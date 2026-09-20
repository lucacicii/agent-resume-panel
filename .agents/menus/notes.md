# Notes Feature Map

> Parent index: `.agents/menus-index.md`
>
> **Scope:** Notes share on-disk files and core helpers; extension and desktop each have their own UI and indexing entry points.

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| shared note model and filesystem | `packages/core/src/notes/` | Markdown files live on disk; catalog stores the index. Covers paths, naming, frontmatter, assets, reconciliation, and search. |
| note association links (tree) | `packages/core/src/notes/links.ts`, `catalog.db` `note_links` | Project-note parent/child tree (one parent); Desktop list shows roots only; right pane shows top-down tree. |
| extension notes sidebar and commands | `src/notes/` | Tree provider, note commands, import, image insertion, and local file operations. |
| extension catalog note flags | `src/catalog/notes.ts` | Reflects note presence in session and project UI. |
| desktop notes service | `apps/desktop/src/main/notesService.ts`, `apps/desktop/src/main/noteIndexer.ts` | Main-process note operations, links IPC, and vector indexing. |
| desktop board notes module | `apps/desktop/src/renderer-react/features/notes/NotesView.tsx` | Board-window notes view: searchable root-note list grouped into tasks, project notes, and library notes, with new/import actions. |
| desktop note editing surface | `apps/desktop/src/renderer-react/features/workbench/notes/NotePaneView.tsx`, `notes/StandaloneNoteWindow.tsx` | Single-note pane (link tree, edit/preview, find, attachments, GTD status) reused by the workbench and the board notes view, plus standalone floating note windows. |

## Constraints

- Note bodies and assets are user-owned files in panel home. Keep catalog index and disk operations consistent.
- Renames must preserve asset-directory naming and rewrite relative asset references through existing helpers.
- Render Markdown with sanitization; do not inject raw note content as trusted HTML.
