# Sessions And Providers Feature Map

> Parent index: `.agents/menus-index.md`

## VS Code Extension

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| sidebar sessions and projects | `apps/extension/src/tree/sessionTree.ts`, `apps/extension/src/extension.ts` | Project grouping, favorites, session ordering, and refresh wiring. |
| provider history loading | `apps/extension/src/history/` | Provider-specific local session readers and types. |
| session catalog | `apps/extension/src/catalog/` | SQLite sync, query, mutation, aliases, GTD, notes flags, and transcript export. |
| preview and session assistant actions | `apps/extension/src/preview/` | Read-only transcript preview, summary, auto rename, handoff actions. |
| search and session manager | `apps/extension/src/search/sessionSearch.ts`, `apps/extension/src/manager/sessionManagerPanel.ts` | Search filters and bulk export. |
| resume targets | `apps/extension/src/terminal/` | Integrated terminal, Ghostty, Claude/Codex panels, Codex App. |

## Shared Core

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| session synchronization | `packages/core/src/sessionSync.ts` | Provider-to-catalog synchronization. |
| catalog and transcripts | `packages/core/src/catalog/`, `packages/core/src/transcript/` | Schema, mutations, projects, preview text helpers, and provider homes. |

## Constraints

- A catalog hide removes the session from the panel only. Do not delete native provider history unless a specific provider operation explicitly does so.
- Native rename support varies by provider. Preserve catalog updates even when a native rename reports a recoverable error.
