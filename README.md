# Agent Resume Panel

Languages: [简体中文](#简体中文) | [English](#english)

## 简体中文

Agent Resume Panel 是一个 VS Code 侧边栏扩展，用来集中查看和恢复 Codex、Claude Code、Antigravity CLI、Grok Build、OpenCode、Pi、Alma 的历史会话。

适合这些场景：

- 快速回到最近一次 AI 编程会话。
- 同时使用多个 CLI / 桌面 Agent，并希望统一管理。
- 按项目查看历史会话，并直接在对应项目里继续工作。
- 需要用 Ghostty 或 Codex App 接着打开已有会话。
- 在 Alma 桌面客户端中按项目打开新对话。

### 快速开始

1. 在 VS Code 左侧活动栏打开 **Agent Resume**。
2. 在 **Sessions** 视图里浏览最近会话或项目分组。
3. 点击某个会话即可恢复（终端 Agent 在 VS Code 终端中恢复；Alma 在 Alma 客户端中打开）。
4. 如果列表没有更新，点击刷新按钮，或运行 **Agent Resume: Refresh**。

默认情况下，终端类 Agent 的恢复会话会在当前编辑器旁边打开一个新的集成终端，方便一边看代码一边继续对话。

### 常用操作

在 **Sessions** 列表中点击会话，或右键会话选择：

- **Resume Session**：在 VS Code 终端恢复会话（Alma 除外）。
- **Copy Resume Command**：复制恢复命令。
- **Open Folder and Resume**：打开会话所属项目，并在新窗口中恢复。
- **Open in Ghostty**：用 Ghostty 打开并恢复会话。
- **Resume in Codex App**：将 Codex 会话交给 Codex App 继续。

Alma 会话**没有右键菜单**，点击会话会在 Alma 客户端中尝试切换到对应对话（通过标题搜索，可能不完全精准）。

项目分组支持右键操作：

- **Open Folder and Resume**：选择该项目下的历史会话并恢复。
- **Open in Ghostty**：选择会话后在 Ghostty 中恢复。
- **New Codex Session**、**New Claude Session**、**New Antigravity Session**、**New Grok Session**、**New OpenCode Session**、**New Pi Session**：在该项目中新建对应 Agent 会话。
- **New Codex App Session**：用 Codex App 打开该项目。
- **New Alma Thread**：在 Alma 中打开新对话，并将工作区目录设为该项目（见下方 Alma 说明）。

### 新建和搜索

在 **Sessions** 视图右上角点击加号，或运行 **Agent Resume: New Session**，可以从当前 VS Code 工作区新建 Codex、Claude、Antigravity CLI、Grok Build、OpenCode、Pi 或 Codex App 会话。Alma 不在全局新建列表中，请通过项目右键 **New Alma Thread** 创建。

运行 **Agent Resume: Search Sessions**，可以从所有已加载会话中快速搜索并恢复。

### Alma

[Alma](https://alma.now/) 是一款 macOS 桌面 AI 客户端，用于统一接入 OpenAI、Anthropic、Google Gemini、DeepSeek 等提供商，并提供聊天、记忆、工具调用、工作区（项目目录）集成等能力。使用前请先从官网下载安装并启动 Alma；完整文档见 [Alma Docs](https://alma.now/docs/)。

本扩展不会替代 Alma 客户端，而是读取本地会话数据并在 VS Code 侧边栏中展示，便于按项目浏览历史 thread、恢复对话，或在指定项目目录下打开新对话。

Alma 集成基于本地 Alma API（默认 `http://localhost:23001`）和 SQLite 数据库（`chat_threads.db`）。

**列出会话**

- 从 Alma 数据库加载 thread 列表，并按项目（workspace 路径）分组显示。
- 默认隐藏 Cron 任务（`⏰ Cron:`）和频道会话（WeChat、Telegram、Discord、Slack）；可在设置中调整。

**恢复已有会话（点击）**

- 需要 Alma 正在运行。
- 扩展会激活 Alma 并通过 `Cmd+F` 按标题搜索切换对话。Alma 目前没有按 thread ID 精确跳转的公开 API，因此标题重复时可能不够准确。

**新建会话（项目右键 → New Alma Thread）**

- 需要 Alma 正在运行（macOS 上扩展会等待 API 就绪）。
- 若该项目尚未在 Alma 中注册 workspace，扩展会自动通过 API 创建。
- 扩展会设置 Alma 的 `defaultWorkspaceId` 为目标项目，然后模拟 `Cmd+N` 打开新对话页。
- Alma 的 `defaultWorkspaceId` **只在「新对话」页生效**；如果 Alma 当前停在某个已有对话里，仅改设置不会改变那条对话的目录，因此扩展会先触发「新建对话」再应用目录。这是 Alma 的设计行为，不是扩展缺陷。

**macOS 权限**

- Alma 相关 UI 操作（恢复会话的标题搜索、新建对话的 `Cmd+N`）需要为 VSCodium / VS Code 授予 **辅助功能（Accessibility）** 权限。

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
- `agentResume.grokHome`：Grok Build 数据目录（默认 `~/.grok`）。
- `agentResume.showSubagentGrok`：是否显示 Grok 子 Agent 会话。
- `agentResume.opencodeHome`：OpenCode 数据目录（默认 `~/.local/share/opencode`）。
- `agentResume.showArchivedOpenCode`：是否显示已归档的 OpenCode 会话。
- `agentResume.piHome`：Pi 数据目录（默认 `~/.pi/agent`）。
- `agentResume.almaDataDir`：Alma 数据目录（macOS 默认 `~/Library/Application Support/alma`）。
- `agentResume.hideCronAlma`：隐藏 Alma Cron 会话。
- `agentResume.hideChannelAlma`：隐藏 Alma 频道会话。
- `agentResume.showIncognitoAlma`：显示 Alma 隐身模式会话。

如果你的 Codex、Claude Code、Antigravity、OpenCode 或 Pi 数据目录不是默认位置，也可以在设置里调整对应的 home 路径。

## English

Agent Resume Panel is a VS Code sidebar extension for browsing and resuming Codex, Claude Code, Antigravity CLI, Grok Build, OpenCode, Pi, and Alma sessions in one place.

Best for:

- Jumping back into a recent AI coding session.
- Managing sessions from multiple CLI and desktop agents in one list.
- Browsing sessions by project and continuing in the right workspace.
- Continuing an existing session in Ghostty or Codex App when needed.
- Starting a new Alma chat scoped to a project directory.

### Quick Start

1. Open **Agent Resume** from the VS Code Activity Bar.
2. Browse recent sessions or project groups in the **Sessions** view.
3. Click a session to resume it (terminal agents in a VS Code terminal; Alma in the Alma desktop app).
4. If the list is stale, click refresh or run **Agent Resume: Refresh**.

By default, terminal agent sessions open in a new integrated terminal beside the current editor, so you can keep code and conversation side by side.

### Common Actions

Click a session in **Sessions**, or right-click it and choose:

- **Resume Session**: Resume in a VS Code terminal (not Alma).
- **Copy Resume Command**: Copy the resume command.
- **Open Folder and Resume**: Open the session's project and resume in a new window.
- **Open in Ghostty**: Open and resume in Ghostty.
- **Resume in Codex App**: Continue a Codex session in Codex App.

Alma sessions have **no context menu**. Clicking a session tries to switch Alma to that thread via title search, which may not be exact.

Project groups support these right-click actions:

- **Open Folder and Resume**: Pick a session from the project and resume it.
- **Open in Ghostty**: Pick a session and resume it in Ghostty.
- **New Codex Session**, **New Claude Session**, **New Antigravity Session**, **New Grok Session**, **New OpenCode Session**, **New Pi Session**: Start a new agent session in that project.
- **New Codex App Session**: Open the project with Codex App.
- **New Alma Thread**: Open a new Alma chat with the project workspace directory (see Alma below).

### New and Search

Click the plus button in the **Sessions** title bar, or run **Agent Resume: New Session**, to start a Codex, Claude, Antigravity CLI, Grok Build, OpenCode, Pi, or Codex App session from the current VS Code workspace. Alma is not in the global new-session picker; use **New Alma Thread** on a project instead.

Run **Agent Resume: Search Sessions** to quickly find and resume any loaded session.

### Alma

[Alma](https://alma.now/) is a macOS desktop AI client for orchestrating providers such as OpenAI, Anthropic, Google Gemini, and DeepSeek, with chat, memory, tool use, and workspace (project directory) integration. Install and launch Alma from the website first; see [Alma Docs](https://alma.now/docs/) for full documentation.

This extension does not replace the Alma app. It reads local session data and surfaces threads in the VS Code sidebar so you can browse history by project, resume conversations, or open a new chat scoped to a project directory.

Alma integration uses the local Alma API (default `http://localhost:23001`) and the SQLite database (`chat_threads.db`).

**Listing sessions**

- Loads threads from Alma's database and groups them by workspace path.
- Cron threads (`⏰ Cron:`) and channel threads (WeChat, Telegram, Discord, Slack) are hidden by default; adjust in settings.

**Resume an existing session (click)**

- Requires Alma to be running.
- The extension activates Alma and uses `Cmd+F` title search to switch threads. Alma does not expose a public thread-ID navigation API, so duplicate titles may be ambiguous.

**New session (project right-click → New Alma Thread)**

- Requires Alma to be running (on macOS the extension waits for the API).
- Creates an Alma workspace via API if the project is not registered yet.
- Sets Alma `defaultWorkspaceId` to the target project, then simulates `Cmd+N` to open the new-chat page.
- Alma applies `defaultWorkspaceId` only on the **new-chat page**. If Alma is already inside an existing thread, changing settings does not retarget that thread's workspace, so the extension opens a new chat first. This is Alma behavior, not an extension bug.

**macOS permissions**

- Alma UI automation (title search for resume, `Cmd+N` for new chat) requires **Accessibility** permission for VSCodium / VS Code.

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
- `agentResume.grokHome`: Grok Build data directory (default `~/.grok`).
- `agentResume.showSubagentGrok`: Show Grok subagent sessions.
- `agentResume.opencodeHome`: OpenCode data directory (default `~/.local/share/opencode`).
- `agentResume.showArchivedOpenCode`: Show or hide archived OpenCode sessions.
- `agentResume.piHome`: Pi data directory (default `~/.pi/agent`).
- `agentResume.almaDataDir`: Alma data directory (default `~/Library/Application Support/alma` on macOS).
- `agentResume.hideCronAlma`: Hide Alma cron threads.
- `agentResume.hideChannelAlma`: Hide Alma channel threads.
- `agentResume.showIncognitoAlma`: Show Alma incognito threads.

If your Codex, Claude Code, Antigravity, OpenCode, or Pi data directory is not in the default location, adjust the matching home path in Settings.

## License

MIT