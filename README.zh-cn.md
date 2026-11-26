# SCMCU IDE for VS Code（SC8 系列单片机）

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.9.10-orange.svg)](https://github.com/YoussefMostafaMohammed/SCMCU_IDE-VSCODE-Plugin/releases)

**仓库地址（国内建议走 Gitee）：**

| 平台 | 地址 |
|---|---|
| GitHub | https://github.com/YoussefMostafaMohammed/SCMCU_IDE-VSCODE-Plugin |
| Gitee（国内镜像） | https://gitee.com/wangzhengyangsb/zhongweiscmcuidevscodecha |

在 VS Code 中编译 SC8F/SC8P 系列单片机工程（基于 SCMCU_IDE 的 MPLAB XC8/PICC 工具链），
支持芯片设置、芯片切换、编译器自动检测、错误跳转，生成与官方烧录器**校验值完全一致**的 `.scx` 烧录文件。
另内置 **SCMCU 编程器识别**（底栏实时显示型号）、**一键编译下载**、**只下载（不编译）**（两者均已实烧闭环验证，覆盖 Writer 烧录器与 CMS-ICE6 仿真器两条通道）。

## 功能

| 命令 | 说明 |
|---|---|
| `SCMCU: 编译` | 编译工程（自动读 .scw 的 Device/源文件顺序/配置字），生成 `.hex` + `.scx`，输出 **CfgCRC/CfgSum** |
| `SCMCU: 一键编译下载` | 编译成功后自动连接编程器烧录（Writer 烧录器走 `.scx`，CMS-ICE6 走 `.hex`，见「一键编译下载」） |
| `SCMCU: 只下载（不编译）` | **跳过编译**，直接烧写 `build/` 下上一次的固件（改了硬件选项、只想重烧时用，省一次编译） |
| `SCMCU: 芯片设置` | 图形化配置 WDT/PROTECT/LVR_SEL/FCPU_DIV 等硬件选项，写回 .scw **并同步写入已有 .scx 配置字区**（单例窗口） |
| `SCMCU: 选择芯片型号` | 从 IDE 芯片库选择型号，更新 .scw 的 Device= |
| `SCMCU: 源文件管理` | 图形化列出/添加/移除/排序 `.scw` 的 `SourceFile=`（按钮或**拖拽**均可，顺序即编译顺序），即时写回工程文件 |
| `SCMCU: 配置编译器目录` | 手动指定 SCMCU_IDE 安装目录 |
| `SCMCU: 自动检测编译器` | 自动扫描常见安装路径/盘符/环境变量 `SCMCU_IDE_HOME` |
| `SCMCU: 设置芯片型号 / 设置配置字 (脱离 .scw)` | 输入框直接写工作区设置（scw-less 模式用） |
| `SCMCU: 启动` | 手动触发加载——找不到 .scw 时若弹窗选了「不加载」，之后用本命令启用 |
| `SCMCU: 规范化配置字` | 修复 scw-less 模式下配置字高位「串芯片」错误（一般加载后自动执行一次，见「配置字规范化」） |

**状态栏**：

- 底部**左侧**按钮组（点击即用）：`$(chip)` 型号(点击切换) ・ `$(settings-gear)` 芯片设置 ・ `$(debug-start)` 编译 ・ `$(cloud-download)` 只下载 ・ `$(zap)` 编译下载 ・ `$(files)` 源文件
- 底部**右侧**：编程器识别（`$(circuit-board) WRITER8 LITE` / `CMS-ICE6 (仿真器)`；点击立即刷新，窗口聚焦时 5s 自动轮询，见「编程器识别」）
- 找不到 `.scw` 时右下角弹「加载」通知（仅一个按钮，约 20s 无操作自动消失 = 本次不加载；`scmcu.noScwBehavior` 可改为直接加载 / 永不加载）

## 使用

1. 用 VS Code 打开包含 `.scw` 工程文件的文件夹
2. 首次使用执行 `SCMCU: 自动检测编译器`（或 `SCMCU: 配置编译器目录`）
3. 执行 `SCMCU: 编译` —— 产物在 `build/` 下：
   - `<输出名>.hex`：Intel HEX 程序文件
   - `<输出名>.scx`：烧录文件（含配置字 + 程序，可直接用 SCMCU_Writer 烧录）
4. 改硬件选项（LVR 电压、WDT 等）→ `SCMCU: 芯片设置` → 选择 → 保存
5. 芯片切换 → 点击状态栏芯片型号 → 选择
6. 管理要编译的源文件 → 点击状态栏「源文件」或执行 `SCMCU: 源文件管理` → 添加 / 移除 / 上移下移（顺序即编译顺序，不可随意打乱）

## 脱离 .scw 编译（无工程文件模式）

适用于手上只有一堆 `.c/.asm/.s` 源码、没有官方 `.scw` 工程文件的场景。插件**不再强依赖 `.scw`**，改为从设置读取芯片型号与配置字、自动扫描源文件。

前提（设置 `settings.json` / 扩展设置页「SCMCU」，**或**用命令面板直接填）：

- `scmcu.device`（**必填**）：芯片型号，如 `"SC8F052A04"`。留空则编译报错提示先配置。
- `scmcu.configWords`（**建议填**）：4 个配置字（十六进制字符串数组），如 `["0x1FFF","0x3FFF","0x3FFF","0x3FFF"]`。
  **留空则用芯片默认未编程值**，编译时给出 ⚠️ 警告——烧录前务必核对硬件选项（振荡器/看门狗/LVR 等），否则固件可能不工作。
- `scmcu.sourceFiles`（**可选**）：源文件清单（相对工程根目录，顺序敏感）。`[]`（默认）= 自动扫描工程下所有 `.c/.asm/.s`；非空 = 按数组顺序编译。**优先于自动扫描**。可通过状态栏「源文件」/ 命令面板的「源文件管理」面板维护。

> 若扩展设置页里找不到这些条目（多为装了旧版 / 装完没重载窗口），可直接用命令面板：
> - `SCMCU: 设置芯片型号 (脱离 .scw)` —— 输入框填型号，写入「工作区设置」
> - `SCMCU: 设置配置字 (脱离 .scw)` —— 输入框填 4 个配置字（逗号分隔），写入「工作区设置」

行为：

- 打开含源码的文件夹后，只要设置了 `scmcu.device`，状态栏即出现「**芯片型号**（点击改型号 / scw 模式下切库）」+「**芯片设置**」+「**构建**」+「**源文件**」四个按钮。`.scw` 存在时面板写回 `.scw`；不存在时写回对应工作区设置。
- 源文件 = 若 `scmcu.sourceFiles` 非空，按其顺序编译；否则自动扫描工程下全部 `.c/.asm/.s`（排除 `build/`、`node_modules/`、`.git/` 等），按字母序。
  **注意**：XC8 的 psect 分配依赖编译顺序，若默认字母序导致链接异常，**用「源文件管理」面板维护一个有序清单写入 `scmcu.sourceFiles`**，或继续用 `.scw` 的 `SourceFile=` 精确控制顺序。
- 产物同样是 `build/<name>.hex` + `build/<name>.scx`，编译参数与 CfgCRC/CfgSum 输出与 `.scw` 模式一致。

## 配置字规范化（防串芯片）

14-bit 芯片（SC8F052 等，未编程值 `0x3FFF`）的工程，若工作区 `scmcu.configWords` 是从 16-bit 芯片
（SC8F072 等，`0xFFFF`）工程整体复制过来的，会出现**高位错误**（典型：`FFFB,FAEF,FFFF,FFFF`，
应为 `3FFB,3FEF,3FFF,3FFF`），烧进芯片后硬件选项错乱。插件内置两层防护：

- **自动**：加载工程时若同时满足「无 `.scw` + 已设 `scmcu.device` + 已手填 `scmcu.configWords`」，
  自动执行一次规范化——**有变化**才写回 `scmcu.configWords`（并尽力同步 build 目录 .scx）+ 提示
  before → after；已正确 / 未编程工程**静默跳过**。同一工作区只自动执行一次，想再跑用下面的命令。
- **手动**：`SCMCU: 规范化配置字`。

规则（核心 `normalizeConfigWordsCore`，src/chip.ts）：

- 芯片配置模板 `mcu/config/<chip>.cfg` **已定义**的位（硬件选项覆盖位）→ 保留基底当前值
- **未定义**的固定位 → 按芯片位宽复位到未编程值（**幂等**：重复执行结果不变）
- 末尾统一按芯片位宽清高位（`& hexmcu`）
- 纯 16-bit 芯片（hexmcu=`0xFFFF`）**只做位宽 mask、不重置未定义位** → SC8F072 的 `FAEF`
  （bit4/8/10=0 的隐藏位）不会被误改成全 1

芯片位宽来源：优先 `.ini` 的 `HEXMCU`；缺省时按型号兜底（`resolveHexmcu`：SC8F05x/SC8F070 等
14-bit → `0x3FFF`；SC8F072+、FC*/SC8P* → `0xFFFF`）。

## 构建输出示例

```
[SCMCU] 芯片: SC8P052B  ROM: 1024 word
[SCMCU] 源文件(8): main.c interrupt.c motor.c key.c LED.c battery.c CMP.c sleep.c
[SCMCU] include: src | inc | data/include
[SCMCU] 配置字: 3FF3,3FAB,3FFF,FFFF
[SCMCU] 硬件选项: WDT=DISABLE  PROTECT=ENABLE  LVR_SEL=2.0V  FCPU_DIV=4T  ICSPPORT_SEL=NORMAL  EXT_RESET=DISABLE
[SCMCU] 烧录文件: ...\build\SCMCU_Project.scx (2304 字节)
[SCMCU] CfgCRC(Hex) -- 0x9202  CfgSum(Hex) -- 0x156D
[SCMCU] ✅ 构建成功
```

> **配置字不用再靠人脑翻译十六进制**：紧跟配置字那一行的「硬件选项」就是把 4 个配置字
> 按芯片模板 `mcu/config/<芯片>.cfg`（IDE 芯片设置面板的同一份定义）反查出来的可读状态，
> 顺序与 IDE 面板一致（WDT / PROTECT / LVR_SEL / FCPU_DIV / ICSPPORT_SEL / EXT_RESET …），
> 某个节的所有位都对不上时显示 `= ?`。模板缺失或芯片名不在 IDE 里时该行自动省略。

## 与烧录器校验值完全一致（CfgSum / CfgCRC）

插件生成的 `.scx`，用官方烧录器 SCMCU_Writer 打开显示的 **CfgSum / CfgCRC 与插件计算完全一致**。
算法直接对应烧录器核心库 `Writer.Core.dll` 反编译出的 **`GetCheckSum` / `GetDataCRC16`** 两个函数：

```csharp
// GetDataCRC16:  GetCRC16L_1021_FFFF_0000(0xFFFF, romDatas + bootRom + GetConfigByteDatas())
// GetCheckSum:   num2 += ConfigDatas[i] & 0xFF;  if (McuType==CMSCore) num2 += ConfigDatas[i] >> 8;
```

```
CfgSum = (Σ 程序区字节 [0x100,end) + Σ 前 N 个配置字 [低字节 + (CMSCore ? 高字节 : 0)]) & 0xFFFF
CfgCRC = CRC-16/CCITT-FALSE (poly=0x1021, init=0xFFFF, xorout=0)，对 [程序区字节 + 前 N 个配置字槽低+高字节] 计算
N      = 该芯片的配置字数量（参与校验和的槽数）
```

> `.scx` 配置区**定长 4 槽**（buildScx 写死 8 字节），但烧录器按**芯片数据库的配置字数量**只取前 N 槽：
> SC8F052 = 2 槽、SC8F072 = 4 槽。**N 以 `CFG_WORD_COUNT` 实测表为准**，不能看 `.scw` 列了几个——`.scw` 的
> `config=` 会用 `FFFF` 补齐到 4 个（如 SC8F052 的 `3FFB,3FEF,FFFF,FFFF` 实际只有 2 个字）。未收录芯片
> 由 build 从芯片配置模板 `mcu/config/<chip>.cfg` 推导（最大 word 索引 + 1）兜底，最后默认 4。
> 早期「只计连续非 0xFFFF 槽」的算法对 SC8F072（槽 0=FFFF）数成 0 槽算错；硬编码 4 槽又让 SC8F052 算错。

实测样本（已用官方烧录器 SCMCU_Writer 显示值逐位核对）：

| 工程 | 芯片 | 配置字 | N | CfgSum | CfgCRC | 备注 |
|---|---|---|---|---|---|---|
| test1 | SC8F052 | 3FFB,3FEF | 2 | A5AE | 20CD | ✓ 与烧录器一致（2 槽） |
| test2 | SC8F052 | 7FFF,FFEF | 2 | AA75 | 9665 | 旧算法样本（同为 2 槽，规则一致） |
| test3 | SC8F072 | FFFF,FAEF,FFFF,FFFF | 4 | 4619 | EC0D | ✓ 与烧录器一致（4 槽） |

> 新芯片接入：若某芯片烧录器显示的 CfgSum/CfgCRC 与插件不符，先确认该芯片的配置字数量与是否 CMSCore
> （非 CMS 内核只加配置字低字节），把芯片名补进 `src/scx.ts` 的 `CFG_WORD_COUNT` / `NON_CMS_CORE` 即可。

## 编程器识别（底栏右侧）

识别 Windows 下已连接的 SCMCU 设备，底栏右侧实时显示型号。分两类：

**Writer 烧录器**（USB HID，**VID 0x1209**；来自 `Writer.Core.dll` 反编译设备表），区分正常 / 升级(bootloader) 模式：

| 型号 | 正常 PID | 升级(bootloader) PID |
|---|---|---|
| WRITER8 LITE | 0x0201 | 0x0101 |
| WRITER V8 | 0x0032 | 0x0011 |
| WRITER V8 PRO | 0x0023 | 0x0021 |
| ICE8 PRO | 0x1502 | 0x1102 |

**ICE 仿真器**（另一 VID）：

| 型号 | VID | PID | 说明 |
|---|---|---|---|
| CMS-ICE6 | 0x0925 | 0x0283 | 厂商串 `CMS ICE`，系统里伪装成「USB 输入设备」；状态栏显示 `CMS-ICE6 (仿真器)` |

> ✅ CMS-ICE6 是**仿真器**（VID `0x0925`），走 IDE 的私有下载通道。**「一键编译下载」与「只下载」都已支持它**：
> 逐字节复刻官方 IDE V2.00.17 的真实下载会话（Frida hook `WriteFile` 抓包，2026-11-26），
> 脚本 `flash/ice6_flash.py`（纯 Python 标准库 ctypes，零 pip 依赖）。识别到 ICE6 时自动走该脚本烧 `.hex`，
> **不需要 SCMCU Writer，也不需要打开官方 IDE**。
>
> 📦 **运行时随插件内置**（`flash/py/`，官方 embeddable Python 3.11.9，只保留 ctypes / unicodedata 等必需组件）：
> 装完 vsix 即可下载，**不需要另装 Python**；`SCMCU_BUILD_PY` 可强制指向自己的解释器（改脚本调试时用）。
>
> ⚠️ 两个前提：
> - 目标板供电正常（VDD ≈ 4.5V）—— 断电 / 接触不良时帧照发，但数据不落盘；
> - **下载前先关 SCMCU IDE** —— 它会抢占 HID 设备并切断目标板供电（现象：后续块全读回 `0xFF`）。

- 加载后立即检测一次；VS Code 窗口**聚焦时每 5 秒轮询**（USB 枚举约 1s/次，失焦自动停表，避免后台空耗 CPU）
- 点击状态栏立即刷新并弹结果；Tooltip 含 VID / PID / 模式；升级模式显示 `(Boot)` 并提示用 Writer 升级功能刷固件
- 未连接 → `编程器: 未连接`；识别失败 → `编程器: 检测失败`；未知 PID → 「未知编程器」（便于将来新硬件）
- 实现（src/programmer.ts，纯 Node 可单测）：优先 `pnputil /enum-devices /connected /deviceids`，失败回退 `Get-PnpDevice`；VID 白名单 1209 / 0925；仅 Windows 生效

## 一键编译下载 / 只下载（编译 → 自动烧录）

两条命令共用同一条烧录通道，区别只在**要不要先编译**：

| 命令 | 底栏按钮 | 行为 |
|---|---|---|
| `SCMCU: 一键编译下载` | `$(zap)` | 编译 → 烧写 `build/<输出名>.hex`（+`.scx`） |
| `SCMCU: 只下载（不编译）` | `$(cloud-download)` | 直接烧写 `build/` 中**上一次**的固件，不重新编译 |

「只下载」适合这些场景：改了芯片设置/配置字后想重烧、换了一片目标板、或者只想把那块已经编译好的固件再烧一次。

前置：USB 连接编程器（Writer 烧录器 **或 CMS-ICE6 仿真器**），芯片/目标板在座且供电正常。

> **用过官方 SCMCU IDE 的话，先关 IDE 并拔插一次 ICE6 的 USB 再下**。IDE 退出后 ICE6 会遗留成
> 「命令都回 `03`、擦除有效、但编程数据一位都不落盘」的状态（见下文「踩坑记录」⑩），软件侧解除不了。
> 脚本能自动识别并提示，但白跑一趟不如提前插拔一下。

**两种下载通道自动选择**（`detectProgrammers()` 按 USB VID 识别）：

| 通道 | VID | 依赖 | 下载输入 |
|---|---|---|---|
| Writer 烧录器 | `0x1209` | 本机装有官方 `SCMCU_Writer`（复用其芯片库） | `.scx` + 内置烧录助手 |
| CMS-ICE6 仿真器 | `0x0925` | 无（运行时随插件自带） | `.hex` + 内置 `flash/ice6_flash.py` |

### Writer 通道（VID 0x1209）

插件编译出 `.scx` 后，spawn 内置烧录助手 `flash/ScmcuFlashHelper.exe` 完成烧录，全程**无需打开 Writer GUI**。
助手引用 Writer 自带的 `Writer.Core.dll`（`AssemblyResolve` 动态加载，不污染安装目录），复用其加密
芯片库（SQLite，口令 `cmsxc`）与 USB HID 协议，时序与 Writer GUI 完全一致：

```
编译 → .scx → 连接编程器(版本握手/WriterID 校验)
     → 0x61 信息帧1(Series/Type/段长/WriterCount/CRC32) → 0x21 芯片名+注解
     → ROM/Config/EE 分段下发(57B/块，逐块等 ACK) → 0x60 整段 CRC 校验 → 0x50 结束(可复位运行)
```

| 项 | 说明 |
|---|---|
| 入口 | `SCMCU: 一键编译下载` / `SCMCU: 只下载（不编译）`；底栏 `$(cloud-download)` / `$(zap)` |
| `scmcu.writerPath` | Writer 安装目录；**留空自动扫描**（盘符根 / `Work` / `Program Files` / `gat/sheet/中微` 下含 `library`+`data` 的 `SCMCU_Writer*`） |
| `scmcu.flashCount` | 固件允许的脱机烧录次数上限（WriterCount）；默认 `0` 表示不限次数，正整数表示上限 |
| 报错 | 编程器未连接 / 型号不支持 / 芯片库无此型号 / 文件解析失败，均有中文说明 |
| 排障 | 助手 `--probe` 只验证链路（连接 → 芯片库 → `.scx` 解析），不烧录 |
| 依赖 | x86 / .NET Framework 4.x（Win7+ 自带）；无 .NET SDK 时用 `npm run build:helper` 重编 |

### CMS-ICE6 通道（VID 0x0925）

用编译产物 `.hex` + 内置脚本下载，**不需要 SCMCU Writer，也不需要打开官方 IDE**。脚本按官方 IDE
V2.00.17 的完整下载会话逐段实现（Frida hook `WriteFile` 抓包 + 真机闭环验证，2026-11-26），
纯 Python 标准库（ctypes），零 pip 依赖。

> **运行时随插件自带**：`flash/py/python.exe`（官方 embeddable 3.11.9 裁剪版），装完 vsix 即可下载，
> **不需要系统里装 Python**。`SCMCU_BUILD_PY` 环境变量可覆盖为自定义解释器。

**帧序**：

| 顺序 | 帧 | 作用 |
|---|---|---|
| ① | `0x50 0x53` / `0x1A` | PS 自检 + 目标链路；不就绪则 `0xA6 0x78` → `0x52` 重连目标 |
| ② | `FC` → `18` → `1B` | 会话握手 |
| ③ | `0x17` | 芯片 ID / ROM 大小 / 高压参数（ERASE·PROGTIME·**VPPMODE=0x89**），高压由 ICE6 硬件自行产生；必须 ACK `03` |
| ④ | `0C 02 10` | 进入编程态 |
| ⑤ | `0x01` × N | 逐块编程，**字地址**步进 `0x18`、48B/帧（24 字），每帧等自己的 ACK 做流控 |
| ⑥ | `03`（配置字=FF）→ `0C 01 04` | 清配置字区 → 退出编程态 |
| ⑦ | `0x06` × 64 | 整片回读校验 |
| ⑧ | `03`（配置字=实际值）→ `0C 01 04` | 写配置字（从同目录 `.scx` 的 `0xA0` 槽读取，换工程也不会写错） |
| ⑨ | `0D` → `0B` → `04` → `0F` → `13` → `11`×8 → `09`×4 | 收尾序列（见踩坑 ⑨） |

**输出**：每步只占一行；原始协议帧默认静音（排障时加 `--debug`），运行中的百分比走 **VS Code 底栏状态条**，不写输出面板。

```
[SCMCU] 检测到 CMS-ICE6 (VID 0x0925/PID 0x0283)
──── CMS-ICE6 下载 ────
固件        c:\...\build\SCMCU_Project.hex  (4096 字节, 需编程 14 块)
配置字      FFF7 FAEF FFFF FFFF   (来源: SCMCU_Project.scx)
选项        WDT=DISABLE  PROTECT=ENABLE  LVR_SEL=1.8V  FCPU_DIV=4T  ICSPPORT_SEL=NORMAL  EXT_RESET=DISABLE
擦除中
擦除完成
下载中
下载完成    14/14 帧，ACK 14（0.1s）
校验中
校验完成    64/64 页，差异 0 字（3.7s）
结果        ✅ 校验通过 · 用时 5.6s
*** 下载成功 ***
```

| 显示项 | 对应动作 |
|---|---|
| 固件 | 要烧的 `.hex` 与需编程块数（空白块自动跳过） |
| 擦除 | `0x17`：整片擦除 + 高压就绪（没有独立擦除命令） |
| 下载 | `0x01`×N 编程帧 |
| 校验 | `0x06` 整片回读比对 |

`补烧` / `复验` 只在首轮校验出现差异时才出现；`结果` 行的 `补烧 N 轮 / 重连 N 次 / 读不到 N 页` 也只在非零时追加。

#### 踩坑记录（按症状查）

| # | 症状 | 根因 | 现在的处理 |
|---|---|---|---|
| ① | 所有命令只回 `03 31 34`，能通信但写不进 | 抓包得到的 wire 已含首字节 ReportID(`0x00`)，整帧错位 1 字节 | 写入前剥掉首字节 |
| ② | 只有型号查询 `50 53` 有应答，其余命令一律回 `14` | 目标链路已断（IDE 启动时会重连） | 复刻 `A6 78` → `52`（回 `[CMSC] OPTION_REG=…`）→ `1A` 预热；探测不过直接拒绝烧写 |
| ③ | 全片校验误报上千处差异 | 编程刚结束时 ICE6 回包变慢，短超时被当成数据不符 | 编程后先等待；校验用宽超时，读不到的块单独重试 |
| ④ | 第 40 帧之后整片读回 `FF`；进程 CPU 恒 0 卡死 | 编程帧之间插读会打断编程状态机；`GetOverlappedResult(..., bWait=True)` 是无界等待 | 编程阶段不插读；所有 Overlapped 等待加上限，超时抛 `IOError` 并重连 |
| ⑤ | 首轮漏烧若干块，后期帧被设备拒收 | 编程 ACK 积压塞满 HID 输入队列（实测漏 23 块） | 每帧读一个 ACK，兼做流控（实测 86 帧约 1 秒） |
| ⑥ | 读回全是 `11 1B 11 1B …` 的垃圾 | 读前没做会话握手（`FC` `18` `1B` + `52`） | 读前先握手；±8 字错位读只作兜底（曾误判为 `0x560` 地址怪癖） |
| ⑦ | 曾以为「旧固件没擦干净」 | `0x17` 本身就完成整片擦除，IDE 并没有独立擦除命令 | 只编程非空白块即可：实测 82 块固件换成 13 块后，`0x0200` 之后全 `FF`、0 残留 |
| ⑧ | 指令字高 6 位永远校验不过 | `0x06` 只返回每个字的低 8 位，第二字节恒 `0x00`（IDE 同样如此） | 校验粒度就按 8 位；这是协议/硬件限制，不是脚本缺陷 |
| ⑨ | **每次烧完必须给调试器断电才能再烧** | 漏发收尾序列 `0D/0B/04/0F/13 + 11×8 + 09×4`，设备停在「擦得掉但写不进」 | 收尾放进 `finally`，校验失败也发；收尾帧不能脱离上下文单独重放（否则进数据流状态） |
| ⑩ | 用过官方 IDE 后又写不进：命令全回 `03`、ACK 齐全、擦除有效，但数据一位不落盘 | IDE 连接后遗留的特殊状态，软件侧无解除命令（`A6 78` 返回 `14`，状态帧由 `09 01 00 00` 变 `09 F6 01 01`） | 首轮校验若「几乎全片读回 `FF` 且差异值全为 `FF`」立即判定并提示**拔插 ICE6 的 USB**，不再空转补烧 6 轮 |

## 设置项（settings.json）

| 键 | 说明 |
|---|---|
| `scmcu.compilerPath` | SCMCU_IDE 的 `data\bin` 目录（含 picc.exe），留空自动检测 |
| `scmcu.idePath` | SCMCU_IDE 安装根目录（含 `mcu\config`），留空自动检测 |
| `scmcu.buildDir` | 编译输出目录，默认 `build` |
| `scmcu.outputName` | 产物文件名，默认 `SCMCU_Project` |
| `scmcu.sourceDirs` | **C 源文件目录**（相对工程根目录；空串 = 根目录），默认 `["src"]` |
| `scmcu.includeDirs` | **头文件 include 目录**（相对工程根目录；空串 = 根目录），默认 `["inc"]`，编译时加入 `-I` |
| `scmcu.device` | **脱离 .scw 模式必填**：芯片型号，如 `"SC8F052A04"`；留空则该模式编译报错 |
| `scmcu.configWords` | **脱离 .scw 模式建议填**：4 个配置字（十六进制字符串数组），如 `["0x1FFF","0x3FFF","0x3FFF","0x3FFF"]`；留空则用芯片默认未编程值（编译时警告） |
| `scmcu.sourceFiles` | **脱离 .scw 模式可选**：源文件清单（相对工程根，顺序即编译顺序）；`[]` = 自动扫描（用「源文件管理」面板维护） |
| `scmcu.noScwBehavior` | 找不到 `.scw` 时的行为：`prompt`（默认，右下角询问）/ `load`（直接加载）/ `skip`（不加载，可手动 `SCMCU: 启动`） |
| `scmcu.writerPath` | SCMCU_Writer 安装目录（一键编译下载用）；留空自动扫描，见「一键编译下载」 |
| `scmcu.flashCount` | 固件允许的脱机烧录次数上限（WriterCount）；默认 `0` 表示不限次数，正整数表示上限 |

## 错误跳转（Problem 面板）

编译时 picc 输出的错误/警告会解析到 VS Code「问题」面板（`--errformat` 格式化为机器可读格式），
点击即可跳转到对应源文件行号。编译输出仍保留在「SCMCU」输出面板。

## 工作原理（与 IDE 一致性的保证）

- **源文件顺序**：按 `.scw` 的 `SourceFile=` 行顺序编译——XC8 的 psect 分配依赖编译顺序，顺序不同产物不同（实测字母序 vs IDE 顺序差异 504 处）。
- **编译参数**：与 IDE 完全一致（从 IDE 生成的 `startup.as` 头部提取）：

  ```
  --fill=0xFFFF --output=intel -D__DEBUG=1 -g --asmlist --warn=-9 --runtime=default,
  --opt=-local,-asmfile,-speed,+space,-debug --stack=compiled:auto:auto:auto
  --addrqual=request --mode=pro
  ```
- **配置字**：从 `.scw` 的 `config=` 行读取（IDE 权威值，含模板外隐藏位规则），写入 `.scx` 头 0xA0 起的 4 个 16 位槽位。
- **芯片参数**：从 IDE 的 `mcu/ini/<chip>.ini` 读取 `ROMSIZE`（程序区大小）、`HEXMCU`（未编程 word 值）。
  `.ini` 缺 `HEXMCU` 时按型号兜底（14-bit SC8F05x/SC8F070 → `0x3FFF`，其余 16-bit → `0xFFFF`），配置字计算末尾统一 `& hexmcu` 按位宽清高位。
- **`.scx` 头部**：芯片名 + `!`（烧录器靠 `!` 识别固件，8 字符芯片名如 SC8P052B 不会截断 `!`）。

## 项目结构

```
src/
├── extension.ts         # 扩展入口：命令注册 + 状态栏 + 自动规范化 / 编程器 / 烧录接线
├── build.ts             # 编译编排 + 错误诊断解析 + CfgCRC/CfgSum 输出
├── chip.ts              # .scw 解析、芯片列表、cfg 模板、配置字计算/规范化核心（normalizeConfigWordsCore）
├── compiler.ts          # 编译器目录查找（配置/常见路径/盘符/环境变量）
├── scx.ts               # .scx 生成 + 校验值计算
├── programmer.ts        # 编程器/仿真器识别（USB HID VID 0x1209 Writer + 0x0925 CMS-ICE6；纯 Node，可单测）
├── flash.ts             # 一键烧录：识别设备 → Writer 走烧录助手 / CMS-ICE6 走内置 Python 脚本
└── webview/
    ├── hardwareOptions.ts  # 芯片设置面板（单例）
    └── sourceManager.ts    # 源文件管理面板（按钮/拖拽排序）
flash/
├── ScmcuFlashHelper.cs   # Writer 通道烧录助手源码（net40/x86，引用 Writer.Core.dll，AssemblyResolve 加载依赖）
├── ScmcuFlashHelper.exe  # 助手编译产物（可 build_helper.py 重编）
├── build_helper.py       # 无 .NET SDK 机器一键重编助手（NuGet 拉 Roslyn Toolset）
├── ice6_flash.py         # CMS-ICE6 下载编排：握手→擦除→编程→校验→收尾，含进度与配置字可读化
├── ice6_flash_core.py    # ICE6 协议原语（HID 读写、控制帧表、块编解码）
└── py/                   # 内置 embeddable Python 3.11.9 运行时（下载脚本零环境依赖）
test/
├── configWords.regression.js  # 配置字回归（15 断言，驱动 out/chip.js 真实实现）
├── programmer.regression.js   # 编程器识别回归（22 断言，含 CMS-ICE6，纯函数层）
└── fixtures/ide/mcu/          # 从 SCMCU_IDE 拷入的芯片模板 .cfg/.ini（模拟 <idePath>，来源见 fixtures/README.md）
images/icon.png            # 扩展图标
```

## 开发

```bash
npm install          # 安装依赖
npm run compile      # TypeScript 编译
npm test             # 回归测试（配置字 15 + 编程器 22 断言；跑 out/chip.js 真实实现 + test/fixtures
                     #   模拟 IDE 芯片数据，不需要本机安装 SCMCU_IDE）
npm run package      # 打包 .vsix（scmcu-vscode-<version>.vsix，含 flash/py 内置运行时，约 7 MB）
```

F5 调试：打开本目录，按 F5 启动扩展开发宿主。

烧录助手重编（本机无需 .NET SDK，脚本自动从 NuGet 拉 Roslyn Toolset 4.8）：

```bash
npm run build:helper           # 或 python flash/build_helper.py
# 产物 flash/ScmcuFlashHelper.exe（x86 / .NET Framework 4.x）
```

> `npm run package` 会先运行 `npm run build:helper`，因此需要 Python、dotnet、.NET Framework 参考程序集及 Writer DLL。
> 如果只修改了助手源码，也可以单独运行 `npm run build:helper`。

> 测试夹具 `test/fixtures` 从官方 SCMCU_IDE 的 `mcu/{config,ini}` 拷入（SC8F052 / SC8F072 模板），
> 来源与更新方式见 `test/fixtures/README.md`。

## 版本历史

| 版本 | 要点 |
|---|---|
| **v0.9.10** | 内置 Python 运行时（vsix 约 7 MB），装完即用，不需要系统 Python |
| **v0.9.9** | 下载日志改为纯文字：`擦除中/完成`、`下载中/完成`、`校验中/完成` |
| **v0.9.8** | 每步只留一行结果；运行中百分比移到底栏状态条；删掉「复刻 IDE」类字样 |
| **v0.9.7** | 配置字翻成硬件选项（`WDT=DISABLE …`），下载阶段可视化 |
| **v0.9.6** | CMS-ICE6 一键下载打通；新增「只下载（不编译）」与底栏按钮 |
| **v0.9.5** | 配置字槽数改读 `CONFIGLENTH`，CfgCRC/CfgSum 与 Writer 完全一致（上限放宽到 16 槽） |
| **v0.9.4** | 烧录助手输出按 UTF-8 解码，修复 `[STEP]/[INFO]` 中文乱码 |
| **v0.9.3** | 编译/烧录输出改 GBK 解码；警告支持 Ctrl+点击跳转 |
| **v0.9.2** | 底栏按钮改纯图标；补 wafer 修调数据下发 |
| **v0.9.1** | 脱机烧录选项/次数修复；源文件管理器死循环修复 |
| **v0.9.0** | 配置字规范化、编程器识别、一键编译下载（Writer 通道） |
| **v0.8.x** | 源文件管理面板；scw-less 模式下芯片设置/源文件面板可用 |
| **v0.7.0** | 插件图标；此前功能见上文各章 |
| **v0.6.x** | 可配置源码/头文件目录、错误跳转、CfgCRC/CfgSum 对齐、8 字符芯片名修复 |
| **v0.3.x** | 芯片设置单例窗口、状态栏芯片切换与构建按钮 |
| **v0.1.x** | 基础编译 + 硬件选项配置 + 编译器自动检测 |

### v0.9.10 细节

- vsix 内新增 `flash/py/`：官方 embeddable **Python 3.11.9**（Win x64），保留 `python.exe` /
  `python311.dll` / 标准库 zip / `_ctypes.pyd` / `unicodedata.pyd` / vcruntime，
  删掉 ssl、sqlite、crypto、lzma 等无关组件（解压 11.2 MB，vsix 约 7 MB）。
- `src/flash.ts` 新增 `resolvePython()`：`SCMCU_BUILD_PY` → 内置 `flash/py/python.exe` → PATH 的 `python`；
  启动失败时区分「内置运行时被拦」与「系统没装 Python」。
- 实测：用内置运行时对真机烧写一次 —— 14 帧 / 校验 64 页 / 差异 0 / 5.3s。

### v0.9.6 细节（CMS-ICE6 通道）

- `flashScx()` 的 ICE 分支移到 Writer 安装目录检查**之前**：只装 IDE、没装 Writer 也能烧。
- 下载会话与 10 条坑位见上文「一键编译下载 / 只下载 → CMS-ICE6 通道」。
- 配置字改从同目录 `.scx` 头部 `0xA0` 槽读取，换工程 / 换振荡器选项不会写错。
