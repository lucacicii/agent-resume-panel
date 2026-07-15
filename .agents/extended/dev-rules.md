# Development Rules

## Workspace Layout

- Root: VS Code extension. TypeScript 5.9, strict mode, Node16 modules, ES2022 target, and VS Code `^1.92.0`.
- `packages/core`: `@agent-resume/core`, the shared TypeScript domain library for catalog, settings, session sync, LLM, memory, notes, GTD, transcripts, and terminal actions. Node.js `>=18`.
- `apps/desktop`: Electron 35 desktop app. Main and preload are strict CommonJS TypeScript; renderer is plain JavaScript and CSS bundled with esbuild.

## Ownership

- Put reusable data, filesystem, SQLite, provider-adapter, LLM, memory, and session behavior in `packages/core`, then expose it through `packages/core/src/index.ts`.
- Keep VS Code APIs, tree views, webviews, commands, and extension configuration in root `src/`.
- Keep Electron lifecycle, IPC handlers, native terminal integration, and desktop-only services in `apps/desktop/src/main/`; expose a narrow typed contract from `apps/desktop/src/preload/preload.ts`; consume it in the renderer.
- The extension still owns extension-specific catalog, history, notes, and LLM code. Do not migrate it to core as incidental cleanup. Make a deliberate, scoped extraction only when both clients need the behavior.

## Build And Test

- Use npm workspaces from the repository root. Add a dependency only to the workspace that owns it: `npm install <package> -w <workspace-name>`.
- Run `npm run compile` after source changes. It builds core before compiling the extension.
- For core-only work, use `npm run build -w @agent-resume/core` and its package test script when applicable.
- For desktop work, use `npm run dev:desktop` for daily watch-mode development (see [`apps/desktop/README.md`](../../apps/desktop/README.md)); use `npm run build:desktop` for full builds; use `npm run dev:mac -w @agent-resume/desktop` on macOS to verify the packaged `.app` path; use `npm run pack:desktop` before distribution tests.
- User-facing extension strings require `npm run i18n:check`. The checker validates `t()` references, webview string consumers, and all locale catalog keys.
- Context-menu contribution changes require `node scripts/patch-project-menu-package.mjs`, then `npm run test:menus`. The patch script updates both `package.json` and `package-vscode.json`.
- Extension contributions, commands, views, or activation events require `npm run install:local` and **Developer: Reload Window** to test the installed extension.

## Data Contracts

- `~/.agent-resume-panel` is the default shared panel home. It contains `catalog.db`, `settings.json`, notes, and ACP data. Preserve the configurable panel-home flow.
- Catalog records are indexes over provider-owned local transcripts. Do not turn a catalog hide/remove action into deletion of a provider's native session data.
- Keep extension and desktop settings compatible where they share panel-home, catalog, LLM, and memory values.
- Use strict types for new domain flows; avoid `any` and avoid bypassing public core exports with deep imports from another workspace.
