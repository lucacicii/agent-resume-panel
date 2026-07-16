# Agent Resume Panel

Languages: [English](#english) | [简体中文](#简体中文)

Browse, search, and resume **Codex / Claude Code / Antigravity / Grok Build / OpenCode / Pi / Alma** CLI sessions from a VS Code / VSCodium sidebar — with **ACP Chat**, **GTD** tagging, **multi-note Markdown** files, and Summarize / Rename / Handoff assist.

There is also a standalone **macOS Desktop app** for calendar digests, Agent Q&A over your work history, and an embedded **Workbench** terminal — it shares the same local data as this extension.

| | VS Code extension | Desktop app (macOS) |
|---|---|---|
| **Install** | [Marketplace](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) | [Download DMG](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest) |
| **Docs** | [panel-doc](https://github.com/thunder-luc/agent-resume-panel-doc) | [desktop-doc](https://github.com/thunder-luc/agent-resume-desktop-doc) |

Extension version: **2.6.8** · Desktop: see [releases](https://github.com/thunder-luc/agent-resume-desktop-doc/releases)

> **No cloud · Local-first**  
> Session index, notes, and ACP chats are stored on your machine under **`~/.agent-resume-panel`** (shared by extension and Desktop).  
> Optional LLM Assist only contacts a third-party API you configure.

---

## English

### VS Code extension vs Desktop

**This repo ships two products** that read the same agent sessions and the same `~/.agent-resume-panel` data directory — use one or both.

| | **VS Code extension** | **Agent Resume Desktop** |
|---|---|---|
| **What it is** | Sidebar panel inside VS Code / Cursor / VSCodium | Standalone macOS app — a **Session OS + Memory** layer |
| **Best for** | Resume while coding; **ACP Chat** beside the editor; quick GTD / Notes in the IDE | Step back from the editor: **calendar digests**, natural-language recall, dedicated **Workbench** |
| **Core views** | Sessions · ACP Chats · GTD · Notes | **Report** · **Agent** · **Workbench** · Notes (+ Sessions reference) |
| **Desktop-only** | — | Daily / weekly / monthly AI digests; **Agent** Q&A over reports; embedded xterm **Workbench** with multi-tab sessions |
| **Extension-only** | ACP Chat panel; Claude / Codex IDE panel resume; Ghostty / Alma targets | — |

**Shared (no duplicate setup):** `catalog.db` session index, GTD tags, Markdown notes, LLM settings (`settings.json`). CLI transcripts still live in each agent’s native storage (Codex, Claude, etc.). Desktop keeps its own extras under `panelHome/.desktop/`.

Typical combo: **extension** for day-to-day resume inside the editor → **Desktop** for weekly review, digest generation, and “what did I work on last Tuesday?” — without re-importing anything.

[Install extension](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) · [Download Desktop (macOS)](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest) · [Desktop docs](https://github.com/thunder-luc/agent-resume-desktop-doc)

### Features

| Feature | Description |
|---------|-------------|
| **Sessions** | Recent / Favorites / Projects; click to resume |
| **ACP Chats** | In-editor chat via [ACP](https://agentclientprotocol.com) |
| **GTD** | `@inbox` / `@next` / `@waiting` / `@someday` / `@reference` on CLI sessions |
| **Notes** | Multiple Markdown notes per session or project |
| **Search / Manager** | Filter, bulk browse, Export backup |
| **LLM Assist** | Summarize, Auto Rename, Handoff Brief (optional API) |
| **Resume targets** | Terminal, Claude/Codex panels, Ghostty, Codex App, Alma |

### Quick start

1. Install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) and open **Agent Resume** in the activity bar.
2. Use **Sessions**, **ACP Chats**, **GTD**, and **Notes** views.
3. Click a session to resume; use **Refresh** when lists are stale.

### Documentation & feedback

| | Link |
|---|------|
| VS Code extension docs | [agent-resume-panel-doc](https://github.com/thunder-luc/agent-resume-panel-doc) |
| Desktop app docs | [agent-resume-desktop-doc](https://github.com/thunder-luc/agent-resume-desktop-doc) |
| Report issues | [panel-doc Issues](https://github.com/thunder-luc/agent-resume-panel-doc/issues) |

Do not paste API keys, full transcripts, or sensitive paths in issues.

---

## 简体中文

在 VS Code / VSCodium 侧边栏中统一浏览、搜索、恢复 **Codex / Claude Code / Antigravity / Grok Build / OpenCode / Pi / Alma** 历史会话；支持 **ACP Chat**、**GTD**、**多条 Markdown 笔记**，以及摘要 / 重命名 / Handoff。

另有独立 **macOS 桌面端**：日历回顾、基于报告的 **Agent** 问答、内嵌 **Workbench** 终端，与本扩展共用同一份本机数据。

| | VS Code 扩展 | Desktop 桌面端（macOS） |
|---|---|---|
| **安装** | [Marketplace](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) | [下载 DMG](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest) |
| **文档** | [panel-doc](https://github.com/thunder-luc/agent-resume-panel-doc) | [desktop-doc](https://github.com/thunder-luc/agent-resume-desktop-doc) |

扩展版本：**2.6.8** · 桌面端版本见 [Releases](https://github.com/thunder-luc/agent-resume-desktop-doc/releases)

> **无云端 · 纯本机存储**  
> 数据默认保存在 **`~/.agent-resume-panel`**（扩展与 Desktop 共用）。可选 LLM Assist 需自行配置 API。

### VS Code 扩展 vs Desktop

**本仓库包含两个产品**，读取同一批 Agent 会话、共用 **`~/.agent-resume-panel`** 数据目录，可单独使用或搭配使用。

| | **VS Code 扩展** | **Agent Resume Desktop** |
|---|---|---|
| **定位** | 装在 VS Code / Cursor / VSCodium 里的侧边栏面板 | 独立 macOS 应用 — **Session OS + Memory** |
| **适合场景** | 写代码时顺手恢复会话；编辑器旁 **ACP Chat**；在 IDE 里打 GTD / 记笔记 | 离开编辑器做回顾：**日历日报**、自然语言回忆、专用 **Workbench** 工作台 |
| **主要视图** | Sessions · ACP Chats · GTD · Notes | **Report** · **Agent** · **Workbench** · Notes（+ Sessions 参考列表） |
| **仅 Desktop** | — | 日 / 周 / 月 AI 回顾报告；对报告做 **Agent** 问答；内嵌 xterm **Workbench** 多标签恢复 |
| **仅扩展** | ACP Chat 面板；Claude / Codex 插件面板恢复；Ghostty / Alma 等恢复目标 | — |

**共用（无需重复配置）：** `catalog.db` 会话索引、GTD 标记、Markdown 笔记、LLM 设置（`settings.json`）。CLI 对话正文仍在各 Agent 本机原生存储。Desktop 私有数据在 `panelHome/.desktop/`。

常见搭配：**扩展**负责日常在编辑器里恢复会话 → **Desktop** 负责周报回顾、生成 Digest、「上周二我在做什么」——无需重新导入。

[安装扩展](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) · [下载 Desktop（macOS）](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest) · [Desktop 文档](https://github.com/thunder-luc/agent-resume-desktop-doc)

### 功能一览

| 能力 | 说明 |
|------|------|
| **Sessions** | Recent / Favorites / Projects 浏览与恢复 |
| **ACP Chats** | 基于 [ACP](https://agentclientprotocol.com) 的编辑器旁聊天 |
| **GTD** | `@inbox` / `@next` / `@waiting` / `@someday` / `@reference` |
| **Notes** | 多条 Markdown 笔记，支持图片附件 |
| **搜索 / Manager** | 筛选、批量浏览、Export 备份 |
| **LLM Assist** | 摘要、自动重命名、Handoff Brief |
| **恢复目标** | 终端、Claude/Codex 面板、Ghostty、Codex App、Alma |

### 快速开始

1. 从 Marketplace 安装并打开 **Agent Resume**。
2. 使用 **Sessions**、**ACP Chats**、**GTD**、**Notes** 四个视图。
3. 点击会话恢复；过期时点 **Refresh**。

### 文档与反馈

| | 链接 |
|---|------|
| VS Code 扩展文档 | [agent-resume-panel-doc](https://github.com/thunder-luc/agent-resume-panel-doc) |
| Desktop App 文档 | [agent-resume-desktop-doc](https://github.com/thunder-luc/agent-resume-desktop-doc) |
| 问题反馈 | [panel-doc Issues](https://github.com/thunder-luc/agent-resume-panel-doc/issues) |

请勿粘贴 API Key、完整对话内容或敏感路径。
