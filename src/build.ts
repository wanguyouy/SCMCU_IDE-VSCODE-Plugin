// build.ts — 编译编排：读 .scw → 调 picc（IDE 完整参数）→ 生成 .scx + 错误诊断
// build.ts — Build orchestration: Read .scw → Invoke picc (with full IDE parameters) → Generate .scx + provide error diagnostics
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { findScwFile, parseScw, loadChipParams, listCandidateSources, ScwInfo } from './chip';
import { findCompilerDir } from './compiler';
import { hexToScx, calcCfgChecks } from './scx';

// 编译错误/警告诊断集合（Problem 面板）
// Collection of compilation errors/warnings (Problems panel)
const diagCollection = vscode.languages.createDiagnosticCollection('scmcu');

export async function buildProject(workspaceRoot: string, channel: vscode.OutputChannel): Promise<boolean> {
    diagCollection.clear();
    const cfg = vscode.workspace.getConfiguration('scmcu');
    const scw = findScwFile(workspaceRoot);
    let info: ScwInfo;
    if (scw) {
        info = parseScw(scw);
        if (!info.device) {
            err(channel, vscode.l10n.t('The .scw file is missing a Device= entry.'));
            return false;
        }
    } else {
        // ---- 脱离 .scw 模式：从插件设置合成工程信息 ----
        // ---- Moving away from .scw mode: Synthesizing project information from plugin settings ----
        const dev = cfg.get<string>('device', '');
        if (!dev) {
            err(channel, vscode.l10n.t("No .scw project file was found, and scmcu.device is not configured. Enter a chip model in Settings > Extensions > SCMCU, or add a .scw file."));
            return false;
        }
        const cw = (cfg.get<string[]>('configWords', []) || []).map(s => parseInt(s, 16) & 0xFFFF);
        // scmcu.sourceFiles 非空 → 优先使用设置中的源文件清单（顺序与维护通过「源文件管理」面板）
        //                       空 → 走自动扫描（按字母序扫工程下 .c/.asm/.s）
        // scmcu.sourceFiles: If non-empty, the list of source files specified in the settings is used (in the order maintained via the "Source File Management" panel).
        //                  If empty, an automatic scan is performed (searching for .c, .asm, and .s files within the project, in alphabetical order).

        const overrideSources = (cfg.get<string[]>('sourceFiles', []) || []).filter(s => s && s.trim().length > 0);
        info = { device: dev, sourceFiles: overrideSources, headFiles: [], configWords: cw, optValue: '', warningValue: '' };
        if (overrideSources.length === 0) {
            info.sourceFiles = listCandidateSources(workspaceRoot, []);
        }
        channel.appendLine(vscode.l10n.t(
            overrideSources.length > 0
                ? '[SCMCU] No .scw file found. Building in .scw-less mode (chip from scmcu.device; source files from scmcu.sourceFiles).'
                : '[SCMCU] No .scw file found. Building in .scw-less mode (chip from scmcu.device; source files detected automatically).'
        ));
        if (cw.length === 0) {
            channel.appendLine(vscode.l10n.t(
                '[SCMCU] scmcu.configWords is not configured. Using the chip\'s default unprogrammed configuration words. Verify hardware options (oscillator, watchdog, LVR, etc.) before programming.'
            ));
        }
    }

    const comp = findCompilerDir();
    if (!comp) {
        err(channel, vscode.l10n.t(
            'Compiler not found (picc.exe). Run "SCMCU: Configure Compiler Directory" or "SCMCU: Detect Compiler Automatically".'
        )); return false;
    }
    const params = loadChipParams(comp.idePath, info.device);
    const buildDir = path.join(workspaceRoot, cfg.get<string>('buildDir', 'build'));
    const outName = cfg.get<string>('outputName', 'SCMCU_Project');
    const sourceDirsCfg = cfg.get<string[]>('sourceDirs', ['src']);
    const includeDirsCfg = cfg.get<string[]>('includeDirs', ['inc']);
    if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
    const hexPath = path.join(buildDir, outName + '.hex');
    const scxPath = path.join(buildDir, outName + '.scx');

    // 按 .scw 的 SourceFile 顺序收集（顺序影响 XC8 psect 分配，必须与 IDE 一致）
    // 查找顺序：用户配置 sourceDirs → 根目录 → 常见目录
    // Collect files in the order specified in the .scw SourceFile list (this order affects XC8 psect allocation and must match the IDE)
    // Search order: user-configured sourceDirs → root directory → common directories
    const srcs: string[] = [];
    const missing: string[] = [];
    for (const f of info.sourceFiles) {
        const resolved = resolveSource(f, workspaceRoot, sourceDirsCfg);
        if (resolved) srcs.push(resolved);
        else missing.push(f);
    }
    if (srcs.length === 0) {
        const listed = info.sourceFiles.join(', ') || '—';

        const sourceError =
            'No usable source files were found. .scw SourceFile entries: {0}.\n' +
            'Current scmcu.sourceDirs setting: [{1}].\n' +
            'Fix: configure the correct source directory in Settings, or add a subdirectory prefix to the SourceFile= entry in .scw (for example, src\\init.c).';

        err(channel, vscode.l10n.t(
            sourceError,
            listed,
            sourceDirsCfg.join(', ')
        ));

        channel.appendLine(vscode.l10n.t(
            '[SCMCU] SourceFile entries not found: {0}',
            missing.join(', ')
        ));
        return false;
    }
    if (missing.length > 0) {
        channel.appendLine(vscode.l10n.t(
            '[SCMCU] The following SourceFile entries were not found and were skipped: {0}',
            missing.join(', ')
        ));
    }

    // 收集 include 路径：①源文件所在目录 ②用户 includeDirs ③工程根目录 ④IDE include
    // Collect include paths: ① directory containing the source file, ② user-specified includeDirs, ③ project root directory, ④ IDE include paths
    const incDirs: string[] = [];
    for (const s of srcs) {
        const dir = path.dirname(s);
        if (!incDirs.includes(dir)) incDirs.push(dir);
    }
    for (const d of includeDirsCfg) {
        const full = d === '' ? workspaceRoot : path.join(workspaceRoot, d);
        if (fs.existsSync(full) && !incDirs.includes(full)) incDirs.push(full);
    }
    if (!incDirs.includes(workspaceRoot)) incDirs.push(workspaceRoot);
    incDirs.push(path.join(comp.idePath, 'data', 'include'));

    // 错误输出格式化为可解析格式（不影响 hex/scx 产物）
    // 注意: 路径必须打头(路径:行:列)，VS Code 输出面板才能自动识别为 Ctrl+点击链接
    // Format error output into a machine-parsable format (does not affect hex/scx build artifacts)
    // Note: The path must come first (path:line:column) so that the VS Code output panel can automatically recognize it as a clickable link (Ctrl+click)
    const errFmt = '%f:%l:%c: Error[%n] %s';
    const warnFmt = '%f:%l:%c: Warning[%n] %s';
    const msgFmt = '%f:%l:%c: Info[%n] %s';

    const args = [
        `--chip=${info.device}`,
        '--fill=0xFFFF', '--output=intel',
        '-D__DEBUG=1', '-g', '--asmlist',
        `--warn=${info.warningValue || '-9'}`,
        '--runtime=default,',
        `--opt=${info.optValue || '-local,-asmfile,+asm,-speed,+space,-debug'}`,
        '--stack=compiled:auto:auto:auto',
        '--addrqual=request', '--mode=pro',
        `--errformat=${errFmt}`, `--warnformat=${warnFmt}`, `--msgformat=${msgFmt}`,
        ...incDirs.map(d => `-I${d}`),
        `-O${hexPath}`,
        ...srcs,
    ];

    channel.appendLine(vscode.l10n.t(
        '================ SCMCU Build ================'
    ));

    const projectName = scw
        ? path.basename(scw)
        : `(${vscode.l10n.t('Without .scw mode')})`;

    channel.appendLine(vscode.l10n.t(
        '[SCMCU] Project: {0}',
        projectName
    ));

    channel.appendLine(vscode.l10n.t(
        '[SCMCU] Chip: {0}  ROM: {1} words',
        info.device,
        params.romWords
    ));

    channel.appendLine(vscode.l10n.t(
        '[SCMCU] Compiler: {0}',
        path.join(comp.binDir, 'picc.exe')
    ));

    channel.appendLine(vscode.l10n.t(
        '[SCMCU] Source files ({0}): {1}',
        srcs.length,
        srcs.map(s => path.basename(s)).join(' ')
    ));

    channel.appendLine(vscode.l10n.t(
        '[SCMCU] Include directories: {0}',
        incDirs.map(d => path.basename(d) || d).join(' | ')
    ));

    channel.appendLine('');

    const ok = await runPicc(path.join(comp.binDir, 'picc.exe'), args, workspaceRoot, channel, (lines) => {
        applyDiagnostics(lines, workspaceRoot);
    });
    if (!ok) {
        err(channel, vscode.l10n.t(
            'Build failed. See the picc output above; errors are also available in the Problems panel and can be clicked to navigate.'
        ));
        return false;
    }
    // ---- 生成 .scx 烧录文件 ----
    // ---- Generate .scx programming file ----
    try {
        const hexText = fs.readFileSync(hexPath, 'utf-8');
        let words = info.configWords.slice(0, 4);
        while (words.length < 4) words.push(0xFFFF);
        const scx = hexToScx(hexText, info.device, words, params.romWords, params.hexmcu);
        fs.writeFileSync(scxPath, scx);
        channel.appendLine('');
        // 配置字没人读得懂，紧跟一行 IDE 硬件选项面板的同款文案（WDT=DISABLE / LVR_SEL=1.8V …）

        // 配置槽数 = 该芯片的配置字数：权威来源 mcu/ini/<chip>.ini 的 CONFIGLENTH+1
        // （.scw 的 config 会用 FFFF 补齐到 4 个，不能作为槽数依据，如 SC8F052=2 槽、SC8P052B=3 槽）
        // Number of configuration slots = number of configuration words for the given chip: defined as CONFIGLENTH + 1 in the authoritative source file (mcu/ini/<chip>.ini).
        // (Note: The configuration data in .scw files is padded with FFFF values ​​to a total of 4 entries; therefore, it cannot be used to determine the actual number of slots—e.g., the SC8F052 has 2 slots, while the SC8P052B has 3 slots.)

        const { sum, crc } = calcCfgChecks(scx, params.romWords, params.configWordCount || undefined);
        channel.appendLine(`[SCMCU] CfgCRC(Hex) -- 0x${crc.toString(16).toUpperCase().padStart(4, '0')}  CfgSum(Hex) -- 0x${sum.toString(16).toUpperCase().padStart(4, '0')}`);
        channel.appendLine(vscode.l10n.t(
            '[SCMCU] Build succeeded'
        ));

        vscode.window.showInformationMessage(vscode.l10n.t(
            'SCMCU build succeeded: {0}',
            path.basename(scxPath)
        ));
    } catch (e: any) {
        err(channel, vscode.l10n.t(
            'Failed to generate the .scx file: {0}',
            e.message
        ));
        return false;
    }
    return true;
}

// 解析 SourceFile：带路径按字面拼；不带则按 sourceDirs → 根目录 → 常见目录兜底

export function resolveSource(f: string, workspaceRoot: string, sourceDirs: string[]): string | null {
    if (f.includes('\\') || f.includes('/')) {
        const p = path.join(workspaceRoot, f);
        return fs.existsSync(p) ? p : null;
    }
    const candidates: string[] = [];
    for (const d of sourceDirs) {
        if (d !== '') candidates.push(path.join(workspaceRoot, d));
    }
    candidates.push(workspaceRoot); // 根目录兜底
    for (const sub of ['src', 'source', 'Src', 'sources', 'Source']) {
        candidates.push(path.join(workspaceRoot, sub));
    }
    for (const p of candidates) {
        const fq = path.join(p, f);
        if (fs.existsSync(fq)) return fq;
    }
    return null;
}

// 解析 picc 格式化的错误/警告 → VS Code 诊断（Problem 面板，可点击跳转）
function applyDiagnostics(lines: string[], workspaceRoot: string): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    // 新格式: 路径:行:列: Error[编号] 消息 (路径打头, VS Code 输出面板自动出 Ctrl+点击链接)
    // Windows 盘符含冒号(C:\)，文件名段必须用非贪婪 .+? 匹配到 ":数字:数字:" 为止
    const DIAG_RE = /^(.+?):(\d+)(?::(\d+))?:\s*(Error|Warning|Info)\[(\d+)\]\s*(.*)$/;
    for (const raw of lines) {
        const m = raw.trim().match(DIAG_RE);
        if (!m) continue;
        const sev = m[4];
        const ln = Math.max(0, parseInt(m[2], 10) - 1);
        const col = m[3] ? Math.max(0, parseInt(m[3], 10) - 1) : 0;
        const msg = `${m[5]} - ${m[6]}`;
        const severity = sev === 'Error'
            ? vscode.DiagnosticSeverity.Error
            : sev === 'Warning'
                ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Information;
        const diag = new vscode.Diagnostic(
            new vscode.Range(ln, col, ln, Math.max(col + 1, ln + 1)),
            msg,
            severity,
        );
        diag.source = 'SCMCU';
        let file = m[1].trim();
        if (!path.isAbsolute(file)) file = path.join(workspaceRoot, file);
        const key = file.toLowerCase();
        if (!byFile.has(key)) byFile.set(key, []);
        byFile.get(key)!.push(diag);
    }
    for (const [key, diags] of byFile) {
        diagCollection.set(vscode.Uri.file(key), diags);
    }
}

// 解码 picc 控制台输出。在中文 Windows 上 picc 以 GBK(代码页 936) 输出，
// 若按默认 UTF-8 解码，中文路径会变成乱码（如 f:/gat/????/...），
// 既无法在输出面板正确显示，诊断也无法定位到真实文件。这里优先按 GBK 解码。
function makeGbkDecoder(): any {
    const TD: any = (globalThis as any).TextDecoder || require('util').TextDecoder;
    try {
        return new TD('gbk');
    } catch {
        return new TD('utf-8');
    }
}

// picc 在缺少列号时会输出 "路径:行:: 级别[编号] 信息"（双冒号、列号缺失），
// 该格式既无法被 VS Code 输出面板的 Ctrl+点击 链接识别，也不匹配诊断正则。
// 补一个列号(1)统一成 "路径:行:列:" 形式，Warning 也能点击跳转。
function normalizeDiagLine(l: string): string {
    return l.replace(/^(.+?:\d+)::(\s*(?:Error|Warning|Info)\[)/, '$1:1:$2');
}

function runPicc(
    exe: string,
    args: string[],
    cwd: string,
    channel: vscode.OutputChannel,
    onLines?: (lines: string[]) => void,
): Promise<boolean> {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(exe, args, { cwd });
        } catch (e: any) {
            channel.appendLine(vscode.l10n.t(
                '[SCMCU] Failed to start the compiler: {0}',
                e.message
            ));
            resolve(false);
            return;
        }
        let buf = '';
        const collected: string[] = [];
        const decoder = makeGbkDecoder();
        const onData = (d: Buffer) => {
            buf += decoder.decode(d, { stream: true });
            const lines = buf.split(/\r?\n/);
            buf = lines.pop() || '';
            for (const l of lines) {
                const norm = normalizeDiagLine(l);
                if (norm.trim()) {
                    channel.appendLine(norm);
                    collected.push(norm);
                }
            }
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (e) => {
            channel.appendLine(vscode.l10n.t(
                '[SCMCU] Failed to start the compiler: {0}',
                e.message
            ));
        });
        child.on('close', (code) => {
            buf += decoder.decode(); // 冲刷末尾可能跨块的多字节字符
            if (buf.trim()) {
                const norm = normalizeDiagLine(buf.trim());
                channel.appendLine(norm);
                collected.push(norm);
            }
            channel.appendLine('');

channel.appendLine(vscode.l10n.t(
    '[SCMCU] picc exit code: {0}',
    code
));
            if (onLines) onLines(collected);
            resolve(code === 0);
        });
    });
}

function err(channel: vscode.OutputChannel, msg: string): void {
    channel.appendLine('[SCMCU] ❌ ' + msg);
    vscode.window.showErrorMessage(
        vscode.l10n.t('SCMCU: {0}', msg)
    );
}