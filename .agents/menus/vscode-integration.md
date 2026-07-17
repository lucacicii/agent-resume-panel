# VS Code Integration Feature Map

> Parent index: `.agents/menus-index.md`
>
> **Scope:** Extension-only surface. No Electron IPC, no `desktop.*` locale keys, no desktop renderer. See [`.agents/extended/product-independence.md`](../extended/product-independence.md).

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| activation and command registration | `apps/extension/src/extension.ts` | Primary composition root for views, commands, and refresh flows. |
| tree views and drag/drop | `apps/extension/src/tree/`, `apps/extension/src/gtd/`, `apps/extension/src/notes/`, `apps/extension/src/acp/acpChatTree.ts` | Sessions, ACP Chats, GTD, and Notes sidebar surfaces. |
| settings UI and sync bridge | `apps/extension/src/settings/` | Extension settings webview, schema, and synchronized panel-home settings values. |
| context menus | `apps/extension/src/menu/`, `apps/extension/scripts/generate-*-menu-contributions.mjs` | Generated project, session, and handoff contributions. |
| package metadata | `apps/extension/package.json`, `apps/extension/package-vscode.json` | Dual marketplace package manifests. |
| webview media | `apps/extension/media/`, `apps/extension/src/webview/uiStrings.ts` | Webview scripts consume localized string bundles. |
| localization runtime | `apps/extension/src/i18n/`, `apps/extension/src/webview/uiStrings.ts` | `t()` catalogs, UI locale context, menu command localization, and webview string exports. |
| locale catalogs and checks | `apps/extension/locales/*.json`, `apps/extension/scripts/check-i18n.mjs`, `apps/extension/scripts/menu-i18n.mjs` | Extension keys only; checker also validates desktop locales in a separate pass. |

## Constraints

- Menu contribution blocks are generated. Run `node apps/extension/scripts/patch-project-menu-package.mjs` before tests instead of manually changing those blocks.
- Installed extension changes are visible only after `pnpm run install:local` and a VS Code window reload.
- Keep extension i18n changes synchronized across `t()` keys, `uiStrings.ts`, webview consumers, and every file in `apps/extension/locales/`.
- Do not add `desktop.*` keys to extension locales. Desktop strings belong in `scripts/desktop-i18n-catalog.json`.
- Extension releases (VSIX) are independent from desktop DMG releases.