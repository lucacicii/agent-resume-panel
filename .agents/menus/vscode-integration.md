# VS Code Integration Feature Map

> Parent index: `.agents/menus-index.md`

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| activation and command registration | `src/extension.ts` | Primary composition root for views, commands, and refresh flows. |
| tree views and drag/drop | `src/tree/`, `src/gtd/`, `src/notes/`, `src/acp/acpChatTree.ts` | Sessions, ACP Chats, GTD, and Notes sidebar surfaces. |
| settings UI and sync bridge | `src/settings/` | Extension settings webview, schema, and synchronized panel-home settings values. |
| context menus | `src/menu/`, `scripts/generate-*-menu-contributions.mjs` | Generated project, session, and handoff contributions. |
| package metadata | `package.json`, `package-vscode.json` | Dual marketplace package manifests. |
| webview media | `media/`, `src/webview/uiStrings.ts` | Webview scripts consume localized string bundles. |
| localization runtime | `src/i18n/`, `src/webview/uiStrings.ts` | `t()` catalogs, UI locale context, menu command localization, and webview string exports. |
| locale catalogs and checks | `locales/*.json`, `scripts/check-i18n.mjs`, `scripts/menu-i18n.mjs` | All locale catalogs must retain matching keys; run the i18n check after string changes. |

## Constraints

- Menu contribution blocks are generated. Run `node scripts/patch-project-menu-package.mjs` before tests instead of manually changing those blocks.
- Installed extension changes are visible only after `npm run install:local` and a VS Code window reload.
- Keep extension i18n changes synchronized across `t()` keys, `uiStrings.ts`, webview consumers, and every locale catalog.
