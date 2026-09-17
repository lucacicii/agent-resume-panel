# Workbench

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

**Workbench** is Desktop’s **session OS** surface: pick a **task**, open its **sessions**, resume in an **embedded xterm** or the **system default terminal**, and use **Git / explorer** tools against that task’s local folders. It is the primary place to *continue working*, while [Sessions](sessions.md) is a lighter reference list.

### Core flows

1. Open the **Workbench** tab. The sidebar lists **tasks** (not repositories).  
2. Select a task to see only its sessions. With no task selected, the middle pane lists all sessions.  
3. Attach a local folder with **Add folder** (macOS folder picker). Click a folder chip to make it the active root for Explorer / Git / Search / Scripts. A task can reference several folders; with none or several, new sessions start in the task’s shared workspace, whose `AGENTS.md` / `CLAUDE.md` carry the address table (where each folder lives) and the note’s background knowledge. Right-click the task to open that folder once a session has created it. With a single folder, the session starts directly in that repository and the same address table and knowledge are appended to the agent’s system prompt (Codex, Claude, Pi, Prime) — nothing is written into the repository.  
4. Resume CLI sessions in the **embedded terminal** (multi-tab) or **external** terminal. If [workspace mentions](workspace-mentions.md) are configured, the new-session picker can open a pack’s work folder and inject reference paths into the first prompt. `arpm go <id>` does the same from any terminal.  
5. If the default target is an **ACP · …** agent, **New session** opens a **visual chat pane** in the same tab strip (Agent Client Protocol; Claude Code, Codex, Grok Build, OpenCode, Pi).  
6. Use the detail header for the active folder path and **branch** controls; watch the **status bar** for live **cwd** and **git branch** (including nested repos when detected).  
7. Open **Search** or **Scripts** from the detail toolbar, or expand scripts under **Explorer**; click the status bar branch to switch branches when Git IPC is available.  
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

### Keyboard & defaults

- **⌘P / Ctrl+P** opens **Quick Access** for files in the task's folders.  
- **⌘⇧P / Ctrl+Shift+P** opens the **command palette**: switch Workbench/GTD, open or exit a task, start sessions and terminals, and open side panels. Type `>` to filter commands while the palette is open.  
- **⌘⇧F / Ctrl+Shift+F** opens **Find in Files** (the Search side panel).  
- **⌘T** can be configured for **new session** or **new terminal** under Workbench settings.  
- **⌘← / ⌘→** switch to the previous / next tab within the current group.  
- **⌘↑ / ⌘↓** switch between the **session**, **terminal**, and **code** groups, skipping empty groups. When the selected tab is a terminal session, focus moves to its TUI input.
- Default agent for new sessions is set in **Settings → Workbench**.

### Tips

1. Prefer embedded terminal when you want multi-tab continuity inside Desktop.  
2. Pick a **Terminal theme** under **Settings → Workbench** (Default Dark/Light, Solarized, One Dark, Dracula); open tabs update immediately.  
3. Use external terminal if you rely on a custom shell / terminal app workflow.  
4. Closing a terminal/editor tab focuses the most recently used panel.  
5. Terminal features depend on a healthy PTY host; other Desktop tabs still work if the terminal subsystem fails to load.  
6. **Jump to top / bottom** controls appear in embedded terminals: for streaming CLIs (Codex) they scroll the terminal history, and for full-screen TUIs (Claude Code, Prime Agent, …) they scroll the agent's own viewport.

### Related

- [Sessions](sessions.md) · [Report](report.md) · [Settings & data](settings-and-data.md) · [Workspace mentions](workspace-mentions.md)  
- Extension resume targets (Ghostty, IDE panels): [Extension Resume](../panel/resume-and-targets.md)

---

## 简体中文

### 是什么

**Workbench** 是 Desktop 的 **Session OS** 工作台：选一个 **任务**，打开它的 **session**，在 **内嵌 xterm** 或 **系统默认终端** 中恢复，并用 **Git / 资源管理器** 操作该任务的本地目录。这里是 *继续干活* 的主战场；[Sessions](sessions.md) 更偏参考列表。

### 核心流程

1. 打开 **Workbench** 页签。侧栏列的是 **任务**（不再按仓库浏览）。  
2. 选中任务只看它的 session；未选任务时中间栏列出全部 session。  
3. 用 **新增目录**（macOS 文件夹选择器）挂本地目录。点目录 chip 把它设为 Explorer / Git / Search / Scripts 的活动根。一个任务可挂多个目录；零个或多个时，新 session 走任务的共享 workspace，其 `AGENTS.md` / `CLAUDE.md` 内含地址表（各目录在哪）与笔记的背景知识。右键任务可在目录生成后打开它。只有单个目录时，会话直接在该仓库中启动，并通过系统提示参数注入相同的地址表与背景知识（Codex、Claude、Pi、Prime），不污染用户仓库。  
4. CLI 会话用 **内嵌终端**（多标签）或 **外部终端** 恢复。若配置了 [工作区 Mention](workspace-mentions.md)，新建会话选择器可打开该包的工作目录并把参考路径写入首条 prompt。任意终端也可用 `arpm go <id>`。  
5. 若默认目标为 **ACP · …** Agent，**新建会话**会在同一标签栏打开 **可视化聊天**（Agent Client Protocol；支持 Claude Code、Codex、Grok Build、OpenCode、Pi）。  
6. 在详情头查看活动目录路径与 **分支** 控件；在 **状态栏** 查看实时 **cwd** 与 **git 分支**（可识别嵌套 git 根）。  
7. 从详情工具栏打开 **Search** 或 **Scripts**，也可在 **Explorer** 下展开脚本区；Git IPC 可用时可点击状态栏分支切换分支。  
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

### 快捷键与默认值

- **⌘P / Ctrl+P** 打开 **Quick Access**，在任务关联的目录中搜索文件。  
- **⌘⇧P / Ctrl+Shift+P** 打开**命令面板**：切换 Workbench / GTD、打开或退出任务、新建会话与终端、打开侧栏面板。面板内输入 `>` 可过滤命令。  
- **⌘⇧F / Ctrl+Shift+F** 打开**全局查找**（Search 侧边栏）。  
- **⌘T** 可在 Workbench 设置中配置为 **新建会话** 或 **新建终端**。  
- **⌘← / ⌘→** 在当前组内切换到前一个 / 后一个标签。  
- **⌘↑ / ⌘↓** 在 **session / terminal / code** 三组之间切换并跳过空组；跳转到会话终端后会自动聚焦 TUI 输入框。
- 新建会话的默认 Agent 在 **Settings → Workbench**。

### 提示

1. 希望在 Desktop 内多标签连续工作时，优先用内嵌终端。  
2. 在 **设置 → Workbench** 选择 **终端主题**（Default Dark/Light、Solarized、One Dark、Dracula）；已打开标签即时生效。  
3. 依赖自定义 shell / 终端 App 时用外部终端。  
4. 关闭终端 / 编辑器标签后会激活最近使用的面板。  
5. 终端依赖 PTY；若终端子系统加载失败，其它页签仍可使用。  
6. 内嵌终端支持**跳到顶部 / 回到底部**：流式 CLI（Codex）直接滚动终端历史；全屏 TUI（Claude Code、Prime Agent 等）会滚动 Agent 自身的视图。

### 相关文档

- [Sessions](sessions.md) · [Report](report.md) · [设置与数据](settings-and-data.md) · [工作区 Mention](workspace-mentions.md)  
- 扩展恢复目标（Ghostty、IDE 面板）：[扩展恢复](../panel/resume-and-targets.md)
