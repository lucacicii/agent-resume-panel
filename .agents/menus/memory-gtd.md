# Memory, Ask, And GTD Feature Map

> Parent index: `.agents/menus-index.md`

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| memory schema and persistence | `packages/core/src/memory/schema.ts`, `packages/core/src/memory/store.ts` | Daily, weekly, and monthly entries are stored with session links. |
| digest generation | `packages/core/src/memory/{daily,weekly,monthly,ensureDailies,ensureWeeklies,digestRefresh}.ts` | LLM-backed digest lifecycle and stale checks. |
| semantic memory search | `packages/core/src/memory/search.ts`, `packages/core/src/llm/embeddings.ts` | Uses configured OpenAI-compatible embeddings. |
| Ask meta-agent | `packages/core/src/agent/` | Context retrieval, streaming chat, persistence, and note audit. |
| GTD persistence | `packages/core/src/gtd/` | Statuses are stored against catalog sessions. |
| memory-to-GTD workflow | `packages/core/src/workflow/{analyzeGtd,runMemoryGtdSync}.ts` | Preview proposals before applying GTD and `todolist.md` updates. |
| desktop scheduler and IPC | `apps/desktop/src/main/{main,scheduler}.ts` | Scheduler is desktop-owned; renderer receives progress through preload. |
| Memory and Ask UI | `apps/desktop/src/renderer/{index.html,app.js,styles.css}` | Calendar, digest detail, chat, citations, and audit views. |
| extension GTD tree | `src/gtd/`, `src/catalog/gtd.ts` | VS Code sidebar GTD integration. |

## Constraints

- Digest generation, embeddings, and Ask can send private local content to a configured third-party endpoint. Preserve opt-in settings and usage accounting.
- Apply flows must retain preview-before-write behavior for GTD proposals.
