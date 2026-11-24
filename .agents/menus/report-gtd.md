# GTD Feature Map

> Parent index: `.agents/menus-index.md`
>
> **Scope:** Session and note GTD tagging in the VS Code extension sidebar and `@agent-resume/core`.

| Feature keywords | Code path | Notes |
| --- | --- | --- |
| session GTD persistence | `packages/core/src/gtd/`, catalog `session_gtd` table | Statuses are stored against catalog sessions. |
| note GTD persistence | `packages/core/src/notes/gtd.ts` | Statuses are stored against notes. |
| extension GTD tree | `apps/extension/src/gtd/`, `apps/extension/src/catalog/gtd.ts` | VS Code sidebar GTD integration. |
