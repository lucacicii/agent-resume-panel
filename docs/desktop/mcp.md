# External Agent MCP

Languages: [English](#english) | [简体中文](#简体中文)

## English

### Overview

Agent Resume Desktop provides one local **Agent Resume MCP** service. It uses stdio, starts only when an MCP client invokes it, and reads the same local data directory as Desktop: `~/.agent-resume-panel` by default. Registration configures a **headless Node** entry (`ELECTRON_RUN_AS_NODE` + the bundled core MCP CLI) so clients do not spawn a second Electron Dock icon.

This is one service with **33 tools**, not 33 independent services:

| Area | Tools | Access |
|---|---:|---|
| Notes and note GTD | 12 | Read and write |
| Reports | 3 | Read-only |
| Sessions | 7 | Read, GTD update, move, and resume-command generation |
| Projects | 4 | Read, merge, tidy, and reconcile |
| Link graph | 1 | Read-only code lineage (`link_graph_trace`) |
| Tags | 6 | Read and write knowledge tags |

The service does not listen on a network port and does not add an authentication layer. Any client registered on this Mac receives the same access as the local Desktop data store. Register only agents and configurations you trust.

### Register a client

1. Open **Agent Resume → Settings → MCP**.
2. Review the full read/write permission warning.
3. Select **Register detected agents**, or register one client at a time.
4. Restart the external client if it was already running.

Desktop detects and can register these clients automatically:

| Client | Registration |
|---|---|
| Codex | Uses the local `codex mcp` command |
| Claude Code | Uses the local `claude mcp` command with user scope |
| Gemini CLI | Updates its local MCP JSON configuration |
| Antigravity | Updates its local MCP JSON configuration |
| OpenCode | Updates its local MCP JSON configuration |

For **Cursor**, **Pi**, and **Grok Build**, use **Copy config** in the MCP settings page and paste the generated JSON into that client's MCP configuration. Desktop does not guess or overwrite their configuration locations.

Use **Update** after moving or reinstalling Agent Resume. Use **Remove** to remove only the `agent-resume` MCP entry from an automatically managed client.

### Tool reference

#### Link graph (code lineage)

| Tool | Purpose |
|---|---|
| `link_graph_trace` | **One call** traces a field/symbol across FE → API client → HTTP path → backend handler → DTO/VO. Independent of Notes/Session — only needs Agent Resume LLM settings. An internal LLM agent performs the full search; filesystem/rg tools only verify. Pass `workspaceRoot` + `symbol`, and preferably `filePath` + `line`. Desktop Workbench uses the same core engine in-process. |

Example arguments:

```json
{
  "workspaceRoot": "/Users/you/my-app",
  "filePath": "/Users/you/my-app/web/src/views/report_center/invoice_details/index.vue",
  "symbol": "deliveryNum",
  "line": 57
}
```

Returns JSON with `primaryChain`, `timeline`, `summary`, `openEnds`, `facts`, and `bridgeStatus`.

#### Notes and note GTD

| Tool | Purpose |
|---|---|
| `note_list` | Page through every indexed note, optionally by scope |
| `note_search` | Search note titles, content, filenames, and paths |
| `note_create` | Create a library, project, or session note |
| `note_read` | Read full Markdown for one note |
| `note_write` | Replace a note's full Markdown content |
| `note_append` | Append Markdown without changing existing content |
| `note_delete` | Permanently delete one note |
| `note_tree_read` | Read the linked Project Note tree containing a note |
| `note_set_parent` | Set or clear a Project Note parent link |
| `note_move` | Move a note to a different owner scope |
| `note_rename` | Rename a note file while preserving its asset directory and references |
| `note_set_gtd` | Set or clear a note's catalog GTD status |

GTD status values are `inbox`, `next`, `waiting`, `someday`, `reference`, and `done`.

#### Reports

| Tool | Purpose |
|---|---|
| `report_list` | List daily, weekly, or monthly memory digests |
| `report_read` | Read a digest by report ID |
| `report_search` | Search report content, including semantic search when configured |

#### Sessions

| Tool | Purpose |
|---|---|
| `session_list` | List recent sessions with optional filters |
| `session_search` | Find sessions by topic, project, provider, date, or GTD status |
| `session_read` | Read catalog metadata and the session summary |
| `session_read_transcript` | Read a short recent transcript excerpt when a summary is insufficient |
| `session_set_gtd` | Set a session's GTD status in the shared catalog |
| `session_move` | Move a session to a different project directory (catalog metadata only; on-disk files are never moved) |
| `session_resume` | Return the terminal command for resuming a saved session |

An external MCP invocation cannot open Desktop's Workbench. Therefore, `session_resume` returns the command and project path for the user or agent to run in a terminal.

#### Projects

| Tool | Purpose |
|---|---|
| `project_list` | List projects with alias, local path, and session counts |
| `project_merge` | Merge a source project into a target (sessions + workbench folder tree) |
| `project_tidy` | Hide stale/empty projects (dry run by default; pass `apply: true` to hide) |
| `project_reconcile` | Re-link projects from sessions by portable key (idempotent) |

### Data and safety

- All data remains on the local machine. Configuring an LLM provider is unrelated to MCP registration.
- Notes, GTD tags, session GTD statuses, and the catalog are shared with the VS Code extension.
- `note_delete` is destructive. There is no MCP recycle bin or undo operation. `project_merge` removes the source project row (its sessions move to the target).
- `project_tidy` only hides projects (recoverable); it never deletes them. `session_move` rewrites only catalog metadata and never moves on-disk session or note files.
- Removing a client registration does not delete Notes, Reports, Sessions, or GTD data.

## 简体中文

### 概览

Agent Resume Desktop 提供一个本机 **Agent Resume MCP** 服务。它使用 stdio，仅在 MCP 客户端调用时启动，并读取与 Desktop 相同的本机数据目录，默认是 `~/.agent-resume-panel`。注册时写入 **无界面 Node** 启动方式（`ELECTRON_RUN_AS_NODE` + 内置 core MCP CLI），避免每个客户端再拉起一个 Electron Dock 图标。

这是一个服务，包含 **33 个工具**，不是 33 个相互独立的服务：

| 范围 | 工具数 | 权限 |
|---|---:|---|
| Notes 与笔记 GTD | 12 | 读写 |
| Reports | 3 | 只读 |
| Sessions | 7 | 读取、更新 GTD、移动、生成恢复命令 |
| Projects | 4 | 读取、合并、整理、协调 |
| 链路图 | 1 | 只读代码血缘（`link_graph_trace`） |
| Tags | 6 | 读写知识标签 |

服务不会监听网络端口，也不会额外增加认证层。本机上注册的任意客户端都会获得访问 Desktop 本机数据的权限，因此只应注册你信任的 Agent 与配置。

### 注册客户端

1. 打开 **Agent Resume → 设置 → MCP**。
2. 阅读完整读写权限提示。
3. 选择 **注册已检测 Agent**，或逐个注册客户端。
4. 如外部客户端已经运行，重启它以加载新配置。

Desktop 可自动检测并注册以下客户端：

| 客户端 | 注册方式 |
|---|---|
| Codex | 使用本机 `codex mcp` 命令 |
| Claude Code | 使用带 user scope 的本机 `claude mcp` 命令 |
| Gemini CLI | 更新本机 MCP JSON 配置 |
| Antigravity | 更新本机 MCP JSON 配置 |
| OpenCode | 更新本机 MCP JSON 配置 |

**Cursor**、**Pi**、**Grok Build** 请在 MCP 设置页选择 **复制配置**，再把生成的 JSON 粘贴到对应客户端的 MCP 配置中。Desktop 不会猜测或覆盖这些客户端的配置路径。

移动或重新安装 Agent Resume 后，可选择 **更新**。选择 **移除** 只会从自动管理的客户端移除 `agent-resume` MCP 条目。

### 工具说明

#### 链路图（代码血缘）

| 工具 | 用途 |
|---|---|
| `link_graph_trace` | **一次调用**完成字段/符号跨端链路：前端 → API 客户端 → HTTP 路径 → 后端 handler → DTO/VO。与 Notes/Session **解耦**，仅需 Agent Resume LLM 配置。内部由 LLM 逐步搜索，工具只做读盘/rg 验证。必填 `workspaceRoot` + `symbol`，建议同时传 `filePath`、`line`。Desktop Workbench 进程内调用同一 core 引擎。 |

示例参数：

```json
{
  "workspaceRoot": "/Users/you/my-app",
  "filePath": "/Users/you/my-app/web/src/views/report_center/invoice_details/index.vue",
  "symbol": "deliveryNum",
  "line": 57
}
```

返回 JSON：`primaryChain`、`timeline`、`summary`、`openEnds`、`facts`、`bridgeStatus`。

#### Notes 与笔记 GTD

| 工具 | 用途 |
|---|---|
| `note_list` | 分页列出所有已索引笔记，可按范围筛选 |
| `note_search` | 搜索笔记标题、内容、文件名和路径 |
| `note_create` | 创建库、项目或会话笔记 |
| `note_read` | 读取一篇笔记的完整 Markdown |
| `note_write` | 覆盖一篇笔记的完整 Markdown 内容 |
| `note_append` | 在不修改原有内容的前提下追加 Markdown |
| `note_delete` | 永久删除一篇笔记 |
| `note_tree_read` | 读取包含该笔记的 Project Note 树 |
| `note_set_parent` | 设置或清除 Project Note 父链接 |
| `note_move` | 将笔记移动到不同的所有者范围 |
| `note_rename` | 重命名笔记文件，同时保留其资产目录和引用 |
| `note_set_gtd` | 设置或清除笔记的 catalog GTD 状态 |

GTD 状态为 `inbox`、`next`、`waiting`、`someday`、`reference`、`done`。

#### Reports

| 工具 | 用途 |
|---|---|
| `report_list` | 列出日、周、月工作记忆报告 |
| `report_read` | 按 report ID 读取完整报告 |
| `report_search` | 搜索报告内容；配置后也可进行语义搜索 |

#### Sessions

| 工具 | 用途 |
|---|---|
| `session_list` | 按可选条件列出最近会话 |
| `session_search` | 按主题、项目、提供方、日期或 GTD 状态查找会话 |
| `session_read` | 读取 catalog 元数据和会话摘要 |
| `session_read_transcript` | 摘要不足时读取最近一小段转录内容 |
| `session_set_gtd` | 在共享 catalog 中设置会话 GTD 状态 |
| `session_move` | 将会话移动到其他项目目录（仅改 catalog 元数据，绝不移动磁盘文件） |
| `session_resume` | 返回恢复已保存会话所需的终端命令 |

外部 MCP 调用不能打开 Desktop 的 Workbench，因此 `session_resume` 会返回用户或 Agent 可在终端执行的命令和项目路径。

#### Projects

| 工具 | 用途 |
|---|---|
| `project_list` | 列出项目（别名、本地路径、会话数） |
| `project_merge` | 将源项目合并进目标项目（会话 + workbench 文件夹树） |
| `project_tidy` | 隐藏失效/空项目（默认 dry-run；传 `apply: true` 执行隐藏） |
| `project_reconcile` | 从 sessions 按 portable key 重新协调项目归属（幂等） |

### 数据与安全

- 所有数据保留在本机。是否配置 LLM 提供方与 MCP 注册无关。
- Notes、GTD 标签、会话 GTD 状态和 catalog 与 VS Code 扩展共用。
- `note_delete` 属于破坏性操作；MCP 不提供回收站或撤销功能。`project_merge` 会删除源项目行（其会话迁入目标）。
- `project_tidy` 只会隐藏项目（可恢复），绝不删除；`session_move` 仅改写 catalog 元数据，绝不移动磁盘上的会话或笔记文件。
- 移除客户端注册不会删除 Notes、Reports、Sessions 或 GTD 数据。
