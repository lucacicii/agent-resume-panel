# Agent Resume Desktop (v0.3)

Electron app: Sessions, Memory digests (daily/weekly/monthly), semantic search, optional schedule, and **Meta-Agent** chat grounded in local memory.

## Develop

```bash
npm install
npm run build:core
npm run dev:desktop
```

## Tabs

| Tab | Capability |
|-----|------------|
| Sessions | Catalog sessions from shared `catalog.db` |
| Memory | **Month calendar** for digests; detail pane; tools fold (generate / backfill / search / GTD) |
| **Agent** | Meta-Agent Q&A with citations; copy answer / resume cmd / handoff brief |
| Settings | LLM + embedding + schedule (`memory.enabled`, default off) |

## Meta-Agent

1. Generate some digests (Memory tab) with embedding configured when possible.
2. Open **Agent**, ask e.g. “上周做了什么?”
3. Answer shows source chips; use:
   - **Copy answer**
   - **Copy resume cmd** (needs `memory_links` on a daily digest)
   - **Copy handoff brief** (Markdown for another CLI)

Retrieval: embedding search first; if empty/unavailable, falls back to recent daily/weekly digests.

## Batch backfill digests

On the **Memory** tab: **预览范围** / **开始批量生成**.

- Scans all catalog sessions by local calendar day
- Generates **daily → weekly → monthly** for those periods
- Options: max days (default 400), skip existing ok jobs, skip embedding
- Bulk daily uses title/summary only (no transcript) to control cost

## Memory → GTD + todolist (v0.4)

On the **Memory** tab (tools fold):

1. **分析预览** — LLM proposals only (no GTD / no md write); expand to preview `todolist.md`
2. Check items → **应用选中（写 GTD + md）** — then writes `session_gtd` + audit + `notes/.../todolist.md`

Marked as AI-applied. No VS Code extension code changes.

## Shared with VS Code

`~/.agent-resume-panel/settings.json` is shared (LLM key/model). Extension aligns on read/write.

See [`docs/mac-agent-memory-vision.md`](../../docs/mac-agent-memory-vision.md).
