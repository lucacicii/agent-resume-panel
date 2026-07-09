# Agent Resume Desktop (v0.1)

Electron app for Session list, shared `panelHome` settings, and manual **Daily** memory digests.

## Prerequisites

- macOS
- Node 18+
- `sqlite3` CLI on PATH (same as the VS Code extension)
- Catalog data from the extension under `~/.agent-resume-panel/catalog.db` (or configure `panelHome`)

## Develop

From repo root:

```bash
npm install
npm run build:core
npm run dev:desktop
```

## Features (v0.1)

| Tab | Capability |
|-----|------------|
| Sessions | List sessions from shared `catalog.db` |
| Memory | List daily digests; **生成今日回顾** (needs LLM in settings) |
| Settings | Read/write `~/.agent-resume-panel/settings.json` (chat + embedding OpenAI-compatible) |

See [`docs/mac-agent-memory-vision.md`](../../docs/mac-agent-memory-vision.md) for product decisions.
