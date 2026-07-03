# Agent Resume Panel

Languages: [简体中文](#简体中文) | [English](#english)

## 简体中文

**本页结构**：[第一部分：概览](#第一部分概览) · [第二部分：插件说明](#第二部分插件说明)

### 第一部分：概览

Agent Resume Panel 是一个 VS Code 侧边栏扩展，用来集中浏览、搜索和恢复 Codex、Claude Code、Antigravity CLI、Grok Build、OpenCode、Pi、Alma 的历史会话，并在编辑器旁通过 **ACP Chat** 直接与 Agent 对话。

适合这些场景：

- 在 VS Code 内用 ACP Chat 与 Codex、Claude、Grok、OpenCode、Pi 实时对话（支持图片上传）。
- 快速回到最近一次 AI 编程会话。
- 同时使用多个 CLI / 桌面 Agent，并希望统一管理。
- 按项目查看历史会话，收藏常用项目，并直接在对应项目里继续工作。
- 在搜索面板里按项目筛选，再快速定位某个会话。
- 重命名会话标题，并写回各 Agent 的原生存储（其他终端 resume 时也会看到新名称）。
- 需要在 Claude Code 或 Codex 官方 VS Code 插件面板中继续会话（Codex 面板恢复为实验性功能）。
- 需要用 Ghostty 或 Codex App 接着打开已有会话。
- 在 Alma 桌面客户端中按项目打开新对话。
- 在编辑器右上角一键新建预设类型的 Agent 会话。
- 将 Catalog 中的**全部 CLI 历史会话**（含元数据与各 Agent 原生存储中的完整对话）一次性导出到本地文件夹，便于备份或迁移。
- 将当前 CLI 或 ACP 会话**转交给其他 Agent** 继续（LLM 生成 Handoff Brief，CLI 走终端、ACP 走 ACP Chat）。

### 快速开始

1. 在 VS Code 左侧活动栏打开 **Agent Resume**。
2. **Sessions** 视图用于浏览和恢复各 Agent 的 CLI 历史会话；**ACP Chats** 视图单独列出基于 ACP 的聊天会话（见下方 [ACP Chat](#acp-chat)）。
3. 在 **Sessions** 中点击某个会话即可恢复。恢复位置取决于 Agent 类型与设置：Claude / Codex 可进入官方插件面板，也可走集成终端；Alma 在 Alma 客户端中打开。
4. 如果列表没有更新，点击对应视图标题栏的刷新按钮，或运行 **Agent Resume: Refresh** / **Refresh ACP Chats**。

默认情况下，Codex 等终端类 Agent 会在编辑器旁边打开集成终端；可将 Claude / Codex 的默认恢复方式改为官方插件面板（见下方设置）。

### 常用操作

在 **Sessions** 列表中点击会话，或右键会话选择：

- **Preview Session**：只读浏览 User/Assistant 对话，不恢复会话。
- **Rename Session**：重命名会话标题，并写入对应 Agent 的原生存储（Codex、Claude、Antigravity、Grok、OpenCode、Pi、Alma 均支持）。
- **Remove from Panel**：仅从扩展面板与 Catalog 索引中隐藏该会话，不删除 Agent 原生存储（见 [第二部分：插件说明](#第二部分插件说明)）。
- **Resume Session**：按当前设置的默认方式恢复（Alma 除外）。
- **Copy Resume Command**：复制恢复命令。
- **Open Folder and Resume**：打开会话所属项目，并在新窗口中恢复。
- **Open in Ghostty**：用 Ghostty 打开并恢复会话。
- **Resume in Claude Code Panel**：在 Claude Code 插件面板中恢复（需已安装 `anthropic.claude-code`）。
- **Resume in Codex IDE Panel (Experimental)**：尝试在 Codex 插件面板中恢复（需已安装 `openai.chatgpt`，见下方说明）。
- **Resume in Codex App**：将 Codex 会话交给 Codex App 继续。
- **Hand Off to Another Agent**：子菜单选择目标 Agent，生成 Handoff Brief 并转交（CLI session → CLI 终端；ACP Chat → ACP Chat）。需已配置 **LLM Assist**；当前 Agent 不会出现在子菜单中。

在 **Preview Session** 面板或搜索预览中，还可使用 **Resume** / **Resume with…** 选择集成终端、Ghostty、Claude Code Panel、Codex IDE Panel（实验性）或 Codex App。若已在 **Agent Resume Settings → LLM Assist** 配置 API，还可使用 **Summarize** 生成会话摘要（显示在对话上方）、**Auto Rename** 由 AI 建议标题并写回原生存储，以及 **Hand Off to…** 将上下文转交给其他 Agent。

**Summarize** 结果自 2.1.1 起写入 Session Catalog（`catalog.db` 的 `session_summary` 等字段），不再仅存于扩展内部状态。在 **Sessions** 侧边栏列表中**悬停**某条会话时，若存在与当前输出语言匹配的摘要，会在 tooltip 中显示 **Summary** 区块。

Alma 会话支持 **Rename Session**；其余终端类操作请直接点击会话。点击 Alma 会话会在 Alma 客户端中尝试切换到对应对话（通过标题搜索，可能不完全精准）。若 Agent 正在运行并锁住数据库，重命名可能失败，请先关闭对应 Agent 后重试。

项目分组支持右键操作：

- **Open Folder and Resume**：选择该项目下的历史会话并恢复。
- **Open in Ghostty**：选择会话后在 Ghostty 中恢复。
- **New Codex Session**、**New Claude Session**、**New Antigravity Session**、**New Grok Session**、**New OpenCode Session**、**New Pi Session**：在该项目中新建对应 Agent 会话。
- **New Codex App Session**：用 Codex App 打开该项目。
- **New Alma Thread**：在 Alma 中打开新对话，并将工作区目录设为该项目（见下方 Alma 说明）。
- **Show More**：未勾选为主菜单的项会收纳在此子菜单中。

可通过 **Agent Resume Settings → Project Menu**（或运行 **Customize Project Menu** / 在 **Show More** 中点击 **Customize Project Menu**）自定义项目右键菜单：勾选要在主菜单显示的项，**拖动**调整顺序，然后点击 **Save**。**Open Folder** 始终显示在顶部。

### 新建和搜索

在 **Sessions** 视图右上角点击加号，或运行 **Agent Resume: New Session**，可以从当前 VS Code 工作区新建 Codex、Claude、Antigravity CLI、Grok Build、OpenCode、Pi 或 Codex App 会话。Alma 不在全局新建列表中，请通过项目右键 **New Alma Thread** 创建。

运行 **Agent Resume: Search Sessions** 会打开专用搜索面板：

- 顶部是 **Projects** 按钮区：点击 `All Projects` 或某个项目，先按项目做初步筛选；收藏项目会带星标。
- 下方是独立的 **Sessions** 列表：在已选项目范围内继续输入关键字，按标题、provider、分支（未选项目时也匹配路径）过滤。
- 点击某条会话即可恢复；行尾的 **Preview**、**Rename**、**Remove** 可分别预览、重命名或从面板移除，面板保持打开。

侧边栏还支持将项目拖入 **Favorite Projects**、调整 Recent / Favorites / Projects 分区顺序。

### 导出全部会话

通过 **Session Manager** 可导出会话（侧边栏 **Sessions** 标题栏的数据库图标，或 **Agent Resume: Session Manager**）：

1. 打开面板后，可先点 **Refresh** 与侧边栏刷新同步，确保 Catalog 已收录各 Agent 的最新会话（受 `agentResume.catalog.syncMaxItems` 上限约束）。
2. 保持搜索框为空、时间筛选为 **All**，并勾选要包含的 **Provider**（默认全部），列表即当前 Catalog 中的全部可见会话（不含已从面板移除的 `hidden` 会话）。
3. 不勾选任何行，直接点击 **Export**，选择目标文件夹；扩展会创建带时间戳的子目录，写入 `manifest.json`，并从各 Agent **原生存储**读取 transcript 复制到 `sessions/` 下（可按 provider 筛选或勾选部分行，只导出选中会话；表头 **全选** 后再 **Export** 则导出当前筛选结果中的全部）。

导出范围覆盖 Codex、Claude、Antigravity、Grok、OpenCode、Pi、Alma 等已同步进 Catalog 的 CLI 会话；**ACP Chats** 不在此导出范围内。更多存储细节见 [第二部分：插件说明](#第二部分插件说明)。

### 编辑器标题栏快捷新建

打开任意编辑器标签页时，编辑器右上角工具栏（Split Editor 旁）会常驻显示 **Agent Resume** 图标，行为类似 Claude Code 的 Spark 按钮。

- 点击图标即可一键新建会话，无需每次选择 Agent 类型。
- 使用哪种 Agent 由设置项 `agentResume.editorNewSessionProvider` 决定，可选 Codex、Claude、Antigravity CLI、Grok Build、OpenCode、Pi（默认 Codex）。
- 项目目录优先取当前打开文件所在的 workspace 根目录；若没有可用的活动文件，则回退到工作区选择逻辑（单根工作区直接使用，多根工作区弹出选择）。
- 新建会话会在 `agentResume.terminalLocation` 配置的位置打开集成终端（默认在编辑器旁边）。

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

### ACP Chat

除侧边栏浏览/恢复各 Agent 的 CLI 历史会话外，扩展还提供基于 [Agent Client Protocol (ACP)](https://agentclientprotocol.com) 的 **ACP Chat**：在 VS Code 编辑器旁打开聊天面板，直接与 Agent 对话。

**新建与打开**

- 切换到 **ACP Chats** 视图，点击标题栏 **+**（**New ACP Chat**）从当前工作区新建；或在 **By Project** 下右键项目选择 **New Chat Session**，再选择 Agent 类型。
- **Sessions** 视图的项目右键菜单仍保留 **New Chat Session**（新建后会出现在 **ACP Chats** 中）。
- 在 **ACP Chats** 中点击会话即可重新打开对应聊天面板；右键可 **Rename ACP Chat**，或通过 **Hand Off to Another Agent** 转交给其他 ACP Agent。
- **Sessions** 与搜索面板不再显示 ACP 聊天条目，避免与 CLI 历史混在一起。

**支持的 Agent**

| Agent | 默认启动方式 |
|-------|-------------|
| Codex | `npx -y @zed-industries/codex-acp@latest` |
| Claude | `npx -y @agentclientprotocol/claude-agent-acp@latest` |
| Grok Build | 本机 `grok agent stdio` |
| OpenCode | `npx -y opencode-ai@latest acp` |
| Pi | `npx -y pi-acp` |

**图片上传**

| Agent | 图片上传 |
|-------|----------|
| Codex | 支持 |
| Claude | 支持 |
| OpenCode | 支持 |
| Pi | 支持 |
| Grok Build | 不支持 |

在支持图片的 Agent 对话中，可使用输入框左侧 **附件** 按钮选图，或 **Ctrl/Cmd+V** 粘贴剪贴板图片；每条消息最多 4 张、单张最大 5 MB（PNG / JPEG / WebP / GIF）。可附带文字说明，也可只发图片。

**Grok Build 说明**

Grok 默认使用本机已安装的 [Grok Build CLI](https://x.ai/cli)（`grok agent stdio`），本地升级 Grok 后无需更新扩展。安装示例：

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
```

请确保 `grok` 在 PATH 中（官方安装脚本通常会写入 `~/.grok/bin`）。若连接失败，可先运行 `grok agent stdio --reauth` 检查登录状态。

> **不要用 `@xai-official/grok@latest`。** npm 的 `latest` 标签目前指向 0.1.x（无 `agent` 子命令），会导致 `ACP connection closed`。未安装本机 CLI 时，可在设置中改为 `npx` + `@xai-official/grok@0.2`（主版本范围，非 `latest`）。

ACP Chat 相关设置：

- **Agent Resume Settings → ACP Chat**（**ACP Chats** 标题栏齿轮 **ACP Chat Settings**，或 **Agent Resume: Open Settings**）：推荐在此配置 ACP 数据目录、权限处理、各 Agent 启动命令与参数。
- 也可在 VS Code Settings 中搜索 `agentResume.acp` 或 `agentResume.panelHome` 直接编辑。

### 在官方插件面板中恢复

#### Claude Code

- 安装 [Claude Code for VS Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code)。
- 设置 `agentResume.claudeResumeMode` 为 `panel`（默认）时，点击 Claude 会话会在插件面板中恢复；设为 `terminal` 则走集成终端 CLI。
- 也可通过右键 **Resume in Claude Code Panel** 或 **Resume with…** 显式选择。

#### Codex（实验性）

- 安装 [Codex – OpenAI's coding agent](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt)。
- 设置 `agentResume.codexResumeMode` 为 `panel` 时，点击 Codex 会话会尝试在插件面板中恢复；默认 `terminal` 走集成终端，`app` 走 Codex App。
- 也可通过右键 **Resume in Codex IDE Panel (Experimental)** 或 **Resume with…** 显式选择。

Codex 面板恢复依赖未公开的内部路由，**可能随 Codex 插件更新而失效**。若出现问题：

1. 将 `agentResume.codexIdePanelResume.enabled` 设为 `false`，立即停用面板恢复。
2. 等待扩展更新，或在我们修复后对齐 `agentResume.codexIdePanelResume.implementationVersion` 与新版集成。

首次使用会提示实验性警告。跨项目恢复时，扩展会先打开对应文件夹，再在新窗口中继续面板恢复。

### Ghostty

当你需要 Ghostty 的图片上传、图片显示或其他终端能力时，可以使用 **Open in Ghostty**。

macOS 上第一次自动粘贴命令时，系统可能会要求授予 VS Code 自动化或辅助功能权限。默认行为是打开 Ghostty、复制恢复命令、自动粘贴并回车。如果你更喜欢手动操作，可以把 `agentResume.ghosttyLaunchMode` 设置为 `copyCommand`。

### Agent Resume Settings

点击 **Sessions** 视图标题栏的齿轮图标，或运行 **Agent Resume: Open Settings**，打开 **Agent Resume Settings** Webview。除 Data Paths、Resume、Terminal、LLM Assist、**Handoff** 等常规项外，左侧导航还有 **Project Menu**、**Session Menu** 等分区，用于配置项目与会话右键菜单的显示项与顺序。

### 常用设置

在 VS Code Settings 中搜索 `Agent Resume` 可以调整：

- `agentResume.maxItems`：列表最多加载多少条会话。
- `agentResume.editorNewSessionProvider`：编辑器标题栏快捷新建按钮使用的 Agent 类型。
- `agentResume.terminalLocation`：终端打开在编辑器旁边还是底部面板。
- `agentResume.claudeResumeMode`：Claude 默认恢复方式（`panel` 插件面板 / `terminal` 集成终端）。
- `agentResume.codexResumeMode`：Codex 默认恢复方式（`terminal` / `panel` 插件面板 / `app` Codex App）。
- `agentResume.codexIdePanelResume.enabled`：是否启用 Codex 插件面板恢复（实验性总开关）。
- `agentResume.codexIdePanelResume.implementationVersion`：Codex 面板集成版本号；与扩展内置版本不一致时会自动阻止面板恢复。
- `agentResume.showArchivedCodex`：是否显示已归档的 Codex 会话。
- `agentResume.ghosttyLaunchMode`：Ghostty 打开会话时的命令处理方式。
- `agentResume.ghosttyExecutable`：Ghostty 应用名或可执行文件路径。
- `agentResume.grokHome`：Grok Build 数据目录（默认 `~/.grok`）。
- `agentResume.showSubagentGrok`：是否显示 Grok 子 Agent 会话。
- `agentResume.panelHome`：ACP Chat 会话数据目录（默认 `~/.agent-resume-panel`）。
- `agentResume.acp.autoApprovePermissions`：ACP Chat 权限请求处理方式（`ask` / `allowAll`）。
- `agentResume.acp.agents.grok.command` / `.args`：Grok ACP 启动命令（默认 `grok` + `agent stdio`，使用本机 CLI）。
- `agentResume.acp.agents.<provider>.command` / `.args`：其他 ACP Agent 的启动命令与参数。
- `agentResume.opencodeHome`：OpenCode 数据目录（默认 `~/.local/share/opencode`）。
- `agentResume.showArchivedOpenCode`：是否显示已归档的 OpenCode 会话。
- `agentResume.piHome`：Pi 数据目录（默认 `~/.pi/agent`）。
- `agentResume.almaDataDir`：Alma 数据目录（macOS 默认 `~/Library/Application Support/alma`）。
- `agentResume.hideCronAlma`：隐藏 Alma Cron 会话。
- `agentResume.hideChannelAlma`：隐藏 Alma 频道会话。
- `agentResume.showIncognitoAlma`：显示 Alma 隐身模式会话。
- `agentResume.handoff.attachRecentVerbatim`：Handoff Brief 后附加最近几轮原文（默认 5；0 表示不附加）。
- `agentResume.handoff.maxBriefTokens`：Handoff Brief 的 LLM 输出 token 上限（默认 2500）。
- `agentResume.projectMenu.mainActions`：显示在项目右键主菜单中的操作（数组顺序即显示顺序）。
- `agentResume.projectMenu.itemOrder`：全部可配置项目菜单项的完整顺序（含 **Show More** 中的项）。推荐在 **Agent Resume Settings → Project Menu** 中拖动排序，无需手改 JSON。
- `agentResume.sessionMenu.mainActions` / `agentResume.sessionMenu.itemOrder`：会话右键主菜单与 **Show More** 的显示项与顺序（推荐在 **Session Menu** 设置页拖动配置）。
- `agentResume.catalog.dbPath`：Session Catalog 的 SQLite 数据库路径（留空则 `<panelHome>/catalog.db`）。
- `agentResume.catalog.syncMaxItems`：每次同步写入 Catalog 的会话数量上限。
- `agentResume.catalog.stalePolicy`：Agent 存储中已消失的会话在 Catalog 中的处理方式（`hide` / `purge`）。
- `agentResume.catalog.sidebarMode`：侧边栏展示上限（`legacy` 沿用 `maxItems`，`full` 至多 `syncMaxItems`）。

如果你的 Codex、Claude Code、Antigravity、OpenCode 或 Pi 数据目录不是默认位置，也可以在设置里调整对应的 home 路径。

### 第二部分：插件说明

本节说明 2.1.0 起 CLI 会话在扩展内部的索引与管理方式，便于备份、排查与理解「从面板移除」等行为。

#### Session Catalog（SQLite）

扩展对 **CLI 历史会话的目录与面板状态** 使用本地 **SQLite** 数据库（**Session Catalog**）作为统一真相源，扩展启动后始终维护该 Catalog（无需单独开关）。

- **默认路径**：`~/.agent-resume-panel/catalog.db`（与 ACP 数据同属 `agentResume.panelHome`）；可用 `agentResume.catalog.dbPath` 覆盖。
- **存储分工（重要）**：
  - **Catalog（SQLite）**：会话元数据（provider、项目路径、时间、分支等）、面板侧字段（如 `user_title`、LLM **Summarize** 摘要 `session_summary` / `session_summary_language`、从面板移除时的 `hidden` 标记），以及指向各 Agent 原生存储中 transcript 的**引用**（`transcript_kind` / `transcript_refs`）。
  - **Agent 原生存储**：对话正文与各 Agent 自己的 session 文件**仍在原位置**；扩展**不复制** transcript，也**不创建**操作系统级软链接。预览、恢复、Session Manager 导出时按需读取原生文件。
- **入站同步**：运行 **Refresh** 或打开面板时，从 Codex、Claude、Antigravity、Grok、OpenCode、Pi、Alma 等数据目录加载会话并 UPSERT 到 Catalog。同步**不会**因冲突而把已「从面板移除」的会话自动恢复为可见（不会对 `hidden` 强行置回显示）。
- **出站操作**：**Rename** 更新 Catalog 并调用各 Provider 的 `renameSession()` 写回原生存储；**Remove from Panel** 仅将 Catalog 中 `hidden=1`，不删除 Agent 侧文件。
- **ACP Chats** 使用独立目录（`panelHome` 下 ACP 会话数据），**不纳入** Session Catalog。

#### Session Manager

在 **Sessions** 标题栏点击 **Session Manager**（数据库图标），或运行 **Agent Resume: Session Manager**，可打开 Webview 管理大量历史会话（筛选、浏览、批量处理）。

**Export** 仅在此面板提供：导出 Catalog 中的会话元数据（`manifest.json`），并在导出时从各 Agent 原生存储读取完整对话写入 `sessions/`（引用式读取，非事先在库内存全文）。未勾选列表项时 **Export** 表示导出**当前筛选条件下的全部会话**；在默认筛选下即为 Catalog 内全部可见 CLI 会话（至多 `syncMaxItems`），实现「导出所有 session」的备份能力。已从面板移除（`hidden`）的条目默认不包含在导出 SQL 中。

#### 项目内会话排序

右键 **项目** 分组或 **会话** 项，通过 **Sort Sessions** 子菜单按更新时间或标题升/降序排列该项目下的会话；排序模式按项目路径记忆。

#### 与侧边栏条数限制的关系

- `agentResume.catalog.sidebarMode` 为 `legacy`（默认）时，侧边栏树仍受 `agentResume.maxItems` 约束，但 Catalog 可同步更多条供 **Session Manager** 与 **Search Sessions** 使用。
- 设为 `full` 时，侧边栏最多可展示至 `syncMaxItems`（仍来自 Catalog 且尊重 `hidden`）。

### 联系

如有问题或建议，请联系：[lucas.zeus.ai@gmail.com](mailto:lucas.zeus.ai@gmail.com)

## English

**On this page**：[Part 1: Overview](#part-1-overview) · [Part 2: Plugin Guide](#part-2-plugin-guide)

### Part 1: Overview

Agent Resume Panel is a VS Code sidebar extension for browsing, searching, and resuming Codex, Claude Code, Antigravity CLI, Grok Build, OpenCode, Pi, and Alma sessions in one place — plus **ACP Chat** for talking to agents directly beside the editor.

Best for:

- Real-time conversations in VS Code via ACP Chat with Codex, Claude, Grok, OpenCode, and Pi (image upload supported).
- Jumping back into a recent AI coding session.
- Managing sessions from multiple CLI and desktop agents in one list.
- Browsing sessions by project, favoriting frequent projects, and continuing in the right workspace.
- Filtering by project in the search panel, then narrowing down to a specific session.
- Renaming session titles in each agent's native storage so other terminals see the new name too.
- Resuming in the Claude Code or Codex official VS Code extension panels (Codex panel resume is experimental).
- Continuing an existing session in Ghostty or Codex App when needed.
- Starting a new Alma chat scoped to a project directory.
- Starting a preset agent session from the editor title bar in one click.
- Exporting **all CLI sessions** in the catalog at once (metadata plus full transcripts read from each agent's native storage) to a local folder for backup or migration.
- **Handing off** the current CLI or ACP session to another agent (LLM-generated handoff brief; CLI sources use the terminal, ACP sources use ACP Chat).

### Quick Start

1. Open **Agent Resume** from the VS Code Activity Bar.
2. Use **Sessions** to browse and resume CLI history; use **ACP Chats** for ACP-based chat sessions (see [ACP Chat](#acp-chat) below).
3. In **Sessions**, click a session to resume it. Where it opens depends on the agent and settings: Claude / Codex can use the official extension panel or the integrated terminal; Alma opens in the Alma desktop app.
4. If a list is stale, use that view's refresh button, or run **Agent Resume: Refresh** / **Refresh ACP Chats**.

By default, Codex and other terminal agents resume in an integrated terminal beside the editor. You can switch Claude / Codex defaults to the official extension panel in Settings (below).

### Common Actions

Click a session in **Sessions**, or right-click it and choose:

- **Preview Session**: Read User/Assistant messages without resuming the session.
- **Rename Session**: Rename the title and write it back to the agent's native storage (Codex, Claude, Antigravity, Grok, OpenCode, Pi, and Alma).
- **Remove from Panel**: Hide the session from the extension sidebar and catalog only; does not delete the agent's native session files (see [Part 2: Plugin Guide](#part-2-plugin-guide)).
- **Resume Session**: Resume using the configured default (see **Extension panel resume** below).
- **Copy Resume Command**: Copy the resume command.
- **Open Folder and Resume**: Open the session's project and resume in a new window.
- **Open in Ghostty**: Open and resume in Ghostty.
- **Resume in Claude Code Panel**: Resume a Claude session in the Claude Code VS Code extension panel.
- **Resume in Codex IDE Panel (Experimental)**: Try resuming a Codex session in the Codex VS Code extension panel (experimental; can be disabled instantly).
- **Resume in Codex App**: Continue a Codex session in Codex App.
- **Hand Off to Another Agent**: Submenu to pick a target agent, generate a handoff brief, and deliver it (CLI session → CLI terminal; ACP chat → ACP Chat). Requires **LLM Assist**; the current agent is hidden from the submenu.

The preview panel and search panel also offer **Resume** and **Resume with…** (integrated terminal, Ghostty, Claude Code Panel, Codex IDE Panel, Codex App, and more). With **LLM Assist** configured under **Agent Resume Settings**, you can **Summarize** the session (shown above messages), **Auto Rename** via AI title suggestion written back to native storage, or **Hand Off to…** to continue with another agent.

As of 2.1.1, **Summarize** results are stored in the Session Catalog (`session_summary` and related columns in `catalog.db`), not only in extension-internal state. **Hover** a session in the **Sessions** sidebar to see a **Summary** block in the tooltip when a summary exists for the current output language.

Alma sessions support **Rename Session**; use a click to resume in the Alma app. Clicking an Alma session tries to switch Alma to that thread via title search, which may not be exact. Rename can fail if the agent holds a database lock—close the agent and try again.

Project groups support these right-click actions:

- **Open Folder and Resume**: Pick a session from the project and resume it.
- **Open in Ghostty**: Pick a session and resume it in Ghostty.
- **New Codex Session**, **New Claude Session**, **New Antigravity Session**, **New Grok Session**, **New OpenCode Session**, **New Pi Session**: Start a new agent session in that project.
- **New Codex App Session**: Open the project with Codex App.
- **New Alma Thread**: Open a new Alma chat with the project workspace directory (see Alma below).
- **Show More**: Actions not pinned to the main menu appear in this submenu.

Customize the project context menu in **Agent Resume Settings → Project Menu** (or run **Customize Project Menu** / use **Customize Project Menu** under **Show More**): check items for the main menu, **drag** to reorder, then click **Save**. **Open Folder** always stays at the top.

### New and Search

Click the plus button in the **Sessions** title bar, or run **Agent Resume: New Session**, to start a Codex, Claude, Antigravity CLI, Grok Build, OpenCode, Pi, or Codex App session from the current VS Code workspace. Alma is not in the global new-session picker; use **New Alma Thread** on a project instead.

Run **Agent Resume: Search Sessions** to open a dedicated search panel:

- **Projects** chip buttons at the top: click **All Projects** or a project to filter first; favorited projects show a star.
- A separate **Sessions** list below: type to filter by title, provider, branch, or path (when no project is selected).
- Click a session row to resume; use **Preview**, **Rename**, or **Remove** on each row to preview, rename, or hide from the panel without closing the search panel.

The sidebar also supports dragging projects into **Favorite Projects** and reordering the Recent / Favorites / Projects sections.

### Export all sessions

Use **Session Manager** (**Sessions** title bar database icon, or **Agent Resume: Session Manager**):

1. Optionally click **Refresh** (or refresh the sidebar first) so the catalog includes the latest sessions from each agent (capped by `agentResume.catalog.syncMaxItems`).
2. Leave the search box empty, set the age filter to **All**, and enable every **Provider** you want (all are on by default). The list is then every visible catalog row (sessions removed from the panel via `hidden` are excluded).
3. Click **Export** without selecting rows and pick a folder. The extension creates a timestamped subdirectory with `manifest.json` and copies transcripts from native agent storage under `sessions/`. You can also select specific rows, or use the header **select all** checkbox and **Export** to dump everything matching the current filters.

This covers CLI sessions synced into the catalog (Codex, Claude, Antigravity, Grok, OpenCode, Pi, Alma, etc.). **ACP Chats** are not included. See [Part 2: Plugin Guide](#part-2-plugin-guide) for storage details.

### Editor Title Bar Shortcut

When any editor tab is open, an **Agent Resume** icon stays visible in the editor toolbar (next to Split Editor), similar to the Claude Code Spark button.

- Click the icon to start a new session in one step without choosing the agent type each time.
- The agent is controlled by `agentResume.editorNewSessionProvider`: Codex, Claude, Antigravity CLI, Grok Build, OpenCode, or Pi (default: Codex).
- The project directory prefers the workspace root of the currently open file. If no suitable active file is available, it falls back to workspace selection (single-root workspaces are used directly; multi-root workspaces show a picker).
- The new session opens in the integrated terminal location from `agentResume.terminalLocation` (default: beside the editor).

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

### ACP Chat

Besides browsing and resuming CLI history in the sidebar, the extension includes **ACP Chat** powered by the [Agent Client Protocol (ACP)](https://agentclientprotocol.com): a chat panel beside the editor for talking to an agent directly.

**Create and open**

- Switch to **ACP Chats** and click **+** (**New ACP Chat**) to start from the current workspace, or right-click a project under **By Project** and choose **New Chat Session**, then pick an agent type.
- **Sessions** project menus still offer **New Chat Session**; new chats appear in **ACP Chats**.
- Click a chat in **ACP Chats** to reopen its panel; right-click to **Rename ACP Chat** or use **Hand Off to Another Agent** to continue with another ACP agent.
- **Sessions** and the search panel no longer list ACP chats, keeping CLI history separate.

**Supported agents**

| Agent | Default launch |
|-------|----------------|
| Codex | `npx -y @zed-industries/codex-acp@latest` |
| Claude | `npx -y @agentclientprotocol/claude-agent-acp@latest` |
| Grok Build | local `grok agent stdio` |
| OpenCode | `npx -y opencode-ai@latest acp` |
| Pi | `npx -y pi-acp` |

**Image upload**

| Agent | Images |
|-------|--------|
| Codex | Yes |
| Claude | Yes |
| OpenCode | Yes |
| Pi | Yes |
| Grok Build | No |

In chats with image-capable agents, use the **attach** button beside the input or **Ctrl/Cmd+V** to paste from the clipboard. Up to 4 images per message, 5 MB each (PNG / JPEG / WebP / GIF). Add a caption or send images only.

**Grok Build notes**

Grok defaults to your locally installed [Grok Build CLI](https://x.ai/cli) (`grok agent stdio`). When you upgrade Grok locally, the extension picks up the new version automatically. Install example:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
```

Make sure `grok` is on your PATH (the official installer usually adds `~/.grok/bin`). If connection fails, run `grok agent stdio --reauth` to check authentication.

> **Do not use `@xai-official/grok@latest`.** npm's `latest` tag currently points at 0.1.x (no `agent` subcommand), which causes `ACP connection closed`. If you have no local CLI, override in Settings with `npx` and `@xai-official/grok@0.2` (major range, not `latest`).

ACP Chat settings:

- **Agent Resume Settings → ACP Chat** (**ACP Chat Settings** gear on the **ACP Chats** title bar, or **Agent Resume: Open Settings**): configure ACP data directory, permissions, and per-agent launch command/args.
- You can also search `agentResume.acp` or `agentResume.panelHome` in VS Code Settings.

### Extension panel resume

#### Claude Code

- Install [Claude Code for VS Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code).
- With `agentResume.claudeResumeMode` set to `panel` (default), clicking a Claude session resumes in the extension panel; set `terminal` to use the integrated terminal CLI instead.
- You can also pick **Resume in Claude Code Panel** from the context menu or **Resume with…** in the preview panel.

#### Codex (experimental)

- Install [Codex – OpenAI's coding agent](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt).
- With `agentResume.codexResumeMode` set to `panel`, clicking a Codex session tries to resume in the extension panel; default `terminal` uses the integrated terminal, and `app` opens Codex App.
- You can also pick **Resume in Codex IDE Panel (Experimental)** from the context menu or **Resume with…** in the preview panel.

Codex panel resume relies on undocumented internal routing and **may break when the Codex extension updates**. If something goes wrong:

1. Set `agentResume.codexIdePanelResume.enabled` to `false` to disable panel resume immediately.
2. Wait for an extension update, or after we ship a fix, align `agentResume.codexIdePanelResume.implementationVersion` with the new integration.

A one-time experimental warning appears on first use. For cross-project resume, the extension opens the session folder first, then continues panel resume in the new window.

### Ghostty

Use **Open in Ghostty** when you need Ghostty-specific image upload, image display, or terminal behavior.

On macOS, the first automatic paste may require granting VS Code Automation or Accessibility permission. By default, the extension opens Ghostty, copies the resume command, pastes it, and presses Enter. If you prefer manual control, set `agentResume.ghosttyLaunchMode` to `copyCommand`.

### Agent Resume Settings

Click the gear icon on the **Sessions** view title bar, or run **Agent Resume: Open Settings**, to open the **Agent Resume Settings** webview. Besides data paths, resume behavior, terminal, LLM Assist, and **Handoff**, the left nav includes **Project Menu** and **Session Menu** for configuring project and session context menus.

### Settings

Search `Agent Resume` in VS Code Settings to adjust:

- `agentResume.maxItems`: Maximum number of sessions to load.
- `agentResume.editorNewSessionProvider`: Agent type used by the editor title bar new-session button.
- `agentResume.terminalLocation`: Open terminals beside the editor or in the bottom panel.
- `agentResume.claudeResumeMode`: Claude default resume target (`panel` extension panel / `terminal` integrated terminal).
- `agentResume.codexResumeMode`: Codex default resume target (`terminal` / `panel` extension panel / `app` Codex App).
- `agentResume.codexIdePanelResume.enabled`: Enable Codex extension panel resume (experimental kill switch).
- `agentResume.codexIdePanelResume.implementationVersion`: Codex panel integration version; panel resume is blocked when this does not match the built-in version.
- `agentResume.showArchivedCodex`: Show or hide archived Codex sessions.
- `agentResume.ghosttyLaunchMode`: How Ghostty receives the resume command.
- `agentResume.ghosttyExecutable`: Ghostty app name or executable path.
- `agentResume.grokHome`: Grok Build data directory (default `~/.grok`).
- `agentResume.showSubagentGrok`: Show Grok subagent sessions.
- `agentResume.panelHome`: ACP Chat session data directory (default `~/.agent-resume-panel`).
- `agentResume.acp.autoApprovePermissions`: ACP Chat permission handling (`ask` / `allowAll`).
- `agentResume.acp.agents.grok.command` / `.args`: Grok ACP launch (default `grok` + `agent stdio`, local CLI).
- `agentResume.acp.agents.<provider>.command` / `.args`: Launch command and args for other ACP agents.
- `agentResume.opencodeHome`: OpenCode data directory (default `~/.local/share/opencode`).
- `agentResume.showArchivedOpenCode`: Show or hide archived OpenCode sessions.
- `agentResume.piHome`: Pi data directory (default `~/.pi/agent`).
- `agentResume.almaDataDir`: Alma data directory (default `~/Library/Application Support/alma` on macOS).
- `agentResume.hideCronAlma`: Hide Alma cron threads.
- `agentResume.hideChannelAlma`: Hide Alma channel threads.
- `agentResume.showIncognitoAlma`: Show Alma incognito threads.
- `agentResume.handoff.attachRecentVerbatim`: Append recent verbatim turns after the handoff brief (default 5; 0 to disable).
- `agentResume.handoff.maxBriefTokens`: LLM output token limit for the handoff brief (default 2500).
- `agentResume.projectMenu.mainActions`: Actions shown on the main project context menu (array order is display order).
- `agentResume.projectMenu.itemOrder`: Full order of all configurable project menu actions (including items under **Show More**). Prefer dragging in **Agent Resume Settings → Project Menu** instead of editing JSON by hand.
- `agentResume.sessionMenu.mainActions` / `agentResume.sessionMenu.itemOrder`: Session context menu and **Show More** order (configure in **Session Menu** settings).
- `agentResume.catalog.dbPath`: SQLite Session Catalog database path (empty → `<panelHome>/catalog.db`).
- `agentResume.catalog.syncMaxItems`: Upper bound on sessions written per sync pass.
- `agentResume.catalog.stalePolicy`: How catalog rows are handled when a session vanishes from agent storage (`hide` / `purge`).
- `agentResume.catalog.sidebarMode`: Sidebar cap (`legacy` uses `maxItems`, `full` up to `syncMaxItems`).

If your Codex, Claude Code, Antigravity, OpenCode, or Pi data directory is not in the default location, adjust the matching home path in Settings.

### Part 2: Plugin Guide

This section describes how CLI sessions are indexed and managed inside the extension from 2.1.0 onward.

#### Session Catalog (SQLite)

The extension uses a local **SQLite** database (**Session Catalog**) as the source of truth for **CLI session listings and panel-side state**. The catalog is always maintained after activation (no separate enable switch).

- **Default path**: `~/.agent-resume-panel/catalog.db` (under `agentResume.panelHome`, shared with ACP data roots); override with `agentResume.catalog.dbPath`.
- **Storage split (important)**:
  - **Catalog (SQLite)**: Session metadata (provider, project path, timestamps, branch, etc.), panel fields (`user_title`, LLM **Summarize** text in `session_summary` / `session_summary_language`, `hidden` when removed from the panel), and **references** to transcript files in each agent's native storage (`transcript_kind` / `transcript_refs`).
  - **Agent native storage**: Full conversation content and agent-specific session files **stay in place**. The extension does **not** copy transcripts into SQLite and does **not** create OS-level symlinks. Preview, resume, and Session Manager export read native files on demand.
- **Inbound sync**: On **Refresh** or when views load, sessions are loaded from Codex, Claude, Antigravity, Grok, OpenCode, Pi, Alma, and similar homes and UPSERTed into the catalog. Sync does **not** force `hidden` sessions back to visible when agent files still exist.
- **Outbound actions**: **Rename** updates the catalog and calls each provider's `renameSession()` for native storage; **Remove from Panel** sets `hidden=1` in the catalog only.
- **ACP Chats** use a separate store under `panelHome` and are **not** part of the Session Catalog.

#### Session Manager

Use **Session Manager** from the **Sessions** title bar (database icon) or **Agent Resume: Session Manager** to browse and filter large session sets.

**Export** is available only here: it writes catalog metadata (`manifest.json`) and pulls full transcripts from native agent storage into `sessions/` at export time (reference-based, not pre-stored blobs in SQLite). With no rows checked, **Export** dumps **all sessions matching the current filters**; with default filters that is every visible CLI session in the catalog (up to `syncMaxItems`)—i.e. export all sessions for backup. Rows marked `hidden` (removed from the panel) are omitted by default.

#### Sort sessions within a project

Right-click a **project** group or a **session** under it and use **Sort Sessions** to order by updated time or title (ascending/descending). The choice is remembered per project path.

#### Sidebar limits vs catalog

- With `agentResume.catalog.sidebarMode` `legacy` (default), the sidebar tree still respects `agentResume.maxItems`, while the catalog can hold more for **Session Manager** and **Search Sessions**.
- With `full`, the sidebar can show up to `syncMaxItems` catalog rows (still honoring `hidden`).

### Contact

Questions or feedback: [lucas.zeus.ai@gmail.com](mailto:lucas.zeus.ai@gmail.com)

## License

MIT