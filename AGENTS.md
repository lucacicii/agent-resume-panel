# AI Task Router

This repository is an npm workspaces monorepo for the Agent Resume Panel VS Code extension, its shared TypeScript core, and Electron desktop app.

## Boundaries

- Do not modify Java code.
- Never commit API keys, publish tokens (`OVSX_PAT`, Marketplace tokens), or `.env` files.
- Do not alter existing user changes outside the requested task.

## Task Routing

Read [`.agents/menus-index.md`](.agents/menus-index.md) before locating feature code only when the request names a product area or user-visible feature without a file path or searchable identifier. Then read only the mapped file in `.agents/menus/`.

Skip the menu index when the user supplies a concrete path, a searchable identifier, or a task limited to tooling, configuration, shared infrastructure, tests, or documentation.

Load these references only when relevant:

- TypeScript, VS Code extension, Electron, workspace, or build work: [`.agents/extended/dev-rules.md`](.agents/extended/dev-rules.md)
- UI or renderer work: [`.agents/extended/ui-policy.md`](.agents/extended/ui-policy.md) and [`.agents/extended/ui-design-system.md`](.agents/extended/ui-design-system.md) (desktop visual spec)
- Filesystem, process, database, authentication, network, or secret handling: [`.agents/extended/security.md`](.agents/extended/security.md)

## Verification

- After code changes, run `npm run compile`.
- After changing user-facing strings or `apps/extension/locales/*.json`, run `npm run i18n:check`.
- After changing menu contribution generators, run `npm run test:menus`.
- For VS Code extension contribution changes, run `npm run install:local`, then use **Developer: Reload Window** in VS Code.

Use `/qa` and `/review` for their respective quality workflows when available.
