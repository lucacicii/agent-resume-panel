# Notes Feature Map

> Parent index: `.agents/menus-index.md`
>
> **Scope:** Notes share on-disk files and core helpers; extension and desktop each have their own UI and indexing entry points.

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| shared note model and filesystem | `packages/core/src/notes/` | Markdown files live on disk; catalog stores the index. Covers paths, naming, frontmatter, assets, reconciliation, and search. |
| extension notes sidebar and commands | `src/notes/` | Tree provider, note commands, import, image insertion, and local file operations. |
| extension catalog note flags | `src/catalog/notes.ts` | Reflects note presence in session and project UI. |
| desktop notes service | `apps/desktop/src/main/notesService.ts`, `apps/desktop/src/main/noteIndexer.ts` | Main-process note operations and vector indexing. |
| desktop notes UI | `apps/desktop/src/renderer/{index.html,app.js,styles.css}` | List, editor, preview, search, import, and attachment interactions. |

## Constraints

- Note bodies and assets are user-owned files in panel home. Keep catalog index and disk operations consistent.
- Renames must preserve asset-directory naming and rewrite relative asset references through existing helpers.
- Render Markdown with sanitization; do not inject raw note content as trusted HTML.
