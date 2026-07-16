# Feature Router Index

Agent Resume Panel is a local-first session manager shipped as **two independent apps** in one monorepo:

- **VS Code extension** (`apps/extension/`) — sidebar sessions, ACP Chat, extension settings, VSIX release.
- **Electron desktop** (`apps/desktop/`) — Memory, Ask, Workbench, embedded terminal, DMG release.
- **Shared core** (`packages/core/`) — optional domain library; not a user-facing product.

They share `~/.agent-resume-panel` data but have separate code, locales, versions, and UI stacks. See [`.agents/extended/product-independence.md`](extended/product-independence.md).

Use this index for feature requests without a concrete path or searchable identifier; read only the matching detail file.

## Product Modules

| Feature keywords | Detail file | Primary surface |
| --- | --- | --- |
| sessions, providers, resume, native rename, transcript preview, search, session manager, project aliases, favorites | `.agents/menus/sessions.md` | VS Code extension and core |
| ACP chat, agent connection, permissions, ACP files, images, handoff | `.agents/menus/acp-chat.md` | VS Code extension |
| GTD, status, tasks, todolist, daily/weekly/monthly digest, memory, Ask, semantic search, usage | `.agents/menus/report-gtd.md` | Core and desktop |
| notes, Markdown, attachments, note import, note search, index | `.agents/menus/notes.md` | Extension, core, and desktop |
| desktop app, Memory calendar, Ask, Workbench, embedded terminal, desktop settings | `.agents/menus/desktop.md` | Electron desktop |
| settings, local storage, LLM configuration, embeddings, panel home, catalog database, usage, session sync | `.agents/menus/infrastructure.md` | Shared infrastructure |
| sidebar, tree views, context menus, commands, package contributions, extension i18n | `.agents/menus/vscode-integration.md` | VS Code extension only |
| desktop i18n, locale catalog, merge pipeline | `.agents/extended/product-independence.md` § i18n | Desktop only (`desktop.*` keys) |

## Cross-Cutting Locations

| Concern | Path | Notes |
| --- | --- | --- |
| Extension entry point | `apps/extension/src/extension.ts` | Registers views, commands, and refresh flows. |
| Extension locales | `apps/extension/locales/{en,zh-cn,ja}.json` | No `desktop.*` keys. |
| Desktop locales | `apps/desktop/locales/{en,zh-cn,ja}.json` | `desktop.*` keys only; merge from `scripts/desktop-i18n-catalog.json`. |
| Shared public API | `packages/core/src/index.ts` | Add reusable domain logic behind this package boundary. |
| Desktop IPC owner | `apps/desktop/src/main/main.ts` | Renderer access must be explicitly exposed through preload. |
| Desktop IPC contract | `apps/desktop/src/preload/preload.ts` | Keep main/preload/renderer API changes synchronized. |
| Desktop renderer | `apps/desktop/src/renderer/{index.html,app.js,styles.css}` | Plain JavaScript and CSS, with CSP enabled. |
| Extension package metadata | `apps/extension/package.json`, `package-vscode.json` | Generated menu blocks must be regenerated, not hand-edited. |
| Desktop release notes | `scripts/desktop-release-notes/`, `agent-resume-desktop-doc/` | Independent from extension VSIX publishing. |

Use `.agents/templates/menus-module.md.template` for new feature maps.
