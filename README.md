# Agent Resume Panel

Monorepo for two independent products that share local data under `~/.agent-resume-panel`:

| Product | Directory | Install | User docs |
|---------|-----------|---------|-----------|
| **VS Code extension** | [`apps/extension/`](apps/extension/) | [Marketplace](https://marketplace.visualstudio.com/items?itemName=lucacicii.agent-resume-panel-v2) | [docs/panel](docs/panel/README.md) |
| **Desktop app (macOS)** | [`apps/desktop/`](apps/desktop/) | [Download DMG](https://github.com/thunder-luc/agent-resume-panel/releases/latest) | [docs/desktop](docs/desktop/README.md) |

Shared library: [`packages/core/`](packages/core/) (`@agent-resume/core`).

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup, build, test, and release workflows.

Product-specific docs:

- Extension README / Changelog — [`apps/extension/README.md`](apps/extension/README.md), [`apps/extension/CHANGELOG.md`](apps/extension/CHANGELOG.md)
- Desktop README / Changelog — [`apps/desktop/README.md`](apps/desktop/README.md), [`apps/desktop/CHANGELOG.md`](apps/desktop/CHANGELOG.md)
- Desktop dev guide — [`apps/desktop/DEVELOPMENT.md`](apps/desktop/DEVELOPMENT.md)

## License

Copyright (C) 2026 thunder-luc. Licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).

Third-party material is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Feedback

| Product | Issues |
|---------|--------|
| VS Code extension | [Issues](https://github.com/thunder-luc/agent-resume-panel/issues) |
| Desktop app | [Issues](https://github.com/thunder-luc/agent-resume-panel/issues) |