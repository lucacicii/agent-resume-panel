# Development

内部开发指南：构建、测试与发布 Agent Resume Panel VS Code 扩展与相关产物。

## User-facing documentation

对外用户文档在独立仓库，**不要**把仓库结构、构建命令、源码路径等开发信息写进 doc 仓库 README：

| 产品 | 用户文档 | Issues |
|------|----------|--------|
| VS Code 扩展 | [agent-resume-panel-doc](https://github.com/thunder-luc/agent-resume-panel-doc) | [issues](https://github.com/thunder-luc/agent-resume-panel-doc/issues) |
| Desktop App | [agent-resume-desktop-doc](https://github.com/thunder-luc/agent-resume-desktop-doc) | [issues](https://github.com/thunder-luc/agent-resume-desktop-doc/issues) |

Desktop 专项开发见 [apps/desktop/DEVELOPMENT.md](apps/desktop/DEVELOPMENT.md)。

## Monorepo layout

| 路径 | 说明 |
|------|------|
| `apps/extension/` | VS Code 扩展（源码、manifest、VSIX） |
| `packages/core/` | 共享 TypeScript 核心（`@agent-resume/core`） |
| `apps/desktop/` | Electron 桌面应用 |
| `apps/extension/locales/` | 扩展 i18n 文案（无 `desktop.*` 键） |
| `apps/desktop/locales/` | Desktop i18n 文案（仅 `desktop.*` 键） |
| `apps/extension/media/` | 扩展 Webview 静态资源 |
| `apps/extension/scripts/` | 扩展构建、菜单生成、i18n 检查 |
| `scripts/` | 跨产品脚本（desktop release、i18n merge 等） |

## Secrets & local config

Never commit:

- Open VSX or VS Code Marketplace publish tokens
- LLM API keys (`AGENT_RESUME_LLM_API_KEY` or values stored in VS Code Secret Storage)
- `.env` files or other local credential files

`package.json` sets `"private": true` to prevent accidental npm registry publishing. That flag is unrelated to repository visibility.

## Setup

Install dependencies:

```sh
corepack enable
pnpm install --frozen-lockfile
```

**Do not copy `node_modules` between machines** (especially Intel Mac ↔ Apple Silicon). Sync git + lockfile only, then reinstall.

### Desktop (macOS)

| | Intel Mac | Apple Silicon |
|--|-----------|---------------|
| `pnpm install` / `pnpm run dev:desktop` | ✅ | ✅ |
| `pnpm run pack:desktop` (universal) | ✅ | ✅ |

After install or when Electron / node-pty / pack fails with env-looking errors:

```sh
pnpm run doctor:desktop
```

Compile the extension:

```sh
pnpm run compile
```

For active development, run the TypeScript watcher:

```sh
pnpm run watch
```

## Local Install

Build and install the local VSIX into available VS Code-compatible editors:

```sh
pnpm run install:local
```

Install only into official VS Code via the `code` CLI (does not install into Cursor or VSCodium; requires `code` on PATH):

```sh
pnpm run install:local-vscode
```

After installing, run **Developer: Reload Window** in VS Code. The extension's own refresh command only reloads session data; it does not reload `package.json` contribution points.

## Packaging

Package a local VSIX into `dist/`:

```sh
pnpm run package
```

Build both Open VSX and VS Code Marketplace VSIX files into `dist/`:

```sh
pnpm run build:all
```

## Open VSX

Release notes live in [`apps/extension/CHANGELOG.md`](apps/extension/CHANGELOG.md). Update that file before each Open VSX publish.

Desktop release notes live in [`apps/desktop/CHANGELOG.md`](apps/desktop/CHANGELOG.md). Update that file before `pnpm run release:desktop:mac`.

Publish (requires an [Open VSX access token](https://github.com/eclipse/openvsx/wiki/Deploying-Extensions)):

```sh
export OVSX_PAT=<your-token>
pnpm run publish:openvsx
```

## Project Menu Contributions

When you add, remove, or reorder configurable **project** or **session** context menu actions:

1. Update [`apps/extension/scripts/generate-project-menu-contributions.mjs`](apps/extension/scripts/generate-project-menu-contributions.mjs) / [`apps/extension/src/menu/projectContextMenu.ts`](apps/extension/src/menu/projectContextMenu.ts), or [`apps/extension/scripts/generate-session-menu-contributions.mjs`](apps/extension/scripts/generate-session-menu-contributions.mjs) / [`apps/extension/src/menu/sessionContextMenu.ts`](apps/extension/src/menu/sessionContextMenu.ts).
2. Regenerate menu contributions:

```sh
pnpm run patch:menus
```

This script regenerates menu blocks in `apps/extension/manifest/contributes.generated.json` and updates `base.openvsx.json`, and preserves ACP chat context menu entries.

3. Verify the generator:

```sh
pnpm run test:menus
```

4. Run `pnpm run install:local`, then **Developer: Reload Window**.

## Desktop i18n

Desktop UI strings live under `desktop.*` keys in [`apps/desktop/locales/`](apps/desktop/locales/). After editing [`scripts/desktop-i18n-catalog.json`](scripts/desktop-i18n-catalog.json) or desktop-only overrides, merge into desktop locale files:

```sh
pnpm run merge:desktop-i18n
```

Then run `pnpm run build:desktop` (or `dev:desktop -- --fresh`) so `apps/desktop/dist/locales` picks up the changes.

## Change Checklist

- Run `pnpm run compile` after code changes.
- Run `pnpm run test:menus` after changing project menu generation scripts.
- Run `pnpm run install:local` after changes that affect extension contributions, menus, commands, views, activation events, or anything the installed extension must show in VS Code.
- After `pnpm run install:local`, reload VS Code with **Developer: Reload Window**.
