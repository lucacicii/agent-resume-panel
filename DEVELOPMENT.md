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

Package a local VSIX:

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

## Change Checklist

- Run `npm run compile` after code changes.
- Run `npm run install:local` after changes that affect extension contributions, menus, commands, views, activation events, or anything the installed extension must show in VS Code.
- After `npm run install:local`, reload VS Code with **Developer: Reload Window**.
