# Shared Infrastructure Feature Map

> Parent index: `.agents/menus-index.md`

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| panel home and shared settings | `packages/core/src/{panelHome.ts,settings/}` | Default `~/.agent-resume-panel`; resolves `settings.json`, effective panel home, and `catalog.db`. |
| SQLite helpers and catalog schema | `packages/core/src/{sqlite.ts,catalog/}` | Shared catalog schema, queries, mutations, and SQLite helpers. |
| session synchronization | `packages/core/src/sessionSync.ts`, `packages/core/src/session/` | Shared provider-to-catalog sync and reusable session actions. |
| LLM runtime and embeddings | `packages/core/src/llm/` | OpenAI-compatible chat and embeddings request construction. |
| usage accounting | `packages/core/src/usage/` | Local LLM usage events and schedule run logs. |
| extension catalog bootstrap | `src/catalog/config.ts`, `src/catalog/db.ts` | Extension-owned catalog configuration and schema startup path. |

## Constraints

- Preserve panel-home migration and effective-home resolution. Do not hardcode a second catalog or settings location.
- Never store LLM credentials in source-controlled configuration or log them during failures.
- Keep shared infrastructure reusable from both the VS Code extension and the Electron desktop app.
