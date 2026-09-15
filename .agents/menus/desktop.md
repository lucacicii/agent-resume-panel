# Electron Desktop Feature Map

> Parent index: `.agents/menus-index.md`
>
> **Scope:** Desktop is an independent product. It does not use VS Code APIs, extension webviews, or extension locale files. Shared behavior comes from `@agent-resume/core` and panel-home data only. See [`.agents/extended/product-independence.md`](../extended/product-independence.md).

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| Electron lifecycle and application IPC | `apps/desktop/src/main/main.ts` | Window setup, session synchronization, IPC handlers, and core orchestration. |
| narrow IPC helper | `apps/desktop/src/main/ipcUtils.ts` | Shared error boundary for selected IPC routes. |
| preload API | `apps/desktop/src/preload/preload.ts` | Typed bridge exposed as `agentResume`; update alongside matching main and renderer work. |
| embedded terminal | `apps/desktop/src/main/ptyHost.ts` | Lazy loads node-pty so terminal failures do not block other desktop functions. |
| Workbench ACP chat | `apps/desktop/src/main/acp/*`, `renderer-react/features/workbench/AcpChatView.tsx` | New-session ACP targets open a visual chat pane in the xterm tab strip; data under `panelHome/acp`. |
| notes indexing and memory scheduler | `apps/desktop/src/main/{noteIndexer,scheduler}.ts` | Background tasks and renderer progress events. |
| renderer runtime | `apps/desktop/src/renderer-react/main.tsx`, `apps/desktop/src/renderer/index.html` | React runtime. Host divs (`react-chrome`, `react-workbench`, `react-notes`, `react-im`, `react-settings`) anchor each panel's portal. |
| primary navigation shell | `apps/desktop/src/renderer-react/components/AppChrome.tsx` | Rail tabs are `workbench` / `notes`; **Workbench is the default landing tab**. Other surfaces switch tabs through the `agent-resume:tab-request` / `agent-resume:tab-change` events, not by direct state access. |
| work item live rollup | `apps/desktop/src/renderer-react/features/workbench/sessionStatus/workItemRollup.ts` | Shared `rollupDot()` / `rank()` / `needsYou()` / `LIVE_RANK` used by the Workbench work item list. Live dots only cover sessions open in this run; `lastExitWaiting` covers sessions that were waiting when the app last quit. |
| IM rooms | `apps/desktop/src/main/im/*`, `renderer-react/features/im/` | User-created project rooms; quote + @ dispatch through existing ACP host (Pi / Claude / Codex). Data in `desktop.db` `im_*` tables. Embedded inside the Workbench panel, not a rail tab. |
| renderer static assets and vendor CSS | `apps/desktop/scripts/copy-renderer.cjs` | Copies `src/renderer` next to `index.html` and stages vendor CSS (xterm, highlight.js) plus the app icon into `dist`. |
| renderer bundle | `apps/desktop/scripts/build-renderer-react.mjs` | esbuild bundle of `src/renderer-react/main.tsx` plus the diff worker entry points. |
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
- Any new capability follows main handler, preload method, and renderer call as one contract change.
- Desktop UI visual work must follow [`.agents/extended/ui-design-system.md`](../extended/ui-design-system.md) (macOS HIG tokens, components, migration phases).
- Use `pnpm run build:desktop` for compilation and asset verification; use `pnpm run dev:desktop` for interactive checks. `build:desktop` runs both desktop type checks, but it is a distribution step — during development run `pnpm run typecheck:desktop` (root) instead, since neither root `compile` nor `test:renderer` type-checks desktop code.
- Desktop releases are independent: bump `apps/desktop/package.json`, then `pnpm run release:desktop:mac`.
