# Electron Desktop Feature Map

> Parent index: `.agents/menus-index.md`

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| Electron lifecycle and application IPC | `apps/desktop/src/main/main.ts` | Window setup, session synchronization, IPC handlers, and core orchestration. |
| narrow IPC helper | `apps/desktop/src/main/ipcUtils.ts` | Shared error boundary for selected IPC routes. |
| preload API | `apps/desktop/src/preload/preload.ts` | Typed bridge exposed as `agentResume`; update alongside matching main and renderer work. |
| embedded terminal | `apps/desktop/src/main/ptyHost.ts` | Lazy loads node-pty so terminal failures do not block other desktop functions. |
| notes indexing and memory scheduler | `apps/desktop/src/main/{noteIndexer,scheduler}.ts` | Background tasks and renderer progress events. |
| renderer | `apps/desktop/src/renderer/{index.html,app.js,styles.css}` | Framework-free app: Memory, Ask, Workbench, Notes, Sessions, and Settings. |
| renderer vendor bundle | `apps/desktop/src/renderer/vendor-entry/`, `apps/desktop/scripts/build-renderer-vendor.mjs` | CodeMirror, Marked, DOMPurify, Highlight.js, and xterm vendor build. |

## Constraints

- Keep `contextIsolation: true` and `nodeIntegration: false`.
- Any new capability follows main handler, preload method, and renderer call as one contract change.
- Desktop UI visual work must follow [`.agents/extended/ui-design-system.md`](../extended/ui-design-system.md) (macOS HIG tokens, components, migration phases).
- Use `npm run build:desktop` for compilation and asset verification; use `npm run dev:desktop` for interactive checks.
