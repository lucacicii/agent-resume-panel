# Claude Code Project Router

Follow [AGENTS.md](AGENTS.md). This monorepo ships an independent VS Code extension and an independent Electron desktop app; identify which product a task targets before editing. Read [`.agents/extended/product-independence.md`](.agents/extended/product-independence.md) when scope spans both apps, shared core, locales, or releases.

Use `.agents/menus-index.md` only when the task describes a product area or user-visible feature without a concrete path or searchable identifier. Load a single matching `.agents/menus/*.md` detail file, plus only the relevant `.agents/extended/` reference.
