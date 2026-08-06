/** Providers that resume outside a Workbench xterm TUI (no terminal input to focus). */
const NON_TUI_RESUME_PROVIDERS = new Set(["chat", "cursor-ide"]);

/**
 * Whether a note is bound to a session that can be resumed into a Workbench
 * xterm TUI. Session-bound notes carry `provider` + `agentSessionId`; ACP chat
 * ("chat") and Cursor IDE ("cursor-ide") sessions resume elsewhere, so they are
 * excluded.
 */
export function isNoteSessionResumable(note: {
  scope: string;
  provider?: string;
  agentSessionId?: string;
}): boolean {
  return note.scope === "session"
    && note.provider != null
    && note.agentSessionId != null
    && !NON_TUI_RESUME_PROVIDERS.has(note.provider);
}
