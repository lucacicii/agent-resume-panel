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
| Memory | List daily digests; pick date; **生成 / 覆盖该日回顾** (LLM). Loads transcript excerpts when `session_summary` is missing |
| Settings | Read/write `~/.agent-resume-panel/settings.json` (chat + embedding OpenAI-compatible) |

### Memory notes

- Same calendar day reuses id `daily:YYYY-MM-DD` (regenerate overwrites).
- `memory.includeTranscripts` (default true), `maxSessionsPerDigest` (40), `snippetMaxChars` (2500).
- Agent homes default to the same paths as the VS Code extension (`~/.codex`, `~/.claude`, …); override via `agentHomes` in settings.json if needed.
- **Shared with VS Code extension**: saving LLM settings (or API key) in the extension updates the same `settings.json`; Desktop can use that key without re-entry. Extension also reads `settings.json` when VS Code has no explicit LLM override / no Secret.

See [`docs/mac-agent-memory-vision.md`](../../docs/mac-agent-memory-vision.md) for product decisions.
