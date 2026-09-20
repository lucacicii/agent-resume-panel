# AI Task Router

This repository is a pnpm workspace monorepo with **two independent products** — the Agent Resume Panel VS Code extension and the Agent Resume Desktop Electron app — plus shared `@agent-resume/core`. It requires Node.js `>=22.13` and pnpm `11.13.1` for development. The products share panel-home data contracts but have separate codebases, locales, versions, UI stacks, and release pipelines.

Read [`.agents/extended/product-independence.md`](.agents/extended/product-independence.md) when a task might touch both products, shared core, i18n, settings, or release tooling.

## Boundaries

- Do not modify Java code.
- Never commit API keys, publish tokens (`OVSX_PAT`, Marketplace tokens), or `.env` files.
- Do not alter existing user changes outside the requested task.

## Engineering Principles

- Do not target backward compatibility. Remove deprecated code paths directly instead of preserving them through compatibility layers, fallback mechanisms, or migration schemes.
- Use the simplest implementation that fully satisfies the current requirements. Avoid abstractions, configuration options, and indirection without demonstrated need.
- Build incrementally and in layers. First deliver the smallest end-to-end version that works, then add functionality gradually on top of a stable product. Do not replace a usable product with immature complexity.
- Keep components modular, with clear boundaries between responsibilities and concerns.
- Prefer mature, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Before implementing functionality or adding a dependency, evaluate the capabilities of existing project dependencies. Consult their documentation and type definitions rather than assuming they cannot meet the requirement.
- Make architectural decisions for long-term evolution. Avoid short-term solutions that are expected to require replacement later.
- Before designing a solution, research how mature products solve similar problems. Prefer proven patterns and conventions over designing a new approach from scratch.

## Task Routing

Read [`.agents/menus-index.md`](.agents/menus-index.md) before locating feature code only when the request names a product area or user-visible feature without a file path or searchable identifier. Then read only the mapped file in `.agents/menus/`.

Skip the menu index when the user supplies a concrete path, a searchable identifier, or a task limited to tooling, configuration, shared infrastructure, tests, or documentation.

Load these references only when relevant:

- Product boundaries (extension vs desktop vs core): [`.agents/extended/product-independence.md`](.agents/extended/product-independence.md)
- TypeScript, VS Code extension, Electron, workspace, or build work: [`.agents/extended/dev-rules.md`](.agents/extended/dev-rules.md)
- UI or renderer work: [`.agents/extended/ui-policy.md`](.agents/extended/ui-policy.md) (desktop + extension UI rules; desktop follows [Apple macOS HIG](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos))
- Filesystem, process, database, authentication, network, or secret handling: [`.agents/extended/security.md`](.agents/extended/security.md)

## Verification

Run checks for the product you changed:

- **Shared / extension TypeScript** — `pnpm run compile` after source changes.
- **Desktop TypeScript (main, preload, renderer)** — `pnpm run typecheck:desktop` after any desktop source change. `pnpm run compile` does **not** cover desktop, and `pnpm run test:renderer` does not type-check; `pnpm run build:desktop` does, but only runs before distribution.
- **Desktop renderer tests** — `pnpm --filter @agent-resume/desktop run test:renderer`; root `test:desktop` does not run them.
- **Extension strings** — `pnpm run i18n:check` after `apps/extension/locales/*.json` or `t()` / webview string changes.
- **Desktop strings** — update `scripts/desktop-i18n-catalog.json`, run `pnpm run merge:desktop-i18n`, then `pnpm run i18n:check`.
- **Translation coverage** — `pnpm run i18n:check:translations` after locale work in either product.
- **Extension menus** — `pnpm run test:menus` after menu contribution generators change.
- **Extension contributions** — `pnpm run install:local` (all detected editors) or `pnpm run install:local-vscode` (VS Code only), then **Developer: Reload Window**.
- **Desktop build** — `pnpm run build:desktop` or `pnpm run pack:desktop` before distribution. `build:desktop` already runs the desktop type checks.

Use `/qa` and `/review` for their respective quality workflows when available.
