# Development

This repository is private and used for local VS Code extension development.

## Setup

Install dependencies:

```sh
npm install
```

Compile the extension:

```sh
npm run compile
```

For active development, run the TypeScript watcher:

```sh
npm run watch
```

## Local Install

Build and install the local VSIX into available VS Code-compatible editors:

```sh
npm run install:local
```

After installing, run **Developer: Reload Window** in VS Code. The extension's own refresh command only reloads session data; it does not reload `package.json` contribution points.

## Packaging

Package a local VSIX into `dist/`:

```sh
npm run package
```

Build both Open VSX and VS Code Marketplace VSIX files into `dist/`:

```sh
npm run build:all
```

## Open VSX

Release notes live in [`CHANGELOG.md`](CHANGELOG.md). Update that file before each Open VSX publish.

Publish (requires an [Open VSX access token](https://github.com/eclipse/openvsx/wiki/Deploying-Extensions)):

```sh
export OVSX_PAT=<your-token>
npm run publish:openvsx
```

## Project Menu Contributions

When you add, remove, or reorder configurable **project** or **session** context menu actions:

1. Update [`scripts/generate-project-menu-contributions.mjs`](scripts/generate-project-menu-contributions.mjs) / [`src/menu/projectContextMenu.ts`](src/menu/projectContextMenu.ts), or [`scripts/generate-session-menu-contributions.mjs`](scripts/generate-session-menu-contributions.mjs) / [`src/menu/sessionContextMenu.ts`](src/menu/sessionContextMenu.ts).
2. Regenerate menu contributions:

```sh
node scripts/patch-project-menu-package.mjs
```

This script regenerates the **session** and **project** menu blocks in `package.json` and `package-vscode.json`, and preserves ACP chat context menu entries.

3. Verify the generator:

```sh
npm run test:menus
```

4. Run `npm run install:local`, then **Developer: Reload Window**.

## Change Checklist

- Run `npm run compile` after code changes.
- Run `npm run test:menus` after changing project menu generation scripts.
- Run `npm run install:local` after changes that affect extension contributions, menus, commands, views, activation events, or anything the installed extension must show in VS Code.
- After `npm run install:local`, reload VS Code with **Developer: Reload Window**.
