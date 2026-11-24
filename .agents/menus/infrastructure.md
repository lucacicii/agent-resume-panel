# Shared Infrastructure Feature Map

> Parent index: `.agents/menus-index.md`
>
> **Scope:** Panel home, catalog DB, and `@agent-resume/core` helpers.

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| panel home | `packages/core/src/panelHome.ts` | Default `~/.agent-resume-panel`; resolves `settings.json` and `catalog.db`. |
| SQLite helpers and catalog schema | `packages/core/src/{sqlite.ts,catalog/}` | Catalog schema, mutations, projects, and SQLite helpers. |
| session synchronization | `packages/core/src/sessionSync.ts` | Provider-to-catalog sync. |
| extension catalog bootstrap | `apps/extension/src/catalog/config.ts`, `apps/extension/src/catalog/db.ts` | Extension catalog startup path. |
| extension settings bridge | `apps/extension/src/settings/`, panel home `settings.json` | VS Code `agentResume.*` + SecretStorage. |

## Constraints

- Preserve panel-home resolution. Do not hardcode a second catalog or settings location.
- Never store LLM credentials in source-controlled configuration or log them during failures.
- Keep `packages/core` free of `vscode` imports.
- Verify with `pnpm run compile` and `pnpm run test:core` when touching `packages/core/` or catalog schema.
