# Agent Resume Desktop

Languages: [English](#english) | [简体中文](#简体中文)

Standalone **macOS Session OS + Memory** app — calendar digests, Agent Q&A over your work history, and an embedded **Workbench** terminal. Shares the same local data as the [Agent Resume Panel VS Code extension](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2).

| | Link |
|---|------|
| **Download** | [Latest DMG](https://github.com/lucacicii/agent-resume-panel/releases/latest) |
| **User docs** | [docs/desktop](../../docs/desktop/README.md) |
| **Report issues** | [Issues](https://github.com/lucacicii/agent-resume-panel/issues) |
| **VS Code extension** | [Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2) |

Version: **0.2.7**

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

- macOS 12 or later
- Apple Silicon or Intel (universal build)

### Local development (Mac Intel / Apple Silicon)

```sh
# from monorepo root
pnpm install
pnpm run doctor:desktop   # optional: Node/pnpm/Electron/node-pty health
pnpm run dev:desktop
pnpm run pack:desktop     # universal .app + DMG; either Mac arch is fine
```

Do **not** copy `node_modules` or `.pack-staging` between Intel and Apple Silicon machines—only clone/pull and `pnpm install`.

### Thunder daemon (optional)

The **Chat** view talks to **Thunder** — a separate Rust workspace (`thunder-agent-daemon`) that does not live in this repo. The app spawns it as a STDIO sidecar on demand (you never start it by hand) and discovers the binary in this order:

| # | Rule | Example |
|---|------|---------|
| 1 | `THUNDER_DAEMON_BIN` | `/opt/thunder/thunder-daemon` |
| 2 | `settings.desktop.json` → `thunder.daemonPath` | direct binary |
| 3 | `THUNDER_PATH` | `/path/into/thunder` |
| 4 | `settings.desktop.json` → `thunder.repoPath` | `/path/into/thunder` |
| 5 | Bundled `Contents/Resources/thunder/bin/thunder-daemon` | packaged app |
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

Release note: `pnpm run pack:desktop` (or `release:desktop:mac`) **embeds** the daemon at `Contents/Resources/thunder/bin/thunder-daemon` — one binary per arch, staged by [`scripts/thunder-sidecar.mjs`](../../apps/desktop/scripts/thunder-sidecar.mjs):

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

Cross-arch builds need the Rust target (`rustup target add aarch64-apple-darwin` for arm64 on an Intel Mac) — without it the arch is packed *without* a bundled daemon and the script says so, unless `AGENT_RESUME_REQUIRE_THUNDER=1`. The staged binary is signed with `--options runtime --timestamp` when `AGENT_RESUME_CODESIGN_IDENTITY` is a real identity, then the bundle is signed as before. `dev:mac` never bundles, so your live checkout always wins during development.

### Install

1. Download the latest `Agent Resume-<version>.dmg` from [Releases](https://github.com/lucacicii/agent-resume-panel/releases/latest).
2. Open the DMG and drag **Agent Resume** to **Applications**.
3. If macOS blocks the app on first launch, right-click → **Open** once, or run:

   ```bash
   xattr -cr "/Applications/Agent Resume.app"
   ```

---

## 简体中文

独立 **macOS Session OS + Memory** 应用：日历回顾、基于报告的 **Agent** 问答、内嵌 **Workbench** 终端。与 [Agent Resume Panel VS Code 扩展](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2) 共用同一份本机数据。

### 主要视图

| 视图 | 说明 |
|------|------|
| **Report** | 日历、日/周/月 AI 回顾报告与 GTD 条 |
| **Agent** | 对回顾与会话历史的自然语言问答 |
| **Workbench** | 内嵌终端（配色、多标签恢复）、项目搜索、脚本运行与 Git 工具 |
| **Notes** | Markdown 笔记编辑（与扩展共用） |
| **Sessions** | 会话参考列表与只读预览 |

### 系统要求

- macOS 12 或更高
- Apple Silicon 或 Intel（通用构建）

### Thunder daemon（可选）

**Chat** 视图背后是 **Thunder** —— 一个独立的 Rust 工作区（`thunder-agent-daemon`），**不在本仓库里**。应用需要时把它作为 STDIO sidecar 拉起来（不需要手动启动），按下列顺序寻找二进制：

| 顺序 | 规则 | 例子 |
|------|------|------|
| 1 | `THUNDER_DAEMON_BIN` | `/opt/thunder/thunder-daemon` |
| 2 | `settings.desktop.json` → `thunder.daemonPath` | 直接指定二进制 |
| 3 | `THUNDER_PATH` | `/path/into/thunder` |
| 4 | `settings.desktop.json` → `thunder.repoPath` | `/path/into/thunder` |
| 5 | 随包内置 `Contents/Resources/thunder/bin/thunder-daemon` | 打包后的 app |
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

发版说明：`pnpm run pack:desktop`（或 `release:desktop:mac`）现在会**内置**守护进程到 `Contents/Resources/thunder/bin/thunder-daemon`，每个架构一份，由 [`scripts/thunder-sidecar.mjs`](../../apps/desktop/scripts/thunder-sidecar.mjs) 负责准备：

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

跨架构需要先装 Rust target（在 Intel Mac 上打 arm64 要 `rustup target add aarch64-apple-darwin`）—— 缺了它，该架构会**不带 daemon** 打包并明确提示；加 `AGENT_RESUME_REQUIRE_THUNDER=1` 则直接失败。`AGENT_RESUME_CODESIGN_IDENTITY` 是真实身份时，内置二进制会用 `--options runtime --timestamp` 单独签名，然后再签整个 bundle。`dev:mac` 从不内置，保证开发时始终用你本地 checkout。

### 安装

1. 从 [Releases](https://github.com/lucacicii/agent-resume-panel/releases/latest) 下载最新 `Agent Resume-<version>.dmg`。
2. 打开 DMG，将 **Agent Resume** 拖入 **应用程序**。
3. 若首次启动被系统拦截，可右键 → **打开** 一次，或执行：

   ```bash
   xattr -cr "/Applications/Agent Resume.app"
   ```
