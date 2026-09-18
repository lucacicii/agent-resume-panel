import type { TaskWorkbench, TaskWorkbenchSessionLink } from "@agent-resume/core";

/**
 * Which workbench owns a session.
 *
 * A tray dot or a waiting notification names a session, not a window, and the
 * window may have been closed since. Workbench session links (written when a
 * session starts inside a workbench) are the durable answer, so they decide which
 * task window to open.
 */

export type SessionOwner = {
  workbenchId: string;
  noteId: string;
};

/** Split `provider:agentSessionId`; other shapes have no owner. */
export function splitSessionKey(sessionKey: string): { provider: string; agentSessionId: string } | null {
  const key = sessionKey?.trim() ?? "";
  const separator = key.indexOf(":");
  if (separator <= 0 || separator >= key.length - 1) return null;
  return { provider: key.slice(0, separator), agentSessionId: key.slice(separator + 1) };
}

/** The first workbench whose links contain this session, in workbench order. */
export function findWorkbenchForSession(
  workbenches: readonly TaskWorkbench[],
  linksByWorkbenchId: ReadonlyMap<string, readonly TaskWorkbenchSessionLink[]>,
  sessionKey: string
): SessionOwner | null {
  const parsed = splitSessionKey(sessionKey);
  if (!parsed) return null;
  for (const workbench of workbenches) {
    const links = linksByWorkbenchId.get(workbench.workbenchId) ?? [];
    if (!links.some((link) => link.provider === parsed.provider && link.agentSessionId === parsed.agentSessionId)) {
      continue;
    }
    return { workbenchId: workbench.workbenchId, noteId: workbench.taskNoteId };
  }
  return null;
}
