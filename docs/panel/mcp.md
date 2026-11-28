# Local MCP Server

Languages: [English](#english) | [简体中文](#简体中文)

Expose your local **Agent Resume Panel** notes, GTD tasks, indexed coding sessions, and conversation transcripts to any MCP-compatible AI client on your machine — **100% local, zero cloud**, working even when VS Code is closed.

---

## English

### Supported Clients

One-click registration from **Agent Resume Settings → Local MCP** or the Command Palette (`Agent Resume: Configure Local MCP Server…`) covers all coding agents supported by Agent Resume Panel plus VS Code / Gemini CLI:

- **Claude Code** (`~/.claude.json`)
- **Codex CLI** (`~/.codex/config.toml`)
- **Antigravity** (`~/.gemini/config/mcp_config.json`)
- **Cursor** (`~/.cursor/mcp.json`)
- **OpenCode** (`~/.config/opencode/opencode.json`)
- **Grok Build** (`~/.grok/config.toml`)
- **Pi** (`~/.pi/agent/mcp.json`)
- **Prime Agent** (`~/.prime/agent/settings.json`)
- **OMP** (`~/.omp/agent/mcp.json`)
- **VS Code** (User `mcp.json`)
- **Gemini CLI** (`~/.gemini/settings.json`)

You can also copy ready-to-paste JSON / TOML snippets or copy a **Self-Install Prompt** to let your agent configure itself.

### Quick Setup

1. Open **Agent Resume Settings** (`Agent Resume: Agent Resume Settings`) and switch to **Local MCP**, or run **`Agent Resume: Configure Local MCP Server…`** from the Command Palette.
2. Choose **Register / Update Local Clients…** and select the clients you want to configure.
3. Pick **Built-in Local MCP Runtime** (recommended). The extension installs a self-contained runtime to `~/.agent-resume-panel/bin/agent-resume-mcp.cjs` and writes the `agent-resume` MCP entry into each selected client config.
4. Restart or reload the target AI client if needed.

### Let an Agent Install & Configure Itself (Prompt)

Click **Copy Agent Install Prompt** in **Agent Resume Settings → Local MCP** (or in **`Agent Resume: Configure Local MCP Server…`**). The extension automatically ensures `~/.agent-resume-panel/bin/agent-resume-mcp.cjs` is up to date, puts a complete prompt containing your exact runtime command and all client config schemas into your clipboard, and lets you paste it directly into any coding agent so it configures itself safely.

> **Works with VS Code closed**  
> Each client launches `agent-resume-mcp.cjs` as an independent local stdio process reading `~/.agent-resume-panel/`. Closing VS Code does not stop MCP queries.

> **Uninstall / Cleanup**  
> Run **`Agent Resume: Configure Local MCP Server…` → `Unregister from Clients…`** to cleanly remove the `agent-resume` entry from selected clients (and remove `~/.agent-resume-panel/bin/agent-resume-mcp.cjs` once no clients remain registered).

### Available MCP Tools (Read-Only)

| Tool | Purpose |
|------|---------|
| `search_agent_resume` | Full-text and fuzzy search across sessions, ACP chats, and notes/tasks |
| `list_notes` | List notes or GTD tasks filtered by scope (`library` / `project` / `session`), project, session, or GTD status |
| `read_note` | Read full Markdown content, parsed frontmatter, and parent/child note links |
| `list_sessions` | List indexed sessions filtered by provider, project, GTD status, or keywords |
| `get_session` | Get session metadata, linked notes, and conversation transcript text |
| `list_projects` | List indexed projects, aliases, and session counts |

---

## 简体中文

通过本地 **stdio MCP**，把你本机 **Agent Resume Panel** 中的笔记、GTD 任务、各工具历史会话与对话内容开放给支持 MCP 的 AI 客户端使用——**纯本地运行、不经云端**，且 **关闭 VS Code 后依然可用**。

### 支持的客户端

在 **Agent Resume 设置 → 本地 MCP** 或命令面板运行 **`Agent Resume: Configure Local MCP Server…`**，支持一键写入或移除 Agent Resume Panel 适配的全部 Agent 及编辑器配置：

- **Claude Code**（`~/.claude.json`）
- **Codex CLI**（`~/.codex/config.toml`）
- **Antigravity**（`~/.gemini/config/mcp_config.json`）
- **Cursor**（`~/.cursor/mcp.json`）
- **OpenCode**（`~/.config/opencode/opencode.json`）
- **Grok Build**（`~/.grok/config.toml`）
- **Pi**（`~/.pi/agent/mcp.json`）
- **Prime Agent**（`~/.prime/agent/settings.json`）
- **OMP**（`~/.omp/agent/mcp.json`）
- **VS Code**（User `mcp.json`）
- **Gemini CLI**（`~/.gemini/settings.json`）

同时也支持直接复制 JSON / TOML 配置片段，或一键复制 **Agent 自主安装提示词**。

### 快速配置

1. 打开 **Agent Resume 设置**并切换到左侧 **本地 MCP**，或在命令面板运行 **`Agent Resume: Configure Local MCP Server…`**。
2. 选择 **注册 / 更新本地客户端…** 并勾选需要接入的客户端。
3. 选择 **内置本地 MCP 运行时**（推荐）：扩展会把单文件运行时释放到 `~/.agent-resume-panel/bin/agent-resume-mcp.cjs`，并自动按各客户端规范增量写入配置。
4. 按目标客户端要求重启或重载 MCP 连接即可使用。

### 复制提示词让 Agent 自主安装

在 **Agent Resume 设置 → 本地 MCP** 点击 **「复制 Agent 安装提示词」**（或在命令菜单选择 **「复制 Agent 自主安装提示词…」**）：扩展会自动把内置运行时释放到 `~/.agent-resume-panel/bin/agent-resume-mcp.cjs`，并将包含你本机真实可执行路径与各客户端配置规范的完整提示词复制到剪贴板。直接粘贴发给任意 Agent，它就会自行检查、合并配置并验证。

> **关闭 VS Code 后也能用**  
> 客户端通过独立的本地 stdio 进程启动 `agent-resume-mcp.cjs`，直接读取 `~/.agent-resume-panel/` 下的索引与笔记文件，不依赖 VS Code 处于打开状态。

> **注销与清理**  
> 在 **`Agent Resume: Configure Local MCP Server…` → `从客户端注销 MCP…`** 中可一键从指定客户端移除 `agent-resume` 条目；当所有客户端都注销后，扩展会自动清理本地释放的运行时文件。

### 提供的 MCP 工具（只读）

| 工具名 | 说明 |
|--------|------|
| `search_agent_resume` | 跨会话、ACP 对话与笔记/任务的全文及模糊搜索 |
| `list_notes` | 按范围（独立/项目/会话）、项目路径、会话或 GTD 状态列出笔记或任务 |
| `read_note` | 读取指定笔记的完整 Markdown 正文、Frontmatter 与父子关联链接 |
| `list_sessions` | 按 Provider、项目、GTD 状态或关键字筛选已索引会话 |
| `get_session` | 获取单个会话的元数据、关联笔记及对话转录内容 |
| `list_projects` | 列出已索引项目、别名与会话统计 |
