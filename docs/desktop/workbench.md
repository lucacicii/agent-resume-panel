# Workbench

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

**Workbench** is Desktop’s **session OS** surface: pick a **task**, open its **sessions**, resume in an **embedded xterm** or the **system default terminal**, and use **Git / explorer** tools against that task’s local folders. It is the primary place to *continue working*, while [Sessions](sessions.md) is a lighter reference list.

Every task workbench lives in **its own window**. The main window is the **GTD board** (plus settings), and clicking a task card — or a workbench chip on it — opens or focuses that workbench’s window. One workbench is one window: its panes, terminals and Git state belong to it, and reopening a task re-attaches the terminals it had instead of starting new agents.

### Core flows

1. Click a task on the **GTD board**. Its workbench window opens on that task’s sessions (a task with several workbenches opens the one you used last).  
2. Select a task to see only its sessions. With no task selected, the middle pane lists all sessions.  
3. Attach a local folder with **Add folder** (macOS folder picker). Click a folder chip to make it the active root for Explorer / Git / Search / Scripts. A task can reference several folders; with none or several, new sessions start in the task’s shared workspace, whose `AGENTS.md` / `CLAUDE.md` carry the address table (where each folder lives), the note’s background knowledge, and a pointer to `.arp/docs/` in that workspace for long-lived shared docs. Right-click the task to open that folder once a session has created it. With a single folder, the session starts directly in that repository and the same address table and knowledge are appended to the agent’s system prompt (Codex, Claude, Pi, Prime) — nothing is written into the repository, and the injected block says nothing about `.arp` (there `.arp/` is the committed panel config, see [Settings & data](settings-and-data.md)). In a session running in the shared workspace, typing `#` in the composer suggests the task’s referenced repositories; `→` walks into a folder level by level (`←` steps back) and `Tab` inserts the highlighted entry — the absolute path for a project inside the shared workspace.  
4. Resume CLI sessions in the **embedded terminal** (multi-tab) or **external** terminal. If [workspace mentions](workspace-mentions.md) are configured, the new-session picker can open a pack’s work folder and inject reference paths into the first prompt. `arpm go <id>` does the same from any terminal.  
5. If the default target is an **ACP · …** agent, **New session** opens a **visual chat pane** in the same tab strip (Agent Client Protocol; Claude Code, Codex, Grok Build, OpenCode, Pi).  
6. The detail header names the **task** and points at the directory it works in — the folder you activated, else its only folder, else the task's shared workspace — with a one-click **reveal in Finder** and the **branch** control; watch the **status bar** for live **cwd** and **git branch** (including nested repos when detected).  
7. Open **Search**, **Scripts** or **Browser** from the detail toolbar, or expand scripts under **Explorer**; click the status bar branch to switch branches when Git IPC is available.  
8. In **Git**, select specific changed files before commit when you do not want to commit everything; open a changed file to inspect an inline diff and search within it. **Auto generate** uses `<repo>/.arp/config.json` `workbench.git.commitMessage` when present, otherwise **Settings → Workbench** commit-message style.
9. In **Explorer**, right-click a file to inspect its Git history across local and remote-tracking branches, including commits before renames. Right-click a folder to discard Git changes under that directory, or use context menus on changed files to open them or copy absolute / relative paths. Open editors watch the workspace and report external changes, conflicts, and deleted files.

### Side panel

| Tool | Purpose |
|------|---------|
| **Explorer** | Browse project files; right-click a file for all-branch Git history and rename tracking, or right-click a file/folder and choose **Find in Folder** to search inside it |
| **Search** | Find text in the selected project (match case, whole word, regex); narrow with **files to include / files to exclude** globs, or switch to **replace** mode for Replace All, per-file, or per-occurrence replacement |
| **Scripts** | Discover and run project scripts (npm / pnpm / yarn / bun, Make, Gradle, Python, Cargo) into the active terminal |
| **Nested git scan** | Discover git repos under the project tree |
| **Git changes** | Stage/select files, commit only selected paths, push / pull, and inspect diffs |
| **Git log graph** | Branch graph and commit node details in the side panel |
| **Browser** | Open a live page for this folder: address bar, tabs, clear cookies, and pop-out into its own window. **Pick element** reports the element, its component and source line; **Annotate** frames regions and attaches notes you can send to the session; the CDP console collects page errors and forwards one to the session; viewport presets and zoom drive the embedded view |

### Find in Files

Press **⌘⇧F / Ctrl+Shift+F** (or open **Search**) to search file contents across the selected project, VS Code style:

- **Aa / Ab / .*** toggle match case, whole word, and regular expressions. The **ellipsis** toggle reveals **files to include** and **files to exclude** fields (comma or newline separated globs such as `src/**` or `**/*.test.ts`); results update live as you type. Include globs can reach build-output folders like `dist/` that are skipped by default.
- The **replace toggle** adds a replace field and **Replace All**, plus per-file and per-occurrence replace buttons on result rows. Regex replace supports `$1…$9`, `$&` and `$$` placeholders. Files open in the editor with unsaved changes are skipped (with a notice), and open editors refresh after replacements land on disk. When results were limited, Replace All is disabled until you refine the search.

### ACP visual chat

Choose an **ACP · …** default agent in **Settings → Workbench → New Session**, then create a session from Workbench. ACP sessions stay in the Workbench tab strip and are saved with the shared local session catalog, so you can reopen them later.

- Test the selected model or agent connection in Settings before creating a session.
- Use the mode control when the agent offers one, such as **Plan**; type `/` to browse the agent-provided command menu.
- The chat shows terminal and file-system tool activity as it streams. File reads are available for inspection; permission requests require an explicit **Allow** or **Deny** decision.
- When an agent asks a question, answer it in the chat to let the run continue. You can also submit a cached command directly when the agent does not require an input prompt.

### Thunder TUI & visual chat

Thunder is a separate Rust agent runtime with its own terminal client and a visual chat backend. Both ship as Workbench new-session targets:

- **Thunder (TUI)** (`cli:thunder`): launches the native `thunder-tui` client in an embedded terminal, rooted at the task's directory. It keeps its conversations under `~/.thunder/conversations`, so it is not indexed into the panel session catalog.
- **Thunder (Visual)** (`thunder:visual`): opens a visual chat pane backed by the Thunder daemon, the same backend as the board **Chat** view. The pane is linked to the open task and streams tools, file changes and `ask_user_question` requests like the ACP chat.

Existing Thunder conversations are also listed in the Workbench session list (scoped to the task when one is open), carrying the same GTD status badge as catalog sessions. Click a row to open it as a visual chat pane; right-click for the same overlay menu the catalog sessions get — **Open as visual chat** and **Resume in Thunder TUI** on top, then floating note, mount note, auto rename, move to task and the GTD status tags, and finally **Delete Thunder conversation**. The delete asks for confirmation, removes the conversation from the Thunder store and closes its visual pane; a TUI terminal resuming it is left running. There is no transcript **Preview** (the visual chat already shows it) and no **Remove from panel** — Thunder has no catalog entry to hide.

The binary is discovered automatically (a sibling checkout, the bundled copy under `Contents/Resources/thunder/bin`, `THUNDER_PATH`), and can be overridden in **Settings → Thunder** with the `thunder-daemon` / `thunder-tui` paths.

#### Approval modes

The composer's **shield chip**, next to the model picker, shows the mode the session is judged by:

| Mode | What runs |
|---|---|
| **Plan** | Reads only — writes are refused, and the refusal names `write_plan` / `exit_plan_mode`. The plan text is the deliverable. |
| **Ask** | Reads run; anything that changes something waits for your approval. |
| **Accept Edits** | Edits inside the working area run without asking; the rest still asks. |
| **YOLO** | Nothing asks. |

**Shift+Tab** cycles them (Shift+Enter still inserts a newline, and an open `/`, `@` or `#` menu keeps the key). The mode can change mid-run — the daemon judges each tool call by the mode in force when the call is made — so the chip is never disabled while the agent works. A change made anywhere, including the plan dialog's own approval, moves the chip and is reported in the chat.

When the agent needs an answer — a plan to approve, an `ask`-mode permission prompt, a plugin's question — a card docks above the input and the run waits. Answering it with the buttons is what releases the run; **Dismiss** declines it immediately. A card raised by Thunder itself (the shield badge) is an authorisation moment; a plugin-raised one is informational and never grants anything.

### Keyboard & defaults

- **⌘P / Ctrl+P** and **⌘⇧P / Ctrl+Shift+P** open **Quick Access** / the **command palette** inside a workbench window: files in the task's folders, open or exit a task, start sessions and terminals, open side panels. Type `>` to filter commands.  
  In the **board window** the same keys open the board palette: start a task, jump into any task's window, or open settings.
- **⌘⇧F / Ctrl+Shift+F** opens **Find in Files** (the Search side panel).  
- **⌘T** can be configured for **new session** or **new terminal** under Workbench settings.  
- **⌘← / ⌘→** switch to the previous / next tab within the current group.  
- **⌘↑ / ⌘↓** switch between the **session**, **terminal**, and **code** groups, skipping empty groups. When the selected tab is a terminal session, focus moves to its TUI input.
- **⌘W** closes the active pane in a workbench window; with no pane left it closes that window, after saving its unsaved editor buffers. Closing a workbench window keeps its agents running — the panes come back when you open the task again.  
- Default agent for new sessions is set in **Settings → Workbench**.

### Tips

1. Prefer embedded terminal when you want multi-tab continuity inside Desktop.  
2. Pick a **Terminal theme** under **Settings → Workbench** (Default Dark/Light, Solarized, One Dark, Dracula); open tabs update immediately.  
3. Use external terminal if you rely on a custom shell / terminal app workflow.  
4. Closing a terminal/editor tab focuses the most recently used panel.  
5. Terminal features depend on a healthy PTY host; other Desktop tabs still work if the terminal subsystem fails to load.  
6. **Jump to top / bottom** controls appear in embedded terminals: for streaming CLIs (Codex) they scroll the terminal history, and for full-screen TUIs (Claude Code, Prime Agent, …) they scroll the agent's own viewport.
7. Each change belongs on its own branch, in its own checkout — see **Worktrees** below.

### Worktrees

A task that touches repositories usually wants every change on its own branch, in
its own working copy. Open the task's **settings** (the gear in the task card) and
turn on **Enable worktree mode**. From then on:

- Every checkout of the task lives under `<panelHome>/.desktop/workspaces/<taskId>/.worktrees/<repository>-<branch>`. The path is derived from the task id, so renaming the task moves nothing.
- Agents are told that location, and told to leave the checkouts alone: the panel never deletes one on its own initiative.
- **Git**, **Explorer**, **Search** and the **terminal** group each carry a checkout selector. They follow one shared choice; the pin beside it keeps one of them on a different checkout.
- **New Worktree…** creates one and offers to install dependencies in a terminal — a fresh checkout has no `node_modules`.
- Removing one is always your decision. The settings sheet inspects the checkout first, says how many changes are uncommitted and how many commits are not in the base branch, and never touches the branch. Records of checkouts whose folder has already gone are cleared separately, as are checkouts left behind by a deleted task.
- The panel reminds you when a task is marked done and when you close its window, and those dialogs only report: closing the window is not deleting anything.

The switch governs what agents are told and which creation entries appear — a
checkout that exists on disk stays visible either way, because work hidden behind
a boolean reads as a bug.

### Related

- [Sessions](sessions.md) · [Report](report.md) · [Settings & data](settings-and-data.md) · [Workspace mentions](workspace-mentions.md)  
- Extension resume targets (Ghostty, IDE panels): [Extension Resume](../panel/resume-and-targets.md)

---

## 简体中文

### 是什么

**Workbench** 是 Desktop 的 **Session OS** 工作台：选一个 **任务**，打开它的 **session**，在 **内嵌 xterm** 或 **系统默认终端** 中恢复，并用 **Git / 资源管理器** 操作该任务的本地目录。这里是 *继续干活* 的主战场；[Sessions](sessions.md) 更偏参考列表。

每个任务的 Workbench 都在**自己的窗口**里。主窗口是 **GTD 看板**（加设置），点任务卡片或卡片上的 workbench 芯片就会打开或聚焦该 workbench 的窗口。一个 workbench 一个窗口：它的 pane、终端、Git 状态都属于它；重新打开任务会**接管原来还在跑的终端**，而不是另起一套 agent。

### 核心流程

1. 在 **GTD 看板**点一个任务。它的 Workbench 窗口会打开到该任务的 session（一个任务有多个 workbench 时，打开你上次用的那个）。  
2. 选中任务只看它的 session；未选任务时中间栏列出全部 session。  
3. 用 **新增目录**（macOS 文件夹选择器）挂本地目录。点目录 chip 把它设为 Explorer / Git / Search / Scripts 的活动根。一个任务可挂多个目录；零个或多个时，新 session 走任务的共享 workspace，其 `AGENTS.md` / `CLAUDE.md` 内含地址表（各目录在哪）、笔记的背景知识，以及该 workspace 中 `.arp/docs/` 作为长期共享文档落点的说明。右键任务可在目录生成后打开它。只有单个目录时，会话直接在该仓库中启动，并通过系统提示参数注入相同的地址表与背景知识（Codex、Claude、Pi、Prime），不污染用户仓库，注入的 block 也不提 `.arp`（仓库里的 `.arp/` 是已提交的面板配置，见 [设置与数据](settings-and-data.md)）。在共享 workspace 中运行的会话里，输入框键入 `#` 会列出任务引用的仓库；按 `→` 可逐级进入下一层目录（`←` 返回上一级），`Tab` 插入当前选中项——共享 workspace 内的项目会插入其绝对路径。  
4. CLI 会话用 **内嵌终端**（多标签）或 **外部终端** 恢复。若配置了 [工作区 Mention](workspace-mentions.md)，新建会话选择器可打开该包的工作目录并把参考路径写入首条 prompt。任意终端也可用 `arpm go <id>`。  
5. 若默认目标为 **ACP · …** Agent，**新建会话**会在同一标签栏打开 **可视化聊天**（Agent Client Protocol；支持 Claude Code、Codex、Grok Build、OpenCode、Pi）。  
6. 详情头显示 **任务名** 与它指向的目录（你激活的目录 → 唯一目录 → 任务的共享 workspace），目录后可一键 **在 Finder 中显示**，同一行还有 **分支** 控件；**状态栏** 显示实时 **cwd** 与 **git 分支**（可识别嵌套 git 根）。  
7. 从详情工具栏打开 **Search**、**Scripts** 或 **Browser**，也可在 **Explorer** 下展开脚本区；Git IPC 可用时可点击状态栏分支切换分支。  
8. 在 **Git** 中可先勾选变更文件再提交，不必一次提交全部改动；打开变更文件可查看内联 diff 并在其中查找。**自动生成**优先使用仓库 `<repo>/.arp/config.json` 的 `workbench.git.commitMessage`，没有该文件时回退到 **设置 → Workbench** 的提交信息格式。
9. 在 **Explorer** 中右键文件可查看本地分支与远程跟踪分支中的 Git 提交历史（包含文件重名前的记录）；右键目录可一键回退该目录下的 Git 改动；在 Git 变更项右键菜单中可直接打开文件或复制绝对/相对路径。打开的编辑器会监听工作区，并提示外部修改、冲突和文件删除。

### 侧边栏

| 工具 | 作用 |
|------|------|
| **Explorer** | 浏览项目文件；右键查看全分支 Git 历史并跟踪文件改名，右键文件 / 文件夹选择 **在文件夹中查找** 可在其内部检索 |
| **Search** | 在当前项目中检索文本（大小写 / 整词 / 正则）；用 **要包含 / 要排除的文件** glob 收窄范围，或切换到 **替换** 模式执行全部替换、按文件替换、按结果替换 |
| **Scripts** | 发现并运行项目脚本（npm / pnpm / yarn / bun、Make、Gradle、Python、Cargo），写入当前终端 |
| **嵌套 Git 扫描** | 发现项目树下的 git 仓库 |
| **Git 变更** | 勾选文件、仅提交选中路径、push / pull 与 diff 查看 |
| **Git Log 图** | 侧边栏分支图与提交节点信息 |
| **Browser** | 为当前目录打开实时页面：地址栏、多标签、清除 Cookie、弹出独立窗口。**圈选** 报告元素、所在组件与源码行号；**圈改** 框选区域并附上批注，可一键发送到会话；CDP 控制台收集页面报错并转交会话；视口预设与缩放驱动内嵌视图 |

### 全局查找

按 **⌘⇧F / Ctrl+Shift+F**（或打开 **Search**）可在当前项目文件中全文检索，用法类似 VS Code：

- **Aa / Ab / .*** 切换大小写、整词与正则。**省略号按钮**展开 **要包含的文件** 与 **要排除的文件** 输入框（逗号或换行分隔的 glob，如 `src/**`、`**/*.test.ts`），输入即实时更新结果；包含 glob 可以搜到默认跳过的构建目录（如 `dist/`）。
- **替换按钮**展开替换输入框与 **全部替换**，结果行的每个文件与每条匹配上也有对应的替换按钮。正则替换支持 `$1…$9`、`$&` 与 `$$` 占位符。在编辑器中打开且未保存的文件会被跳过并提示；替换落盘后已打开的编辑器会自动刷新。结果被截断时，全部替换会禁用，直到缩小搜索范围。

### ACP 可视化聊天

在 **设置 → Workbench → 新建会话** 选择 **ACP · …** 默认 Agent 后，从 Workbench 新建会话。ACP 会话会保留在 Workbench 标签栏中，并存入共用本机会话索引，因此之后可再次打开。

- 新建会话前，可在设置中测试所选模型或 Agent 的连接。
- 当 Agent 提供协作模式时，可用模式控件选择（如 **Plan**）；输入 `/` 可浏览 Agent 提供的命令菜单。
- 聊天会流式显示终端和文件系统工具操作。读取文件可查看；权限请求必须明确选择 **允许** 或 **拒绝**。
- Agent 提问时直接在聊天中作答即可继续执行。若 Agent 不要求输入提示，也可直接提交缓存的命令。

### Thunder TUI 与可视化聊天

Thunder 是独立的 Rust Agent 运行时，自带终端客户端与可视化聊天后端。两者都可作为 Workbench 的新建会话目标：

- **Thunder (TUI)**（`cli:thunder`）：在内嵌终端中以任务目录启动原生 `thunder-tui` 客户端。它使用自己的 `~/.thunder/conversations` 会话库，因此不会进入面板的会话索引。
- **Thunder (可视化)**（`thunder:visual`）：打开可视化聊天 pane，与看板 **Chat** 视图共用同一套 Thunder daemon 后端；pane 会关联当前任务，并像 ACP 聊天一样流式展示工具、文件与 `ask_user_question` 反问。

已有的 Thunder 会话也会出现在 Workbench 会话列表中（打开任务时按任务过滤），并与其他会话一样显示 GTD 状态标记。点击行即作为可视化聊天打开；右键弹出的浮层菜单与 catalog 会话一致 —— 最上面是 **以可视化聊天打开** 与 **在 Thunder TUI 中恢复**，其后是浮动便签、挂载笔记、自动重命名、移动到 task 与 GTD 状态标签，最后是 **删除 Thunder 会话**（danger）。删除会二次确认，从 Thunder 会话库中移除该会话并关闭其可视化 pane；正在恢复它的 TUI 终端保持运行。菜单里没有 **预览**（可视化聊天本身即转录）与 **从面板移除** —— Thunder 不走 catalog，没有可隐藏的条目。

二进制会自动探测（同级 checkout、`Contents/Resources/thunder/bin` 打包副本或 `THUNDER_PATH`），也可在 **设置 → Thunder** 中通过 `thunder-daemon` / `thunder-tui` 路径覆盖。

#### 审批档位

输入框工具栏上、模型选择器旁边的**盾牌 chip** 显示当前会话的判定档位：

| 档位 | 会跑什么 |
|---|---|
| **Plan** | 只读——写操作被拒，且拒绝文案会点名 `write_plan` / `exit_plan_mode`。此时计划本身就是交付物。 |
| **Ask** | 读操作直接跑；任何会改变东西的调用都等你批准。 |
| **Accept Edits** | 工作区内的编辑不问直接跑；其余仍然要问。 |
| **YOLO** | 什么都不问。 |

**Shift+Tab** 在四档之间循环（Shift+Enter 仍是换行；`/`、`@`、`#` 菜单打开时按键归菜单）。运行中也能切——daemon 按「调用发起那一刻」的档位判定，所以 agent 干活时 chip 不会禁用。任何来源的变化（包括计划弹窗里批准的那一下）都会让 chip 跟着动，并在聊天里给出提示。

agent 需要你回答时——批准计划、`ask` 档位的授权、插件的提问——输入框上方会停靠一张卡片，run 会一直等。点按钮作答才会放行；**Dismiss** 表示立刻拒绝。带盾牌徽章的是 Thunder 自己发起的**授权时刻**；插件发起的只是通知，不构成任何授权。

### 快捷键与默认值

- **⌘P / Ctrl+P** 打开 **Quick Access**，在任务关联的目录中搜索文件。  
- **⌘P / Ctrl+P** 与 **⌘⇧P / Ctrl+Shift+P** 在 Workbench 窗口里打开 **Quick Access** / **命令面板**：任务目录下的文件、打开或退出任务、新建会话与终端、打开侧栏面板。输入 `>` 可过滤命令。  
  在**看板窗口**里这两个键打开看板面板：新建任务、跳到任意任务的窗口、打开设置。
- **⌘⇧F / Ctrl+Shift+F** 打开**全局查找**（Search 侧边栏）。  
- **⌘T** 可在 Workbench 设置中配置为 **新建会话** 或 **新建终端**。  
- **⌘← / ⌘→** 在当前组内切换到前一个 / 后一个标签。  
- **⌘↑ / ⌘↓** 在 **session / terminal / code** 三组之间切换并跳过空组；跳转到会话终端后会自动聚焦 TUI 输入框。
- **⌘W** 在 Workbench 窗口里关闭当前 pane；没有 pane 可关时关闭该窗口（关窗前会先保存未保存的编辑器）。关闭 Workbench 窗口不会杀掉 agent：重新打开该任务时 pane 会带回来。
- 新建会话的默认 Agent 在 **Settings → Workbench**。

### 提示

1. 希望在 Desktop 内多标签连续工作时，优先用内嵌终端。  
2. 在 **设置 → Workbench** 选择 **终端主题**（Default Dark/Light、Solarized、One Dark、Dracula）；已打开标签即时生效。  
3. 依赖自定义 shell / 终端 App 时用外部终端。  
4. 关闭终端 / 编辑器标签后会激活最近使用的面板。  
5. 终端依赖 PTY；若终端子系统加载失败，其它页签仍可使用。  
6. 内嵌终端支持**跳到顶部 / 回到底部**：流式 CLI（Codex）直接滚动终端历史；全屏 TUI（Claude Code、Prime Agent 等）会滚动 Agent 自身的视图。
7. 每份改动各占一个分支、各自一份检出——见下文 **Worktree**。

### Worktree

一个涉及仓库的任务，通常希望每份改动都在自己的分支、自己的工作副本里。打开任务的**设置**（任务卡片上的齿轮），打开 **启用 worktree 模式**。之后：

- 该任务的所有 worktree 都落在 `<panelHome>/.desktop/workspaces/<任务 id>/.worktrees/<仓库名>-<分支名>`。路径由任务 id 派生，任务改名不会挪动任何目录。
- Agent 会被告知这个落点，也会被告知不要动这些目录：面板**不会**自作主张删掉任何一个。
- **Git 改动 / 文件目录 / 全局查找 / 终端**各自带一个 checkout 选择器，默认联动；旁边的图钉可以让其中一个钉在别的 checkout 上。
- **新建 worktree…** 可以直接建一个，并顺手在终端里装依赖——新 checkout 里没有 `node_modules`。
- 删除永远由你决定：设置弹层会先体检这个 checkout，告诉你有多少处未提交改动、多少提交还没进基础分支，并且**不碰分支**。目录已经消失的登记单独清理；被删任务遗留的 worktree 也会单独列出。
- 面板会在**任务标记完成**和**关闭窗口**这两个时刻提醒你，而这些弹窗只负责报告：关窗不会删掉任何东西。

开关管的是「告诉 agent 什么」和「哪里能新建」——磁盘上真实存在的 checkout
无论如何都会显示，因为把真实存在的活儿藏在一个开关后面，看起来就像坏了。

### 相关文档

- [Sessions](sessions.md) · [Report](report.md) · [设置与数据](settings-and-data.md) · [工作区 Mention](workspace-mentions.md)  
- 扩展恢复目标（Ghostty、IDE 面板）：[扩展恢复](../panel/resume-and-targets.md)
