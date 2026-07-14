# UI Policy

## VS Code Extension

- Use VS Code TreeView, command, QuickPick, InputBox, and webview APIs before building custom interaction layers.
- Keep sidebar labels, command titles, settings-panel text, and webview UI strings in the extension i18n flow (`src/i18n/`, `src/webview/uiStrings.ts`, and `locales/*.json`).
- Preserve existing context-menu generation. Do not manually edit generated contribution blocks in `package.json` or `package-vscode.json`.

## Electron Desktop

- The renderer is intentionally framework-free: `index.html` defines the shell, `app.js` owns behavior and DOM updates, and `styles.css` owns presentation. Do not introduce React, Vue, or a UI library for an isolated change.
- The top-level product areas are Memory, Ask, Workbench, Notes, Sessions, and Settings. Extend their existing tab, sheet, list, and toolbar patterns rather than creating a parallel navigation model.
- Render untrusted Markdown through the existing `marked` plus DOMPurify path. Do not assign external or user-authored HTML directly to `innerHTML`.
- New renderer capabilities require an explicit preload API and main-process IPC handler. Do not expose Electron or Node primitives to the renderer.
- Keep controls keyboard-accessible: use semantic buttons and inputs, labels or `aria-label`, and stable empty/loading/error states.

## General

- Reuse local CSS classes and controls before adding new ones. Verify desktop layout at its 860px minimum width and at the normal 1120px window width.
- Retain existing text language conventions in the surface being modified; do not silently convert unrelated UI copy.
