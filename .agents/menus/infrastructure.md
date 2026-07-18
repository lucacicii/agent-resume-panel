# Shared Infrastructure Feature Map

> Parent index: `.agents/menus-index.md`
>
> **Scope:** Cross-product contracts — panel home, catalog DB, and core helpers. Settings and UI still differ per product. See [`.agents/extended/product-independence.md`](../extended/product-independence.md).

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| panel home and shared settings | `packages/core/src/{panelHome.ts,settings/}` | Default `~/.agent-resume-panel`; resolves `settings.json`, effective panel home, and `catalog.db`. |
| SQLite helpers and catalog schema | `packages/core/src/{sqlite.ts,catalog/}` | Shared catalog schema, queries, mutations, and SQLite helpers. |
| session synchronization | `packages/core/src/sessionSync.ts`, `packages/core/src/session/` | Shared provider-to-catalog sync and reusable session actions. |
| LLM runtime and embeddings | `packages/core/src/llm/` | OpenAI-compatible chat and embeddings request construction. |
| usage accounting | `packages/core/src/usage/` | Local LLM usage events and schedule run logs. |
| extension catalog bootstrap | `apps/extension/src/catalog/config.ts`, `apps/extension/src/catalog/db.ts` | Extension-owned base schema startup path. |
| desktop catalog extensions | `packages/core/src/catalog/` (`ensureDesktopCatalogSchema`) | Desktop-only tables; migrated separately from extension schema. |
| extension settings bridge | `apps/extension/src/settings/`, panel home `settings.json` | VS Code `agentResume.*` + SecretStorage; extension-only. |
| desktop settings | panel home `settings.desktop.json`, `apps/desktop/src/main/` | Desktop config; not stored in VS Code settings. |

## Constraints

- Preserve panel-home migration and effective-home resolution. Do not hardcode a second catalog or settings location.
- Never store LLM credentials in source-controlled configuration or log them during failures.
- Shared infrastructure must stay product-agnostic. Do not import `vscode` in core or desktop-main code paths that core owns.
- Changing a shared contract may affect both products — verify extension (`pnpm run compile`) and desktop (`pnpm run build:desktop`) when touching `packages/core/` or catalog schema.
