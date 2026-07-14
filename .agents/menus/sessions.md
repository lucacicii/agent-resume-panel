# Sessions And Providers Feature Map

> Parent index: `.agents/menus-index.md`

## VS Code Extension

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| sidebar sessions and projects | `src/tree/sessionTree.ts`, `src/extension.ts` | Project grouping, favorites, session ordering, and refresh wiring. |
| provider history loading | `src/history/` | Provider-specific local session readers and types. |
| session catalog | `src/catalog/` | SQLite sync, query, mutation, aliases, GTD, notes flags, and transcript export. |
| preview and session assistant actions | `src/preview/` | Read-only transcript preview, summary, auto rename, handoff actions. |
| search and session manager | `src/search/sessionSearch.ts`, `src/manager/sessionManagerPanel.ts` | Search filters and bulk export. |
| resume targets | `src/terminal/` | Integrated terminal, Ghostty, Claude/Codex panels, Codex App, and Alma. |

## Shared Core And Desktop

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| session synchronization | `packages/core/src/sessionSync.ts`, `packages/core/src/session/` | Shared provider-to-catalog synchronization and reusable session actions. |
| catalog and transcripts | `packages/core/src/catalog/`, `packages/core/src/transcript/` | Shared schema, queries, native transcript previews, and provider homes. |
| desktop session flows | `apps/desktop/src/main/main.ts`, `apps/desktop/src/renderer/app.js` | Sync, list, preview, rename, hide, and resume are IPC-mediated. |

## Constraints

- A catalog hide removes the session from the panel only. Do not delete native provider history unless a specific provider operation explicitly does so.
- Native rename support varies by provider. Preserve catalog updates even when a native rename reports a recoverable error.
