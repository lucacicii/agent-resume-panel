# Agent Resume Panel

Languages: [简体中文](#简体中文) | [English](#english)

在 VS Code / VSCodium 侧边栏中统一浏览、搜索、恢复 **Codex / Claude Code / Antigravity / Grok Build / OpenCode / Pi / Alma** 历史会话；支持 **ACP Chat** 实时对话、**GTD** 状态管理、**多条 Markdown 笔记**（磁盘文件 + Catalog 索引），以及摘要 / 重命名 / Handoff 等辅助能力。

当前版本：**2.6.2**

> **无云端 · 纯本机存储（Local-first）**  
> **本插件不提供、也不依赖自有云端服务**；会话索引、笔记、ACP 聊天等面板数据均为**纯本机存储**。  
> 默认目录：**`~/.agent-resume-panel`**（可用 `agentResume.panelHome` 修改），内含 `catalog.db`、`notes/`、`acp/`。  
> CLI 对话全文仍在各 Agent **本机**原生存储（如 `~/.codex`、`~/.claude`）。换机请自行拷贝/同步上述本机目录。  
> （可选）LLM Assist 仅在你自行配置第三方 API 时才会访问该 API，与本插件是否有云端无关——**插件本身没有账号体系与云端数据库。**

---

## 简体中文

**目录**

1. [简介与功能一览](#1-简介与功能一览)
2. [快速开始](#2-快速开始)
3. [四个侧边栏视图](#3-四个侧边栏视图)
4. [会话与项目操作](#4-会话与项目操作)
5. [搜索、Session Manager 与备份](#5-搜索session-manager-与备份)
6. [LLM Assist 与 Handoff](#6-llm-assist-与-handoff)
7. [恢复目标与外部工具](#7-恢复目标与外部工具)
8. [数据存储架构（Local-first）](#8-数据存储架构local-first)
9. [设置](#9-设置)
10. [联系](#10-联系)

### 1. 简介与功能一览

| 能力 | 说明 |
|------|------|
| **Sessions** | 按 Recent / Favorites / Projects 浏览 CLI 历史，点击恢复 |
| **ACP Chats** | 基于 [ACP](https://agentclientprotocol.com) 的编辑器旁聊天（Codex / Claude / Grok / OpenCode / Pi） |
| **GTD** | 为 CLI 会话打 `@inbox` / `@next` / `@waiting` / `@someday` / `@reference` 标签 |
| **Notes** | 每个 session / project **多条** Markdown 笔记；真实 `.md` + 图片 assets，可被 Obsidian 等打开 |
| **搜索 / Manager** | 按项目、GTD、provider 筛选；批量浏览与 **Export** 备份 |
| **LLM Assist** | Summarize、Auto Rename、Handoff Brief（需配置 OpenAI 兼容 API） |
| **恢复目标** | 集成终端、官方插件面板（Claude / 实验性 Codex）、Ghostty、Codex App、Alma 客户端 |

**支持的 CLI / 桌面 Agent**

Codex · Claude Code · Antigravity CLI · Grok Build · OpenCode · Pi · Alma（macOS 桌面客户端）

---

### 2. 快速开始

1. 在活动栏打开 **Agent Resume**。
2. 使用四个视图：
   - **Sessions** — CLI 历史
   - **ACP Chats** — ACP 实时聊天
   - **GTD** — 已打标 CLI 会话
   - **Notes** — Markdown 笔记
3. 在 **Sessions** 中点击会话即可恢复（Claude / Codex 可走官方插件面板或终端；Alma 走 Alma 客户端）。
4. 列表过期时：各视图标题栏 **Refresh**，或命令 **Agent Resume: Refresh** / **Refresh ACP Chats** / **Refresh Notes**。

默认终端类 Agent 在编辑器旁集成终端恢复；可在设置中改 Claude / Codex 默认方式。

---

### 3. 四个侧边栏视图

#### 3.1 Sessions

- 分区：**Recent**、**Favorite Projects**、**Projects**（可拖拽调整分区与收藏）。
- 标题栏：**New Session**、**Search**、**Session Manager**、**Refresh**、**Settings**。
- 悬停会话：若有 LLM 摘要，tooltip 显示 **Summary**；若有笔记显示 **Note**；若有 GTD 显示状态。

#### 3.2 ACP Chats

- 独立列表，不与 CLI **Sessions** 混排。
- **+ / New ACP Chat**：从当前工作区新建；项目上也可 **New Chat Session**。
- 点击打开聊天面板；右键可 **Rename**、**Open Note…**、**Hand Off** 等。
- 默认 Agent 启动方式见下表（可在 **Settings → ACP Chat** 覆盖）。

| Agent | 默认启动 | 图片上传 |
|-------|----------|----------|
| Codex | `npx -y @zed-industries/codex-acp@latest` | 是 |
| Claude | `npx -y @agentclientprotocol/claude-agent-acp@latest` | 是 |
| Grok Build | 本机 `grok agent stdio` | — |
| OpenCode | `npx -y opencode-ai@latest acp` | 是 |
| Pi | `npx -y pi-acp` | 是 |

**Grok**：请安装本机 [Grok Build CLI](https://x.ai/cli)，**不要**使用 npm `@xai-official/grok@latest`（会指向无 `agent` 子命令的旧版）。失败时可 `grok agent stdio --reauth`。

#### 3.3 GTD

- 仅 **CLI** 会话可打标（数据在 Catalog）；**ACP Chats 不可打标**。
- 五个互斥桶：`@inbox` · `@next` · `@waiting` · `@someday` · `@reference`。
- 右键会话 → **Set GTD Status…**（可清除）；Search / Session Manager 可按 GTD 筛选。
- 持久化：`catalog.db` → `session_gtd`。

#### 3.4 Notes

每个 **session** 或 **project** 可有**多条** Markdown 笔记。正文在磁盘，Catalog 只存索引。

**视图结构**

```text
Notes
├── Projects → 项目 → *.md
└── Sessions → 会话 → *.md
```

**标题栏**

Filter · Clear Filter · New Note… · **Import Markdown…** · Refresh · Open Notes Folder · Settings

**单条笔记右键**

Open · **Rename Note** · Delete Note · Reveal in File Explorer · Copy Path  

（重命名会同步 `{stem}.assets/` 与文内相对路径。）

**批量导入 Markdown**

- 标题栏 **Import Markdown…**，或在项目 / 会话节点右键 **Import Markdown…**。
- 可选多个 `.md` 文件，或选择**文件夹**（导入该目录下顶层全部 `.md`）。
- 复制到目标 project/session 目录；文件名冲突时自动加 `-2`、`-3` 后缀。
- 若源文件旁存在同名 `{stem}.assets/`，会一并复制；正文相对路径会尽量对齐。
- 导入为**本机拷贝**，不修改你选中的源文件。

**命名与资源**

- 新建默认：`YYYY-MM-DD-NN.md`（本地日期 + 该 owner 当天序号）。
- 附件目录：`{stem}.assets/`，例如 `![](./2026-07-08-01.assets/shot.png)`。
- 命令 **Insert Image into Note**：把图片写入 assets 并插入链接。
- 可用 Finder / Obsidian / Typora 等直接打开同一路径。

**从 Sessions / 项目入口**

| 操作 | 行为 |
|------|------|
| **Open Note…** / **Open Project Note…** | 无则新建；一条直接开；多条 QuickPick |
| **Delete Notes** / **Delete Project Notes** | 删除该 owner 下全部笔记（含 assets） |

侧栏 **Note** 标记 = 至少有一条笔记；完整列表在 **Notes** 视图。

**磁盘布局示例**

```text
~/.agent-resume-panel/
  catalog.db                 # 含 notes 索引表
  notes/
    projects/{projectKey}/
      2026-07-08-01.md
      2026-07-08-01.assets/
    sessions/{provider}/{sessionKey}/
      2026-07-09-01.md
  acp/                       # ACP 会话数据
```

从 **2.5.x** 升级：旧 `session_notes` / `project_notes` 会**一次性**迁到磁盘 md；迁完后日常读写**不再**使用这两张旧表（仅作历史保留）。

---

### 4. 会话与项目操作

#### 4.1 会话右键（Sessions / GTD；部分 ACP 类似）

| 操作 | 说明 |
|------|------|
| Preview Session | 只读预览 User/Assistant，不恢复 |
| Rename Session | 写回各 Agent 原生存储 |
| Remove from Panel | 仅 Catalog `hidden=1`，不删原生文件 |
| Resume / Copy Resume Command | 默认恢复或复制命令 |
| Open Folder and Resume | 打开项目并在新窗口恢复 |
| Open in Ghostty / Claude Panel / Codex Panel / Codex App | 指定目标恢复 |
| Hand Off to… | 转交其他 Agent（需 LLM） |
| Set GTD Status… | CLI 会话 GTD |
| Open Note… / Delete Notes | 笔记 |

预览 / 搜索面板中还可 **Resume with…**、**Summarize**、**Auto Rename**、**Hand Off**。

可在 **Agent Resume Settings → Session Menu** 配置主菜单与 **Show More** 顺序。

#### 4.2 项目右键

- 打开项目 / Ghostty / 新建各 CLI 会话 / New Chat Session / New Alma Thread / New Codex App Session  
- **Set Project Alias…**（`文件夹名 · 别名`）  
- **Open Project Note…** / **Delete Project Notes**  
- **Sort Sessions**（按项目记忆排序）  

菜单可在 **Settings → Project Menu** 拖拽自定义（**Open Folder** 始终置顶）。

#### 4.3 编辑器标题栏

任意编辑器右上角 **Agent Resume** 图标：按 `agentResume.editorNewSessionProvider` 一键新建会话（默认 Codex）。

---

### 5. 搜索、Session Manager 与备份

#### Search Sessions

命令 **Agent Resume: Search Sessions**。

- 顶部 **Projects** chip + **GTD** 筛选  
- 关键字匹配标题、provider、分支、GTD、别名 / 路径  
- 行内 Preview / Rename / Remove，面板保持打开  

#### Session Manager

**Sessions** 标题栏数据库图标，或 **Agent Resume: Session Manager**。

- 按 provider、年龄、GTD 浏览大批量会话  
- **Export**：写入 `manifest.json` + 从 Agent 原生存储复制 transcript 到 `sessions/`  
  - 不勾选行 = 导出当前筛选下全部可见 CLI 会话（不含 `hidden`）  
  - **ACP Chats 不在 Export 范围**  

#### 备份建议

1. **Session Manager → Export**（对话全文备份）  
2. **整份 `panelHome`**（默认 `~/.agent-resume-panel/`）：`catalog.db` + `notes/` + `acp/`  
3. 各 Agent **原生 home**（Codex / Claude / …）若需完整原始归档  

仅备份 `catalog.db` **不包含**笔记正文（正文在 `notes/`）。

---

### 6. LLM Assist 与 Handoff

在 **Agent Resume Settings → LLM Assist** 配置 OpenAI 兼容 Base URL、Model、API Key 与输出语言。

| 能力 | 说明 |
|------|------|
| Summarize | 摘要写入 Catalog `session_summary`；侧栏 tooltip 可显示 |
| Auto Rename | AI 建议标题并写回原生存储 |
| Handoff | 生成 Brief 并转交其他 Agent（CLI→终端，ACP→ACP Chat） |

Handoff 相关：`agentResume.handoff.attachRecentVerbatim`、`agentResume.handoff.maxBriefTokens`。

---

### 7. 恢复目标与外部工具

#### Claude Code 插件面板

- 安装 [Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code)  
- `agentResume.claudeResumeMode`：`panel`（默认）/ `terminal`  

#### Codex 插件面板（实验性）

- 安装 [Codex](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt)  
- `agentResume.codexResumeMode`：`terminal` / `panel` / `app`  
- 依赖未公开路由，Codex 插件升级可能失效；可用 `agentResume.codexIdePanelResume.enabled = false` 立即关闭  

#### Ghostty

- **Open in Ghostty**；`ghosttyLaunchMode`：`autoPaste` / `copyCommand`  
- macOS 可能需要辅助功能 / 自动化权限  

#### Alma（macOS）

- 需运行 [Alma](https://alma.now/) 与本地 API（默认 `http://localhost:23001`）  
- 点击会话：按标题搜索切换（无公开 thread-id API，标题重复时可能不准）  
- **New Alma Thread**：注册 workspace 后 `Cmd+N` 新建；`defaultWorkspaceId` 仅对新对话页生效  
- UI 自动化需为 VS Code / VSCodium 授予 **辅助功能** 权限  
- 默认可隐藏 Cron / 频道会话（设置项见下）  

---

### 8. 数据存储架构（无云端 · 纯本机）

**结论：本插件没有云端，数据默认只写本机磁盘。**

- **无**本插件自有服务器、云同步、云账号或远程数据库。
- 面板数据（Catalog / Notes / ACP）默认全部在本机 **`~/.agent-resume-panel`**（`agentResume.panelHome`）。
- CLI 对话正文在各 Agent **本机**目录；扩展只做本地索引与按需读取。
- 备份与迁移 = 你自己拷贝本机文件夹（或系统备份 / 同步盘），插件不会替你上传。

默认根目录：`agentResume.panelHome` = `~/.agent-resume-panel`。

```text
~/.agent-resume-panel/          # 或自定义 panelHome
  catalog.db                    # Session Catalog（SQLite，本机）
  notes/                        # 笔记正文与 assets（本机文件）
  acp/                          # ACP 会话与附件（本机）
```

| 数据 | 位置 | 说明 |
|------|------|------|
| CLI 会话元数据、hidden、摘要、GTD、别名、**笔记索引** | `catalog.db` | 扩展维护；不存对话全文 |
| 对话全文 | 各 Agent 原生目录 | Preview / Resume / Export 按需读取 |
| 笔记正文与图片 | `notes/**` | 真实文件；`notes` 表只索引 |
| ACP 聊天 | `panelHome/acp/` | 不进 CLI Catalog |
| 旧 `session_notes` / `project_notes` | catalog（遗留） | 仅升级迁移读一次，日常不用 |

**同步行为**

- Refresh：从各 Agent 同步进 Catalog；不强制把 `hidden` 会话显示回来  
- Notes：刷新时对账磁盘 `notes/` 与 `notes` 索引表  
- Remove from Panel：仅 `hidden=1`  
- Rename Session：Catalog + 各 Provider 原生存储  

**侧栏条数**

- `catalog.sidebarMode = legacy`：侧栏受 `maxItems` 限制，Catalog 可同步更多供 Manager/Search  
- `full`：侧栏最多到 `syncMaxItems`  

---

### 9. 设置

打开方式：**Sessions** 齿轮，或 **Agent Resume: Open Settings**。  
也可在 VS Code Settings 中搜索 `Agent Resume`。

| 分类 | 主要项 |
|------|--------|
| 列表 | `maxItems`、`catalog.syncMaxItems`、`catalog.sidebarMode`、`catalog.stalePolicy`、`catalog.dbPath` |
| 路径 | `panelHome`、`codexHome`、`claudeHome`、`antigravityHome`、`grokHome`、`opencodeHome`、`piHome`、`almaDataDir` |
| 恢复 | `claudeResumeMode`、`codexResumeMode`、`codexIdePanelResume.*`、`terminalLocation`、`editorNewSessionProvider` |
| Ghostty | `ghosttyExecutable`、`ghosttyLaunchMode` |
| 过滤 | `showArchivedCodex`、`showSubagentCodex`、`showArchivedOpenCode`、`showSubagentGrok`、`hideCronAlma`、`hideChannelAlma`、`showIncognitoAlma` |
| ACP | `acp.autoApprovePermissions`、`acp.agents.<provider>.command/args` |
| LLM / Handoff | `llm.*`、`handoff.*` |
| 菜单 | `projectMenu.*`、`sessionMenu.*`（推荐在 Settings Webview 拖拽） |
| 界面 | `uiLanguage`（`auto` 或 10 种语言） |

就地升级扩展后，若菜单/配置异常：执行 **Developer: Reload Window**（侧栏 Refresh **不能**替代）。

---

### 10. 联系

问题或建议：[lucas.zeus.ai@gmail.com](mailto:lucas.zeus.ai@gmail.com)

---

## English

**Contents**

1. [Overview](#1-overview)
2. [Quick start](#2-quick-start)
3. [Four sidebar views](#3-four-sidebar-views)
4. [Session & project actions](#4-session--project-actions)
5. [Search, Session Manager & backup](#5-search-session-manager--backup)
6. [LLM Assist & handoff](#6-llm-assist--handoff)
7. [Resume targets & external tools](#7-resume-targets--external-tools)
8. [Data & storage (local-first)](#8-data--storage-local-first)
9. [Settings](#9-settings)
10. [Contact](#10-contact)

> **No cloud · pure local storage**  
> **This extension has no cloud backend, accounts, or remote database.** Panel data is stored only on your machine.  
> Default directory: **`~/.agent-resume-panel`** (`agentResume.panelHome`) — `catalog.db`, `notes/`, `acp/`.  
> Full CLI transcripts stay in each agent’s **local** native folders. Back up by copying those folders yourself.  
> Optional LLM Assist only contacts a **third-party API you configure**; the extension itself still has no cloud service.

### 1. Overview

| Area | What it does |
|------|----------------|
| **Sessions** | Browse CLI history (Recent / Favorites / Projects) and resume |
| **ACP Chats** | Live chat beside the editor via [ACP](https://agentclientprotocol.com) |
| **GTD** | Tag CLI sessions: `@inbox` / `@next` / `@waiting` / `@someday` / `@reference` |
| **Notes** | **Multiple** Markdown notes per session/project; real files + assets |
| **Search / Manager** | Filter by project, GTD, provider; **Export** backups |
| **LLM Assist** | Summarize, Auto Rename, Handoff Brief (OpenAI-compatible API) |
| **Resume targets** | Integrated terminal, official panels (Claude / experimental Codex), Ghostty, Codex App, Alma |

**Agents:** Codex · Claude Code · Antigravity CLI · Grok Build · OpenCode · Pi · Alma (macOS app)

---

### 2. Quick start

1. Open **Agent Resume** from the Activity Bar.  
2. Use **Sessions**, **ACP Chats**, **GTD**, and **Notes**.  
3. Click a CLI session in **Sessions** to resume.  
4. Refresh via each view’s title bar or **Agent Resume: Refresh** / **Refresh ACP Chats** / **Refresh Notes**.

---

### 3. Four sidebar views

#### 3.1 Sessions

Recent · Favorite Projects · Projects (drag to reorder / favorite).  
Title bar: New Session · Search · Session Manager · Refresh · Settings.  
Hover tooltips may show **Summary**, **Note**, and GTD status.

#### 3.2 ACP Chats

Separate from CLI Sessions. Create via **+** or project **New Chat Session**.  
Supported ACP agents and image upload:

| Agent | Default launch | Images |
|-------|----------------|--------|
| Codex | `npx -y @zed-industries/codex-acp@latest` | Yes |
| Claude | `npx -y @agentclientprotocol/claude-agent-acp@latest` | Yes |
| Grok Build | local `grok agent stdio` | — |
| OpenCode | `npx -y opencode-ai@latest acp` | Yes |
| Pi | `npx -y pi-acp` | Yes |

Use the local [Grok CLI](https://x.ai/cli); **do not** use `@xai-official/grok@latest`.

#### 3.3 GTD

CLI sessions only (not ACP). One bucket per session.  
Stored in `catalog.db` → `session_gtd`. Filterable in Search / Session Manager.

#### 3.4 Notes

Multiple Markdown notes per session or project. **Disk is authoritative**; Catalog holds the index only.

- Tree: **Projects** / **Sessions** → notes  
- Toolbar: Filter · New · **Import Markdown…** · Refresh · Open Notes Folder  
- Note menu: Open · **Rename** (syncs assets + relative links) · Delete · Reveal · Copy path  
- **Bulk import**: multi-select `.md` files or a folder (top-level `.md` only); copies into the chosen project/session; renames on conflict (`-2`, `-3`); copies sibling `{stem}.assets/` when present. Local copy only—source files unchanged.  
- Default name: `YYYY-MM-DD-NN.md`; assets: `{stem}.assets/`  
- **Insert Image into Note** copies into assets and inserts a relative link  
- Openable in Finder / Obsidian / Typora, etc.  
- **Open Note…**: create if none / open one / QuickPick many  
- Upgrade from 2.5.x: one-time migrate from legacy `session_notes` / `project_notes`; those tables are unused afterward  

```text
~/.agent-resume-panel/
  catalog.db
  notes/projects|sessions/...
  acp/
```

---

### 4. Session & project actions

**Sessions (selection):** Preview · Rename · Remove from Panel · Resume · Copy command · Open folder · Ghostty / Claude panel / Codex panel / Codex App · Handoff · GTD · Notes  

**Projects:** New CLI / ACP / Alma / Codex App sessions · Alias · Project notes · Sort Sessions  

**Editor title bar:** one-click new session via `editorNewSessionProvider`.

Customize menus under **Agent Resume Settings → Session Menu / Project Menu**.

---

### 5. Search, Session Manager & backup

- **Search Sessions** — project + GTD chips, text filter, row Preview/Rename/Remove  
- **Session Manager** — large-list browse + **Export** (`manifest.json` + native transcripts). ACP chats not exported.  
- **Backup:** Export + full `panelHome` (`catalog.db` + `notes/` + `acp/`) + optional agent homes  

Database-only backup does **not** include note bodies.

---

### 6. LLM Assist & handoff

Configure under **Settings → LLM Assist**.

| Feature | Role |
|---------|------|
| Summarize | Stored in catalog; tooltip **Summary** |
| Auto Rename | Writes title to native storage |
| Handoff | Brief + deliver to another agent |

---

### 7. Resume targets & external tools

- **Claude panel:** `claudeResumeMode` = `panel` | `terminal`  
- **Codex panel (experimental):** `codexResumeMode` + kill switch `codexIdePanelResume.enabled`  
- **Ghostty:** paste/copy modes; may need macOS accessibility  
- **Alma:** local API + Accessibility; resume via title search; **New Alma Thread** sets workspace then `Cmd+N`  

---

### 8. Data & storage (no cloud · pure local)

**This plugin has no cloud.** All panel data is pure local storage under **`~/.agent-resume-panel`** by default. There is no extension-operated server, cloud sync, or account system. Copy that folder (plus agent native homes if needed) to back up.

| What | Where |
|------|--------|
| CLI metadata, GTD, aliases, summaries, note **index** | `~/.agent-resume-panel/catalog.db` |
| Full transcripts | Agent native homes (not copied into SQLite) |
| Note bodies & assets | `~/.agent-resume-panel/notes/**` |
| ACP data | `~/.agent-resume-panel/acp/**` |
| Legacy `session_notes` / `project_notes` | Migration source only |

Refresh reconciles catalog with agents and notes with disk. Remove from Panel only sets `hidden`.

---

### 9. Settings

Open via the **Sessions** gear or **Agent Resume: Open Settings**.

Highlights: data paths, resume modes, terminal, Ghostty, Alma filters, ACP agent commands, LLM/Handoff, project/session menus, `uiLanguage`.

After an in-place extension upgrade, run **Developer: Reload Window** so `package.json` contributions apply (sidebar Refresh is not enough).

---

### 10. Contact

[lucas.zeus.ai@gmail.com](mailto:lucas.zeus.ai@gmail.com)

---

## License

MIT
