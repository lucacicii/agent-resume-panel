# Agent Resume Panel — User Documentation

Languages: [English](#english) | [简体中文](#简体中文)

Browse, search, and resume **Codex / Claude Code / Antigravity / Grok Build / OpenCode / Pi / Cursor CLI** sessions from a VS Code / VSCodium sidebar — with **ACP Chat**, **GTD** tagging, **multi-note Markdown** files, and Summarize / Rename / Handoff assist. **Cursor IDE** Composer session metadata is indexed and opens its recorded project in Cursor.

There is also a standalone **macOS Desktop app** for calendar digests, Agent Q&A over your work history, and an embedded **Workbench** terminal — it shares the same local data as this extension.
<img width="2880" height="1632" alt="image" src="https://github.com/user-attachments/assets/fb4639d1-9cde-4510-8064-a17e374b016b" />

<img width="2880" height="1632" alt="image" src="https://github.com/user-attachments/assets/3fb6400c-8cb6-4a8d-9b5a-1a5db1c10ad5" />

<img width="1787" height="1323" alt="image" src="https://github.com/user-attachments/assets/84f880d6-e0bb-455f-ae31-0f9cdf63b36f" /><img width="588" height="582" alt="image" src="https://github.com/user-attachments/assets/0c681e2f-874f-4502-b060-32b0d3b3bb9b" />
<img width="2560" height="1345" alt="image" src="https://github.com/user-attachments/assets/6a88ddcb-5665-4481-9622-0ab6f7c90dd7" /><img width="584" height="467" alt="image" src="https://github.com/user-attachments/assets/31b568e1-c287-4404-b631-79365870e04e" />
<img width="2560" height="1345" alt="image" src="https://github.com/user-attachments/assets/5e2332c2-a401-4847-816d-e1eb475dba8c" /><img width="2560" height="1345" alt="image" src="https://github.com/user-attachments/assets/807f4882-e93c-47ee-bc50-5c5e387cce8a" />
<img width="1293" height="456" alt="image" src="https://github.com/user-attachments/assets/3ed291fe-54e4-49ad-aec5-dc112566600a" /><img width="578" height="438" alt="image" src="https://github.com/user-attachments/assets/41ee14bf-d40c-4569-acff-a5751c66b3c8" />
<img width="1175" height="717" alt="image" src="https://github.com/user-attachments/assets/289e6718-7121-48bc-8c21-06ef716b09f5" /><img width="2114" height="1309" alt="image" src="https://github.com/user-attachments/assets/b4647bf8-39b8-4c0d-b24b-72dfb04c2c4f" />
<img width="2560" height="1345" alt="image" src="https://github.com/user-attachments/assets/b5aabd35-862b-4e25-9901-537c8d106152" />




| | VS Code extension | Desktop app (macOS) |
|---|---|---|
| **Install** | [Marketplace](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) | [Download DMG](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest) |
| **Docs** | [This folder](README.md) | [Desktop docs](../desktop/README.md) |

Extension version: **2.7.0** · [Changelog](../../apps/extension/CHANGELOG.md) · Desktop: see [releases](https://github.com/thunder-luc/agent-resume-desktop-doc/releases)

> **No cloud · Local-first**  
> Session index, notes, and ACP chats are stored on your machine under **`~/.agent-resume-panel`** (shared by extension and Desktop).  
> Optional LLM Assist only contacts a third-party API you configure.

---

## English

### Documentation by module

| Module | What it covers |
|--------|----------------|
| [Sessions](sessions.md) | Recent / Favorites / Projects, providers including Cursor, search, Session Manager, hide / rename / preview |
| [Resume & targets](resume-and-targets.md) | How resume works: integrated terminal, Ghostty, Claude/Codex panels, Codex App, and Cursor CLI |
| [ACP Chat](acp-chat.md) | In-editor chat via ACP (extension-only) |
| [GTD](gtd.md) | `@inbox` / `@next` / `@waiting` / `@someday` / `@reference` / `@done` |
| [Notes](notes.md) | Markdown notes per session or project, attachments |
| [LLM Assist](llm-assist.md) | Summarize, Auto Rename, Handoff Brief |
| [Settings & data](settings-and-data.md) | Panel home, settings, backup, upgrade tips |
| [Changelog](../../apps/extension/CHANGELOG.md) | Extension release notes |

### Quick start

1. Install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) and open **Agent Resume** in the activity bar.
2. Use the four sidebar views: **Sessions**, **ACP Chats**, **GTD**, and **Notes**.
3. Click a session in **Sessions** to resume (default target is configurable).
4. Use **Refresh** in a view’s title bar when lists look stale.

### VS Code extension vs Desktop

**Two products, one data directory** — same agent sessions and the same `~/.agent-resume-panel` folder. Use one or both.

| | **VS Code extension** | **Agent Resume Desktop** |
|---|---|---|
| **What it is** | Sidebar panel inside VS Code / Cursor / VSCodium | Standalone macOS app — a **Session OS + Memory** layer |
| **Best for** | Resume while coding; **ACP Chat** beside the editor; quick GTD / Notes in the IDE | Step back from the editor: **calendar digests**, natural-language recall, dedicated **Workbench** |
| **Core views** | Sessions · ACP Chats · GTD · Notes | **Report** · **Agent** · **Workbench** · Notes (+ Sessions reference) |
| **Desktop-only** | — | Daily / weekly / monthly AI digests; **Agent** Q&A over reports; embedded xterm **Workbench** with multi-tab sessions |
| **Extension-only** | ACP Chat panel; Claude / Codex IDE panel resume; Ghostty targets | — |

**Shared (no duplicate setup):** `catalog.db` session index, GTD tags, Markdown notes, LLM settings (`settings.json`). CLI transcripts still live in each agent’s native storage (Codex, Claude, etc.). Desktop keeps its own extras under `panelHome/.desktop/`.

Typical combo: **extension** for day-to-day resume inside the editor → **Desktop** for weekly review and digests — without re-importing anything.

[Install extension](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) · [Download Desktop (macOS)](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest) · [Desktop docs](../desktop/README.md)

### Feedback & support

- **Discord community**: [discord.gg/CG2esx7K7](https://discord.gg/CG2esx7K7)
- **Bugs / feature requests**: [GitHub Issues](https://github.com/thunder-luc/agent-resume-panel/issues)
- Do not paste API keys, full transcripts, or sensitive paths in issues.

### Related links

- [Desktop App documentation](../desktop/README.md)
- [Download Desktop (macOS)](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2)

---

## 简体中文

在 VS Code / VSCodium 侧边栏中统一浏览、搜索、恢复 **Codex / Claude Code / Antigravity / Grok Build / OpenCode / Pi / Cursor CLI** 历史会话；支持 **ACP Chat**、**GTD**、**多条 Markdown 笔记**，以及摘要 / 重命名 / Handoff 等辅助能力。**Cursor IDE** Composer 会话仅索引元数据，点击后在 Cursor 中打开其记录的项目。

另有独立 **macOS 桌面端**：日历回顾、基于报告的 **Agent** 问答、内嵌 **Workbench** 终端，与本扩展共用同一份本机数据。

| | VS Code 扩展 | Desktop 桌面端（macOS） |
|---|---|---|
| **安装** | [Marketplace](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) | [下载 DMG](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest) |
| **文档** | [本目录](README.md) | [Desktop 文档](../desktop/README.md) |

扩展版本：**2.7.0** · [更新日志](../../apps/extension/CHANGELOG.md) · 桌面端版本见 [Releases](https://github.com/thunder-luc/agent-resume-desktop-doc/releases)

> **无云端 · 纯本机存储**  
> 数据默认目录 **`~/.agent-resume-panel`**（扩展与 Desktop 共用）。可选 LLM Assist 仅在你配置第三方 API 时使用。

### 按模块阅读

| 模块 | 内容 |
|------|------|
| [会话 Sessions](sessions.md) | Recent / Favorites / Projects、含 Cursor 的 Provider、搜索、Session Manager、隐藏 / 重命名 / 预览 |
| [恢复与目标](resume-and-targets.md) | 点击恢复：集成终端、Ghostty、Claude/Codex 面板、Codex App、Cursor CLI |
| [ACP Chat](acp-chat.md) | 编辑器旁 ACP 聊天（仅扩展） |
| [GTD](gtd.md) | `@inbox` / `@next` / `@waiting` / `@someday` / `@reference` / `@done` |
| [Notes](notes.md) | 会话 / 项目 Markdown 笔记与附件 |
| [LLM 辅助](llm-assist.md) | 摘要、自动重命名、Handoff Brief |
| [设置与数据](settings-and-data.md) | 数据目录、设置、备份、升级提示 |
| [更新日志](../../apps/extension/CHANGELOG.md) | 扩展版本变更 |

### 快速开始

1. 从 [Marketplace](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) 安装，并在活动栏打开 **Agent Resume**。
2. 使用四个侧边栏视图：**Sessions**、**ACP Chats**、**GTD**、**Notes**。
3. 在 **Sessions** 中点击会话即可恢复（默认目标可配置）。
4. 列表过期时，点视图标题栏的 **Refresh**。

### VS Code 扩展 vs Desktop

**两个产品，一份数据目录** — 读取同一批 Agent 会话、共用 **`~/.agent-resume-panel`**，可单独使用或搭配使用。

| | **VS Code 扩展** | **Agent Resume Desktop** |
|---|---|---|
| **定位** | 装在 VS Code / Cursor / VSCodium 里的侧边栏面板 | 独立 macOS 应用 — **Session OS + Memory** |
| **适合场景** | 写代码时顺手恢复会话；编辑器旁 **ACP Chat**；在 IDE 里打 GTD / 记笔记 | 离开编辑器做回顾：**日历日报**、自然语言回忆、专用 **Workbench** 工作台 |
| **主要视图** | Sessions · ACP Chats · GTD · Notes | **Report** · **Agent** · **Workbench** · Notes（+ Sessions 参考列表） |
| **仅 Desktop** | — | 日 / 周 / 月 AI 回顾报告；对报告做 **Agent** 问答；内嵌 xterm **Workbench** 多标签恢复 |
| **仅扩展** | ACP Chat 面板；Claude / Codex 插件面板恢复；Ghostty 等恢复目标 | — |

**共用（无需重复配置）：** `catalog.db` 会话索引、GTD 标记、Markdown 笔记、LLM 设置（`settings.json`）。CLI 对话正文仍在各 Agent 本机原生存储。Desktop 私有数据在 `panelHome/.desktop/`。

常见搭配：**扩展**负责日常在编辑器里恢复会话 → **Desktop** 负责周报回顾与 Digest——无需重新导入。

[安装扩展](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2) · [下载 Desktop（macOS）](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest) · [Desktop 文档](../desktop/README.md)

### 反馈与支持

- **Discord 社区**：[discord.gg/CG2esx7K7](https://discord.gg/CG2esx7K7)
- [GitHub Issues](https://github.com/thunder-luc/agent-resume-panel/issues)
- 请勿粘贴 API Key、完整对话内容或敏感路径。

### 相关链接

- [Desktop App 用户文档](../desktop/README.md)
- [下载 Desktop（macOS）](https://github.com/thunder-luc/agent-resume-desktop-doc/releases/latest)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=thunder-luc.agent-resume-panel-v2)
