# Agent & Contributor Conventions

Repository conventions for human contributors and coding agents.

## Build & verify

- After code changes, run `npm run compile`.
- After changing user-facing strings or `locales/*.json`, run `npm run i18n:check`.
- After changing menu contribution generators, run `npm run test:menus`.
- When changes affect extension contributions (menus, commands, views, activation events, or anything the installed extension must show in VS Code), run `npm run install:local`, then reload VS Code with **Developer: Reload Window**. The extension Refresh command only reloads session data; it does not reload `package.json` contribution points.

## Scope

- Do not modify Java code (not part of this extension).
- Do not copy this repository's extension build/install workflow into other projects unless they define the same rules.

## Secrets

Never commit API keys, publish tokens (`OVSX_PAT`, Marketplace tokens), or `.env` files. See [`DEVELOPMENT.md`](DEVELOPMENT.md) for publish setup.

For full setup, packaging, and menu contribution workflows, see [`DEVELOPMENT.md`](DEVELOPMENT.md).