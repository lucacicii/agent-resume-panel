# Development Rules

## Workspace Layout

- `apps/extension` (`agent-resume-panel`): VS Code extension. TypeScript 5.9, strict mode, Node16 modules, ES2022 target, VS Code `^1.92.0`. Ships `.vsix` to VS Code Marketplace and Open VSX.
- `packages/core` (`@agent-resume/core`): TypeScript domain library — catalog helpers, session sync, notes, GTD types, i18n, transcripts. Node.js `>=22.13`. Not published standalone.

## Ownership

- Put reusable data, filesystem, SQLite, catalog, session sync, notes, and i18n behavior in `packages/core`, exposed through `packages/core/src/index.ts` and `packages/core/src/extension.ts`.
- Keep VS Code APIs, tree views, webviews, commands, ACP Chat, and extension configuration in `apps/extension/src/`.
- The extension owns extension-specific catalog bootstrap, history readers, notes sidebar, and ACP UI.

## Build And Test

- Use pnpm `11.13.1` workspaces from the repository root with Node.js `>=22.13`. Add a dependency only to the workspace that owns it: `pnpm --filter <workspace-name> add <package>`.
- Run `pnpm run compile` after source changes. It builds core before compiling the extension.
- For core-only work, use `pnpm --filter @agent-resume/core run build` and `pnpm run test:core`.
- Extension strings live in `apps/extension/locales/`. Run `pnpm run i18n:check` after locale or `t()` / webview string changes, and `pnpm run i18n:check:translations` for coverage audits.
- Context-menu contribution changes require `node apps/extension/scripts/patch-project-menu-package.mjs`, then `pnpm run test:menus`. The patch script updates `manifest/contributes.generated.json` and `base.openvsx.json`, then merges `package.json`.
- Extension contributions, commands, views, or activation events require `pnpm run install:local` and **Developer: Reload Window** to test the installed extension.

## Data Contracts

- `~/.agent-resume-panel` is the default panel home. It contains `catalog.db`, `notes/`, `settings.json` (LLM bridge), and `acp/`. Preserve the configurable panel-home flow.
- `catalog.db` tables are owned by the extension schema (`sessions`, `sync_state`, `projects`, `session_gtd`, legacy note tables, `notes`, `catalog_meta`).
- Catalog records are indexes over provider-owned local transcripts. Do not turn a catalog hide/remove action into deletion of a provider's native session data.
- Extension settings stay in VS Code `agentResume.*` (+ SecretStorage).
- Use strict types for new domain flows; avoid `any` and avoid bypassing public core exports with deep imports from another workspace.
