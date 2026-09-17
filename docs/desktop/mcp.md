# External Agent MCP

Languages: [English](#english) | [简体中文](#简体中文)

## English

### Overview

Agent Resume Desktop exposes **two local MCP services** over stdio. Both start only when an MCP client invokes them, read the same local data directory as Desktop (`~/.agent-resume-panel` by default), and are launched through a **headless Node** entry (`ELECTRON_RUN_AS_NODE` + the bundled core CLI) so clients do not spawn a second Electron Dock icon.

| Service | Transport | Entry | Consumers | Tool areas |
|---|---|---|---|---|
| `agent-resume` | stdio (`ELECTRON_RUN_AS_NODE`) | `@agent-resume/core` `dist/mcp/cli.js` | External TUI clients, ACP sessions | Notes, tasks, workbenches, reports, sessions, link graph |
| `agent-resume-browser` | ACP: in-app loopback HTTP MCP with a bearer token; TUI: stdio proxy `dist/mcp/browserCli.js` → endpoint file → loopback server | `apps/desktop/src/main/browser/mcpServer.ts` | External TUI clients, ACP sessions | 15 `browser_*` tools |

The data service exposes **31 tools**, not 31 independent services:

| Area | Tools | Access |
|---|---:|---|
| Notes and note GTD | 12 | Read and write |
| Tasks (work items) | 6 | Read and write |
| Workbenches | 2 | Read-only |
| Reports and memory retrieval | 4 | Read-only |
| Sessions | 6 | Read, GTD update, and resume-command generation |
| Link graph | 1 | Read-only code lineage (`link_graph_trace`) |

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

For **Cursor**, **Pi**, and **Grok Build**, use **Copy config** in the MCP settings page and paste the generated JSON into that client's MCP configuration. The snippet contains both services; replace `<client-name>` in the `agent-resume-browser` entry with that client's id (for example `cursor` or `pi`). Desktop does not guess or overwrite these clients' configuration locations.

Use **Update** after moving or reinstalling Agent Resume. This Mac's automatic clients are re-synced with both services (`agent-resume` and `agent-resume-browser`) at startup and after any settings save; the browser entry follows **Settings → Browser**. **Remove** drops the `agent-resume` entry from an automatically managed client.

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
| `note_list` | Page through every indexed note, optionally by scope (library or session) |
| `note_search` | Search note titles, content, filenames, and paths |
| `note_create` | Create a library or session note, or a linked child under a task |
| `note_read` | Read full Markdown for one note |
| `note_write` | Replace a note's full Markdown content |
| `note_append` | Append Markdown without changing existing content |
| `note_delete` | Permanently delete one note |
| `note_tree_read` | Read the linked task (work item) knowledge tree containing a note |
| `note_set_parent` | Set or clear a task parent link |
| `note_move` | Move a note to a different owner scope (library or session) |
| `note_rename` | Rename a note file while preserving its asset directory and references |
| `note_set_gtd` | Set or clear a note's catalog GTD status |

`rootPath` / `roots` are plain repository addresses — not an owning entity. Project notes are an **extension-only** capability: this server never creates, lists, or modifies them.

**Default owner (TUI / ACP sessions)**

Desktop injects the current session identity into the MCP server. When a note tool is called with no explicit owner, the target is resolved in this order:

1. The **task (work item)** bound to the session — when the session was launched for a work item, or is linked to one in the shared catalog. `note_create` adds a library child under it; `note_list` / `note_search` default to that task's subtree.
2. The **session** itself, when there is no bound task.
3. **No owner** — a plain library note, when the MCP server has no session identity (for example a CLI you started outside Desktop).

An explicit `scope`, `parentNoteId`, or `rootPath` always wins. `note_create` reports `resolvedVia` (`explicit` | `context` | `session` | `none`) so the caller can tell which rule applied.

GTD status values are `inbox`, `next`, `waiting`, `someday`, `reference`, and `done`.

#### Reports and memory retrieval

| Tool | Purpose |
|---|---|
| `memory_retrieve` | Retrieve relevant context across all local memory (digests, notes, sessions) with `[D#]` / `[N#]` / `[S#]` citations — see [Agent memory](agent.md) |
| `report_list` | List daily, weekly, or monthly memory digests |
| `report_read` | Read a digest by report ID |
| `report_search` | Search report content, including semantic search when configured |

#### Sessions

| Tool | Purpose |
|---|---|
| `session_list` | List recent sessions with optional filters |
| `session_search` | Find sessions by topic, root, provider, date, or GTD status |
| `session_read` | Read catalog metadata and the session summary |
| `session_read_transcript` | Read a short recent transcript excerpt when a summary is insufficient |
| `session_set_gtd` | Set a session's GTD status in the shared catalog |
| `session_resume` | Return the terminal command for resuming a saved session |

An external MCP invocation cannot open Desktop's Workbench. Therefore, `session_resume` returns the command and root path for the user or agent to run in a terminal.

#### Tasks (work items)

A task is a note with front-matter `work: true`. Tasks are library-scoped and **reference** 0..n repository roots (multi-root) instead of belonging to one, so a single task can span repositories.

| Tool | Purpose |
|---|---|
| `task_list` | List tasks with GTD status, next action, owed decision, repository roots, and linked-session counts |
| `task_read` | Read one task: work fields, linked sessions with their root paths, and its workbenches |
| `task_create` | Create a task (a library-scoped work item) |
| `task_write` | Update next action, owed decision, repository roots, primary root, or GTD status |
| `task_link_session` | Link a session to a task; when `rootPath` is given it also references that root and, by default, rebinds the session's catalog project path |
| `task_unlink_session` | Unlink a session from a task (the session itself is untouched) |

`task_link_session` replaces the removed `session_move`: the session's catalog `project_path` is rewritten through the task, and on-disk files are never moved.

#### Workbenches

A workbench is a desktop-only unit of work under a task: it binds to one repository root (or the task's neutral workspace when the binding is null) and owns its own pane layout and session set. External MCP callers cannot open Desktop's Workbench UI, so these tools are read-only.

| Tool | Purpose |
|---|---|
| `workbench_list` | List a task's workbenches with their root binding and session counts |
| `workbench_read` | Read one workbench: task, bound repository root, pane layout, and linked sessions |

The former `project_list` / `project_merge` / `project_tidy` / `project_reconcile` tools were removed in favor of the task tools.

### Data and safety

- All data remains on the local machine. Configuring an LLM provider is unrelated to MCP registration.
- Notes, GTD tags, session GTD statuses, and the catalog are shared with the VS Code extension.
- `note_delete` is destructive. There is no MCP recycle bin or undo operation.
- `task_link_session` rewrites only catalog metadata (`project_path` / `project_id`) and never moves on-disk session or note files. `task_unlink_session` leaves the session itself untouched.
- Removing a client registration does not delete Notes, Reports, Sessions, or GTD data.

## 简体中文

### 概览

Agent Resume Desktop 暴露 **两个本机 MCP 服务**，均使用 stdio。两者都仅在 MCP 客户端调用时启动，读取与 Desktop 相同的本机数据目录（默认 `~/.agent-resume-panel`），并通过 **无界面 Node** 启动方式（`ELECTRON_RUN_AS_NODE` + 内置 core CLI）运行，避免每个客户端再拉起一个 Electron Dock 图标。

| 服务 | 传输方式 | 入口 | 消费方 | 工具域 |
|---|---|---|---|---|
| `agent-resume` | stdio（`ELECTRON_RUN_AS_NODE`） | `@agent-resume/core` `dist/mcp/cli.js` | 外部 TUI 客户端、ACP 会话 | Notes、Tasks、Workbenches、Reports、Sessions、链路图 |
| `agent-resume-browser` | ACP：应用内回环 HTTP MCP（Bearer Token）；TUI：stdio 代理 `dist/mcp/browserCli.js` → 端点文件 → 回环服务 | `apps/desktop/src/main/browser/mcpServer.ts` | 外部 TUI 客户端、ACP 会话 | 15 个 `browser_*` 工具 |

数据服务包含 **31 个工具**，不是 31 个相互独立的服务：

| 范围 | 工具数 | 权限 |
|---|---:|---|
| Notes 与笔记 GTD | 12 | 读写 |
| Tasks（工作项） | 6 | 读写 |
| Workbenches | 2 | 只读 |
| Reports 与记忆检索 | 4 | 只读 |
| Sessions | 6 | 读取、更新 GTD、生成恢复命令 |
| 链路图 | 1 | 只读代码血缘（`link_graph_trace`） |

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

**Cursor**、**Pi**、**Grok Build** 请在 MCP 设置页选择 **复制配置**，再把生成的 JSON 粘贴到对应客户端的 MCP 配置中。片段同时包含两个服务；请将 `agent-resume-browser` 条目中的 `<client-name>` 替换为该客户端 id（例如 `cursor`、`pi`）。Desktop 不会猜测或覆盖这些客户端的配置路径。

移动或重新安装 Agent Resume 后，可选择 **更新**。本机的自动客户端会在启动时和每次保存设置后同时同步两个服务（`agent-resume` 与 `agent-resume-browser`）；浏览器条目跟随 **设置 → 浏览器**。选择 **移除** 会从自动管理的客户端移除 `agent-resume` 条目。

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
| `note_list` | 分页列出所有已索引笔记，可按范围（library 或 session）筛选 |
| `note_search` | 搜索笔记标题、内容、文件名和路径 |
| `note_create` | 创建 library 或 session 笔记，或在任务下创建子笔记 |
| `note_read` | 读取一篇笔记的完整 Markdown |
| `note_write` | 覆盖一篇笔记的完整 Markdown 内容 |
| `note_append` | 在不修改原有内容的前提下追加 Markdown |
| `note_delete` | 永久删除一篇笔记 |
| `note_tree_read` | 读取包含该笔记的任务（工作项）知识树 |
| `note_set_parent` | 设置或清除任务父链接 |
| `note_move` | 将笔记移动到不同所有者范围（library 或 session） |
| `note_rename` | 重命名笔记文件，同时保留其资产目录和引用 |
| `note_set_gtd` | 设置或清除笔记的 catalog GTD 状态 |

`rootPath` / `roots` 只是仓库地址，不是拥有者实体。项目笔记属于 **扩展专属** 能力：本服务不会创建、列出或修改它们。

**默认归属解析（TUI / ACP 会话）**

Desktop 会把当前会话身份注入 MCP 服务。当笔记工具未显式指定所有者时，按以下顺序解析：

1. 会话绑定的 **任务（工作项）** —— 会话为该工作项启动，或在共享 catalog 中已关联到它。`note_create` 会在其下创建 library 子笔记；`note_list` / `note_search` 默认收敛到该任务的子树。
2. 没有绑定任务时，退回 **会话** 本身。
3. MCP 服务没有任何会话身份时（例如你在 Desktop 之外自行启动的 CLI），**不绑定任何实体**，就是一篇普通 library 笔记。

显式传入的 `scope`、`parentNoteId` 或 `rootPath` 始终优先。`note_create` 会返回 `resolvedVia`（`explicit` | `context` | `session` | `none`），便于调用方判断命中了哪条规则。

GTD 状态为 `inbox`、`next`、`waiting`、`someday`、`reference`、`done`。

#### Reports 与记忆检索

| 工具 | 用途 |
|---|---|
| `memory_retrieve` | 一次检索全部本机记忆（报告、笔记、会话），返回 `[D#]` / `[N#]` / `[S#]` 引用 —— 见 [Agent memory](agent.md) |
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
| `session_resume` | 返回恢复已保存会话所需的终端命令 |

外部 MCP 调用不能打开 Desktop 的 Workbench，因此 `session_resume` 会返回用户或 Agent 可在终端执行的命令和根路径。

#### Tasks（工作项）

任务是 front-matter 标记 `work: true` 的笔记。任务属于 library 域，**引用**（而非拥有）0..n 个仓库根（多根），因此一个任务可以横跨多个仓库。

| 工具 | 用途 |
|---|---|
| `task_list` | 列出任务：GTD 状态、下一步行动、待决策项、仓库根、关联会话数 |
| `task_read` | 读取单个任务：工作项字段、关联会话及其根路径、所属工作台 |
| `task_create` | 创建任务（library 域工作项） |
| `task_write` | 更新下一步行动、待决策项、仓库根、主根或 GTD 状态 |
| `task_link_session` | 把会话关联到任务；传 `rootPath` 时同时引用该项目根，并默认重绑会话的 catalog 项目路径 |
| `task_unlink_session` | 解除会话与任务的关联（会话本身不受影响） |

`task_link_session` 取代了已删除的 `session_move`：会话的 catalog `project_path` 通过任务改写，绝不移动磁盘文件。

#### Workbenches（工作台）

工作台是任务下 Desktop 专属的工作单元：绑定一个仓库根（绑定为空时使用任务的中立工作区），并拥有自己的面板布局与会话集合。外部 MCP 不能打开 Desktop 的 Workbench UI，因此这些工具均为只读。

| 工具 | 用途 |
|---|---|
| `workbench_list` | 列出某任务的工作台及其根绑定与会话数 |
| `workbench_read` | 读取单个工作台：所属任务、绑定仓库根、面板布局、关联会话 |

原 `project_list` / `project_merge` / `project_tidy` / `project_reconcile` 工具已移除，由任务工具取代。

### 数据与安全

- 所有数据保留在本机。是否配置 LLM 提供方与 MCP 注册无关。
- Notes、GTD 标签、会话 GTD 状态和 catalog 与 VS Code 扩展共用。
- `note_delete` 属于破坏性操作；MCP 不提供回收站或撤销功能。
- `task_link_session` 仅改写 catalog 元数据（`project_path` / `project_id`），绝不移动磁盘上的会话或笔记文件；`task_unlink_session` 不影响会话本身。
- 移除客户端注册不会删除 Notes、Reports、Sessions 或 GTD 数据。
