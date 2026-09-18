# Workspace mentions

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

A **workspace mention** is a global pack: one **work folder** (where the agent writes) plus optional **reference folders** (read-only paths injected into the first prompt).

It is **not** a per-repo `.arp` file. Packs live in Desktop settings:

```text
~/.agent-resume-panel/settings.desktop.json
→ workbench.composerMentions
```

Use them when you often start from an unrelated directory but the real work is in another repo (and you still want sibling repos named in the prompt).

Example pack `anfeng`:

| Role | Path |
|------|------|
| Work (cwd, write here) | `/Users/you/work/C` |
| Reference (read only) | `/Users/you/work/A` |
| Reference (read only) | `/Users/you/work/B` |

### Configure

1. Open **⚙ Settings → Workbench**.
2. Under **Workspace mentions**, click **Add mention**.
3. Set **Id** (`anfeng` — letters, digits, `_`, `-`; no `@` in the stored id).
4. Set **Work folder** (Browse or paste an absolute / `~/…` path).
5. Optionally **Add reference** folders.
6. Settings save automatically — fields commit when they lose focus, so just click elsewhere.

Ids are unique case-insensitively. Empty ids, empty work folders, and duplicate ids are dropped on save.

### New session

In **Workbench**, click **New session**:

- If the **current project is already the pack’s work folder**, Desktop injects the reference paths automatically. You do not pick the pack again.
- Otherwise the picker lists **Workspace**: **Current project** (default) or each pack id. Choosing `anfeng` opens the session in **C** and sends this block as the first prompt:

```text
[Workspace anfeng]
Work cwd (write here only): /Users/you/work/C
Reference (read only):
- /Users/you/work/A
- /Users/you/work/B
```

If Settings already has a default agent, picking a workspace launches immediately. If default agent is **Ask every time**, pick the workspace first, then the CLI / ACP target.

The sidebar project follows the work folder so Explorer / Git match the session cwd.

### `arpm` CLI

Same packs, from any terminal (iTerm, Ghostty, Workbench shell). Command name is **`arpm`** (not `arp`, which is the system ARP table tool).

| Command | Effect |
|---------|--------|
| `arpm list` | Print configured packs |
| `arpm prompt <id>` | Print the prompt block only |
| `arpm go <id>` | Print the prompt block and **cd into the work folder** (needs the shell hook) |
| `arpm go <id> --print-cwd` | Print only the work folder |
| `arpm go <id> --launch` | Start the CLI agent in the work folder (default provider `codex`) |
| `arpm go <id> --launch --provider claude` | Launch that CLI agent |
| `arpm go <id> --launch --yolo` | Launch with the provider’s YOLO flags when supported |
| `arpm run [--provider <agent>] [--note <id>] [--yolo]` | Start an agent in the current directory; `--note` injects the task's context (address table and knowledge) |

Desktop also installs a shell function (via `~/.zshrc` / `~/.bashrc`) so `arpm go anfeng` cds **in the current terminal**. Open a new terminal after the first launch. Without the hook, `arpm` can only print a `cd` line — a subprocess cannot change your shell’s directory.

Panel home override (same as other Agent Resume CLIs):

```bash
AGENT_RESUME_PANEL_HOME=/path/to/home arpm list
```

Desktop installs `~/.local/bin/arpm` on launch (a small shim that runs the bundled CLI under Electron’s Node). `~/.local/bin` must be on your shell `PATH`. After the first launch, open a **new** terminal and run `arpm list`.

If a file named `arpm` already exists there and was not written by Agent Resume, Desktop leaves it alone.

Without Desktop, from this repo:

```bash
pnpm --filter @agent-resume/core exec arpm list
```

### Limits (v1)

- **Prompt only.** Reference folders are listed for the model. Desktop does not pass `--add-dir` / extra sandbox roots, so some CLIs still cannot read A/B until you allow those paths in the agent.
- **No composer `@anfeng`.** Type the pack in **New session** or `arpm`, not in the Workbench composer.
- **One agent.** There is no explore-then-implement router.
- **Desktop + `arpm` only.** The VS Code extension does not read these packs.

### Related

- [Workbench](workbench.md) · [Settings & data](settings-and-data.md)

---

## 简体中文

### 是什么

**工作区 Mention** 是一份全局包：一个 **工作目录**（agent 在这里写代码）加上可选的 **参考目录**（只读路径，写入首条 prompt）。

它 **不是** 某个仓库的 `.arp`。配置在 Desktop 设置里：

```text
~/.agent-resume-panel/settings.desktop.json
→ workbench.composerMentions
```

适合：人经常待在无关目录，真正干活在另一个仓库，同时还希望 prompt 里写清兄弟仓库的绝对路径。

例如包 `anfeng`：

| 角色 | 路径 |
|------|------|
| 工作（cwd，只在这里写） | `/Users/you/work/C` |
| 参考（只读） | `/Users/you/work/A` |
| 参考（只读） | `/Users/you/work/B` |

### 配置

1. 打开 **⚙ 设置 → Workbench**。
2. 在 **工作区 Mention** 点 **添加 Mention**。
3. 填 **Id**（`anfeng`，字母数字 `_` `-`；存盘时不要带 `@`）。
4. 填 **工作目录**（浏览或粘贴绝对路径 / `~/…`）。
5. 需要时 **添加参考目录**。
6. 设置会自动保存：输入框失焦即写入，直接点别处即可。

Id 大小写不敏感、不可重复。空 Id、空工作目录、重复 Id 会在保存时丢掉。

### 新建会话

在 **Workbench** 点 **新建 Session**：

- **当前项目已经是该包的工作目录** 时，自动注入参考路径，不必再选包。
- 否则选择器会列出 **工作区**：**当前项目**（默认）或各个 pack id。选 `anfeng` 会在 **C** 开会话，并把下面这块作为首条 prompt：

```text
[Workspace anfeng]
Work cwd (write here only): /Users/you/work/C
Reference (read only):
- /Users/you/work/A
- /Users/you/work/B
```

若设置里已有默认 Agent，选完工作区会立刻启动。若默认 Agent 是 **每次询问**，先选工作区，再选 CLI / ACP。

侧边栏项目会切到工作目录，Explorer / Git 与会话 cwd 一致。

### `arpm` 命令行

同一份配置，任意终端都能用（iTerm、Ghostty、Workbench shell）。命令名是 **`arpm`**（不要用 `arp`，那是系统 ARP 表工具）。

| 命令 | 作用 |
|------|------|
| `arpm list` | 列出已配置的包 |
| `arpm prompt <id>` | 只打印 prompt 块 |
| `arpm go <id>` | 打印 prompt 块并 **cd 进工作目录**（需要 shell hook） |
| `arpm go <id> --print-cwd` | 只打印工作目录 |
| `arpm go <id> --launch` | 在工作目录启动 CLI agent（默认 `codex`） |
| `arpm go <id> --launch --provider claude` | 启动指定 CLI agent |
| `arpm go <id> --launch --yolo` | 在支持的情况下带上 YOLO 参数 |
| `arpm run [--provider <agent>] [--note <id>] [--yolo]` | 在当前目录启动 agent；`--note` 会注入任务上下文（地址表与背景知识） |

Desktop 还会通过 `~/.zshrc` / `~/.bashrc` 装一个 shell 函数，让 `arpm go anfeng` **在当前终端里 cd**。第一次启动后请新开终端。没有 hook 时，`arpm` 只能打印一条 `cd`——子进程改不了你当前 shell 的目录。

覆盖 panel home（与其它 Agent Resume CLI 相同）：

```bash
AGENT_RESUME_PANEL_HOME=/path/to/home arpm list
```

Desktop 启动时会把 `~/.local/bin/arpm` 装上（一小段 shim，用 Electron 自带的 Node 跑内置 CLI）。shell 的 `PATH` 里需要有 `~/.local/bin`。第一次启动后，**新开**一个终端再运行 `arpm list`。

若该路径已有不是 Agent Resume 写的 `arpm`，Desktop 不会覆盖。

不启动 Desktop 时，在本仓库：

```bash
pnpm --filter @agent-resume/core exec arpm list
```

### 限制（v1）

- **只注入 prompt。** 参考目录只写给模型。Desktop 不会给 CLI 加 `--add-dir` 等额外沙箱根，部分 agent 仍可能读不到 A/B，需要你在 agent 里放行这些路径。
- **没有 composer `@anfeng`。** 在 **新建会话** 或 `arpm` 里选包，不要在 Workbench 输入框打 `@`。
- **单 agent。** 没有「先探索再实现」的路由。
- **仅 Desktop + `arpm`。** VS Code 扩展不读这些包。

### 相关文档

- [Workbench](workbench.md) · [设置与数据](settings-and-data.md)
