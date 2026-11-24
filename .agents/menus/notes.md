# Notes Feature Map

> Parent index: `.agents/menus-index.md`
>
> **Scope:** Notes live as Markdown files on disk under panel home; `packages/core/src/notes/` provides storage/indexing helpers and `apps/extension/src/notes/` provides the VS Code sidebar UI.

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| note model and filesystem | `packages/core/src/notes/` | Markdown files live on disk; catalog stores the index. Covers paths, naming, frontmatter, assets, links, and reconciliation. |
| note association links (tree) | `packages/core/src/notes/links.ts`, `catalog.db` `note_links` | Project-note parent/child tree (one parent). |
| extension notes sidebar and commands | `apps/extension/src/notes/` | Tree provider, note commands, import, image insertion, and local file operations. |
| extension catalog note flags | `apps/extension/src/catalog/notes.ts` | Reflects note presence in session and project UI. |

## Constraints

- Note bodies and assets are user-owned files in panel home. Keep catalog index and disk operations consistent.
- Renames must preserve asset-directory naming and rewrite relative asset references through existing helpers.
- Render Markdown with sanitization; do not inject raw note content as trusted HTML.
