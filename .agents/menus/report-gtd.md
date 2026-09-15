# Memory, GTD, And Retrieval Feature Map

> Parent index: `.agents/menus-index.md`
>
> **Scope:** Memory digests and the desktop scheduler are desktop-primary. GTD appears in the desktop Workbench and the extension sidebar. Core stores shared persistence; each product owns its UI. There is no in-app Archive tab — read digests through MCP.

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| report/digest schema and persistence | `packages/core/src/report/{schema,store}.ts` | Daily, weekly, and monthly digests are stored with session links. |
| digest generation | `packages/core/src/report/{daily,weekly,monthly,ensureDailies,ensureWeeklies,digestRefresh,hierarchicalDigest}.ts` | LLM-backed digest lifecycle and stale checks. |
| digest progress events | `packages/core/src/report/{progress,progressI18n}.ts` | Progress phases used by the background scheduler. |
| semantic digest search | `packages/core/src/report/{search,embedStore,cosine}.ts`, `packages/core/src/llm/embeddings.ts` | Uses configured OpenAI-compatible embeddings. |
| local retrieval for external agents | `packages/core/src/agent/retrieve.ts`, `packages/core/src/mcp/memoryTools.ts` | Backs the MCP `memory_retrieve` tool; **there is no in-app Agent/Ask UI** — see `docs/desktop/agent.md`. |
| MCP agent tool loop | `packages/core/src/agent/{agentChat,toolLoop,agentStore,noteAudit}.ts` | Exported for MCP clients; the desktop renderer has no chat surface. |
| session GTD persistence | `packages/core/src/gtd/`, catalog session GTD tables | Statuses are stored against catalog sessions. |
| note/work item GTD | `packages/core/src/notes/`, `note_set_gtd` MCP tool | Statuses are stored against notes; work items are notes. |
| desktop scheduler and IPC | `apps/desktop/src/main/{main.ts,scheduler.ts}` | Scheduler is always on with code defaults (daily 22:00, weekly/monthly 09:00). There is no Report settings pane. |
| digest retrieval | `packages/core/src/mcp/{memoryTools,reportTools}.ts` | External agents read digests via `memory_retrieve`, `report_search`, `report_read`, `report_list`. |
| session GTD UI | `apps/desktop/src/renderer-react/features/workbench/` | Session GTD menu in Workbench. |
| extension GTD tree | `apps/extension/src/gtd/`, `apps/extension/src/catalog/gtd.ts` | VS Code sidebar GTD integration. |

## Constraints

- Digest generation, embeddings, and MCP retrieval can send private local content to a configured third-party endpoint. Preserve opt-in settings and usage accounting.
- Work-item GTD status is independent of digest generation; scheduled digests must not clear it.
