# SCMCU IDE for VS Code (SC8 Series MCUs)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.9.10-orange.svg)](https://github.com/YoussefMostafaMohammed/SCMCU_IDE-VSCODE-Plugin/releases)

**Chinese documentation: [README.zh-cn.md](README.zh-cn.md)**

Compile SC8F/SC8P series MCU projects in VS Code using the SCMCU_IDE MPLAB XC8/PICC toolchain. Configure chip hardware options, select chips, detect the compiler, navigate to build errors, and generate `.hex` and `.scx` files. The extension also detects SCMCU programmers and supports one-click build-and-program and programming an existing build.

## Features

| Command | Description |
|---|---|
| `SCMCU: Build (Generate .hex + .scx)` | Builds the project using the `.scw` device, source-file order, and configuration words. |
| `SCMCU: Build and Flash` | Builds, then programs with a Writer programmer using `.scx` or a CMS-ICE6 simulator using `.hex`. |
| `SCMCU: Flash (Without Building)` | Programs the most recent firmware in `build/` without rebuilding. |
| `SCMCU: Hardware Options` | Configure WDT, PROTECT, LVR, FCPU_DIV, and other hardware options. Saves to `.scw` or workspace settings and synchronizes existing `.scx` configuration words. |
| `SCMCU: Select Chip Model` | Select a chip from the IDE library and update the `.scw` device. |
| `SCMCU: Source File Manager` | Add, remove, and reorder source files. The order is the compilation order. |
| `SCMCU: Configure Compiler Directory` | Set the SCMCU_IDE installation directory manually. |
| `SCMCU: Detect Compiler Automatically` | Search common installation paths, drives, and `SCMCU_IDE_HOME`. |
| `SCMCU: Set Chip Model (Without .scw)` / `SCMCU: Set Configuration Words (Without .scw)` | Configure standalone-project workspace settings. |
| `SCMCU: Startup` | Manually enable the extension after choosing not to load it for a workspace without a `.scw` file. |
| `SCMCU: Normalize Configuration Words` | Repair configuration-word bits copied from a chip with a different word width. |

**Status bar**

- Left side: chip selection, hardware options, build, flash, build-and-flash, and source-file management.
- Right side: programmer detection. Click to refresh; automatic polling runs every five seconds while the VS Code window is focused.
- If no `.scw` file is found, the extension follows `scmcu.noScwBehavior` (ask, load, or skip).

## Getting Started

1. Open a folder containing a `.scw` project in VS Code.
2. Run `SCMCU: Detect Compiler Automatically`, or use `SCMCU: Configure Compiler Directory`.
3. Run `SCMCU: Build`. The build output is written to `build/` by default:
   - `<name>.hex`: Intel HEX program image.
   - `<name>.scx`: SCMCU programming file containing the program and configuration words.
4. To change hardware options, run `SCMCU: Hardware Options`, select the desired values, and save.
5. To select a different chip, click the chip item in the status bar or run `SCMCU: Select Chip Model`.
6. To manage source files, click the source-file item in the status bar or run `SCMCU: Source File Manager`. Reordering files changes compilation order.

## Complete Windows Setup (Downloads, Source Build, and VS Code)

This walkthrough covers a fresh Windows setup: install the SCMCU tools, build this extension from source, configure the local tool paths, and build/program a project. The SCMCU IDE, SCMCU Writer, and this VS Code extension are separate downloads/installations.

### 1. Install the SCMCU IDE and SCMCU Writer

1. Download the SCMCU IDE package and the **normal SCMCU Writer** package from the SCMCU vendor or the distributor that supplied your MCU/programmer. Install or extract each package and note its actual folder. Use a Writer version that supports your programmer and target chip.
2. Check that the IDE folder contains the compiler and chip files:

   ```text
   <SCMCU IDE root>\
   ├── data\bin\picc.exe
   └── mcu\config\
   ```

   The IDE root is the folder above `data` and `mcu`, not the `bin` folder and not `picc.exe` itself.
3. Check that the Writer folder contains the runtime files:

   ```text
   <SCMCU Writer root>\
   ├── data\system.info
   ├── data\database.db
   └── library\Writer.Core.dll
   ```

   If the downloaded Writer archive has an extra nested folder, use the inner folder that contains both `data` and `library` as the Writer root. A copy of `library` by itself is not a complete Writer installation for programming.

### 2. Build the extension from source

Install Node.js (including npm), Git, and Python 3. To rebuild the Writer programming helper, also install the .NET 8+ runtime (or SDK, which includes the runtime); the build script runs the downloaded Roslyn compiler with `dotnet`. The first helper build needs internet access to download Roslyn from NuGet.

Open PowerShell in the extension source folder (the folder containing `package.json`) and run:

```powershell
npm install
npm run compile
npm test
```

The commands install the JavaScript development dependencies, compile the TypeScript extension, and run its regression tests. To build the `.vsix` installer, first configure the Writer library path as described in the next section, then run:

```powershell
npm run package
```

This runs the helper build and creates a file such as `scmcu-vscode-0.9.10.vsix` in the extension source folder. The `package` script requires Python, `dotnet`, the .NET Framework reference assemblies used by the helper, and access to the Writer DLLs.

### 3. Point the Writer helper build at your Writer libraries

`flash\build_helper.py` needs the Writer **library directory** at build time so the C# helper can reference `Writer.Core.dll` and its companion assemblies. Find the `_pick_first(...)` call in that file and add your library directory as a candidate. For example, if the Writer is installed in the nested Program Files location:

```python
writer_lib = (os.environ.get('SCMCU_WRITER_LIB') or
              _pick_first(r'F:/Work/SCMCU_Writer_V9.01.16/library',
                          r'C:/Program Files (x86)/SCMCU_Writer_V9.01.16/SCMCU_Writer_V9.01.16/library',
                          r'C:/Program Files (x86)/SCMCU_Writer_V9.01.16/library',
                          r'C:/Program Files/SCMCU_Writer_V9.01.16/library'))
```

Keep the paths comma-separated and make sure the selected directory contains `Writer.Core.dll`. `_pick_first` selects the first path that exists. Then rebuild the helper from the extension source folder:

```powershell
python flash\build_helper.py
```

Instead of editing the candidate list, you can set `SCMCU_WRITER_LIB` before packaging, or pass `--writer-lib` when building only the helper:

```powershell
$env:SCMCU_WRITER_LIB = 'C:\Program Files (x86)\SCMCU_Writer_V9.01.16\SCMCU_Writer_V9.01.16\library'
npm run package

python flash\build_helper.py --writer-lib 'C:\Program Files (x86)\SCMCU_Writer_V9.01.16\SCMCU_Writer_V9.01.16\library'
```

This helper-build path is **not** the same setting as `scmcu.writerPath`: `_pick_first` (or `SCMCU_WRITER_LIB`) is for compiling the helper; `scmcu.writerPath`, below, is the full Writer installation directory used when the extension programs a chip.

### 4. Install the extension in VS Code

From the extension source folder, install the packaged VSIX using either method:

- In VS Code, open **Extensions** → `...` → **Install from VSIX...**, then select the generated `.vsix`.
- Or run this in PowerShell, replacing the filename if the extension version differs:

  ```powershell
  code --install-extension .\scmcu-vscode-0.9.10.vsix
  ```

Reload VS Code after installation. To test the compiled source directly without installing a VSIX, run `npm run compile`, then launch an Extension Development Host from PowerShell (replace both paths):

```powershell
code --extensionDevelopmentPath "C:\path\to\SCMCU_IDE-VSCODE-Plugin" "C:\path\to\your\MCU-project"
```

### 5. Configure the IDE, compiler, and Writer paths in VS Code

Open the MCU project folder in VS Code. Create or edit that project’s `.vscode\settings.json` (create the `.vscode` folder if needed), or use **Preferences: Open Workspace Settings (JSON)** from the Command Palette. Add the following settings and replace each example with the path on your computer:

```json
{
  "scmcu.idePath": "C:\\Program Files (x86)\\SCMCU_IDE_V2.00.17",
  "scmcu.compilerPath": "C:\\Program Files (x86)\\SCMCU_IDE_V2.00.17\\data\\bin",
  "scmcu.writerPath": "C:\\Program Files (x86)\\SCMCU_Writer_V9.01.16\\SCMCU_Writer_V9.01.16"
}
```

On Windows, JSON strings require doubled backslashes (`\\`). These settings are directories:

- `scmcu.idePath`: IDE root containing `mcu\config` and `data\bin`.
- `scmcu.compilerPath`: the `data\bin` directory containing `picc.exe`; do not include `picc.exe` in the setting.
- `scmcu.writerPath`: full Writer root containing `library\Writer.Core.dll`, `data\system.info`, and `data\database.db`. Do not set this to the `library` subdirectory.

The extension can auto-detect some installations, but explicit settings avoid ambiguity when you have multiple IDE/Writer versions or installed them in non-standard locations. You can also set the compiler using **SCMCU: Configure Compiler Directory** or try **SCMCU: Detect Compiler Automatically**.

### 6. Build and program a project

1. Connect the target board and programmer, and install the programmer’s USB driver if Windows has not already done so.
2. In VS Code, open the project folder containing its `.scw` file.
3. Run **SCMCU: Build (Generate .hex + .scx)** from the Command Palette. The output channel should show the selected chip/compiler and report that the build succeeded. The generated firmware is in the project’s `build` directory.
4. To program using a Writer programmer, run **SCMCU: Build and Flash**. The extension uses the `.scx` file and the Writer path configured above; the Writer GUI does not need to be open. You can also run **SCMCU: Flash (Without Building)** to program the existing output in `build`.
5. Check the **SCMCU** output channel for the programming steps and final success message. A successful Writer download should include messages for the ROM/configuration data and verification, followed by `[OK]`/download complete.

If compilation fails, verify that `scmcu.compilerPath` ends at the folder containing `picc.exe` and that `scmcu.idePath` is the IDE root. If programming reports a missing Writer database or DLL, verify `scmcu.writerPath` is the full Writer root and separately verify that the helper was built with the correct Writer `library` directory. After changing paths or installing the VSIX, reload the VS Code window.

## Build Without a `.scw` Project
- `scmcu.device` (**required**): chip model, for example `SC8F052A04`.
- `scmcu.configWords` (**recommended**): four hexadecimal strings, for example `["0x1FFF","0x3FFF","0x3FFF","0x3FFF"]`. If empty, the extension uses the chip's default unprogrammed values and warns during the build. Verify hardware options before programming.
- `scmcu.sourceFiles` (optional): ordered source-file list relative to the project root. An empty list (the default) scans for `.c`, `.asm`, and `.s` files; a non-empty list is compiled in the specified order.

Commands for standalone settings:

- `SCMCU: Set Chip Model (Without .scw)` writes `scmcu.device` to workspace settings.
- `SCMCU: Set Configuration Words (Without .scw)` accepts four comma-separated hexadecimal values and writes `scmcu.configWords`.

When `scmcu.device` is set, the chip, hardware-options, build, and source-file status-bar actions are available without a `.scw` file. Hardware options and source-file changes are saved to workspace settings in standalone mode; with a `.scw` file, they are saved to the project.

If `scmcu.sourceFiles` is empty, the extension scans the project for `.c`, `.asm`, and `.s` files, excluding common generated and dependency directories. Files are sorted alphabetically. XC8's psect allocation can depend on source order; if the default order causes link errors, use the Source File Manager to create an explicit ordered list.

Both modes produce `build/<name>.hex` and `build/<name>.scx` and use the same build configuration and checksum calculation.

## Configuration-Word Normalization

Copying configuration words from a 16-bit chip (such as SC8F072, default `0xFFFF`) to a 14-bit chip (such as SC8F052, default `0x3FFF`) can leave invalid high bits. For example, `FFFB,FAEF,FFFF,FFFF` may need to become `3FFB,3FEF,3FFF,3FFF`.

- **Automatic:** In standalone mode, if both `scmcu.device` and manually entered `scmcu.configWords` are set, the extension normalizes the words once per workspace. It writes them back only when they change and attempts to update existing `.scx` files.
- **Manual:** Run `SCMCU: Normalize Configuration Words`.

Normalization preserves bits defined by the chip's `mcu/config/<chip>.cfg` template, resets undefined fixed bits for chips that require it, and masks values to the chip's word width. It is idempotent. For 16-bit chips, only the width mask is applied.

Chip width is read from `HEXMCU` in the IDE `.ini` file when available. Otherwise, the extension uses a model-based fallback (`0x3FFF` for supported 14-bit families and `0xFFFF` for 16-bit families).

## Build Output and Checksums

The output channel reports the project, chip, compiler, sources, include directories, configuration words, and generated programming file. Build errors and warnings are also shown in VS Code's Problems panel and can be clicked to navigate to their source locations.

The output also decodes configuration words into readable hardware options using the chip's `mcu/config/<chip>.cfg` template, in the same order as the SCMCU IDE hardware-options panel (for example, `WDT`, `PROTECT`, `LVR_SEL`, `FCPU_DIV`, `ICSPPORT_SEL`, and `EXT_RESET`). A field that cannot be matched is shown as `?`. This line is omitted when the template or chip data is unavailable.

Example:

```text
[SCMCU] Chip: SC8P052B  ROM: 1024 word
[SCMCU] Sources (8): main.c interrupt.c motor.c key.c LED.c battery.c CMP.c sleep.c
[SCMCU] Include: src | inc | data/include
[SCMCU] Config words: 3FF3,3FAB,3FFF,FFFF
[SCMCU] Hardware options: WDT=DISABLE  PROTECT=ENABLE  LVR_SEL=2.0V  FCPU_DIV=4T
        ICSPPORT_SEL=NORMAL  EXT_RESET=DISABLE
[SCMCU] Programming file: ...\build\SCMCU_Project.scx (2304 bytes)
[SCMCU] CfgCRC(Hex) -- 0x9202  CfgSum(Hex) -- 0x156D
[SCMCU] Build succeeded
```

The generated `.scx` file's CfgSum and CfgCRC are calculated to match SCMCU Writer:

```text
CfgSum = (sum of program bytes from 0x100 + checksum configuration bytes) & 0xFFFF
CfgCRC = CRC-16/CCITT-FALSE (poly=0x1021, init=0xFFFF, xorout=0)
```

The calculation matches `GetCheckSum` and `GetDataCRC16` in the Writer library. CfgSum adds program bytes starting at address `0x100` and the low byte of each configuration word; CMSCore chips also include each word's high byte. CfgCRC covers the program bytes and the low and high bytes of the applicable configuration words.

Although `.scx` reserves four configuration-word slots, the number included in the checksum is chip-specific. It is taken from the chip database when available, otherwise inferred from the configuration template (maximum word index plus one); the final fallback is four slots. For example, SC8F052 uses two slots and SC8F072 uses four. The `.scw` file may show four values because missing slots are padded with `FFFF`; that does not mean all four are part of the checksum.

| Project | Chip | Configuration words | Slots | CfgSum | CfgCRC |
|---|---|---|---:|---|---|
| test1 | SC8F052 | `3FFB,3FEF` | 2 | `A5AE` | `20CD` |
| test2 | SC8F052 | `7FFF,FFEF` | 2 | `AA75` | `9665` |
| test3 | SC8F072 | `FFFF,FAEF,FFFF,FFFF` | 4 | `4619` | `EC0D` |

These sample values were checked against SCMCU_Writer. If a newly supported chip reports different values, verify its configuration-word count and core type, then update the relevant tables in `src/scx.ts`.

## Programmer Detection

The status bar detects supported USB devices on Windows.

**Writer programmers** use VID `0x1209`:

| Model | Normal PID | Bootloader PID |
|---|---:|---:|
| WRITER8 LITE | `0x0201` | `0x0101` |
| WRITER V8 | `0x0032` | `0x0011` |
| WRITER V8 PRO | `0x0023` | `0x0021` |
| ICE8 PRO | `0x1502` | `0x1102` |

**CMS-ICE6 simulator**:

| Model | VID | PID |
|---|---:|---:|
| CMS-ICE6 | `0x0925` | `0x0283` |

The extension checks once after activation and polls every five seconds while the window is focused. Clicking the status item refreshes detection immediately. Bootloader-mode Writer devices are reported with a reminder to restore normal firmware using SCMCU Writer. An unrecognized PID is reported as an unknown programmer; no connected device and detection errors are reported separately. Detection runs on Windows and uses `pnputil`, with a `Get-PnpDevice` fallback.

For CMS-ICE6, the device must be powered and connected. The target board should have a stable supply (approximately 4.5 V VDD). Close SCMCU IDE before programming: it can retain exclusive access to the ICE6. If a previous IDE session left the device unable to write, disconnect and reconnect the ICE6 USB cable.

## Build and Program

`SCMCU: Build and Flash` builds first; `SCMCU: Flash (Without Building)` programs the existing output in `build/`. Both commands select a channel based on the connected device:

| Device | Input | Requirements |
|---|---|---|
| Writer programmer (`0x1209`) | `.scx` | SCMCU_Writer must be installed so the extension can use its chip database and libraries. |
| CMS-ICE6 (`0x0925`) | `.hex` | No Writer installation required. The extension includes the programming script and Python runtime. |

`Build and Flash` builds before programming; `Flash (Without Building)` programs the most recent build without recompiling. Both commands require a connected supported programmer and a powered target.

### Writer channel

The extension runs `flash/ScmcuFlashHelper.exe` and loads the Writer libraries from the configured or detected SCMCU_Writer installation. The GUI does not need to be open.

- `scmcu.writerPath`: Writer installation path. If empty, the extension searches common drive and software directories for `SCMCU_Writer*`.
- `scmcu.flashCount`: maximum allowed programming operations for the firmware. `0` (the default) means unlimited; a positive integer sets a limit.
- The helper can be rebuilt with `npm run build:helper` or `python flash/build_helper.py`.

The Writer helper checks the programmer connection and Writer ID, sends firmware and configuration data in blocks, waits for acknowledgements, verifies the transfer, and finishes the programming session. It loads the Writer libraries at runtime from the installation directory rather than copying them into that installation.

### CMS-ICE6 channel

The extension uses `flash/ice6_flash.py` and the bundled embeddable Python runtime in `flash/py/`; a system Python installation is not required. Set `SCMCU_BUILD_PY` to use a different Python executable.

The script performs the device handshake, erase, programming, read-back verification, configuration-word update, and cleanup. Progress is displayed in the VS Code status bar.

The high-level device sequence is:

| Step | Operation |
|---|---|
| 1 | Check the programmer and target connection; reconnect to the target if needed. |
| 2 | Perform the session handshake and query chip ID, ROM size, and programming parameters. |
| 3 | Enter programming mode, erase, and program non-blank firmware blocks, waiting for an acknowledgement for each block. |
| 4 | Read back the device and verify the programmed contents. |
| 5 | Write the configuration words from the matching `.scx` file and send the device cleanup sequence. |

The script uses the bundled embeddable Python 3.11.9 runtime and Python's standard library; a system Python installation and pip packages are not required. Set `SCMCU_BUILD_PY` to use a different interpreter.

The protocol workflow is:

| Step | Command or frame | Purpose |
|---|---|---|
| 1 | `0x50 0x53`, `0x1A` | Check the programmer and target connection; reconnect with `0xA6 0x78` and `0x52` if needed. |
| 2 | `0xFC`, `0x18`, `0x1B` | Establish the programming session. |
| 3 | `0x17` | Read chip ID, ROM size, and programming parameters, including erase/program timing and `VPPMODE=0x89`; the programmer generates VPP. The command must be acknowledged with `0x03`. |
| 4 | `0x0C 0x02 0x10` | Enter programming mode. |
| 5 | `0x01` per block | Program non-blank firmware blocks. Addresses advance by `0x18` words; each frame carries 48 bytes (24 words) and waits for its own acknowledgement. |
| 6 | `0x03` with erased configuration, then `0x0C 0x01 0x04` | Clear the configuration area and leave programming mode. |
| 7 | `0x06` x 64 | Read back the device for verification. The device returns the low byte for each word. |
| 8 | `0x03` with actual configuration, then `0x0C 0x01 0x04` | Write configuration words read from offset `0xA0` in the matching `.scx` file. |
| 9 | `0x0D`, `0x0B`, `0x04`, `0x0F`, `0x13`, `0x11` x 8, `0x09` x 4 | Finish and release the programming session, including after a verification failure. |

**Before programming**

- Ensure the target board is powered (approximately 4.5 V VDD).
- Close SCMCU IDE before programming. It can take exclusive control of the ICE6 and leave it unable to write until the USB device is disconnected and reconnected.

If verification reports that the chip was erased but no data was written, disconnect and reconnect the ICE6, then retry.

Progress is summarized in the output channel, while the active percentage is shown in the VS Code status bar. Raw protocol frames are suppressed by default; use `--debug` when troubleshooting.

#### CMS-ICE6 troubleshooting

| Symptom | Likely cause and action |
|---|---|
| Commands respond, but nothing is written | Disconnect and reconnect the programmer. Verify that the IDE is closed and the target is powered. |
| Only the initial device query responds | The target connection may have dropped. Reconnect the programmer and retry. |
| Verification reports many mismatches | Allow the programmer to settle after writing, then retry verification. |
| Later write blocks are missed | Check USB stability and retry; the extension waits for each block acknowledgement. |
| Read-back data looks invalid | Reconnect the device and retry the programming session. |
| Writing works only after power cycling | Close SCMCU IDE, then disconnect and reconnect the ICE6 USB cable before retrying. |

The extension stops and reports communication or verification failures rather than treating an incomplete write as a successful download.

The following troubleshooting notes summarize known ICE6 issues:

| Symptom | Cause and handling |
|---|---|
| Responses arrive but programming does not take effect | A report-ID byte can shift the frame. The script handles the report ID when preparing writes. |
| Only the initial query responds | The target link may have dropped. The script reconnects and checks the target before writing. |
| Many read-back mismatches appear immediately after writing | The device may need time to settle. Verification uses longer timeouts and retries unreadable blocks. |
| Later blocks read as `FF`, or a write hangs | Reads during programming can interrupt the device state machine. The script avoids interleaving reads and bounds asynchronous waits. |
| Some blocks are missed | Each write acknowledgement is consumed before sending the next block to avoid filling the HID input queue. |
| Read-back data looks like repeated `11 1B` bytes | The read path needs a valid session handshake; the script establishes one before reading. |
| Old data appears to remain after erase | The erase operation is part of the programming setup; blank blocks are skipped and verified by read-back. |
| High instruction bits do not match in verification | The device returns only the low byte for the relevant read command; verification uses the supported byte granularity. |
| The programmer erases but cannot write again | The cleanup sequence must run even after a failed verification. The script sends it during cleanup. |
| After using SCMCU IDE, writes are acknowledged but the chip remains erased | Close the IDE, disconnect and reconnect the ICE6 USB cable, then retry. |

## Error Navigation

Compiler errors and warnings are parsed into VS Code's **Problems** panel. Select an entry to jump to the corresponding source location; the full compiler output remains available in the **SCMCU** output channel.

## Build Behavior and IDE Compatibility

- **Source order:** In `.scw` mode, files are compiled in the order of the `SourceFile=` entries. XC8 psect allocation can depend on source order, so changing the order can change the output. In standalone mode, configure `scmcu.sourceFiles` when alphabetical scanning produces link errors.
- **Compiler options:** Build options are derived from the SCMCU IDE project configuration and its generated startup assembly.
- **Configuration words:** `.scw` mode reads the `config=` values from the project. The four words are written to the `.scx` header starting at offset `0xA0`.
- **Chip metadata:** ROM size and word width are read from the IDE's chip `.ini` files when available. If `HEXMCU` is absent, a model-based fallback is used: supported 14-bit families use `0x3FFF`; 16-bit families use `0xFFFF`.
- **`.scx` header:** The chip name and required marker are written so the SCMCU Writer can identify the firmware, including chip names that use all eight available characters.

## Settings

| Setting | Description |
|---|---|
| `scmcu.compilerPath` | SCMCU_IDE `data\\bin` directory containing `picc.exe`. Empty means automatic detection. |
| `scmcu.idePath` | SCMCU_IDE root containing `mcu\\config`. Empty means automatic detection. |
| `scmcu.buildDir` | Build output directory, relative to the project root. Default: `build`. |
| `scmcu.outputName` | Output filename without an extension. Default: `SCMCU_Project`. |
| `scmcu.sourceDirs` | C source directories relative to the project root. Empty string means the project root. Default: `["src"]`. |
| `scmcu.includeDirs` | Header include directories; added to the compiler's `-I` options. Default: `["inc"]`. |
| `scmcu.device` | Chip model required for builds without `.scw`. |
| `scmcu.configWords` | Four hexadecimal configuration words for builds without `.scw`. Empty uses unprogrammed defaults and emits a warning. |
| `scmcu.sourceFiles` | Ordered source-file list for builds without `.scw`. Empty triggers automatic scanning. |
| `scmcu.noScwBehavior` | Behavior when no `.scw` is found: `prompt` (default), `load`, or `skip`. |
| `scmcu.writerPath` | SCMCU_Writer installation directory. Empty triggers automatic detection. |
| `scmcu.flashCount` | Maximum programming operations for offline Writer programming. Default `0` means unlimited. |

## Development

```bash
npm install
npm run compile
npm test
npm run package
```

- `npm test` runs the configuration-word and programmer-detection regression suites.
- `npm run package` creates `scmcu-vscode-<version>.vsix`.
- Press **F5** in VS Code to launch an Extension Development Host.
- `npm run build:helper` rebuilds the Writer flash helper.

The regression tests use fixtures under `test/fixtures` and do not require SCMCU_IDE to be installed on the development machine.

## Project Structure

```text
src/
├── extension.ts             # Commands, status bar, activation, and programming workflow
├── build.ts                 # Compiler orchestration and diagnostics
├── chip.ts                  # .scw parsing, chip data, and configuration-word handling
├── compiler.ts              # Compiler discovery
├── scx.ts                   # .scx generation and checksum calculation
├── programmer.ts            # USB programmer/simulator detection
├── flash.ts                 # Writer and CMS-ICE6 programming channels
└── webview/
    ├── hardwareOptions.ts   # Hardware-options panel
    └── sourceManager.ts     # Ordered source-file manager
flash/
├── ScmcuFlashHelper.cs      # Writer-channel helper source
├── ice6_flash.py            # CMS-ICE6 download orchestration
├── ice6_flash_core.py       # CMS-ICE6 protocol primitives
└── py/                      # Bundled Python runtime
test/
├── configWords.regression.js  # Configuration-word regression tests
├── programmer.regression.js   # Programmer-detection regression tests
└── fixtures/ide/mcu/          # IDE chip configuration fixtures
l10n/
├── bundle.l10n.json         # Default runtime localization catalog
└── bundle.l10n.zh-cn.json   # Simplified Chinese runtime translations
```

## Version History

| Version | Highlights |
|---|---|
| **v0.9.10** | Bundled Python runtime; no system Python required for CMS-ICE6 programming. |
| **v0.9.9** | Simplified programming progress output. |
| **v0.9.8** | Progress moved to the status bar; concise output. |
| **v0.9.7** | Added readable hardware-option information and programming progress. |
| **v0.9.6** | CMS-ICE6 programming and flash-without-building command. |
| **v0.9.5** | Chip-specific configuration-word slot counts and Writer-matching checksums. |
| **v0.9.4** | UTF-8 decoding for Writer helper output. |
| **v0.9.3** | Improved compiler output decoding and warning navigation. |
| **v0.9.2** | Status-bar controls changed to icon buttons. |
| **v0.9.1** | Fixes for offline programming options and source-file management. |
| **v0.9.0** | Configuration-word normalization, programmer detection, and Writer programming channel. |
| **v0.8.x** | Source-file manager and standalone mode support. |
| **v0.6.x** | Configurable source/include directories, error navigation, and checksum alignment. |
| **v0.3.x** | Hardware-options panel and status-bar chip selection/build actions. |
| **v0.1.x** | Initial build, hardware-options, and compiler auto-detection features. |

### v0.9.10 details

- The VSIX bundles the Windows x64 embeddable Python 3.11.9 runtime under `flash/py/`; system Python is not required for CMS-ICE6 programming.
- The runtime resolver checks `SCMCU_BUILD_PY`, then the bundled interpreter, then `python` on `PATH`.
- The bundled runtime contains only the components needed by the programming script.

### v0.9.6 details

- CMS-ICE6 programming is selected before checking for a Writer installation, so CMS-ICE6 can be used without SCMCU Writer.
- Configuration words are read from the matching `.scx` file at offset `0xA0` to avoid programming words from a different project or hardware configuration.
- The extension added the **Flash (Without Building)** command and its status-bar button.
