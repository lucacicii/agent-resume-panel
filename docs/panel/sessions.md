# Sessions

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

The **Sessions** sidebar view is the main place to browse, search, and open historical CLI agent sessions. The extension syncs local session metadata into a catalog under your panel home (default `~/.agent-resume-panel`) so you can find work across tools in one tree.

### Supported providers

| Provider | Typical local home |
|----------|--------------------|
| **Codex** | `~/.codex` |
| **Claude Code** | `~/.claude` |
| **Antigravity (agy)** | configured Antigravity home |
| **Grok Build** | `~/.grok` (or configured path) |
| **OpenCode** | configured OpenCode home |
| **Pi** | configured Pi home |
| **Cursor CLI** | `~/.cursor` |
| **Cursor IDE** | platform Cursor User directory (Composer headers only) |

Full transcripts stay in each agent’s native storage. The panel index only stores catalog metadata (title, project, timestamps, GTD, note flags, etc.).

**Cursor support:** Cursor CLI sessions include local transcript preview and can be resumed. Cursor IDE currently exposes only Composer session headers locally, so the panel indexes their metadata and opens the recorded project in Cursor; it does not claim command resume or transcript preview for those IDE sessions.

### Browse layout

Sessions are organized roughly as:

- **Recent** — latest activity across providers  
- **Favorites** — projects you marked as favorites  
- **Projects** — sessions grouped by project / working directory  

Use the view title bar **Refresh** when lists look out of date after heavy CLI use outside the IDE.

### Common actions

| Action | Typical entry |
|--------|----------------|
| **Open / resume** | Click a session (see [Resume & targets](resume-and-targets.md)) |
| **Preview transcript** | Context menu → preview (read-only) |
| **Rename** | Context menu → rename (catalog + native rename when supported) |
| **Copy resume command** | Context menu → copy the shell command for that session |
| **Search** | Command **Agent Resume: Search** / title-bar search entry |
| **Session Manager** | Bulk browse and **Export** conversation backups |
| **Favorite project** | Context menu on a project node |
| **Hide session** | Remove from the panel catalog only — does **not** delete native history |

### Search & Session Manager

- **Search** filters by project, GTD status, provider, and free text over catalog fields.  
- **Session Manager** is better for scanning many sessions and exporting a backup of conversations.

### Tips

1. Configure custom agent home directories in [Settings](settings-and-data.md) if tools are not installed in the default paths.  
2. Sidebar density and max items are configurable (`sidebarMode`, `maxItems`, catalog sync limits).  
3. Hiding a session only affects the panel. Native provider history is left alone unless a specific provider action explicitly removes it.  
4. Native rename support varies by provider; the catalog title still updates when rename is partial.

### Related

- [Resume & targets](resume-and-targets.md)  
- [GTD](gtd.md) · [Notes](notes.md) · [LLM Assist](llm-assist.md)  
- [Settings & data](settings-and-data.md)

---

## 简体中文

### 是什么

**Sessions** 侧边栏用于浏览、搜索并打开各 CLI Agent 的历史会话。扩展会把本机会话元数据同步到面板数据目录（默认 `~/.agent-resume-panel`）中的目录索引，便于跨工具统一查找。

### 支持的 Provider

| Provider | 常见本机目录 |
|----------|----------------|
| **Codex** | `~/.codex` |
| **Claude Code** | `~/.claude` |
| **Antigravity (agy)** | 配置的 Antigravity 目录 |
| **Grok Build** | `~/.grok`（或自定义路径） |
| **OpenCode** | 配置的 OpenCode 目录 |
| **Pi** | 配置的 Pi 目录 |
| **Cursor CLI** | `~/.cursor` |
| **Cursor IDE** | 平台默认的 Cursor User 目录（仅 Composer 会话头） |

完整对话正文仍在各 Agent 原生存储中。面板索引主要保存标题、项目、时间、GTD、笔记标记等元数据。

**Cursor 支持范围：**Cursor CLI 会话可本地预览并恢复。Cursor IDE 目前仅在本机暴露 Composer 会话头，因此面板只索引其元数据并在 Cursor 中打开记录的项目；不承诺 IDE 会话的命令恢复或正文预览。

### 浏览结构

常见分组：

- **Recent** — 跨 Provider 的最近活动  
- **Favorites** — 已收藏的项目  
- **Projects** — 按项目 / 工作目录分组  

在 IDE 外大量使用 CLI 后，若列表过期，点视图标题栏 **Refresh**。

### 常用操作

| 操作 | 入口 |
|------|------|
| **打开 / 恢复** | 点击会话（见 [恢复与目标](resume-and-targets.md)） |
| **预览对话** | 右键 → 只读预览 |
| **重命名** | 右键 → 重命名（目录 + 支持时写回原生） |
| **复制恢复命令** | 右键 → 复制 shell 命令 |
| **搜索** | 命令 **Agent Resume: Search** 等 |
| **Session Manager** | 批量浏览与 **Export** 备份 |
| **收藏项目** | 在项目节点上操作 |
| **隐藏会话** | 仅从面板目录移除，**不会**删除原生存储 |

### 搜索与 Session Manager

- **Search** 可按项目、GTD、Provider 与目录字段筛选。  
- **Session Manager** 适合批量查看并导出对话备份。

### 提示

1. 若工具不在默认路径，请在 [设置](settings-and-data.md) 中配置各 Agent Home。  
2. 侧边栏密度、最大条数与同步上限可在设置中调整。  
3. 隐藏只影响面板；原生历史默认保留。  
4. 各 Provider 对原生重命名支持不同；目录标题仍会尽量更新。

### 相关文档

- [恢复与目标](resume-and-targets.md)  
- [GTD](gtd.md) · [Notes](notes.md) · [LLM 辅助](llm-assist.md)  
- [设置与数据](settings-and-data.md)
