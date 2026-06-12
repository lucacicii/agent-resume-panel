# Agent Resume Panel

Languages: [简体中文](#简体中文) | [English](#english)

## 简体中文

Agent Resume Panel 是一个 VS Code 侧边栏扩展，用来集中查看和恢复 Codex、Claude Code、Antigravity CLI 的历史会话。

适合这些场景：

- 快速回到最近一次 AI 编程会话。
- 同时使用多个 CLI Agent，并希望统一管理。
- 按项目查看历史会话，并直接在对应项目里继续工作。
- 需要用 Ghostty 或 Codex App 接着打开已有会话。

### 快速开始

1. 在 VS Code 左侧活动栏打开 **Agent Resume**。
2. 在 **Sessions** 视图里浏览最近会话或项目分组。
3. 点击某个会话即可在 VS Code 终端中恢复。
4. 如果列表没有更新，点击刷新按钮，或运行 **Agent Resume: Refresh**。

默认情况下，恢复的会话会在当前编辑器旁边打开一个新的集成终端，方便一边看代码一边继续对话。

### 常用操作

在 **Sessions** 列表中点击会话，或右键会话选择：

- **Resume Session**：在 VS Code 终端恢复会话。
- **Copy Resume Command**：复制恢复命令。
- **Open Folder and Resume**：打开会话所属项目，并在新窗口中恢复。
- **Open in Ghostty**：用 Ghostty 打开并恢复会话。
- **Resume in Codex App**：将 Codex 会话交给 Codex App 继续。

项目分组支持右键操作：

- **Open Folder and Resume**：选择该项目下的历史会话并恢复。
- **Open in Ghostty**：选择会话后在 Ghostty 中恢复。
- **New Codex Session**、**New Claude Session**、**New Antigravity Session**：在该项目中新建对应 Agent 会话。
- **New Codex App Session**：用 Codex App 打开该项目。

### 新建和搜索

在 **Sessions** 视图右上角点击加号，或运行 **Agent Resume: New Session**，可以从当前 VS Code 工作区新建 Codex、Claude、Antigravity CLI 或 Codex App 会话。

运行 **Agent Resume: Search Sessions**，可以从所有已加载会话中快速搜索并恢复。

### Ghostty

当你需要 Ghostty 的图片上传、图片显示或其他终端能力时，可以使用 **Open in Ghostty**。

macOS 上第一次自动粘贴命令时，系统可能会要求授予 VS Code 自动化或辅助功能权限。默认行为是打开 Ghostty、复制恢复命令、自动粘贴并回车。如果你更喜欢手动操作，可以把 `agentResume.ghosttyLaunchMode` 设置为 `copyCommand`。

### 常用设置

在 VS Code Settings 中搜索 `Agent Resume` 可以调整：

- `agentResume.maxItems`：列表最多加载多少条会话。
- `agentResume.terminalLocation`：终端打开在编辑器旁边还是底部面板。
- `agentResume.showArchivedCodex`：是否显示已归档的 Codex 会话。
- `agentResume.ghosttyLaunchMode`：Ghostty 打开会话时的命令处理方式。
- `agentResume.ghosttyExecutable`：Ghostty 应用名或可执行文件路径。

如果你的 Codex、Claude Code 或 Antigravity 数据目录不是默认位置，也可以在设置里调整对应的 home 路径。

## English

Agent Resume Panel is a VS Code sidebar extension for browsing and resuming Codex, Claude Code, and Antigravity CLI sessions in one place.

Best for:

- Jumping back into a recent AI coding session.
- Managing sessions from multiple CLI agents in one list.
- Browsing sessions by project and continuing in the right workspace.
- Continuing an existing session in Ghostty or Codex App when needed.

### Quick Start

1. Open **Agent Resume** from the VS Code Activity Bar.
2. Browse recent sessions or project groups in the **Sessions** view.
3. Click a session to resume it in a VS Code terminal.
4. If the list is stale, click refresh or run **Agent Resume: Refresh**.

By default, resumed sessions open in a new integrated terminal beside the current editor, so you can keep code and conversation side by side.

### Common Actions

Click a session in **Sessions**, or right-click it and choose:

- **Resume Session**: Resume in a VS Code terminal.
- **Copy Resume Command**: Copy the resume command.
- **Open Folder and Resume**: Open the session's project and resume in a new window.
- **Open in Ghostty**: Open and resume in Ghostty.
- **Resume in Codex App**: Continue a Codex session in Codex App.

Project groups support these right-click actions:

- **Open Folder and Resume**: Pick a session from the project and resume it.
- **Open in Ghostty**: Pick a session and resume it in Ghostty.
- **New Codex Session**, **New Claude Session**, **New Antigravity Session**: Start a new agent session in that project.
- **New Codex App Session**: Open the project with Codex App.

### New and Search

Click the plus button in the **Sessions** title bar, or run **Agent Resume: New Session**, to start a Codex, Claude, Antigravity CLI, or Codex App session from the current VS Code workspace.

Run **Agent Resume: Search Sessions** to quickly find and resume any loaded session.

### Ghostty

Use **Open in Ghostty** when you need Ghostty-specific image upload, image display, or terminal behavior.

On macOS, the first automatic paste may require granting VS Code Automation or Accessibility permission. By default, the extension opens Ghostty, copies the resume command, pastes it, and presses Enter. If you prefer manual control, set `agentResume.ghosttyLaunchMode` to `copyCommand`.

### Settings

Search `Agent Resume` in VS Code Settings to adjust:

- `agentResume.maxItems`: Maximum number of sessions to load.
- `agentResume.terminalLocation`: Open terminals beside the editor or in the bottom panel.
- `agentResume.showArchivedCodex`: Show or hide archived Codex sessions.
- `agentResume.ghosttyLaunchMode`: How Ghostty receives the resume command.
- `agentResume.ghosttyExecutable`: Ghostty app name or executable path.

If your Codex, Claude Code, or Antigravity data directory is not in the default location, adjust the matching home path in Settings.

## License

MIT
