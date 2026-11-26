// flash.ts — 下载通道选择：Writer 烧录器走 ScmcuFlashHelper.exe 烧 .scx，CMS-ICE6 仿真器走 ice6_flash.py 烧 .hex
// 由「一键编译下载」(scmcu.buildAndFlash) 与「只下载」(scmcu.flash) 共用。
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { detectProgrammers } from './programmer';
import { findCompilerDir } from './compiler';

// 烧录助手(ScmcuFlashHelper.exe)是 .NET 程序，以 UTF-8 输出中文状态；
// 故用 UTF-8 流式解码，失败回退 GBK。
function makeFlashDecoder(): any {
    try { return new TextDecoder('utf-8'); } catch (e) {}
    try { return new TextDecoder('gbk'); } catch (e) {}
    return new TextDecoder('gb2312');
}


export interface FlashResult { ok: boolean; message: string; }

// 判定目录是否为 SCMCU Writer 安装目录（library/Writer.Core.dll + data/system.info + data/database.db）
export function isWriterDir(dir: string): boolean {
    try {
        return fs.existsSync(path.join(dir, 'library', 'Writer.Core.dll'))
            && fs.existsSync(path.join(dir, 'data', 'system.info'))
            && fs.existsSync(path.join(dir, 'data', 'database.db'));
    } catch { return false; }
}

// 查找 Writer 安装目录：优先 scmcu.writerPath 设置，其次扫描盘符根目录 SCMCU_Writer* 命名的目录
export function findWriterDir(): string | null {
    const cfg = vscode.workspace.getConfiguration('scmcu');
    const custom = (cfg.get<string>('writerPath', '') || '').trim();
    if (custom) {
        if (isWriterDir(custom)) return custom;
        // 用户配置了但不可用，继续自动探测并给出提示由调用方处理
    }
    const drives = ['C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'I:', 'J:'];
    // 候选父目录：盘符根 + 常见软件目录（Work / Program Files / Program Files (x86)）
    const parents = ['', 'Work', 'Program Files', 'Program Files (x86)', 'gat', 'gat\\sheet\\中微'];
    const seen = new Set<string>();
    for (const drv of drives) {
        for (const sub of parents) {
            const dir = drv + '\\' + (sub ? sub + '\\' : '');
            if (!fs.existsSync(dir)) continue;
            let entries: string[] = [];
            try { entries = fs.readdirSync(dir); } catch { continue; }
            for (const e of entries) {
                if (!/^SCMCU_Writer/i.test(e)) continue;
                const full = path.join(dir, e);
                if (seen.has(full)) continue;
                seen.add(full);
                if (isWriterDir(full)) return full;
            }
        }
    }
    return null;
}

// 运行时解析：优先用插件自带的 embeddable Python（flash/py/python.exe），
// 装完扩展即可下载，不需要用户另装 Python；SCMCU_BUILD_PY 可强制指定（改脚本调试时用），
// 两者都没有才回落到 PATH 里的 python。
function resolvePython(iceScript: string): { exe: string; bundled: boolean } {
    const override = process.env.SCMCU_BUILD_PY;
    if (override) {
        return { exe: override, bundled: false };
    }
    const bundled = path.join(path.dirname(iceScript), 'py', 'python.exe');
    if (fs.existsSync(bundled)) {
        return { exe: bundled, bundled: true };
    }
    return { exe: 'python', bundled: false };
}

// 通过 CMS-ICE6（VID 0x0925）仿真器下载：调用纯 Python 脚本逐字节复刻 IDE 下载帧序列。
// 该脚本内嵌 HID 通信(ctypes 标准库)与 IDE 抓包的控制帧(含 0x17 高压参数)，零 pip 依赖；
// 配套的 embeddable Python 运行时随扩展一起分发（flash/py/），因此无需预装 Python。
// hexPath: Intel HEX 固件; iceScript: flash/ice6_flash.py 绝对路径。
export async function flashIce6(
    hexPath: string,
    iceScript: string,
    channel: vscode.OutputChannel
): Promise<FlashResult> {
    if (!fs.existsSync(hexPath)) {
        return { ok: false, message: vscode.l10n.t('HEX firmware file not found: {0}', hexPath) };
    }
    if (!fs.existsSync(iceScript)) {
        return { ok: false, message: vscode.l10n.t('The CMS-ICE6 programming script is missing: {0} (the extension installation may be incomplete).', iceScript) };
    }
    const pyInfo = resolvePython(iceScript);
    const py = pyInfo.exe;
    // 脚本要按芯片名读 IDE 的硬件选项模板 <IDE>/mcu/config/<chip>.cfg，
    // 把配置字翻成 WDT=DISABLE / LVR_SEL=1.8V 这类可读状态（找不到 IDE 时自动跳过）。
    const comp = findCompilerDir();
    const extraArgs = comp ? ['--ide=' + comp.idePath] : [];

    // 进度只占一行：脚本不发逐档进度行，而是用 @@P 标记报「第几段/共多少」，
    // 这里解析后写进底栏状态条（一行滚动），输出面板每个步骤只留一行结果。
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.name = vscode.l10n.t('SCMCU programming progress');
    item.text = vscode.l10n.t('$(sync~spin) SCMCU Programming...');
    item.show();

    return new Promise<FlashResult>((resolve) => {
        let errText = '';
        let pending = '';
        let child;
        const progressLabels: Record<string, string> = {
            '擦除': vscode.l10n.t('Erasing'),
            '下载': vscode.l10n.t('Programming'),
            '补烧': vscode.l10n.t('Retry programming'),
            '校验': vscode.l10n.t('Verifying'),
            '复验': vscode.l10n.t('Rechecking'),
        };
        const handleLine = (line: string) => {
            if (line.startsWith('@@P\t')) {
                const [, label, done, total] = line.split('\t');
                if (label && done && total) item.text = `$(sync~spin) ${progressLabels[label] || label} ${done}/${total}`;
                return;
            }
            channel.appendLine(line);
        };
        try {
            child = spawn(py, [iceScript, hexPath, ...extraArgs], {
                cwd: path.dirname(iceScript),
                env: { ...process.env, SCMCU_PROGRESS: '1' },
            });
        } catch (e: any) {
            item.dispose();
            resolve({
                ok: false,
                message: vscode.l10n.t('Unable to start the programming runtime ({0}): {1}', py, e.message),
            });
            return;
        }
        const outDec = makeFlashDecoder();
        child.stdout?.on('data', (c: Buffer) => {
            pending += outDec.decode(c, { stream: true });
            const lines = pending.split('\n');
            pending = lines.pop() || '';
            for (const raw of lines) handleLine(raw.replace(/\r$/, ''));
        });
        child.stderr?.on('data', (c: Buffer) => {
            const s = outDec.decode(c, { stream: true });
            errText += s;
            channel.append(s);
        });
        child.on('error', (e) => {
            item.dispose();
            const msg = pyInfo.bundled
                ? vscode.l10n.t('The bundled programming runtime failed to start (it may be blocked by antivirus or the extension installation may be incomplete): {0}', e.message)
                : vscode.l10n.t('Unable to start Python (install it and add it to PATH, or set SCMCU_BUILD_PY): {0}', e.message);
            resolve({ ok: false, message: msg });
        });
        child.on('close', (code) => {
            item.dispose();
            try {
                pending += outDec.decode();
                if (pending.trim()) handleLine(pending.replace(/\r$/, ''));
            } catch (e) { /* 忽略末尾解码异常 */ }
            channel.appendLine('');
            if (code === 0) {
                resolve({ ok: true, message: vscode.l10n.t('Programming completed') });
            } else {
                const msg = errText.trim();
                resolve({
                    ok: false,
                    message: msg || vscode.l10n.t('CMS-ICE6 programming script exited unexpectedly (code {0}).', String(code)),
                });
            }
        });
    });
}

// 执行烧录。scxPath: 固件文件; helperExe: ScmcuFlashHelper.exe 绝对路径; probe: true=只做链路探测不烧录
export async function flashScx(
    scxPath: string,
    helperExe: string,
    channel: vscode.OutputChannel,
    count: number,
    probe: boolean,
    hexPath?: string,       // CMS-ICE6 下载用的 Intel HEX（buildAndFlash 传入）
    iceScript?: string      // flash/ice6_flash.py 绝对路径
): Promise<FlashResult> {
    if (!fs.existsSync(scxPath) && !(hexPath && fs.existsSync(hexPath))) {
        return { ok: false, message: vscode.l10n.t('Firmware file not found: {0}', scxPath) };
    }
    const devs = await detectProgrammers();
    const normal = devs.find((d) => d.kind === 'writer' && d.mode !== 'bootloader');
    // CMS-ICE6（VID 0x0925）是 ICE 仿真器：走逐字节复刻 IDE 的私有下载脚本，
    // 不能套用 Writer.Core.dll 的 --pid 烧录流程，也**不依赖 SCMCU Writer 是否安装**。
    // 因此这一段必须在 findWriterDir / ScmcuFlashHelper 检查之前判断。
    const ice = devs.find((d) => d.kind === 'ice');
    if (ice && !normal) {
        if (!hexPath || !iceScript) {
            return { ok: false, message: vscode.l10n.t('CMS-ICE6 programming requires a HEX firmware path and the programming script (internal extension error).') };
        }
        channel.appendLine(vscode.l10n.t(
            '[SCMCU] Detected programmer: {0} (VID 0x{1}/PID 0x{2})',
            ice.name, ice.vidHex, ice.pidHex
        ));
        return flashIce6(hexPath, iceScript, channel);
    }
    const writer = findWriterDir();
    if (!writer) {
        return {
            ok: false,
            message: vscode.l10n.t(
                'SCMCU Writer installation directory was not found. Install SCMCU Writer or set scmcu.writerPath in Settings. The directory must contain library/Writer.Core.dll and data/database.db.'
            ),
        };
    }
    if (!fs.existsSync(helperExe)) {
        return {
            ok: false,
            message: vscode.l10n.t('The flash helper program is missing: {0} (the extension installation may be incomplete).', helperExe),
        };
    }
    if (!normal) {
        return {
            ok: false,
            message: devs.length > 0
                ? vscode.l10n.t('The connected programmer is in bootloader mode. Use the firmware upgrade function in SCMCU Writer to restore normal mode.')
                : vscode.l10n.t('No SCMCU programmer or CMS-ICE6 simulator was detected (USB VID 0x1209 / 0x0925). Connect a device and try again.'),
        };
    }

    const args = ['--writer', writer, '--scx', scxPath, '--pid', normal.pidHex];
    // count=0 表示无限(不传 --count，助手默认无限)；>0 才作为烧写次数上限传入
    if (count > 0) args.push('--count', String(count));
    if (probe) args.push('--probe');

    channel.appendLine(vscode.l10n.t(
        '[SCMCU] Flash helper: {0}  Programmer: {1} (PID 0x{2})',
        path.basename(helperExe), normal.name, normal.pidHex
    ));
    channel.appendLine(vscode.l10n.t('[SCMCU] Firmware: {0}  Writer: {1}', scxPath, writer));
    channel.appendLine(vscode.l10n.t(probe ? '[SCMCU] -- Probe mode (no programming) --' : '[SCMCU] -- Starting programming --'));

    return new Promise<FlashResult>((resolve) => {
        let errText = '';
        const child = spawn(helperExe, args, { cwd: path.dirname(helperExe) });
        const outDec = makeFlashDecoder();
        child.stdout.on('data', (c: Buffer) => { channel.append(outDec.decode(c, { stream: true })); });
        child.stderr.on('data', (c: Buffer) => {
            const s = outDec.decode(c, { stream: true });
            errText += s;
            channel.append(s);
        });
        child.on('error', (e) => resolve({
            ok: false,
            message: vscode.l10n.t('Unable to start the flash helper: {0}', e.message),
        }));
        child.on('close', (code) => {
            try { channel.append(outDec.decode()); } catch (e) { /* 忽略末尾解码异常 */ }
            channel.appendLine('');
            if (code === 0) {
                resolve({
                    ok: true,
                    message: probe
                        ? vscode.l10n.t('Link probe passed (no programming performed)')
                        : vscode.l10n.t('Programming completed'),
                });
            } else {
                const msg = errText.trim().replace(/^\[ERROR\]\s*/m, '');
                resolve({
                    ok: false,
                    message: msg || vscode.l10n.t('The flash helper exited unexpectedly (code {0}).', String(code)),
                });
            }
        });
    });
}
