# Changelog

Languages: [简体中文](#简体中文) | [English](#english)

本文件用于 Open VSX 发布说明，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

This file is used for Open VSX release notes and follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 简体中文

### [2.1.0] - 2026-07-02

#### 新增

- **Session Catalog（SQLite）**：CLI 会话目录与面板状态默认写入本地 SQLite（`~/.agent-resume-panel/catalog.db`，可配置 `agentResume.catalog.dbPath`）；对话正文仍保留在各 Agent 原生存储，Catalog 存元数据与 transcript **引用**，预览/导出时按需读取原生文件。
- **Session Manager**：**Sessions** 标题栏入口，浏览与筛选大量会话；**Export** 仅在此提供（含元数据 + 导出时读取的完整对话）。
- **Search Sessions** 每行 **Remove**：与侧边栏 **Remove from Panel** 一致，仅在 Catalog 中隐藏。
- **Session Menu** 设置页与可配置会话右键菜单（含 **Remove from Panel**）；项目/会话右键 **Sort Sessions**（按项目记忆排序）。

#### 变更

- 刷新时 UPSERT 同步各 Agent 会话至 Catalog；「从面板移除」的 `hidden` 状态不会因同步被自动恢复显示。
- 移除 **Sessions** 标题栏 **Export Catalog**（导出仅保留在 Session Manager）。

#### 移除

- 项目/会话右键 **Collapse Project**。

### [2.0.2] - 2026-07-01

#### 修复

- Codex ACP 重连：优先 `session/load`，`Resource not found` 时回退新建会话，避免 `Failed to connect to codex agent: Resource not found`。
- ACP Chat 在 session ID 变更后重新订阅 `session/update`，修复 Codex 回复被丢弃导致的 `Agent returned an empty response`。

### [2.0.1] - 2026-07-01

#### 修复

- 发布构建移除 `vsce package --no-dependencies`，确保 VSIX 包含 `@agentclientprotocol/sdk` 等 ACP 运行时依赖，修复安装后 `Cannot find package '@agentclientprotocol/sdk'` 导致无法连接 Agent 的问题。

### [2.0.0] - 2026-07-01

#### 新增

- **ACP Chat**：基于 [Agent Client Protocol (ACP)](https://agentclientprotocol.com) 重写聊天面板，在编辑器旁直接与 Agent 对话；移除旧 handoff 栈。
- **ACP Chats** 独立侧边栏视图：与 **Sessions**（CLI 历史）分离，各自刷新与管理。
- 支持 Agent：Codex、Claude、Grok Build、OpenCode、Pi；可在 **Agent Resume Settings → ACP Chat** 配置启动命令与权限。
- **图片上传**：Codex、Claude、OpenCode、Pi 支持附件按钮与 Ctrl/Cmd+V 粘贴（每条最多 4 张、单张 5 MB）。
- Grok ACP 默认使用本机 `grok agent stdio` CLI。

#### 变更

- **Sessions** 与搜索面板不再混入 ACP 聊天条目；新建聊天出现在 **ACP Chats**。
- ACP 数据目录、权限与各 Agent 启动参数集中在 **ACP Chat** 设置分区。


### [1.2.1] - 2026-06-30

#### 新增

- **Project Menu** 设置分区：在 **Agent Resume Settings** 中勾选主菜单项，并通过**拖动**调整顺序；保存后项目右键菜单按该顺序显示。
- 设置项 `agentResume.projectMenu.itemOrder`：保存全部可配置项的显示顺序（含 **Show More** 子菜单中的未勾选项）。

#### 变更

- **Customize Project Menu** 命令改为打开 **Agent Resume Settings → Project Menu**，不再使用 QuickPick 弹窗。
- 项目右键主菜单与 **Show More** 子菜单顺序与 Settings 中保存的配置一致（**Open Folder** 始终固定在顶部）。

#### 修复

- 恢复 **Session** 右键菜单（Preview、Rename、Resume 等）；项目菜单排序改动不再影响会话项。
- 项目菜单 `when` 条件增加 `viewItem =~ /agentResume\.project/`，避免项目操作出现在 Session 右键菜单中。

### [1.2.0] - 2026-06-30

#### 新增

- **Agent Resume Settings** Webview：Sessions 标题栏齿轮入口，分区管理扩展设置（Data Paths、Resume、Terminal、LLM Assist 等）。
- **LLM Assist**：接入 OpenAI 兼容 API（Base URL、Model、API Key），API Key 在设置页内联输入并安全存储。
  - Preview Session：**Summarize** 总结当前会话（显示在对话上方；按 session 与输出语言缓存）。
  - Preview Session：**Auto Rename** 由 AI 生成标题并写回原生存储。
  - Sessions 树右键：**Auto Rename Session**（无需手动输入）。
  - Search Sessions 预览 overlay 同步支持 Summarize / Auto Rename。
- 设置项 `agentResume.llm.outputLanguage`（默认 English）：Summarize 与 Auto Rename 输出语言，支持 Chinese、Japanese、Korean 等 10 种语言。
- **Test Connection** 使用表单当前值测试连通性（无需先 Save）；失败时错误信息包含实际请求 endpoint。

#### 变更

- LLM Assist 设置页增加提示：请尽可能使用快速、便宜的模型（如 gpt-4o-mini、deepseek-chat）。

### [1.1.20] - 2026-06-29

#### 新增

- 设置项 `agentResume.showSubagentCodex`（默认 `false`）：控制是否在面板中显示 Codex subagent 会话（`source` 字段含 `subagent`）。

#### 变更

- **Grok Build**：默认隐藏无标题且最多 1 条消息的空壳子进程会话，避免大量 subagent 占满 `maxItems` 显示配额；`session_kind: subagent` 仍由 `agentResume.showSubagentGrok` 控制。
- **Grok Build**：刷新时按文件 mtime 缓存 `summary.json` 并并行读取，二次刷新明显更快。
- **Codex**：默认过滤 subagent 线程（`source` 含 `subagent`），可通过 `agentResume.showSubagentCodex` 开启显示。
- **Claude Code**：无首条 user 消息标题时，从 `ai-title` 条目的 `aiTitle` 字段提取会话标题。

### [1.1.90] - 2026-06-29

无更新。

### [1.1.18] - 2026-06-26

#### 新增

- **Resume in Codex IDE Panel (Experimental)**：尝试在 Codex VS Code 插件面板中恢复会话。
- 设置项 `agentResume.codexResumeMode`：`terminal`（默认）/ `panel` / `app`。
- 实验性开关 `agentResume.codexIdePanelResume.enabled`：可一键禁用面板恢复。
- 实现版本号 `agentResume.codexIdePanelResume.implementationVersion`：与内置集成版本不一致时自动阻止面板恢复，便于 Codex 更新后快速修复。
- **Resume with…** 在开关开启时为 Codex 会话提供 **Codex IDE Panel (Experimental)** 选项。

### [1.1.17] - 2026-06-26

#### 新增

- **Resume in Claude Code Panel**：Claude 会话可在 Claude Code 插件面板中恢复，而不只是集成终端。
- 可在设置中选择 Claude 默认恢复方式：插件面板或集成终端（默认面板）。
- **Resume with…** 中 Claude 会话新增 **Claude Code Panel** 选项。

### [1.1.16] - 2026-06-25

#### 新增

- Preview Session 面板右上角新增 **Resume** 与 **Resume with…** 按钮（树预览面板与 Search Sessions 预览 overlay 均支持）。
  - **Resume**：在 VS Code 集成终端恢复（Alma 走 Alma 客户端恢复）。
  - **Resume with…**：可选择 VS Code 集成终端、Ghostty；Codex 会话还可选 Codex App。
- Sessions 树右键菜单顺序调整：Copy Resume Command → Open Folder and Resume → Open in Ghostty → Preview Session → Rename Session。

#### 变更

- 从预览面板恢复会话后，预览面板保持打开，可继续浏览对话。

### [1.1.15] - 2026-06-25

#### 新增

- Preview Session 面板右上角新增 **Rename** 按钮（侧边栏树预览面板与 Search Sessions 预览 overlay 均支持）。

#### 变更

- 从预览面板重命名后，预览标题与侧边栏 Sessions 树会同步更新，无需关闭面板。

### [1.1.14] - 2026-06-25

#### 新增

- **Preview Session**：只读浏览 User/Assistant 对话，不恢复会话。
  - Sessions 树右键菜单：**Preview Session**，在编辑器旁打开独立预览面板。
  - Search Sessions：每行 **Preview** 按钮，面板内全屏预览 overlay。
  - 支持 Codex、Claude、Antigravity CLI、Grok Build、OpenCode、Pi、Alma（Antigravity 支持有限）。
- **Search Sessions** 专用 Webview 面板：顶部项目筛选 chip，下方独立会话列表。
- **Rename Session**：会话标题写回各 Agent 原生存储（Codex、Claude、Antigravity、Grok、OpenCode、Pi、Alma）。
  - 树右键菜单与 Search Sessions 行级 **Rename** 均可用；其他终端 resume 时也会看到新名称。

#### 变更

- 更新 README 与扩展描述，涵盖搜索、重命名、预览功能。

## English

### [2.1.0] - 2026-07-02

#### Added

- **Session Catalog (SQLite)**: CLI session listings and panel state are indexed in a local SQLite database (default `~/.agent-resume-panel/catalog.db`, configurable via `agentResume.catalog.dbPath`). Conversation bodies remain in each agent's native storage; the catalog stores metadata and transcript **references**, with native reads on preview/export.
- **Session Manager**: Title-bar entry on **Sessions** to browse and filter large session sets; **Export** is only available here (metadata plus full transcripts read at export time).
- **Remove** on each **Search Sessions** row, matching sidebar **Remove from Panel** (catalog hide only).
- **Session Menu** settings and configurable session context menus (including **Remove from Panel**); **Sort Sessions** on project/session right-clicks (per-project sort memory).

#### Changed

- Refresh UPSERTs agent sessions into the catalog; `hidden` from remove-from-panel is not cleared automatically by sync.
- Removed **Export Catalog** from the **Sessions** title bar (export remains in Session Manager only).

#### Removed

- **Collapse Project** from project/session context menus.

### [2.0.2] - 2026-07-01

#### Fixed

- Codex ACP reconnect: prefer `session/load`, fall back to a new session on `Resource not found`; fixes `Failed to connect to codex agent: Resource not found`.
- ACP Chat re-subscribes to `session/update` after the session ID changes; fixes dropped Codex streams and `Agent returned an empty response`.

### [2.0.1] - 2026-07-01

#### Fixed

- Release builds no longer use `vsce package --no-dependencies`, so the VSIX includes ACP runtime deps such as `@agentclientprotocol/sdk`; fixes `Cannot find package '@agentclientprotocol/sdk'` and failed agent connections after install.

### [2.0.0] - 2026-07-01

#### Added

- **ACP Chat**: Chat panel rebuilt on the [Agent Client Protocol (ACP)](https://agentclientprotocol.com) for direct agent conversations beside the editor; legacy handoff stack removed.
- **ACP Chats** sidebar view: separate from **Sessions** (CLI history), each with its own refresh and management.
- Supported agents: Codex, Claude, Grok Build, OpenCode, Pi; launch commands and permissions configurable under **Agent Resume Settings → ACP Chat**.
- **Image upload**: Codex, Claude, OpenCode, and Pi support attach button and Ctrl/Cmd+V paste (up to 4 images per message, 5 MB each).
- Grok ACP defaults to the local `grok agent stdio` CLI.

#### Changed

- **Sessions** and the search panel no longer mix in ACP chat entries; new chats appear in **ACP Chats**.
- ACP data directory, permissions, and per-agent launch settings grouped under **ACP Chat** settings.


### [1.2.1] - 2026-06-30

#### Added

- **Project Menu** section in **Agent Resume Settings**: choose which actions appear on the main project context menu and **drag** to reorder; the right-click menu follows the saved order.
- Setting `agentResume.projectMenu.itemOrder`: stores the full display order for all configurable actions (including unchecked items under **Show More**).

#### Changed

- **Customize Project Menu** now opens **Agent Resume Settings → Project Menu** instead of a QuickPick dialog.
- Project right-click menu and **Show More** submenu order match the saved Settings configuration (**Open Folder** stays fixed at the top).

#### Fixed

- Restored the **session** context menu (Preview, Rename, Resume, etc.); project menu ordering no longer affects session items.
- Project menu `when` clauses now require `viewItem =~ /agentResume\.project/`, so project actions no longer appear on session right-clicks.

### [1.2.0] - 2026-06-30

#### Added

- **Agent Resume Settings** webview: gear icon on the Sessions view title bar; grouped settings for data paths, resume behavior, terminal, LLM Assist, and more.
- **LLM Assist**: OpenAI-compatible API (base URL, model, API key) with inline API key field in settings (stored in VS Code Secret Storage).
  - Preview Session: **Summarize** the current session (shown above messages; cached per session and output language).
  - Preview Session: **Auto Rename** generates a title and writes it back to native storage.
  - Sessions tree context menu: **Auto Rename Session** (no manual input).
  - Search Sessions preview overlay supports Summarize and Auto Rename as well.
- Setting `agentResume.llm.outputLanguage` (default English): output language for Summarize and Auto Rename (Chinese, Japanese, Korean, and 7 more).
- **Test Connection** uses the current form values (Save not required); errors include the actual request endpoint.

#### Changed

- LLM Assist settings include a tip to prefer fast, low-cost models (e.g. gpt-4o-mini, deepseek-chat).

### [1.1.90] - 2026-06-29

No changes.

### [1.1.20] - 2026-06-29

#### Added

- Setting `agentResume.showSubagentCodex` (default `false`): show or hide Codex subagent threads whose `source` field contains `subagent`.

#### Changed

- **Grok Build**: Ephemeral subagent shells with no title and at most one message are always hidden by default, so they no longer crowd out the `maxItems` display quota; `session_kind: subagent` sessions remain controlled by `agentResume.showSubagentGrok`.
- **Grok Build**: `summary.json` files are cached by mtime and read in parallel on refresh, making repeat refreshes noticeably faster.
- **Codex**: Subagent threads (`source` contains `subagent`) are filtered by default; enable `agentResume.showSubagentCodex` to show them.
- **Claude Code**: When a session has no first user-message title, the panel now uses the `aiTitle` field from `ai-title` rows.

### [1.1.18] - 2026-06-26

#### Added

- **Resume in Codex IDE Panel (Experimental)**: Attempt to resume Codex sessions in the Codex VS Code extension panel.
- Setting `agentResume.codexResumeMode`: `terminal` (default), `panel`, or `app`.
- Experimental kill switch `agentResume.codexIdePanelResume.enabled` to disable panel resume immediately.
- Implementation version `agentResume.codexIdePanelResume.implementationVersion` blocks panel resume when it no longer matches the built-in integration, making post-update fixes safer.
- **Resume with…** adds **Codex IDE Panel (Experimental)** for Codex sessions when the switch is on.

### [1.1.17] - 2026-06-26

#### Added

- **Resume in Claude Code Panel**: Resume Claude sessions in the Claude Code extension panel, not only in the integrated terminal.
- Choose Claude's default resume target in Settings: extension panel or integrated terminal (panel is the default).
- **Resume with…** adds **Claude Code Panel** for Claude sessions.


### [1.1.16] - 2026-06-25

#### Added

- **Resume** and **Resume with…** buttons in the Preview Session panel header (tree preview panel and Search Sessions preview overlay).
  - **Resume**: Resume in a VS Code integrated terminal (Alma sessions open in the Alma desktop app).
  - **Resume with…**: Choose VS Code integrated terminal or Ghostty; Codex sessions also support Codex App.
- Reordered Sessions tree context menu: Copy Resume Command → Open Folder and Resume → Open in Ghostty → Preview Session → Rename Session.

#### Changed

- Preview panels stay open after resuming, so you can keep reading the conversation.

### [1.1.15] - 2026-06-25

#### Added

- **Rename** button in the Preview Session panel header (tree context-menu panel and Search Sessions preview overlay).

#### Changed

- After a rename from the preview panel, the preview title and Sessions sidebar tree update without closing the panel.

### [1.1.14] - 2026-06-25

#### Added

- **Preview Session**: Read-only User/Assistant chat preview without resuming a session.
  - Tree context menu: **Preview Session** opens a standalone webview panel beside the editor.
  - Search Sessions: **Preview** action on each session row with an in-panel overlay.
  - Provider support: Codex, Claude, Antigravity CLI, Grok Build, OpenCode, Pi, and Alma (limited Antigravity support).
- **Search Sessions** webview panel: project filter chips at the top and a separate session list below.
- **Rename Session**: Write session titles back to each agent's native storage (Codex, Claude, Antigravity, Grok, OpenCode, Pi, and Alma).
  - Available from the tree context menu and Search Sessions row actions; other terminals pick up renamed titles on resume.

#### Changed

- README and extension description updated for search, rename, and preview workflows.