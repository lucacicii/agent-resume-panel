# Agent Resume Panel

Languages: [English](#english) | [简体中文](#简体中文)

Browse, search, and resume **Codex / Claude Code / Antigravity / Grok Build / OpenCode / Pi / Prime Agent / OMP / Cursor CLI** sessions from a VS Code / VSCodium sidebar — with **ACP Chat**, **GTD** tagging, **multi-note Markdown** files, and Summarize / Rename / Handoff assist. **Cursor IDE** composer sessions are indexed as metadata and open their recorded project in Cursor.

| | Link |
|---|---|
| **Install** | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2) |
| **Docs** | [docs/panel](../../docs/panel/README.md) |

Extension version: **2.14.0** · [Changelog](CHANGELOG.md)

> **No cloud · Local-first**  
> Session index, notes, and ACP chats are stored on your machine under **`~/.agent-resume-panel`**.  
> Optional LLM Assist only contacts a third-party API you configure.

---

## English

### Features

| Feature | Description |
|---------|-------------|
| **Sessions** | Recent / Favorites / Projects; click to resume |
| **ACP Chats** | In-editor chat via [ACP](https://agentclientprotocol.com) |
| **GTD** | `@inbox` / `@next` / `@waiting` / `@someday` / `@reference` on CLI sessions and notes |
| **Notes** | Multiple Markdown notes per session or project |
| **Search / Manager** | Filter, bulk browse, Export backup |
| **LLM Assist** | Summarize, Auto Rename, Handoff Brief (optional API) |
| **Resume targets** | Terminal, Claude/Codex panels, Ghostty, Codex App, Herdr (`Herdr Core Bridge`) |
| **Prime Agent** | Prime Agent CLI sync, preview, `prime-agent --resume` terminal resume, and ACP Chat via `prime-agent --mode acp` |
| **OMP** | OMP CLI sync (`~/.omp/agent/sessions`), preview, `omp -r` terminal resume, and ACP Chat via `omp acp` |
| **Cursor** | Cursor CLI sync, preview, terminal resume, and copied `cursor-agent` command; Cursor IDE composer headers open the recorded project (command resume is not available) |

### Quick start

1. Install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2) and open **Agent Resume** in the activity bar.
2. Use **Sessions**, **ACP Chats**, **GTD**, and **Notes** views.
3. Click a session to resume; use **Refresh** when lists are stale.

### Documentation & feedback

| | Link |
|---|------|
| VS Code extension docs | [docs/panel](../../docs/panel/README.md) |
| Companion extension | [Herdr Core Bridge](https://github.com/lucacicii/herdr-bridge) ([Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.herdr-core-bridge) · [Open VSX](https://open-vsx.org/extension/lucacicii/herdr-core-bridge)) — live `hc` PTYs, Spaces & two-way session sync |
| Discord community | [discord.gg/CG2esx7K7](https://discord.gg/CG2esx7K7) |
| Report issues | [Issues](https://github.com/lucacicii/agent-resume-panel/issues) |

Do not paste API keys, full transcripts, or sensitive paths in issues.

---

## 简体中文

在 VS Code / VSCodium 侧边栏中统一浏览、搜索、恢复 **Codex / Claude Code / Antigravity / Grok Build / OpenCode / Pi / Prime Agent / OMP / Cursor CLI** 历史会话；支持 **ACP Chat**、**GTD**、**多条 Markdown 笔记**，以及摘要 / 重命名 / Handoff。**Cursor IDE** Composer 会话仅索引元数据，点击后在 Cursor 中打开其记录的项目。

| | 链接 |
|---|---|
| **安装** | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2) |
| **文档** | [docs/panel](../../docs/panel/README.md) |

扩展版本：**2.14.0** · [更新日志](CHANGELOG.md)

> **无云端 · 纯本机存储**  
> 数据默认保存在 **`~/.agent-resume-panel`**。可选 LLM Assist 需自行配置 API。

### 功能一览

| 能力 | 说明 |
|------|------|
| **Sessions** | Recent / Favorites / Projects 浏览与恢复 |
| **ACP Chats** | 基于 [ACP](https://agentclientprotocol.com) 的编辑器旁聊天 |
| **GTD** | `@inbox` / `@next` / `@waiting` / `@someday` / `@reference`（CLI 会话和笔记） |
| **Notes** | 多条 Markdown 笔记，支持图片附件 |
| **搜索 / Manager** | 筛选、批量浏览、Export 备份 |
| **LLM Assist** | 摘要、自动重命名、Handoff Brief |
| **恢复目标** | 终端、Claude/Codex 面板、Ghostty、Codex App、Herdr（`Herdr Core Bridge`） |
| **Prime Agent** | Prime Agent CLI 同步、预览、`prime-agent --resume` 终端恢复，以及 `prime-agent --mode acp` ACP 聊天 |
| **OMP** | OMP CLI 同步（`~/.omp/agent/sessions`）、预览、`omp -r` 终端恢复，以及 `omp acp` ACP 聊天 |
| **Cursor** | Cursor CLI 支持同步、预览、终端恢复与复制 `cursor-agent` 命令；Cursor IDE Composer 仅打开记录的项目，不支持命令恢复 |

### 快速开始

1. 从 Marketplace 安装并打开 **Agent Resume**。
2. 使用 **Sessions**、**ACP Chats**、**GTD**、**Notes** 视图。
3. 点击会话恢复；过期时点 **Refresh**。

### 文档与反馈

| | 链接 |
|---|------|
| VS Code 扩展文档 | [docs/panel](../../docs/panel/README.md) |
| 配套扩展 | [Herdr Core Bridge](https://github.com/lucacicii/herdr-bridge)（[Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.herdr-core-bridge) · [Open VSX](https://open-vsx.org/extension/lucacicii/herdr-core-bridge)）— 实时 `hc` 终端、Spaces 与双向会话联动 |
| Discord 社区 | [discord.gg/CG2esx7K7](https://discord.gg/CG2esx7K7) |
| 问题反馈 | [Issues](https://github.com/lucacicii/agent-resume-panel/issues) |

请勿粘贴 API Key、完整对话内容或敏感路径。
