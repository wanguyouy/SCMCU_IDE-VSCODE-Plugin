// webview/hardwareOptions.ts — 芯片设置面板（读 cfg 模板 → 交互选择 → 写回 .scw 或 scmcu.configWords）
// 单例：整个扩展只允许一个芯片设置窗口，重复打开时聚焦并刷新内容
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    findScwFile, parseScw, parseCfgTemplate, computeConfigWordsFromBase,
    detectCurrentSelections, writeScwConfig, loadChipParams, CfgTemplate, ScwInfo,
} from '../chip';
import { findCompilerDir } from '../compiler';
import { findScxFiles, patchScxConfigWords } from '../scx';

let panelRef: vscode.WebviewPanel | undefined;

export function showHardwareOptions(context: vscode.ExtensionContext, workspaceRoot: string, channel: vscode.OutputChannel): void {
    // 读取当前工程数据（.scw / 配置模板 / 当前配置字）—— scw 与 scw-less 两种模式都支持
    const data = loadPanelData(workspaceRoot);
    if (!data) return;

    // 已有窗口 → 聚焦 + 刷新内容（配置可能已被外部修改）；panelRef 由 onDidDispose 置空
    if (panelRef) {
        panelRef.reveal();
        panelRef.webview.html = renderHtml(data);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'scmcu.hardwareOptions',
        vscode.l10n.t('Chip Settings - {0}', data.device),
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true },
    );
    panelRef = panel;
    panel.onDidDispose(() => { if (panelRef === panel) panelRef = undefined; });

    const render = () => {
        const d = loadPanelData(workspaceRoot);
        if (d && panelRef === panel) {
            panel.webview.html = renderHtml(d);
        }
    };

    panel.webview.html = renderHtml(data);

    // 工具函数：把配置字写回存储（按当前 data.mode 选择 .scw 或设置）
    const persist = async (w: number[], logLabel: string): Promise<string[]> => {
        const synced: string[] = [];
        if (data.mode === 'scw') {
            writeScwConfig(data.scw!, w);
            // 一并写入已有烧录文件(.scx)的配置字区，程序区不动
            const buildDir = vscode.workspace.getConfiguration('scmcu').get<string>('buildDir', 'build');
            for (const scxPath of findScxFiles(workspaceRoot, buildDir)) {
                if (patchScxConfigWords(scxPath, data.device, w)) synced.push(path.basename(scxPath));
            }
            channel.appendLine(vscode.l10n.t(
                '[SCMCU] Chip settings saved{0}: config={1} -> {2}',
                logLabel, formatWords(w), path.basename(data.scw!)
            ));
        } else {
            // scw-less：写入 scmcu.configWords（十六进制字符串数组）
            const cfg = vscode.workspace.getConfiguration('scmcu');
            const hexStrs = w.map(x => '0x' + x.toString(16).toUpperCase().padStart(4, '0'));
            await cfg.update('configWords', hexStrs, vscode.ConfigurationTarget.Workspace);
            channel.appendLine(vscode.l10n.t(
                '[SCMCU] Chip settings saved{0}: scmcu.configWords={1} (workspace settings)',
                logLabel, formatWords(w)
            ));
            // 同步覆盖已有 .scx 的配置字（程序区不动），这样烧录文件与设置保持一致
            const buildDir = cfg.get<string>('buildDir', 'build');
            for (const scxPath of findScxFiles(workspaceRoot, buildDir)) {
                if (patchScxConfigWords(scxPath, data.device, w)) synced.push(path.basename(scxPath));
            }
        }
        return synced;
    };

    panel.webview.onDidReceiveMessage(async (msg: any) => {
        if (msg.type === 'preview' || msg.type === 'save') {
            // 以当前 words 为基底计算，保留模板外的隐藏位
            const w = computeConfigWordsFromBase(data.tpl, msg.selections, data.words, data.hexmcu);
            if (msg.type === 'preview') {
                panel.webview.postMessage({ type: 'previewResult', words: w });
            } else {
                try {
                    const synced = await persist(w, '');
                    const ws = formatWords(w);
                    if (synced.length > 0) {
                        channel.appendLine(vscode.l10n.t(
                            '[SCMCU] Configuration words synchronized to programming files: {0}',
                            synced.join(', ')
                        ));
                        vscode.window.showInformationMessage(
                            data.mode === 'scw'
                                ? vscode.l10n.t(
                                    'Chip settings were written to {0} and synchronized to programming files: {1}',
                                    path.basename(data.scw!), synced.join(', ')
                                )
                                : vscode.l10n.t(
                                    'Chip settings were written to scmcu.configWords and synchronized to programming files: {0}',
                                    synced.join(', ')
                                ),
                        );
                        panel.webview.postMessage({ type: 'saved', words: w, syncedScx: synced });
                    } else {
                        vscode.window.showInformationMessage(
                            data.mode === 'scw'
                                ? vscode.l10n.t(
                                    'Chip settings were written to {0}. No .scx programming file was found; changes will take effect after the next build.',
                                    path.basename(data.scw!)
                                )
                                : vscode.l10n.t(
                                    'Chip settings were written to scmcu.configWords. No .scx programming file was found; changes will take effect after the next build.'
                                ),
                        );
                        panel.webview.postMessage({ type: 'saved', words: w });
                    }
                } catch (e: any) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Save failed: {0}', e.message));
                }
            }
        } else if (msg.type === 'resetDefault') {
            // 恢复默认值：每个节取 cfg 模板的第一个选项
            try {
                const defaults: Record<string, string> = {};
                for (const sec of Object.keys(data.tpl)) {
                    const opts = Object.keys(data.tpl[sec]);
                    if (opts.length > 0) defaults[sec] = opts[0];
                }
                const w = computeConfigWordsFromBase(data.tpl, defaults, data.words, data.hexmcu);
                await persist(w, vscode.l10n.t(' (defaults restored)'));
                // scw 模式下也同步 patch scx
                if (data.mode === 'scw') {
                    const buildDir = vscode.workspace.getConfiguration('scmcu').get<string>('buildDir', 'build');
                    const patched: string[] = [];
                    for (const scxPath of findScxFiles(workspaceRoot, buildDir)) {
                        if (patchScxConfigWords(scxPath, data.device, w)) patched.push(path.basename(scxPath));
                    }
                    if (patched.length > 0) {
                        channel.appendLine(vscode.l10n.t(
                            '[SCMCU] Configuration words synchronized to programming files: {0}',
                            patched.join(', ')
                        ));
                    }
                }
                // 重新加载数据并刷新面板
                const fresh = loadPanelData(workspaceRoot);
                if (fresh && panelRef === panel) {
                    panel.webview.html = renderHtml(fresh);
                }
                vscode.window.showInformationMessage(vscode.l10n.t('Defaults restored'));
            } catch (e: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to restore defaults: {0}', e.message));
            }
        }
    });
}

interface PanelData {
    mode: 'scw' | 'scwless';
    scw: string | null;     // mode=scw 时有值
    scwName: string;        // mode=scw → 工程文件名；scwless → "(脱离 .scw 模式)"
    device: string;
    tpl: CfgTemplate;
    words: number[];
    current: Record<string, string>;
    hexmcu: number;
}

function formatWords(w: number[]): string {
    return w.map(x => x.toString(16).toUpperCase().padStart(4, '0')).join(',');
}

function loadPanelData(workspaceRoot: string): PanelData | null {
    const cfg = vscode.workspace.getConfiguration('scmcu');
    const scw = findScwFile(workspaceRoot);
    let device = '';
    let mode: 'scw' | 'scwless';
    let scwInfo: ScwInfo | null = null;
    if (scw) {
        mode = 'scw';
        scwInfo = parseScw(scw);
        device = scwInfo.device;
        if (!device) { vscode.window.showErrorMessage(vscode.l10n.t('.scw file is missing a Device= entry.')); return null; }
    } else {
        mode = 'scwless';
        device = cfg.get<string>('device', '') || '';
        if (!device) {
            vscode.window.showErrorMessage(vscode.l10n.t(
                'Without .scw mode: scmcu.device is not configured. Enter a chip model in Settings > Extensions > SCMCU, or run "SCMCU: Set Chip Model" from the Command Palette.'
            ));
            return null;
        }
    }

    const comp = findCompilerDir();
    if (!comp) { vscode.window.showErrorMessage(vscode.l10n.t('Compiler not found. Run "SCMCU: Configure Compiler Directory" first.')); return null; }

    const cfgPath = path.join(comp.idePath, 'mcu', 'config', device + '.cfg');
    if (!fs.existsSync(cfgPath)) {
        vscode.window.showErrorMessage(vscode.l10n.t('Chip configuration template not found: {0}', cfgPath));
        return null;
    }
    const tpl = parseCfgTemplate(cfgPath);
    const hexmcu = loadChipParams(comp.idePath, device).hexmcu;

    // 当前配置字：scw 模式从 .scw 读；scw-less 从 scmcu.configWords 读
    let words: number[];
    if (mode === 'scw') {
        const ws = (scwInfo as ScwInfo).configWords;
        words = ws.length >= 2 ? ws.slice(0, 4) : [hexmcu, hexmcu, hexmcu, hexmcu];
    } else {
        const cwStrs = (cfg.get<string[]>('configWords', []) || []).filter(s => s && s.trim().length > 0);
        if (cwStrs.length === 0) {
            // 未配置 → 用芯片默认未编程值（与 build.ts 行为一致）
            words = [hexmcu, hexmcu, hexmcu, hexmcu];
        } else {
            words = cwStrs.map(s => parseInt(s, 16) & 0xFFFF);
        }
    }
    while (words.length < 4) words.push(0xFFFF);
    const current = detectCurrentSelections(tpl, words);

    return {
        mode,
        scw: mode === 'scw' ? scw! : null,
        scwName: mode === 'scw' ? path.basename(scw!) : vscode.l10n.t('Without .scw mode'),
        device,
        tpl,
        words,
        current,
        hexmcu,
    };
}

function renderHtml(d: PanelData): string {
    const wordStr = formatWords(d.words);
    const nonce = Math.random().toString(36).slice(2, 12);
    const isScwLess = d.mode === 'scwless';
    const subLine = isScwLess
        ? vscode.l10n.t(
            'Target: {0} | Mode: without .scw (saving writes to the scmcu.configWords workspace setting)',
            d.scwName
        )
        : vscode.l10n.t(
            'Project file: {0} | Click "Save Configuration" after making changes to write the config= entry back to .scw (takes effect in the IDE immediately).',
            d.scwName
        );
    const messages = JSON.stringify({
        notSaved: vscode.l10n.t('Not saved'),
        previewWords: vscode.l10n.t('Configuration words (preview): {0}', '{0}'),
        savedWords: vscode.l10n.t('Configuration words: {0}', '{0}'),
        saved: vscode.l10n.t('Saved'),
        synced: vscode.l10n.t(', and synchronized to programming files: {0}', '{0}'),
    }).replace(/</g, '\\u003c');

    let sectionsHtml = '';
    for (const sec of Object.keys(d.tpl)) {
        const opts = Object.keys(d.tpl[sec]);
        if (opts.length === 0) continue;
        let radios = '';
        for (const opt of opts) {
            const checked = d.current[sec] === opt ? ' checked' : '';
            radios += `<label class="opt"><input type="radio" name="${sec}" value="${opt}"${checked}><span>${opt}</span></label>`;
        }
        sectionsHtml += `<fieldset data-section="${sec}"><legend>${sec}</legend>${radios}</fieldset>`;
    }

    return `<!DOCTYPE html>
<html lang="${vscode.env.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${nonce ? `'nonce-${nonce}'` : "'unsafe-inline'"}; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
:root {
    color-scheme: light dark;
}
body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px 20px;
    max-width: 860px;
}
h1 { font-size: 16px; margin: 0 0 4px; }
.sub { opacity: .7; font-size: 12px; margin: 0 0 16px; }
fieldset {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    margin: 0 0 14px;
    padding: 10px 14px;
}
legend { font-weight: 600; font-size: 13px; padding: 0 6px; }
.opt {
    display: inline-flex; align-items: center; gap: 6px;
    margin: 4px 14px 4px 0; padding: 4px 10px;
    border: 1px solid var(--vscode-panel-border); border-radius: 4px;
    cursor: pointer; font-size: 12px;
    background: var(--vscode-editorWidget-background);
}
.opt:hover { border-color: var(--vscode-focusBorder); }
.opt input { accent-color: var(--vscode-focusBorder); }
.opt:has(input:checked) { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.bar {
    position: sticky; bottom: 0;
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: 10px 0; background: var(--vscode-editor-background);
    border-top: 1px solid var(--vscode-panel-border);
}
#words {
    font-family: Consolas, monospace; font-size: 13px;
    color: var(--vscode-charts-blue); word-break: break-all;
}
#status { font-size: 12px; opacity: .85; }
button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 4px; padding: 6px 18px; cursor: pointer; font-size: 13px;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
}
</style>
</head>
<body>
<h1>${vscode.l10n.t('Hardware Options - {0}', d.device)}</h1>
<p class="sub">${subLine}</p>
${sectionsHtml}
<div class="bar">
    <button id="save">${vscode.l10n.t('Save Configuration')}</button>
    <button id="reset" class="secondary">${vscode.l10n.t('Restore Defaults')}</button>
    <span id="words">${vscode.l10n.t('Configuration words: {0}', wordStr)}</span>
    <span id="status"></span>
</div>
<script nonce="${nonce}">
(function () {
    var vscode = acquireVsCodeApi();
    var messages = ${messages};
    function format(template, value) {
        return template.replace('{0}', value);
    }
    function collect() {
        var sel = {};
        document.querySelectorAll('fieldset').forEach(function (fs) {
            var c = fs.querySelector('input:checked');
            if (c) sel[fs.getAttribute('data-section')] = c.value;
        });
        return sel;
    }
    function fmt(w) {
        return w.map(function (x) { return x.toString(16).toUpperCase().padStart(4, '0'); }).join(',');
    }
    document.querySelectorAll('input[type=radio]').forEach(function (r) {
        r.addEventListener('change', function () {
            document.getElementById('status').textContent = messages.notSaved;
            vscode.postMessage({ type: 'preview', selections: collect() });
        });
    });
    document.getElementById('save').addEventListener('click', function () {
        vscode.postMessage({ type: 'save', selections: collect() });
    });
    document.getElementById('reset').addEventListener('click', function () {
        vscode.postMessage({ type: 'resetDefault' });
    });
    window.addEventListener('message', function (e) {
        var m = e.data;
        if (m.type === 'previewResult') {
            document.getElementById('words').textContent = format(messages.previewWords, fmt(m.words));
        } else if (m.type === 'saved') {
            document.getElementById('words').textContent = format(messages.savedWords, fmt(m.words));
            var st = messages.saved;
            if (m.syncedScx && m.syncedScx.length) st += format(messages.synced, m.syncedScx.join(', '));
            document.getElementById('status').textContent = st;
        }
    });
})();
</script>
</body>
</html>`;
}
