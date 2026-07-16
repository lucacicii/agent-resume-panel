# Product Independence

This monorepo ships **two independent products** plus a shared library. Treat them as separate apps that happen to share data contracts and some domain code.

## Products

| Product | Workspace | Version file | Primary deliverable |
| --- | --- | --- | --- |
| VS Code extension | `agent-resume-panel` (`apps/extension/`) | `apps/extension/package.json` | `.vsix` → VS Marketplace / Open VSX |
| Electron desktop | `@agent-resume/desktop` (`apps/desktop/`) | `apps/desktop/package.json` | `.dmg` → `thunder-luc/agent-resume-desktop-doc` GitHub Releases |
| Shared core | `@agent-resume/core` (`packages/core/`) | `packages/core/package.json` | npm workspace library (not published standalone) |

Versions, release cadence, and changelogs are **independent**. Bumping the extension does not bump desktop, and vice versa.

## What Is Shared vs Owned

### Shared (intentional contracts only)

- **Panel home** — default `~/.agent-resume-panel`; both products read/write here.
- **`catalog.db`** — session index; extension owns the frozen base schema in `apps/extension/src/catalog/db.ts`; desktop adds tables via `ensureDesktopCatalogSchema` in core.
- **`packages/core`** — reusable domain helpers (session sync, settings resolution, LLM, memory, notes filesystem, GTD persistence). Extract to core only when both clients need the same behavior.
- **Note files on disk** — Markdown under panel home; catalog indexes them.

### Extension-only

- VS Code APIs: tree views, commands, webviews, SecretStorage, activation.
- **ACP Chat** — entire `apps/extension/src/acp/` stack; no desktop equivalent.
- Extension settings — VS Code `agentResume.*` + `settings.json` LLM bridge.
- Extension i18n — `apps/extension/locales/{en,zh-cn,ja}.json`; keys are extension-scoped (no `desktop.*`).
- Extension packaging — `npm run package`, `install:local`, menu contribution generators.

### Desktop-only

- Electron main/preload/renderer — `apps/desktop/src/{main,preload,renderer}/`.
- Embedded terminal (`node-pty`), Workbench, Memory calendar, Ask UI, desktop scheduler.
- Desktop settings — `settings.desktop.json` under panel home.
- Desktop-private runtime — `.desktop/` (`desktop.db`, workbench scratch).
- Desktop i18n — `apps/desktop/locales/{en,zh-cn,ja}.json`; keys are `desktop.*` only.
- Desktop packaging — `npm run pack:desktop`, `release:desktop:mac`.

## i18n Separation

Extension and desktop **do not share locale JSON files**.

| Surface | Locale source | Key namespace | Checker |
| --- | --- | --- | --- |
| Extension | `apps/extension/locales/*.json` | `tree.*`, `settings.*`, `webview.*`, etc. | `npm run i18n:check` |
| Desktop | `apps/desktop/locales/*.json` (generated from `scripts/desktop-i18n-catalog.json`) | `desktop.*` only | `npm run i18n:check` (desktop section) |
| Translation coverage | — | — | `npm run i18n:check:translations` |

Rules:

- Do **not** add `desktop.*` keys to extension locales or extension keys to desktop locales.
- Desktop locale changes go through `scripts/desktop-i18n-catalog.json` and `npm run merge:desktop-i18n`.
- Do **not** run `build:en-catalog` (removed); extension `en.json` is the source of truth.
- `packages/core` may reference i18n keys via `pt()` / `progressText()`; the checker scans core for both products.

## UI Separation

| Surface | Design language | Policy doc |
| --- | --- | --- |
| VS Code extension | VS Code platform (native tree views, webviews) | `.agents/extended/ui-policy.md` § VS Code |
| Electron desktop | macOS HIG tokens and components | `.agents/extended/ui-design-system.md` |

Do not apply desktop visual tokens to extension webviews, or VS Code patterns to the desktop renderer.

## Code Change Routing

Before editing, identify the target product:

1. **Extension task** — stay in `apps/extension/`; load `.agents/menus/vscode-integration.md` for shell/contribution work.
2. **Desktop task** — stay in `apps/desktop/`; load `.agents/menus/desktop.md`.
3. **Shared domain** — change `packages/core/` and update both consumers only when the contract is intentionally shared.
4. **Never** copy extension UI into desktop (or reverse) as a shortcut.
5. **Never** assume a string, setting, or feature exists in the other product.

## Verification By Product

| Change type | Extension | Desktop |
| --- | --- | --- |
| TypeScript / compile | `npm run compile` | `npm run build:desktop` |
| User-facing strings | `npm run i18n:check` on extension locales | `npm run i18n:check` + `merge:desktop-i18n` if catalog changed |
| Translation audit | `npm run i18n:check:translations` | same (covers both) |
| Menu contributions | `npm run test:menus`, `install:local`, reload VS Code | — |
| Pack / release smoke | — | `npm run pack:desktop` or `release:desktop:mac` |

## Release Pipelines

- **Extension** — update `apps/extension/CHANGELOG.md`, then workspace scripts in `apps/extension/package.json`; publish via Marketplace / Open VSX tooling.
- **Desktop** — update `apps/desktop/CHANGELOG.md`, then `npm run release:desktop:mac -- --build`; user docs live in `agent-resume-desktop-doc` repo.

A desktop release does not require an extension release, and the reverse is also true.