# Electron Desktop Feature Map

> Parent index: `.agents/menus-index.md`
>
> **Scope:** Desktop is an independent product. It does not use VS Code APIs, extension webviews, or extension locale files. Shared behavior comes from `@agent-resume/core` and panel-home data only. See [`.agents/extended/product-independence.md`](../extended/product-independence.md).

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| Electron lifecycle and application IPC | `apps/desktop/src/main/main.ts` | Window setup, session synchronization, IPC handlers, and core orchestration. |
| task workbench windows | `apps/desktop/src/main/taskWindows.ts` | One window per workbench (singleton by workbenchId, four-window cap), and the registry the rest of main routes through. |
| narrow IPC helper | `apps/desktop/src/main/ipcUtils.ts` | Shared error boundary for selected IPC routes. |
| preload API | `apps/desktop/src/preload/preload.ts` | Typed bridge exposed as `agentResume`; update alongside matching main and renderer work. |
| embedded terminal | `apps/desktop/src/main/ptyHost.ts` | Lazy loads node-pty so terminal failures do not block other desktop functions. Each session is owned by the one window that renders it (`ownerWebContentsId`); workbenchId on the session is what lets a reopened workbench adopt a running pty instead of spawning a second agent. |
| Workbench ACP chat | `apps/desktop/src/main/acp/*`, `renderer-react/features/workbench/AcpChatView.tsx` | New-session ACP targets open a visual chat pane in the xterm tab strip; data under `panelHome/acp`. |
| notes indexing and memory scheduler | `apps/desktop/src/main/{noteIndexer,scheduler}.ts` | Background tasks and renderer progress events. |
| renderer runtime | `apps/desktop/src/renderer-react/main.tsx`, `apps/desktop/src/renderer/index.html` | React runtime, one entry per window mode: `main` (GTD board + settings), `task` (one workbench), `standalone-note`, `browser`. |
| primary navigation shell | `apps/desktop/src/renderer-react/components/AppChrome.tsx` | Board window header (bell, account/settings menu, floating-note dots). Workbenches are separate windows, so the board opens and focuses those instead of switching views inside itself. |
| task live rollup | `apps/desktop/src/renderer-react/features/workbench/sessionStatus/taskRollup.ts`, `apps/desktop/src/shared/workbenchSelection.ts` | Shared `rollupDot()` / `rank()` / `needsYou()` plus the one urgency table and `rollupSessionDotStatus()` in `shared/workbenchSelection.ts`. Live dots only cover sessions open in this run; `lastExitWaiting` covers sessions that were waiting when the app last quit. Every workbench window reports its own per-pane dots (`workbench:activeSessions`, each tagged with `workbenchId`); main merges them and both the tray and the GTD board roll them up per workbench with the shared function — one tray dot per workbench (an open workbench with no session yet still shows a gray dot), click focuses or opens that workbench window. |
| renderer static assets and vendor CSS | `apps/desktop/scripts/copy-renderer.cjs` | Copies `src/renderer` next to `index.html` and stages vendor CSS (xterm, highlight.js) plus the app icon into `dist`. |
| renderer bundle | `apps/desktop/scripts/build-renderer-react.mjs` | esbuild bundle of `src/renderer-react/main.tsx` plus the diff worker entry points. |
| file watching for Explorer / Git | `apps/desktop/src/main/workbenchWatcher.ts` | One watch per project root, shared by every window showing it, with per-window visible/hidden state so hidden windows neither receive changes nor keep the poll timer alive. |
| shared concurrent git queries | `apps/desktop/src/main/gitQueryShare.ts` | `git status` and the periodic fetch are polled per window; identical queries running at the same time are answered once. Only in-flight queries are shared, so no result is ever served stale. |
| workspace mentions, `arpm`, composerMentions | `packages/core/src/settings/{mentions,mentionPrompt,arpmCli}.ts`, `apps/desktop/src/main/arpmInstall.ts`, Settings Workbench pane, Workbench new-session picker | Global work/reference packs in `settings.desktop.json`. Desktop installs `~/.local/bin/arpm` on launch. User docs: `docs/desktop/workspace-mentions.md`. |

## Desktop i18n

| Concern | Path | Notes |
| --- | --- | --- |
| locale catalogs | `apps/desktop/locales/{en,zh-cn,ja}.json` | Shipped keys only; `desktop.*` namespace. |
| catalog source | `scripts/desktop-i18n-catalog.json` | Authoritative desktop strings; run `pnpm run merge:desktop-i18n` to regenerate locales. |
| settings aliases | `scripts/desktop-settings-i18n-aliases.json`, `scripts/desktop-settings-i18n-overrides.mjs` | Map shared setting labels where desktop reuses extension wording. |
| renderer bundle | `apps/desktop/scripts/copy-renderer.cjs` | Copies merged locales to `dist/locales` at build time. |

Do not edit extension `apps/extension/locales/` for desktop UI copy.

## Constraints

- Keep `contextIsolation: true` and `nodeIntegration: false`.
- A workbench exists in exactly one window: `workbenchId` is the window key, and the board window hosts no workbench. Anything that opens a session (task card, chip, tray dot, waiting notification, resumed session) must route through `taskWindows.ts` rather than assuming the board window can host a pane.
- Any new capability follows main handler, preload method, and renderer call as one contract change.
- Desktop UI visual work must follow [`.agents/extended/ui-policy.md`](../extended/ui-policy.md) (Electron desktop rules) and the Apple macOS HIG. macOS conformance rules live in that policy file — read it before touching windows, menus, dialogs, or appearance.
- Use `pnpm run build:desktop` for compilation and asset verification; use `pnpm run dev:desktop` for interactive checks. `build:desktop` runs both desktop type checks, but it is a distribution step — during development run `pnpm run typecheck:desktop` (root) instead, since neither root `compile` nor `test:renderer` type-checks desktop code.
- Desktop releases are independent: bump `apps/desktop/package.json`, then `pnpm run release:desktop:mac`.
