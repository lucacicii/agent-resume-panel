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
| notes indexing and memory scheduler | `apps/desktop/src/main/{noteIndexer,scheduler}.ts` | Background tasks and renderer progress events. |
| renderer | `apps/desktop/src/renderer/{index.html,app.js,styles.css}` | Framework-free app: Memory, Ask, Workbench, Notes, Sessions, and Settings. |
| renderer vendor bundle | `apps/desktop/src/renderer/vendor-entry/`, `apps/desktop/scripts/build-renderer-vendor.mjs` | CodeMirror, Marked, DOMPurify, Highlight.js, and xterm vendor build. |

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
- Use `pnpm run build:desktop` for compilation and asset verification; use `pnpm run dev:desktop` for interactive checks.
- Desktop releases are independent: bump `apps/desktop/package.json`, then `pnpm run release:desktop:mac`.
