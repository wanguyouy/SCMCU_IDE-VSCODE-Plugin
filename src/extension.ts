// extension.ts — VS Code 扩展入口：注册 SCMCU 命令
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { buildProject } from './build';
import { findCompilerDir } from './compiler';
import { findScwFile, parseScw, writeScwDevice, listChips, loadChipParams, writeScwConfig, normalizeConfigWordsCore } from './chip';
import { showHardwareOptions } from './webview/hardwareOptions';
import { showSourceManager } from './webview/sourceManager';
import { findScxFiles, patchScxConfigWords } from './scx';
import { detectProgrammers } from './programmer';
import { flashScx } from './flash';
import { spawn } from 'child_process';

// ---- 安装即用：激活时自愈烧录助手（exe 缺失自动构建、.config 缺失自动生成）----
const HELPER_CONFIG_XML = '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<configuration>\n'
    + '  <runtime>\n'
    + '    <!-- Writer.Core.dll 等带 Zone.Identifier(来自网络标记)，Assembly.LoadFrom 会视为远程源并抛\n'
    + '         NotSupportedException(0x80131515)；启用该开关以允许从受信本地目录加载。 -->\n'
    + '    <loadFromRemoteSources enabled="true"/>\n'
    + '  </runtime>\n'
    + '</configuration>\n';

// 激活时确保 flash 助手就绪：ScmcuFlashHelper.exe 存在、旁边 .config 存在。
// 缺失时自动生成/自动构建（构建需 Python，失败只提示，不阻塞插件）。
async function ensureFlashHelper(context: vscode.ExtensionContext): Promise<void> {
    const flashDir = path.join(context.extensionPath, 'flash');
    const exe = path.join(flashDir, 'ScmcuFlashHelper.exe');
    const cfg = exe + '.config';
    try { fs.mkdirSync(flashDir, { recursive: true }); } catch { /* 忽略 */ }
    // 1) .config 缺失 → 生成（根治 loadFromRemoteSources 报错）
    if (!fs.existsSync(cfg)) {
        try {
            fs.writeFileSync(cfg, HELPER_CONFIG_XML, 'utf8');
            if (channel) channel.appendLine(vscode.l10n.t('[SCMCU] Flash helper configuration generated: {0}', cfg));
        } catch (e) {
            if (channel) channel.appendLine(vscode.l10n.t('[SCMCU] Failed to generate flash helper configuration: {0}', String(e)));
        }
    }
    // 2) exe 缺失 → 尝试自动构建（python flash/build_helper.py，需 Python + 网络下载 Roslyn）
    //    这里刻意用系统 python 而不是 flash/py 的内置运行时：内置运行时为省体积裁掉了
    //    ssl/_hashlib，跑不了 build_helper.py 里的 HTTPS 下载。正常情况下 exe 随插件分发，
    //    走不到这个分支。
    if (!fs.existsSync(exe)) {
        const py = process.env.SCMCU_BUILD_PY || 'python';
        const script = path.join(flashDir, 'build_helper.py');
        if (channel) channel.appendLine(vscode.l10n.t(
            '[SCMCU] Flash helper not found. Building it automatically (the first build requires downloading the Roslyn compiler)...'
        ));
        const child = spawn(py, [script], { cwd: flashDir });
        child.stdout.on('data', (c: Buffer) => { if (channel) channel.append(c.toString('utf8')); });
        child.stderr.on('data', (c: Buffer) => { if (channel) channel.append(c.toString('utf8')); });
        child.on('error', (e) => {
            if (channel) channel.appendLine(vscode.l10n.t(
                '[SCMCU] Automatic build failed (could not start Python): {0}. You can run it manually: {1} {2}',
                e.message, py, script
            ));
        });
        child.on('close', (code) => {
            if (channel) channel.appendLine(code === 0
                ? vscode.l10n.t('[SCMCU] Flash helper build completed')
                : vscode.l10n.t(
                    '[SCMCU] Automatic build failed (exit code {0}). You can run it manually: {1} {2}',
                    String(code), py, script
                ));
        });
    }
}

// 插件是否已加载（保证「SCMCU: 启动」命令幂等，不重复注册）
let scmcuLoaded = false;
// 全局输出通道，供编译等命令处理器使用（在 startScmcu 中初始化）
let channel!: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // 始终注册「启动」命令：即使本次因无 .scw 且用户选择不加载，也可稍后手动启用
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.startup', () => startScmcu(context)));

    const root = getWorkspaceRoot();
    if (root && !findScwFile(root)) {
        // 找不到 .scw：按 scmcu.noScwBehavior 决定（skip=不加载 / load=直接加载 / prompt=弹窗）
        const ok = await promptNoScw();
        if (!ok) {
            return; // 本次不加载；可运行「SCMCU: 启动」命令启用
        }
    }
    startScmcu(context);
}

// 加载 SCMCU 插件功能：注册全部命令、状态栏等。幂等，重复调用不会重复注册。
function startScmcu(context: vscode.ExtensionContext): void {
    if (scmcuLoaded) {
        vscode.window.showInformationMessage(vscode.l10n.t('SCMCU features are already loaded'));
        return;
    }
    scmcuLoaded = true;
    channel = vscode.window.createOutputChannel('SCMCU');
    context.subscriptions.push(channel);

    // 安装即用：后台自愈烧录助手（不阻塞激活）
    void ensureFlashHelper(context);

    // ---- 编译 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.build', async () => {
        const root = workspaceRoot();
        if (!root) return;
        channel.clear();
        channel.show(true);
        await buildProject(root, channel);
    }));

    // ---- 一键编译下载：编译成功后调用烧录通道（Writer 烧录器 或 CMS-ICE6 仿真器）----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.buildAndFlash', async () => {
        const root = workspaceRoot();
        if (!root) return;
        channel.clear();
        channel.show(true);
        const built = await buildProject(root, channel);
        if (!built) return;
        await flashBuildArtifacts(context, root);
    }));

    // ---- 只下载：跳过编译，直接烧写 build 目录中上一次的固件 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.flash', async () => {
        const root = workspaceRoot();
        if (!root) return;
        channel.clear();
        channel.show(true);
        await flashBuildArtifacts(context, root);
    }));

    // ---- 硬件选项 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.hardwareOptions', () => {
        const root = workspaceRoot();
        if (!root) return;
        showHardwareOptions(context, root, channel);
    }));

    // ---- 选择芯片 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.selectChip', async () => {
        const root = getWorkspaceRoot();
        if (!root) { vscode.window.showWarningMessage(vscode.l10n.t('Please open a folder containing an .scw project.')); return; }
        const scw = findScwFile(root);
        if (!scw) { vscode.window.showErrorMessage(vscode.l10n.t('No .scw project file was found.')); return; }
        const comp = findCompilerDir();
        if (!comp) { vscode.window.showErrorMessage(vscode.l10n.t('Compiler not found. Please configure it first.')); return; }
        const chips = listChips(comp.idePath);
        if (chips.length === 0) {
            vscode.window.showErrorMessage(vscode.l10n.t(
                'No chip models were found in: {0}',
                path.join(comp.idePath, 'mcu', 'config')
            ));
            return;
        }
        const current = parseScw(scw).device;
        const pick = await vscode.window.showQuickPick(
            chips.map(c => ({ label: c, description: c === current ? vscode.l10n.t('Current') : undefined })),
            { placeHolder: vscode.l10n.t('Current chip: {0}. Select a new chip.', current) },
        );
        if (!pick) return;
        writeScwDevice(scw, pick.label);
        updateStatusBar(chipStatus, cfgStatus, buildStatus, srcStatus);
        vscode.window.showInformationMessage(vscode.l10n.t(
            'Chip changed to {0}. Reopen Hardware Options to verify the configuration.',
            pick.label
        ));
    }));

    // ---- 配置编译器目录 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.configureCompiler', async () => {
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const cur = cfg.get<string>('idePath', '') || '';
        const val = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Enter the SCMCU_IDE installation root directory (must contain mcu\\config and data\\bin\\picc.exe)'),
            value: cur,
            placeHolder: vscode.l10n.t('e.g. C:\\Program Files (x86)\\SCMCU_IDE_V2.00.17'),
        });
        if (val === undefined || val.trim() === '') return;
        const ide = val.trim().replace(/\\+$/, '');
        const bin = path.join(ide, 'data', 'bin');
        if (fs.existsSync(path.join(bin, 'picc.exe')) && fs.existsSync(path.join(ide, 'mcu'))) {
            await cfg.update('compilerPath', bin, vscode.ConfigurationTarget.Global);
            await cfg.update('idePath', ide, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(vscode.l10n.t('Compiler configured: {0}', bin));
        } else {
            vscode.window.showWarningMessage(vscode.l10n.t(
                'The specified directory does not contain data\\bin\\picc.exe or the mcu directory. Please check the path.'
            ));
        }
    }));

    // ---- 自动检测编译器 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.detectCompiler', async () => {
        const found = findCompilerDir();
        if (found) {
            const cfg = vscode.workspace.getConfiguration('scmcu');
            await cfg.update('compilerPath', found.binDir, vscode.ConfigurationTarget.Global);
            await cfg.update('idePath', found.idePath, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(vscode.l10n.t('Compiler detected automatically: {0}', found.binDir));
        } else {
            vscode.window.showErrorMessage(vscode.l10n.t(
                'Compiler was not detected automatically. Use "SCMCU: Configure Compiler Directory" to specify it manually.'
            ));
        }
    }));

    // ---- 源文件管理 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.manageSources', () => {
        const root = getWorkspaceRoot();
        if (!root) { vscode.window.showWarningMessage(vscode.l10n.t('Please open a folder containing an .scw project.')); return; }
        showSourceManager(context, root, channel);
    }));

    // ---- 脱离 .scw：设置芯片型号 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.setDevice', async () => {
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const cur = cfg.get<string>('device', '') || '';
        const val = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Chip model to use when building without a .scw file (e.g. SC8F052A04)'),
            value: cur,
            placeHolder: vscode.l10n.t('e.g. SC8F052A04'),
        });
        if (val === undefined) return;
        const dev = val.trim();
        if (dev === '') { vscode.window.showWarningMessage(vscode.l10n.t('Chip model cannot be empty.')); return; }
        await cfg.update('device', dev, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(vscode.l10n.t('Set scmcu.device = {0} (saved in workspace settings)', dev));
        updateStatusBar(chipStatus, cfgStatus, buildStatus, srcStatus);
    }));

    // ---- 脱离 .scw：设置配置字 ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.setConfigWords', async () => {
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const cur = (cfg.get<string[]>('configWords', []) || []).join(', ');
        const val = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Enter the four configuration words for builds without .scw (hexadecimal, comma-separated, e.g. 0x1FFF, 0x3FFF, 0x3FFF, 0x3FFF)'),
            value: cur,
            placeHolder: '0x1FFF, 0x3FFF, 0x3FFF, 0x3FFF',
        });
        if (val === undefined) return;
        const parts = val.split(',').map(s => s.trim()).filter(s => s.length > 0);
        await cfg.update('configWords', parts, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(parts.length
            ? vscode.l10n.t('Set scmcu.configWords = [{0}]', parts.join(', '))
            : vscode.l10n.t('Cleared scmcu.configWords. Builds without .scw will use the default unprogrammed configuration words and show a warning.'));
    }));

    // ---- 规范化配置字（对齐芯片规范，修复"换芯片串配置字"导致的高位/隐藏位错误） ----
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.fixConfigWords', async () => {
        await normalizeConfigWords();
    }));

    // ---- 状态栏：芯片型号（点击切换）+ 芯片设置 + 构建 + 源文件 ----
    const chipStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    chipStatus.command = 'scmcu.selectChip';
    context.subscriptions.push(chipStatus);
    const cfgStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    cfgStatus.command = 'scmcu.hardwareOptions';
    context.subscriptions.push(cfgStatus);
    const buildStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
    buildStatus.command = 'scmcu.build';
    context.subscriptions.push(buildStatus);
    // 只下载：跳过编译，直接烧写 build 目录里上一次的固件（位于「编译」与「一键编译下载」之间）
    const downloadStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
    downloadStatus.command = 'scmcu.flash';
    downloadStatus.text = '$(cloud-download)';
    downloadStatus.tooltip = vscode.l10n.t('Flash without building: program the existing firmware in the build directory');
    context.subscriptions.push(downloadStatus);
    downloadStatusItem = downloadStatus;
    const flashStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
    flashStatus.command = 'scmcu.buildAndFlash';
    flashStatus.text = '$(zap)';
    flashStatus.tooltip = vscode.l10n.t('Build and flash to the programmer');
    context.subscriptions.push(flashStatus);
    flashStatusItem = flashStatus;
    const srcStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    srcStatus.command = 'scmcu.manageSources';
    context.subscriptions.push(srcStatus);

    // ---- 编程器识别：底栏右侧显示当前连接的 SCMCU 编程器型号（点击立即刷新）----
    const progStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    progStatus.command = 'scmcu.refreshProgrammer';
    context.subscriptions.push(progStatus);
    context.subscriptions.push(vscode.commands.registerCommand('scmcu.refreshProgrammer', () => refreshProgrammerStatus(progStatus, true)));
    startProgrammerWatcher(context, progStatus);

    updateStatusBar(chipStatus, cfgStatus, buildStatus, srcStatus);
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => updateStatusBar(chipStatus, cfgStatus, buildStatus, srcStatus)));

    // 无 .scw（脱离 IDE 工程）时，加载后自动执行一次配置字规范化（幂等，详见 autoNormalizeConfigWords）
    void autoNormalizeConfigWords(context);
}

// 找不到 .scw 时的提示：自定义 webview 通知（真实复选框 + 单个「加载」按钮 + 20 秒无操作自动关闭）
// 返回 true=加载插件，false=不加载。behavior=load/skip 时直接返回，不弹窗。
// 找不到 .scw 时的提示：原生右下角通知（黑框），单个「加载」按钮，无复选框、无倒计时。
// 通知自动消失或用户关闭后选择为空 → 本次不加载。behavior=load/skip 时直接决定，不弹窗。
function promptNoScw(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const behavior = cfg.get<string>('noScwBehavior', 'prompt');
        if (behavior === 'skip') { resolve(false); return; }
        if (behavior === 'load') { resolve(true); return; }
        // 原生通知（右下角黑框）：仅一个「加载」按钮；超时/关闭(Esc)视为本次不加载
        vscode.window.showWarningMessage(
            vscode.l10n.t('No .scw project file was found in this folder. This may not be an SCMCU project. Load SCMCU extension features?'),
            vscode.l10n.t('Load')
        ).then((choice) => {
            resolve(choice === vscode.l10n.t('Load'));
        });
    });
}

// 状态栏刷新：显示当前工程 .scw 的芯片型号；脱离 .scw 模式则显示设置中的型号并仅提供构建
function updateStatusBar(chipStatus: vscode.StatusBarItem, cfgStatus: vscode.StatusBarItem, buildStatus: vscode.StatusBarItem, srcStatus: vscode.StatusBarItem): void {
    const root = getWorkspaceRoot();
    const cfg = vscode.workspace.getConfiguration('scmcu');
    let device = '';
    let scwMode = false;
    if (root) {
        const scw = findScwFile(root);
        if (scw) {
            device = parseScw(scw).device;
        } else {
            scwMode = true;
            device = cfg.get<string>('device', '') || '';
        }
    }
    if (device) {
        chipStatus.text = `$(chip) ${device}`;
        chipStatus.command = scwMode ? 'scmcu.setDevice' : 'scmcu.selectChip';
        chipStatus.tooltip = scwMode
            ? vscode.l10n.t('Click to change chip model (without .scw mode)')
            : vscode.l10n.t('Click to select chip model');
        chipStatus.show();
        buildStatus.text = '$(debug-start)';
        buildStatus.tooltip = vscode.l10n.t('Build');
        buildStatus.show();
        if (downloadStatusItem) downloadStatusItem.show();
        if (flashStatusItem) flashStatusItem.show();
        // 芯片设置 + 源文件按钮在两种模式下都可用：
        //   scw 模式 → 读写 .scw 文件
        //   scw-less 模式 → 读写 scmcu.configWords / scmcu.sourceFiles 工作区设置
        cfgStatus.text = '$(settings-gear)';
        cfgStatus.tooltip = vscode.l10n.t('Hardware Options');
        cfgStatus.show();
        srcStatus.text = '$(file-directory)';
        srcStatus.tooltip = vscode.l10n.t('Manage Source Files');
        srcStatus.show();
    } else {
        chipStatus.text = '$(chip) SCMCU';
        chipStatus.tooltip = root
            ? (scwMode
                ? vscode.l10n.t('scmcu.device is not configured. Cannot build without a .scw file.')
                : vscode.l10n.t('No .scw project file was found.'))
            : vscode.l10n.t('The project folder is not open.');
        chipStatus.show();
        cfgStatus.hide();
        buildStatus.hide();
        if (downloadStatusItem) downloadStatusItem.hide();
        if (flashStatusItem) flashStatusItem.hide();
        srcStatus.hide();
    }
}

// 规范化配置字：按当前芯片模板，用"当前选择 + 未编程值"重建配置字并写回，
// 修复基底串了其它芯片（如 SC8F072 的 FAEF 被带入 SC8F052）或高位残留 F 的问题。
async function normalizeConfigWords(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { vscode.window.showWarningMessage(vscode.l10n.t('Please open a project folder.')); return; }
    const cfg = vscode.workspace.getConfiguration('scmcu');
    const scw = findScwFile(root);
    let device = '';
    let mode: 'scw' | 'scwless';
    let scwPath: string | null = null;
    if (scw) {
        mode = 'scw'; scwPath = scw;
        device = parseScw(scw).device;
    } else {
        mode = 'scwless';
        device = cfg.get<string>('device', '') || '';
    }
    if (!device) { vscode.window.showWarningMessage(vscode.l10n.t('Cannot determine the chip model (no .scw file and scmcu.device is not configured).')); return; }

    const comp = findCompilerDir();
    if (!comp) { vscode.window.showErrorMessage(vscode.l10n.t('Compiler not found. Please configure the SCMCU_IDE path.')); return; }
    const cfgPath = path.join(comp.idePath, 'mcu', 'config', device + '.cfg');
    if (!fs.existsSync(cfgPath)) {
        vscode.window.showErrorMessage(vscode.l10n.t('Chip configuration template not found: {0}', cfgPath));
        return;
    }

    const hexmcu = loadChipParams(comp.idePath, device).hexmcu;

    // 当前配置字基底
    let base: number[];
    if (mode === 'scw') {
        const ws = parseScw(scwPath!).configWords;
        base = ws.length >= 2 ? ws.slice(0, 4) : [hexmcu, hexmcu, hexmcu, hexmcu];
    } else {
        const cw = (cfg.get<string[]>('configWords', []) || []).filter(s => s && s.trim());
        base = cw.length ? cw.map(s => parseInt(s, 16) & 0xFFFF) : [hexmcu, hexmcu, hexmcu, hexmcu];
    }

    // 核心规范化计算：见 chip.ts normalizeConfigWordsCore。
    // 保留模板已定义位，仅复位未定义固定位并按位宽清高位，幂等。
    const resolved = normalizeConfigWordsCore(base, device, comp.idePath);
    const before = base.map(x => x.toString(16).toUpperCase().padStart(4, '0')).join(',');
    const after = resolved.map(x => x.toString(16).toUpperCase().padStart(4, '0')).join(',');

    const buildDir = cfg.get<string>('buildDir', 'build');
    const synced: string[] = [];
    if (mode === 'scw') {
        writeScwConfig(scwPath!, resolved);
        for (const s of findScxFiles(root, buildDir)) {
            if (patchScxConfigWords(s, device, resolved)) synced.push(path.basename(s));
        }
        if (channel) channel.appendLine(vscode.l10n.t(
            '[SCMCU] Configuration words normalized: {0} -> {1} ({2})',
            before, after, path.basename(scwPath!)
        ));
        vscode.window.showInformationMessage(vscode.l10n.t(
            'Configuration words normalized: {0} -> {1}{2}',
            before, after, synced.length ? vscode.l10n.t(', and synchronized to programming files: {0}', synced.join(', ')) : ''
        ));
    } else {
        const hexStrs = resolved.map(x => '0x' + x.toString(16).toUpperCase().padStart(4, '0'));
        await cfg.update('configWords', hexStrs, vscode.ConfigurationTarget.Workspace);
        for (const s of findScxFiles(root, buildDir)) {
            if (patchScxConfigWords(s, device, resolved)) synced.push(path.basename(s));
        }
        const syncText = synced.length
            ? vscode.l10n.t(', and synchronized to programming files: {0}', synced.join(', '))
            : '';
        if (channel) channel.appendLine(vscode.l10n.t(
            '[SCMCU] Automatically normalized configuration words (without .scw): {0} -> {1}{2}',
            before, after, syncText
        ));
        vscode.window.showInformationMessage(vscode.l10n.t(
            'Configuration words normalized: {0} -> {1}{2}',
            before, after, vscode.l10n.t('saved to scmcu.configWords') + syncText
        ));
    }
}

// 自动规范化：检测到工程无 SCMCU IDE 生成的 .scw（脱离 .scw 模式）时自动执行一次配置字规范化。
// 触发条件（全部满足）：无 .scw && 已设 scmcu.device && 已手填 scmcu.configWords &&
//                     编译器已配置 && 有芯片 cfg 模板。
// 行为：仅当规范化结果有变化时才写回 scmcu.configWords（并尽力同步 build 目录 .scx），
//      并弹一次信息提示；已规范（无变化）时静默跳过，不写回不打扰。
// 只自动执行一次：context.workspaceState 记录标记，同工作区后续重开不再自动执行（可手动
//      用「SCMCU: 规范化配置字」）。任何异常静默记日志，避免打断启动。
export async function autoNormalizeConfigWords(context: vscode.ExtensionContext): Promise<void> {
    try {
        const root = getWorkspaceRoot();
        if (!root) return;
        if (findScwFile(root)) return; // 有 .scw = 正常 IDE 工程模式，配置字由 IDE/.scw 维护，不自动改
        const cfg = vscode.workspace.getConfiguration('scmcu');
        const device = cfg.get<string>('device', '') || '';
        if (!device) return; // 未设置芯片型号，无从规范
        const cw = (cfg.get<string[]>('configWords', []) || []).filter(s => s && s.trim());
        if (cw.length === 0) return; // 未手填配置字（用默认未编程值），无串芯片风险，无需规范
        const onceKey = 'configWordsAutoNormalized';
        if (context.workspaceState.get<boolean>(onceKey)) return; // 本工作区只自动执行一次
        const comp = findCompilerDir();
        if (!comp) return; // 编译器未配置：本次跳过，配置后重开窗口会再尝试
        const cfgPath = path.join(comp.idePath, 'mcu', 'config', device + '.cfg');
        if (!fs.existsSync(cfgPath)) return; // 无芯片 cfg 模板，跳过
        const base = cw.map(s => parseInt(s, 16) & 0xFFFF);
        const resolved = normalizeConfigWordsCore(base, device, comp.idePath);
        await context.workspaceState.update(onceKey, true); // 无论是否变化，自动执行仅此一次
        const changed = resolved.some((v, i) => v !== base[i]);
        if (!changed) return; // 已规范化，无变化：不写回、不提示
        const hexStrs = resolved.map(x => '0x' + x.toString(16).toUpperCase().padStart(4, '0'));
        await cfg.update('configWords', hexStrs, vscode.ConfigurationTarget.Workspace);
        const fmt = (arr: number[]) => arr.map(x => x.toString(16).toUpperCase().padStart(4, '0')).join(',');
        const buildDir = cfg.get<string>('buildDir', 'build');
        const synced: string[] = [];
        for (const s of findScxFiles(root, buildDir)) {
            if (patchScxConfigWords(s, device, resolved)) synced.push(path.basename(s));
        }
        const syncText = synced.length
            ? vscode.l10n.t(', and synchronized to programming files: {0}', synced.join(', '))
            : '';
        if (channel) channel.appendLine(vscode.l10n.t(
            '[SCMCU] Automatically normalized configuration words (without .scw): {0} -> {1}{2}',
            fmt(base), fmt(resolved), syncText
        ));
        vscode.window.showInformationMessage(vscode.l10n.t(
            'Detected a project without .scw (not an IDE project). Configuration words were normalized automatically: {0} -> {1}{2}',
            fmt(base), fmt(resolved), syncText
        ));
    } catch (e) {
        if (channel) channel.appendLine(vscode.l10n.t('[SCMCU] Automatic configuration word normalization failed: {0}', String(e)));
    }
}

// ---- 编程器识别（Windows USB HID，VID 0x1209）----
// 型号/PID 表来自官方 SCMCU Writer（Writer.Core.dll）反编译；识别逻辑见 src/programmer.ts。
// 每次枚举 USB 设备约 1s，故仅在窗口聚焦时轮询、失焦停表，避免后台窗口持续空耗 CPU。
const PROGRAMMER_POLL_MS = 5000;
let flashStatusItem: vscode.StatusBarItem | undefined; // 一键编译下载按钮（updateStatusBar 内同步显隐）
let downloadStatusItem: vscode.StatusBarItem | undefined; // 只下载按钮（updateStatusBar 内同步显隐）
let progTimer: NodeJS.Timeout | undefined;
let progPollOn = false;
let progBusy = false;
let progLastText = '';

function startProgrammerWatcher(context: vscode.ExtensionContext, item: vscode.StatusBarItem): void {
    if (process.platform !== 'win32') {
        item.text = vscode.l10n.t('$(circuit-board) Programmer: Unsupported');
        item.tooltip = vscode.l10n.t('SCMCU programmer detection is supported only on Windows (USB HID, VID 0x1209).');
        item.show();
        return;
    }
    item.text = vscode.l10n.t('$(circuit-board) Programmer: Detecting...');
    item.tooltip = vscode.l10n.t('Detecting SCMCU programmer... (click to refresh)');
    item.show();
    const sync = (focused: boolean): void => {
        if (focused) {
            if (!progPollOn) {
                progPollOn = true;
                progTimer = setInterval(() => { void refreshProgrammerStatus(item, false); }, PROGRAMMER_POLL_MS);
            }
        } else {
            progPollOn = false;
            if (progTimer) { clearInterval(progTimer); progTimer = undefined; }
        }
    };
    sync(vscode.window.state.focused);
    context.subscriptions.push(vscode.window.onDidChangeWindowState((s) => sync(s.focused)));
    void refreshProgrammerStatus(item, false); // 首查
}

async function refreshProgrammerStatus(item: vscode.StatusBarItem, verbose: boolean): Promise<void> {
    if (progBusy) return;
    progBusy = true;
    try {
        const devs = await detectProgrammers();
        const one = devs.map(d =>
            `${localizedProgrammerName(d.name)} (VID 0x${d.vidHex} / PID 0x${d.pidHex}${d.mode === 'bootloader' ? vscode.l10n.t(' (bootloader mode)') : ''})`
        ).join(', ');
        let text: string;
        let tip: string;
        if (devs.length === 0) {
            text = vscode.l10n.t('$(circuit-board) Programmer: Not connected');
            tip = vscode.l10n.t(
                'No SCMCU programmer or CMS-ICE6 simulator was detected. Supported Writer programmers: WRITER8 LITE / WRITER V8 / WRITER V8 PRO / ICE8 PRO (VID 0x1209). Supported simulator: CMS-ICE6 (VID 0x0925). Click to refresh.'
            );
        } else {
            text = '$(circuit-board) ' + devs.map(d => d.kind === 'ice'
                ? `${localizedProgrammerName(d.name)} (${vscode.l10n.t('Simulator')})`
                : (d.mode === 'bootloader' ? `${localizedProgrammerName(d.name)} (${vscode.l10n.t('Boot')})` : localizedProgrammerName(d.name))).join(', ');
            tip = devs.map(d => d.kind === 'ice'
                ? vscode.l10n.t(
                    'Detected CMS-ICE6 simulator: {0}\nUSB VID 0x{1} / PID 0x{2}\nClose SCMCU IDE before programming because it can take control of the device.',
                    localizedProgrammerName(d.name), d.vidHex, d.pidHex
                )
                : vscode.l10n.t(
                    'Detected SCMCU programmer: {0}\nUSB VID 0x{1} / PID 0x{2}{3}',
                    localizedProgrammerName(d.name), d.vidHex, d.pidHex,
                    d.mode === 'bootloader'
                        ? `\n${vscode.l10n.t('The programmer is in bootloader mode. Use SCMCU Writer to upgrade its firmware.')}`
                        : ''
                )
            ).join('\n\n') + `\n${vscode.l10n.t('Click to refresh.')}`;
        }
        if (progLastText !== text) { // 内容变化才刷新状态栏，避免闪烁
            progLastText = text;
            item.text = text;
            item.tooltip = tip;
        }
        if (verbose) {
            if (channel) channel.appendLine(vscode.l10n.t('[SCMCU] Programmer detection: {0}', one || vscode.l10n.t('No SCMCU programmer was detected (USB VID 0x1209)')));
            vscode.window.showInformationMessage(devs.length
                ? vscode.l10n.t('Detected programmer: {0}', one)
                : vscode.l10n.t('No SCMCU programmer was detected (USB VID 0x1209)'));
        }
    } catch (e) {
        progLastText = '';
        item.text = vscode.l10n.t('$(circuit-board) Programmer: Detection failed');
        item.tooltip = vscode.l10n.t('Programmer detection error: {0}\nClick to retry.', String(e));
        if (channel) channel.appendLine(vscode.l10n.t('[SCMCU] Programmer detection failed: {0}', String(e)));
        if (verbose) vscode.window.showErrorMessage(vscode.l10n.t('Programmer detection error: {0}', String(e)));
    } finally {
        progBusy = false;
    }
}

function localizedProgrammerName(name: string): string {
    return name === '未知编程器' ? vscode.l10n.t('Unknown programmer') : name;
}

function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// ---- 烧写 build 目录中已有的固件 ----
// 「一键编译下载」编译成功后调用；「只下载」跳过编译直接调用。
// 具体走哪条通道由 flashScx 按当前连接的设备决定：
//   Writer 烧录器（VID 0x1209）→ Writer.Core.dll 烧录 .scx
//   CMS-ICE6 仿真器（VID 0x0925）→ 内置 ice6_flash.py 复刻 IDE HID 会话烧 .hex
async function flashBuildArtifacts(context: vscode.ExtensionContext, root: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('scmcu');
    const buildDir = cfg.get<string>('buildDir', 'build');
    const outName = cfg.get<string>('outputName', 'SCMCU_Project');
    const scxPath = path.join(root, buildDir, outName + '.scx');
    const hexPath = path.join(root, buildDir, outName + '.hex');
    if (!fs.existsSync(scxPath) && !fs.existsSync(hexPath)) {
        vscode.window.showErrorMessage(vscode.l10n.t('Programming file not found (the build should have generated a .scx file): {0}', scxPath));
        return;
    }
    // 脱机烧写次数上限：0=无限（默认），>0=限次。不可强制最小 1，否则会锁成“烧一次即耗尽”。
    const count = cfg.get<number>('flashCount', 0) || 0;
    const helper = context.asAbsolutePath(path.join('flash', 'ScmcuFlashHelper.exe'));
    const iceScript = context.asAbsolutePath(path.join('flash', 'ice6_flash.py'));
    const r = await flashScx(scxPath, helper, channel, count, false, hexPath, iceScript);
    if (r.ok) {
        vscode.window.showInformationMessage(vscode.l10n.t('One-click programming completed: {0}', path.basename(scxPath)));
    } else {
        vscode.window.showErrorMessage(vscode.l10n.t('Download failed: {0}', r.message));
    }
}

function workspaceRoot(): string | undefined {
    const root = getWorkspaceRoot();
    if (!root) {
        vscode.window.showWarningMessage(vscode.l10n.t('Please open a folder containing an .scw project.'));
        return undefined;
    }
    return root;
}

export function deactivate(): void { /* noop */ }
