# UI Policy

## VS Code Extension

- Use VS Code TreeView, command, QuickPick, InputBox, and webview APIs before building custom interaction layers.
- Keep sidebar labels, command titles, settings-panel text, and webview UI strings in the extension i18n flow (`apps/extension/src/i18n/`, `apps/extension/src/webview/uiStrings.ts`, and `apps/extension/locales/*.json`).
- Preserve existing context-menu generation. Do not manually edit generated contribution blocks in `package.json` or `manifest/base.*.json`.
- VS Code extension and webview UI follow the VS Code platform design language.
- Render untrusted Markdown through the existing `marked` plus DOMPurify path. Do not assign external or user-authored HTML directly to `innerHTML`.
- Keep controls keyboard-accessible and provide stable empty/loading/error states.
