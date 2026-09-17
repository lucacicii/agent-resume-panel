# Agent memory (MCP)

[← Back to README](README.md)

Languages: [English](#english) | [简体中文](#简体中文)

---

## English

### What it is

Desktop once had an in-app **Agent** tab for natural-language Q&A over your local work history. That tab was retired: Desktop now ships the same retrieval capability as a **local MCP tool**, so the agents you already run (Claude Code, Codex, Cursor, …) can query your memory directly instead of you switching apps to ask.

There is no Agent tab and no in-app chat thread. To ask questions about past work, register an MCP client and use **`memory_retrieve`** — see [External Agent MCP](mcp.md) for registration and permissions.

### `memory_retrieve`

| | |
|---|---|
| **Purpose** | Retrieve relevant context across **all** local memory in one call: memory digests, notes, and historical agent sessions |
| **Returns** | Bounded excerpts with citation markers — `[D#]` digests, `[N#]` notes, `[S#]` sessions |
| **Filters** | Optional project path to prioritize one project, and a result limit per category |
| **Access** | Read-only |

The three citation kinds map onto:

| Marker | Source | Where it lives in the app |
|---|---|---|
| `[D#]` | Memory digests (daily / weekly / monthly) | MCP `report_read` / `report_search` (no in-app Archive tab) |
| `[N#]` | Project notes and tasks | [Notes](notes.md) |
| `[S#]` | Historical agent sessions | [Sessions](sessions.md) and [Workbench](workbench.md) |

### Related read-only tools

For narrower questions, ask for one source at a time:

| Tool | Purpose |
| --- | --- |
| `report_search` | Semantic search over memory digests |
| `report_read` | Read one full digest by `reportId` |
| `report_list` | List digests by level and period |
| `session_search` | Keyword search over sessions; **plus** summary-vector search when embeddings are configured |
| `session_list` · `session_read` · `session_read_transcript` | Recent sessions, one session's metadata and cached summary, or a short transcript excerpt |
| `note_search` · `note_read` · `note_tree_read` | Notes and task trees |
| `task_list` · `task_read` · `workbench_list` | Tasks, their multi-root project references, and workbenches |

### Retrieval quality

- Without embeddings, search still works via **keywords**.
- Semantic retrieval improves after sessions have **summaries** and embeddings are configured (see [Settings & data](settings-and-data.md)).
- Digests answer “what did I do that week”; session tools answer “which single CLI session”.

Client-side permissions decide whether a write tool is even offered — see [External Agent MCP](mcp.md).

### Where the deleted in-app features went

| Retired | Replacement |
|---|---|
| Agent tab (chat threads, streaming answers, execution-flow panel, citation sheet) | MCP `memory_retrieve` + the related read-only tools above |
| In-app note audit view | Note tools return operation results to the calling agent |

### Related

- [External Agent MCP](mcp.md) · [Reports](report.md) · [Sessions](sessions.md) · [Notes](notes.md) · [Settings & data](settings-and-data.md)

---

## 简体中文

### 是什么

Desktop 曾有一个应用内的 **Agent** 页签，用自然语言对本机工作历史问答。该页签已被移除：现在同一套检索能力以 **本机 MCP 工具** 的形式提供，于是你已经在用的 agent（Claude Code、Codex、Cursor 等）可以直接查询你的记忆，不必切到另一个应用里提问。

**不存在** Agent 页签，也没有应用内对话线程。要就过去的工作提问，请注册 MCP 客户端并使用 **`memory_retrieve`** —— 注册与权限见 [External Agent MCP](mcp.md)。

### `memory_retrieve`

| | |
|---|---|
| **用途** | 一次调用检索 **全部** 本机记忆：回顾报告、项目笔记、历史 agent 会话 |
| **返回** | 带引用标记的有界节选 —— `[D#]` 报告、`[N#]` 笔记、`[S#]` 会话 |
| **筛选** | 可选的项目路径（优先某个项目）与每类结果的条数上限 |
| **权限** | 只读 |

三类引用对应到应用内的位置：

| 标记 | 来源 | 应用内位置 |
|---|---|---|
| `[D#]` | 回顾报告（日 / 周 / 月） | MCP `report_read` / `report_search`（应用内已无归档页） |
| `[N#]` | 项目笔记与任务 | [Notes](notes.md) |
| `[S#]` | 历史 agent 会话 | [Sessions](sessions.md) 与 [Workbench](workbench.md) |

### 相关的只读工具

问题更窄时，可以只查单一来源：

| 工具 | 用途 |
| --- | --- |
| `report_search` | 对回顾报告做语义搜索 |
| `report_read` | 按 `reportId` 读取整篇报告 |
| `report_list` | 按层级与周期列出报告 |
| `session_search` | 会话关键词搜索；配置了 embedding 后**另加**摘要向量检索 |
| `session_list` · `session_read` · `session_read_transcript` | 最近会话、单个会话的元数据与缓存摘要、或短转写节选 |
| `note_search` · `note_read` · `note_tree_read` | 笔记与任务树 |
| `task_list` · `task_read` · `workbench_list` | 任务、其多根项目引用与工作台 |

### 检索质量

- 没有 embedding 时，搜索仍可按**关键词**工作。
- 会话有**摘要**且配置了 embedding 后，语义检索效果最好（见 [设置与数据](settings-and-data.md)）。
- 回顾报告回答「那一周我做了什么」；会话工具回答「具体是哪个 CLI 会话」。

写入类工具是否提供，由客户端侧的权限设置决定 —— 见 [External Agent MCP](mcp.md)。

### 已移除的应用内功能去向

| 已退役 | 替代 |
|---|---|
| Agent 页签（对话线程、流式回答、执行流面板、引用面板） | MCP `memory_retrieve` 及上述相关只读工具 |
| 应用内笔记审计视图 | 笔记工具把操作结果返回给调用方 agent |

### 相关文档

- [External Agent MCP](mcp.md) · [Reports](report.md) · [Sessions](sessions.md) · [Notes](notes.md) · [设置与数据](settings-and-data.md)
