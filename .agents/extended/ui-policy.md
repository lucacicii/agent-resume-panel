# UI Policy

Extension and desktop are **independent UI products**. See [product-independence.md](product-independence.md).

## VS Code Extension

- Use VS Code TreeView, command, QuickPick, InputBox, and webview APIs before building custom interaction layers.
- Keep sidebar labels, command titles, settings-panel text, and webview UI strings in the extension i18n flow (`apps/extension/src/i18n/`, `apps/extension/src/webview/uiStrings.ts`, and `apps/extension/locales/*.json`).
- Preserve existing context-menu generation. Do not manually edit generated contribution blocks in `package.json` or `package-vscode.json`.
- VS Code extension and webview UI follow the VS Code platform design language. The macOS design system in [`ui-design-system.md`](ui-design-system.md) does **not** apply to extension surfaces.

## Electron Desktop

- **Locales:** Desktop UI copy uses `desktop.*` keys in `apps/desktop/locales/`. Do not reuse extension `t()` catalogs or webview string files in the renderer.
- **Visual design:** All desktop UI decisions — colors, typography, spacing, components, and layout — must follow [`ui-design-system.md`](ui-design-system.md). When refactoring `styles.css`, execute one migration phase at a time (see design system §7).
- The renderer is intentionally framework-free: `index.html` defines the shell, `app.js` owns behavior and DOM updates, and `styles.css` owns presentation. Do not introduce React, Vue, or a UI library for an isolated change.
- The top-level product areas are Memory, Ask, Workbench, Notes, Sessions, and Settings. Extend their existing tab, sheet, list, and toolbar patterns rather than creating a parallel navigation model.
- Render untrusted Markdown through the existing `marked` plus DOMPurify path. Do not assign external or user-authored HTML directly to `innerHTML`.
- New renderer capabilities require an explicit preload API and main-process IPC handler. Do not expose Electron or Node primitives to the renderer.
- Keep controls keyboard-accessible: use semantic buttons and inputs, labels or `aria-label`, stable empty/loading/error states, and visible `:focus-visible` rings per the design system.

## General

- Reuse existing CSS classes and design tokens before adding new ones. Prefer semantic tokens (`--color-*`) over hard-coded hex values in new rules.
- Verify desktop layout at its 860px minimum width and at the normal 1120px window width after visual changes.
- Retain existing text language conventions in the surface being modified; do not silently convert unrelated UI copy.
- After desktop visual changes: `npm run build:desktop`; on macOS, also run `npm run dev:mac -w @agent-resume/desktop` and complete the verification checklist in `ui-design-system.md` §8.