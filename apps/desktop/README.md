# Agent Resume Desktop (v0.2)

Electron app for Session list, shared `panelHome` settings, and **Daily / Weekly / Monthly** memory digests with optional semantic search and scheduled jobs.

## Prerequisites

- macOS
- Node 18+
- `sqlite3` CLI on PATH (same as the VS Code extension)
- Catalog data under `~/.agent-resume-panel/catalog.db`

## Develop

```bash
npm install
npm run build:core
npm run dev:desktop
```

## Features

| Tab | Capability |
|-----|------------|
| Sessions | List sessions from shared `catalog.db` |
| Memory | Level filter; generate daily/weekly/monthly; semantic search |
| Settings | LLM + embedding + schedule toggle (`memory.enabled`, default off) |

### Memory notes

- Ids: `daily:YYYY-MM-DD`, `weekly:YYYY-Www` (ISO week), `monthly:YYYY-MM` (regenerate overwrites).
- Weekly prefers existing dailies; monthly prefers weeklies then dailies.
- Semantic search uses OpenAI-compatible embeddings + cosine similarity over `embedding_json`.
- Schedule runs only in **Desktop** when `memory.enabled=true` (daily at hour, weekly previous week on Monday, monthly previous month on day 1).

### Shared with VS Code

Saving LLM settings in the extension writes the same `settings.json`; Desktop and extension share API keys / models.

See [`docs/mac-agent-memory-vision.md`](../../docs/mac-agent-memory-vision.md).
