# Workbench

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

**Workbench** is Desktop’s **session OS** surface: pick or create sessions, resume in an **embedded xterm** or the **system default terminal**, and use **Git / explorer** tools in a side panel. It is the primary place to *continue working*, while [Sessions](sessions.md) is a lighter reference list.

### Core flows

1. Open the **Workbench** tab.  
2. Use **Quick Access** to choose a project when you need to switch context; browse the complete session list and create a new session if needed (default agent: **Settings → Workbench → New Session**).  
3. Resume CLI sessions in the **embedded terminal** (multi-tab) or **external** terminal.  
4. If the default target is an **ACP · …** agent, **New session** opens a **visual chat pane** in the same tab strip (Agent Client Protocol; Claude Code, Codex, Grok Build, OpenCode, Pi).  
5. Use the detail header for project path and **branch** controls; watch the **status bar** for live **cwd** and **git branch** (including nested repos when detected).  
6. Open **Search** or **Scripts** from the detail toolbar, or expand scripts under **Explorer**; click the status bar branch to switch branches when Git IPC is available.  
7. In **Git**, select specific changed files before commit when you do not want to commit everything; open a changed file to inspect an inline diff and search within it.
8. In **Explorer**, right-click a file to inspect its Git history across local and remote-tracking branches, including commits before renames. Right-click a folder to discard Git changes under that directory, or use context menus on changed files to open them or copy absolute / relative paths. Open editors watch the workspace and report external changes, conflicts, and deleted files.

### Side panel

| Tool | Purpose |
|------|---------|
| **Explorer** | Browse project files; right-click a file for all-branch Git history and rename tracking |
| **Search** | Find text in the selected project (match case, whole word, regex); open hits in the file editor |
| **Scripts** | Discover and run project scripts (npm / pnpm / yarn / bun, Make, Gradle, Python, Cargo) into the active terminal |
| **Nested git scan** | Discover git repos under the project tree |
| **Git changes** | Stage/select files, commit only selected paths, push / pull, and inspect diffs |
| **Git log graph** | Branch graph and commit node details in the side panel |

### ACP visual chat

Choose an **ACP · …** default agent in **Settings → Workbench → New Session**, then create a session from Workbench. ACP sessions stay in the Workbench tab strip and are saved with the shared local session catalog, so you can reopen them later.

- Test the selected model or agent connection in Settings before creating a session.
- Use the mode control when the agent offers one, such as **Plan**; type `/` to browse the agent-provided command menu.
- The chat shows terminal and file-system tool activity as it streams. File reads are available for inspection; permission requests require an explicit **Allow** or **Deny** decision.
- When an agent asks a question, answer it in the chat to let the run continue. You can also submit a cached command directly when the agent does not require an input prompt.

### Keyboard & defaults

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

- [Sessions](sessions.md) · [Report](report.md) · [Settings & data](settings-and-data.md)  
- Extension resume targets (Ghostty, IDE panels): [Extension Resume](../panel/resume-and-targets.md)

---

## 简体中文

### 是什么

**Workbench** 是 Desktop 的 **Session OS** 工作台：选择或新建会话，在 **内嵌 xterm** 或 **系统默认终端** 中恢复，并使用侧边栏 **Git / 资源管理器**。这里是 *继续干活* 的主战场；[Sessions](sessions.md) 更偏参考列表。

### 核心流程

1. 打开 **Workbench** 页签。  
2. 使用 **Quick Access** 快速切换项目；浏览完整会话列表，需要时新建会话（默认 Agent：**Settings → Workbench → New Session**）。  
3. CLI 会话用 **内嵌终端**（多标签）或 **外部终端** 恢复。  
4. 若默认目标为 **ACP · …** Agent，**新建会话**会在同一标签栏打开 **可视化聊天**（Agent Client Protocol；支持 Claude Code、Codex、Grok Build、OpenCode、Pi）。  
5. 在详情头查看项目路径与 **分支** 控件；在 **状态栏** 查看实时 **cwd** 与 **git 分支**（可识别嵌套仓库）。  
6. 从详情工具栏打开 **Search** 或 **Scripts**，也可在 **Explorer** 下展开脚本区；Git IPC 可用时可点击状态栏分支切换分支。  
7. 在 **Git** 中可先勾选变更文件再提交，不必一次提交全部改动；打开变更文件可查看内联 diff 并在其中查找。
8. 在 **Explorer** 中右键文件可查看本地分支与远程跟踪分支中的 Git 提交历史（包含文件重名前的记录）；右键目录可一键回退该目录下的 Git 改动；在 Git 变更项右键菜单中可直接打开文件或复制绝对/相对路径。打开的编辑器会监听工作区，并提示外部修改、冲突和文件删除。

### 侧边栏

| 工具 | 作用 |
|------|------|
| **Explorer** | 浏览项目文件；右键查看全分支 Git 历史并跟踪文件改名 |
| **Search** | 在当前项目中检索文本（大小写 / 整词 / 正则），点击结果在编辑器中打开 |
| **Scripts** | 发现并运行项目脚本（npm / pnpm / yarn / bun、Make、Gradle、Python、Cargo），写入当前终端 |
| **嵌套 Git 扫描** | 发现项目树下的 git 仓库 |
| **Git 变更** | 勾选文件、仅提交选中路径、push / pull 与 diff 查看 |
| **Git Log 图** | 侧边栏分支图与提交节点信息 |

### ACP 可视化聊天

在 **设置 → Workbench → 新建会话** 选择 **ACP · …** 默认 Agent 后，从 Workbench 新建会话。ACP 会话会保留在 Workbench 标签栏中，并存入共用本机会话索引，因此之后可再次打开。

- 新建会话前，可在设置中测试所选模型或 Agent 的连接。
- 当 Agent 提供协作模式时，可用模式控件选择（如 **Plan**）；输入 `/` 可浏览 Agent 提供的命令菜单。
- 聊天会流式显示终端和文件系统工具操作。读取文件可查看；权限请求必须明确选择 **允许** 或 **拒绝**。
- Agent 提问时直接在聊天中作答即可继续执行。若 Agent 不要求输入提示，也可直接提交缓存的命令。

### 快捷键与默认值

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

- [Sessions](sessions.md) · [Report](report.md) · [设置与数据](settings-and-data.md)  
- 扩展恢复目标（Ghostty、IDE 面板）：[扩展恢复](../panel/resume-and-targets.md)
