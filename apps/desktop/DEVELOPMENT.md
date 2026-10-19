# Agent Resume Desktop

Languages: [English](#english) | [简体中文](#简体中文)

Standalone **macOS & Windows Session OS + Memory** app — calendar digests, Agent Q&A over your work history, and an embedded **Workbench** terminal. Shares the same local data as the [Agent Resume Panel VS Code extension](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2).

| | Link |
|---|------|
| **Download** | [Latest release (DMG / .zip)](https://github.com/lucacicii/agent-resume-panel/releases/latest) |
| **User docs** | [docs/desktop](../../docs/desktop/README.md) |
| **Report issues** | [Issues](https://github.com/lucacicii/agent-resume-panel/issues) |
| **VS Code extension** | [Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2) |

Version: **0.2.36**

> **No cloud · Local-first**  
> Session index, notes, and reports are stored on your machine under **`~/.agent-resume-panel`** (shared with the VS Code extension).  
> Optional LLM features only contact a third-party API you configure.

---

## English

### What it is

| View | Description |
|------|-------------|
| **Report** | Calendar with daily / weekly / monthly AI digests and GTD bar |
| **Agent** | Natural-language Q&A over your digests and session history |
| **Workbench** | Embedded terminal (themes, multi-tab resume), project search, scripts runner, and Git tooling |
| **Notes** | Markdown note editor (shared with the extension) |
| **Sessions** | Reference list and read-only preview |

### Requirements

- macOS 12 or later (Apple Silicon or Intel universal build), or Windows 10/11 (x64 or arm64)
- PowerShell 7 is optional on Windows: `pwsh.exe` is preferred when present, otherwise `powershell.exe` / `cmd.exe` is used
- node-pty ships ConPTY prebuilds for Windows, so there is no native rebuild after `pnpm install`

### Local development (macOS Intel / Apple Silicon / Windows)

```sh
# from monorepo root
pnpm install
pnpm run doctor:desktop   # optional: Node/pnpm/Electron/node-pty health
pnpm run dev:desktop
pnpm run pack:desktop     # DMG on macOS, portable .zip on Windows
```

Do **not** copy `node_modules` or `.pack-staging` between machines (either OS, or Intel ↔ Apple Silicon)—only clone/pull and `pnpm install`.

`pnpm run test:desktop` selects suites by host: `test:mac-app` + `test:launchd` on macOS, `test:win-app` on Windows, plus the platform-neutral suites on both.

### Packaging and release

`pnpm run pack:desktop` dispatches on the host platform to [`scripts/pack-mac.mjs`](scripts/pack-mac.mjs) or [`scripts/pack-win.mjs`](scripts/pack-win.mjs); use `pnpm run pack:desktop:mac` / `pnpm run pack:desktop:win` to force one.

| Platform | Artifacts | Signing |
|---|---|---|
| macOS | universal `.app` + `Agent Resume-<version>-<arch>.dmg` | `AGENT_RESUME_CODESIGN_IDENTITY`, then notarization |
| Windows | `Agent Resume-<version>-win32-<arch>.zip` (x64 + arm64); optional `...-setup.exe` | Authenticode via `WINDOWS_CERTIFICATE_FILE` + `WINDOWS_CERTIFICATE_PASSWORD`, or `WINDOWS_CERTIFICATE_SHA1` for a certificate already in the store |

Set `AGENT_RESUME_WIN_INSTALLER=nsis` to also emit the installer (requires `makensis` on PATH). `pnpm run release:desktop` uploads the current host's required artifacts.

### Thunder daemon (optional)

The **Chat** view talks to **Thunder** — a separate Rust workspace (`thunder-agent-daemon`) that does not live in this repo. The app spawns it as a STDIO sidecar on demand (you never start it by hand) and discovers the binary in this order:

| # | Rule | Example |
|---|------|---------|
| 1 | `THUNDER_DAEMON_BIN` | `/opt/thunder/thunder-daemon` |
| 2 | `settings.desktop.json` → `thunder.daemonPath` | direct binary |
| 3 | `THUNDER_PATH` | `/path/into/thunder` |
| 4 | `settings.desktop.json` → `thunder.repoPath` | `/path/into/thunder` |
| 5 | Bundled `Contents/Resources/thunder/bin/thunder-daemon` (macOS) / `<app>/resources/thunder/bin/thunder-daemon.exe` (Windows) | packaged app |
| 6 | Sibling checkout of this repo | `../thunder` (dev) |
| 7 | `../thunder`, `../../thunder`, `thunder` from cwd | run from a checkout |
| 8 | `$HOME/{wz,GitHub,Documents/GitHub,}/thunder` | your own build |

Rules 3–8 accept a checkout: `<repo>/thunder-agent-daemon/target/{release,debug}/thunder-daemon` is preferred, then `<repo>/daemon.sh` (builds on demand via cargo).

```sh
# build the daemon (native arch is fine for local work)
cd ../thunder && cargo build --release -p thunder-agent-daemon

pnpm run dev:desktop                                  # sibling checkout wins automatically
THUNDER_PATH=/path/to/thunder pnpm run dev:desktop     # another checkout
THUNDER_DEBUG=1 pnpm run dev:desktop                   # log the matched rule
```

`Chat → sidebar footer → Thunder Daemon` mirrors this: click to re-check, hover for the error, and `Not found — check Settings` when nothing is usable. **Settings → Thunder** shows the resolved daemon, the rule that matched, and the probed paths, and stores the two overrides above. The rules are unit-tested in `src/main/thunder/daemonResolver.test.ts` — add a case there instead of guessing.

Release note: `pnpm run pack:desktop` (or `pack:desktop:mac` / `pack:desktop:win`) **embeds** the daemon at `Contents/Resources/thunder/bin/thunder-daemon` on macOS and `resources/thunder/bin/thunder-daemon.exe` on Windows — one binary per arch, staged by [`scripts/thunder-sidecar.mjs`](../../apps/desktop/scripts/thunder-sidecar.mjs):

| Source | Rule |
|---|---|
| 1 | `AGENT_RESUME_THUNDER_BIN` — explicit binary (any arch) |
| 2 | `AGENT_RESUME_THUNDER_DIR` — prebuilt artifact dir: `<dir>/<arch>/thunder-daemon` (CI) |
| 3 | `THUNDER_PATH` or auto-discovered checkout → `cargo build --release -p thunder-agent-daemon` |

```sh
pnpm run pack:desktop                          # stages + signs + asserts the daemon is inside
AGENT_RESUME_REQUIRE_THUNDER=1 pnpm run pack:desktop   # fail instead of shipping without it
AGENT_RESUME_THUNDER_DIR=~/thunder-artifacts pnpm run pack:desktop
```

Cross-arch macOS builds need the Rust target (`rustup target add aarch64-apple-darwin` for arm64 on an Intel Mac); Windows uses `x86_64-pc-windows-msvc` / `aarch64-pc-windows-msvc`. Without the target that arch is packed *without* a bundled daemon; `pack:desktop` prints a boxed warning naming every artifact that lost the daemon, and `AGENT_RESUME_REQUIRE_THUNDER=1` turns it into a hard failure instead. On macOS, the staged binary is signed with `--options runtime --timestamp` when `AGENT_RESUME_CODESIGN_IDENTITY` is a real identity, then the bundle is signed as before; on Windows the packager signs the app and the embedded Thunder binaries with the `WINDOWS_CERTIFICATE_*` credentials above. `dev:mac` (macOS) and `dev:desktop` never bundle, so your live checkout always wins during development.

### Install

1. Download the latest `Agent Resume-<version>-<arch>.dmg` (macOS) or `Agent Resume-<version>-win32-<arch>.zip` (Windows) from [Releases](https://github.com/lucacicii/agent-resume-panel/releases/latest).
2. macOS: open the DMG and drag **Agent Resume** to **Applications**. Windows: extract the zip and run `Agent Resume.exe`, or run the optional `-setup.exe` installer.
3. If macOS blocks the app on first launch, right-click → **Open** once, or run:

   ```bash
   xattr -cr "/Applications/Agent Resume.app"
   ```

   Unsigned Windows builds may be flagged by SmartScreen; only continue if the artifact came from the official Releases page.

---

## 简体中文

独立 **macOS & Windows Session OS + Memory** 应用：日历回顾、基于报告的 **Agent** 问答、内嵌 **Workbench** 终端。与 [Agent Resume Panel VS Code 扩展](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2) 共用同一份本机数据。

### 主要视图

| 视图 | 说明 |
|------|------|
| **Report** | 日历、日/周/月 AI 回顾报告与 GTD 条 |
| **Agent** | 对回顾与会话历史的自然语言问答 |
| **Workbench** | 内嵌终端（配色、多标签恢复）、项目搜索、脚本运行与 Git 工具 |
| **Notes** | Markdown 笔记编辑（与扩展共用） |
| **Sessions** | 会话参考列表与只读预览 |

### 系统要求

- macOS 12 或更高（Apple Silicon 或 Intel 通用构建），或 Windows 10/11（x64 / arm64）
- Windows 上 PowerShell 7 可选：存在 `pwsh.exe` 时优先使用，否则回退到 `powershell.exe` / `cmd.exe`
- node-pty 自带 Windows ConPTY 预编译产物，`pnpm install` 后无需重新编译

本地开发与打包命令见英文节 **Packaging and release**：`pnpm run pack:desktop` 按宿主平台分派到 `pack-mac.mjs` / `pack-win.mjs`（也可显式用 `pack:desktop:mac` / `pack:desktop:win`）；`pnpm run release:desktop` 上传当前平台的产物。Windows 产物是 `Agent Resume-<version>-win32-<arch>.zip`，设置 `AGENT_RESUME_WIN_INSTALLER=nsis` 时另出 `-setup.exe`；签名使用 `WINDOWS_CERTIFICATE_FILE` + `WINDOWS_CERTIFICATE_PASSWORD`（或 `WINDOWS_CERTIFICATE_SHA1`）。

### Thunder daemon（可选）

**Chat** 视图背后是 **Thunder** —— 一个独立的 Rust 工作区（`thunder-agent-daemon`），**不在本仓库里**。应用需要时把它作为 STDIO sidecar 拉起来（不需要手动启动），按下列顺序寻找二进制：

| 顺序 | 规则 | 例子 |
|------|------|------|
| 1 | `THUNDER_DAEMON_BIN` | `/opt/thunder/thunder-daemon` |
| 2 | `settings.desktop.json` → `thunder.daemonPath` | 直接指定二进制 |
| 3 | `THUNDER_PATH` | `/path/into/thunder` |
| 4 | `settings.desktop.json` → `thunder.repoPath` | `/path/into/thunder` |
| 5 | 随包内置 `Contents/Resources/thunder/bin/thunder-daemon`（macOS）/ `<app>/resources/thunder/bin/thunder-daemon.exe`（Windows） | 打包后的 app |
| 6 | 与本仓库同级的 checkout | `../thunder`（开发） |
| 7 | 从 cwd 往上找 `../thunder`、`../../thunder`、`thunder` | 在 checkout 里启动 |
| 8 | `$HOME/{wz,GitHub,Documents/GitHub,}/thunder` | 自己编译的副本 |

规则 3–8 接受一个 checkout：优先 `<repo>/thunder-agent-daemon/target/{release,debug}/thunder-daemon`，其次 `<repo>/daemon.sh`（用 cargo 现编）。

```sh
# 编译 daemon（本地开发用本机架构即可）
cd ../thunder && cargo build --release -p thunder-agent-daemon

pnpm run dev:desktop                              # 同级 checkout 会自动命中
THUNDER_PATH=/path/to/thunder pnpm run dev:desktop # 指向别的 checkout
THUNDER_DEBUG=1 pnpm run dev:desktop               # 打印命中的规则
```

`Chat → 侧栏底部 → Thunder Daemon` 显示同样的状态：点击重新检测，悬停看错误详情；完全找不到时显示 `Not found — check Settings`。**设置 → Thunder** 面板会显示实际解析到的守护进程、命中的规则与已检查的路径，并可保存上面两个覆盖项。规则本身在 `src/main/thunder/daemonResolver.test.ts` 有单测 —— 要改行为先在那里加用例。

发版说明：`pnpm run pack:desktop`（或 `pack:desktop:mac` / `pack:desktop:win`）现在会**内置**守护进程到 `Contents/Resources/thunder/bin/thunder-daemon`（macOS）或 `resources/thunder/bin/thunder-daemon.exe`（Windows），每个架构一份，由 [`scripts/thunder-sidecar.mjs`](../../apps/desktop/scripts/thunder-sidecar.mjs) 负责准备：

| 来源 | 规则 |
|------|------|
| 1 | `AGENT_RESUME_THUNDER_BIN` —— 直接指定二进制（不限架构） |
| 2 | `AGENT_RESUME_THUNDER_DIR` —— 预编译产物目录：`<dir>/<arch>/thunder-daemon`（CI） |
| 3 | `THUNDER_PATH` 或自动探测到的 checkout → `cargo build --release -p thunder-agent-daemon` |

```sh
pnpm run pack:desktop                                  # 准备 + 签名 + 断言二进制确实进了包
AGENT_RESUME_REQUIRE_THUNDER=1 pnpm run pack:desktop    # 拿不到就报错，而不是静默发出一个没有 daemon 的包
AGENT_RESUME_THUNDER_DIR=~/thunder-artifacts pnpm run pack:desktop
```

跨架构 macOS 构建需要先装 Rust target（在 Intel Mac 上打 arm64 要 `rustup target add aarch64-apple-darwin`）；Windows 对应 `x86_64-pc-windows-msvc` / `aarch64-pc-windows-msvc`。缺了它，该架构会**不带 daemon** 打包；`pack:desktop` 会在结尾用醒目的警告框列出所有丢了 daemon 的产物，加 `AGENT_RESUME_REQUIRE_THUNDER=1` 则直接失败。macOS 上 `AGENT_RESUME_CODESIGN_IDENTITY` 是真实身份时，内置二进制会用 `--options runtime --timestamp` 单独签名，然后再签整个 bundle；Windows 上打包器用上面的 `WINDOWS_CERTIFICATE_*` 凭据签署 app 与内置 Thunder 二进制。`dev:mac`（macOS）与 `dev:desktop` 从不内置，保证开发时始终用你本地 checkout。

### 安装

1. 从 [Releases](https://github.com/lucacicii/agent-resume-panel/releases/latest) 下载最新 `Agent Resume-<version>-<arch>.dmg`（macOS）或 `Agent Resume-<version>-win32-<arch>.zip`（Windows）。
2. macOS：打开 DMG，将 **Agent Resume** 拖入 **应用程序**。Windows：解压 zip 后运行 `Agent Resume.exe`，或运行可选的 `-setup.exe` 安装包。
3. 若首次启动被系统拦截，可右键 → **打开** 一次，或执行：

   ```bash
   xattr -cr "/Applications/Agent Resume.app"
   ```

   未签名的 Windows 构建可能触发 SmartScreen；请仅在产物来自官方 Releases 页面时继续。
