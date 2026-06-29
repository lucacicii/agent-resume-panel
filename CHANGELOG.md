# Changelog

Languages: [简体中文](#简体中文) | [English](#english)

本文件用于 Open VSX 发布说明，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

This file is used for Open VSX release notes and follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 简体中文


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