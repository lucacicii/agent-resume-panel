# Development Rules

See [product-independence.md](product-independence.md) for the full extension vs desktop vs core boundary.

## Workspace Layout

- `apps/extension` (`agent-resume-panel`): VS Code extension. TypeScript 5.9, strict mode, Node16 modules, ES2022 target, VS Code `^1.92.0`. Independent version and VSIX release.
- `packages/core` (`@agent-resume/core`): Shared TypeScript domain library — catalog helpers, settings, session sync, LLM, memory, notes, GTD, transcripts. Node.js `>=18`. Not a standalone shipped product.
- `apps/desktop` (`@agent-resume/desktop`): Electron 35 desktop app. Main/preload are strict CommonJS TypeScript; renderer is plain JavaScript and CSS bundled with esbuild. Independent version and DMG release.

## Ownership

- Put reusable data, filesystem, SQLite, provider-adapter, LLM, memory, and session behavior in `packages/core`, then expose it through `packages/core/src/index.ts` — **only when both products need it**.
- Keep VS Code APIs, tree views, webviews, commands, ACP Chat, and extension configuration in `apps/extension/src/`. Extension code must not depend on Electron or desktop renderer assets.
- Keep Electron lifecycle, IPC handlers, native terminal integration, Memory/Ask/Workbench UI, and desktop-only services in `apps/desktop/src/`. Desktop code must not depend on `vscode` APIs or extension webviews.
- The extension still owns extension-specific catalog bootstrap, history readers, notes sidebar, and ACP. Do not migrate to core or desktop as incidental cleanup.
- Desktop owns its renderer, scheduler, embedded terminal, and `settings.desktop.json`. Do not port desktop UI flows into extension webviews.

## Build And Test

- Use pnpm `11.13.1` workspaces from the repository root with Node.js `>=22.13`. Add a dependency only to the workspace that owns it: `pnpm --filter <workspace-name> add <package>`.
- Run `pnpm run compile` after source changes. It builds core before compiling the extension.
- For core-only work, use `pnpm --filter @agent-resume/core run build` and its package test script when applicable.
- For desktop work, use `pnpm run dev:desktop` for daily watch-mode development (see [`apps/desktop/DEVELOPMENT.md`](../../apps/desktop/DEVELOPMENT.md)); use `pnpm run build:desktop` for full builds; use `pnpm --filter @agent-resume/desktop run dev:mac` on macOS to verify the packaged `.app` path; use `pnpm run pack:desktop` before distribution tests.
- Extension and desktop locales are separate. Extension strings live in `apps/extension/locales/`; desktop strings live in `apps/desktop/locales/` (`desktop.*` keys only, generated from `scripts/desktop-i18n-catalog.json`). Run `pnpm run i18n:check` after either changes. Run `pnpm run i18n:check:translations` for coverage audits.
- Context-menu contribution changes require `node apps/extension/scripts/patch-project-menu-package.mjs`, then `pnpm run test:menus`. The patch script updates `manifest/contributes.generated.json` and `base.openvsx.json`, then merges `package.json`.
- Extension contributions, commands, views, or activation events require `pnpm run install:local` and **Developer: Reload Window** to test the installed extension.

## Data Contracts

- `~/.agent-resume-panel` is the default shared panel home for both the extension and Desktop. It contains `catalog.db`, `notes/`, `settings.json` (extension LLM bridge), `settings.desktop.json` (Desktop config), and `acp/` (extension-only). Desktop-private runtime data lives under `.desktop/` (`desktop.db`, workbench `scratch/`). Preserve the configurable panel-home flow.
- `catalog.db` shared tables are owned by the frozen extension schema in `apps/extension/src/catalog/db.ts` (`sessions`, `sync_state`, `projects`, `session_gtd`, legacy note tables, `notes`, `catalog_meta`). Desktop-only tables (`report_*`, `agent_*`, vector index, usage, scheduler) are migrated only through `ensureDesktopCatalogSchema` in `@agent-resume/core`.
- Catalog records are indexes over provider-owned local transcripts. Do not turn a catalog hide/remove action into deletion of a provider's native session data.
- Extension settings stay in VS Code `agentResume.*` (+ SecretStorage). Desktop settings live in `settings.desktop.json` under the same `panelHome`.
- Use strict types for new domain flows; avoid `any` and avoid bypassing public core exports with deep imports from another workspace.
