# Changelog

Languages: [简体中文](#简体中文) | [English](#english)

本文件用于 Open VSX 发布说明，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

This file is used for Open VSX release notes and follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 简体中文

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