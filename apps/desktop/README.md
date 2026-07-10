# Agent Resume Desktop

macOS-oriented shell: **Memory** (home calendar), **Ask** (chat over digests), Settings (gear).

## Develop

```bash
npm install
npm run build:core
npm run dev:desktop
```

## Navigation

| Entry | Role |
|-------|------|
| **Memory** (default) | Month calendar + day detail |
| **Ask** | Natural-language Q&A (semantic retrieval + citations + resume/handoff copy) |
| **Sessions** (header) | Reference list + read-only preview (like extension Preview) |
| **⚙** | Settings (`settings.json` shared with VS Code extension) |

### Memory · ⋯ menu

- Generate today's daily
- Generate / backfill tools (sheet)
- Analyze GTD from **weekly + monthly** digests → **editable** preview → apply selected (GTD + `todolist.md`)
- Open Sessions reference

### GTD flow

1. Analyze preview (no writes)
2. Edit GTD / tasks / full markdown per row
3. Apply selected → writes `session_gtd` + audit + notes path

No VS Code extension code changes required for Desktop features.
