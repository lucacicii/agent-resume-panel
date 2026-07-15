# Security and Runtime Boundaries

- Do not commit API keys, `OVSX_PAT`, Marketplace tokens, `.env` files, or local credentials. LLM keys can live in VS Code Secret Storage or the user-managed local panel-home settings; neither belongs in source control.
- The product is local-first. Provider transcripts remain in each CLI's native local storage. The shared panel home is local storage for catalog, settings, notes, ACP data, and memory metadata; do not add a cloud service or automatic upload path.
- Treat configured agent homes, project paths, session metadata, note names, and provider transcript contents as untrusted input. Reuse existing path normalization, home expansion, SQLite helpers, and command builders.
- Do not execute shell fragments assembled from transcript content or titles. Keep command construction in the established provider/terminal helpers and preserve argument escaping.
- Preserve explicit user consent and configuration around LLM chat, embeddings, summarization, and scheduled memory jobs. These operations can read private transcripts and call a third-party OpenAI-compatible endpoint.
- Keep Electron security boundaries: `contextIsolation` stays enabled, `nodeIntegration` stays disabled, renderer access is constrained to named preload APIs, and IPC arguments are validated in main-process handlers.
- Preserve ACP permission prompts and attachment limits. Do not silently auto-approve agent permissions or weaken image type and size validation.
- Surface failures without logging secrets, tokens, raw credentials, or unnecessary transcript content.
