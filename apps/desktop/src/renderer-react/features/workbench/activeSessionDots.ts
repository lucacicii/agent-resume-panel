/**
 * Rendering model for the session indicators (nav rail, tray, floating notes).
 *
 * This module only *shapes* data for display: given the open panes and the
 * statuses the `sessionStatus` store settled on, it produces one dot per pane.
 * It performs no detection of its own — see `sessionStatus/`.
 */

import type { SessionDotRuntime, SessionDotStatus } from "./sessionStatus";

export type ActiveSessionDot = {
  paneKey: string;
  projectPath: string;
  title: string;
  sessionKey: string;
  status: SessionDotStatus;
  /** Weak heuristic (idle TUI) vs confirmed (explicit report / approval UI). */
  awaitingConfidence?: "confirmed" | "possible";
};

type DotTerminal = {
  key: string;
  title: string;
  group: string;
  sessionKey?: string;
  projectPath: string;
};

type DotAcpChat = {
  key: string;
  recordId: string;
  title: string;
  projectPath: string;
};

/** ACP panes are keyed `acp:${recordId}` in the status store. */
export function acpPaneKey(recordId: string): string {
  return `acp:${recordId}`;
}

/**
 * One dot per open session-group terminal pane + ACP chat pane, across ALL
 * projects. Mirrors sessionTabTitle()'s resolution: prefer the bound session
 * title from sessionTitles (keyed `${provider}:${id}` / `chat:${recordId}`),
 * fall back to the pane title (covers pending panes with no sessionKey yet).
 * Order: terminals array order (creation order), then acpChats order.
 */
export function collectActiveSessionDots(
  terminals: ReadonlyArray<DotTerminal>,
  acpChats: ReadonlyArray<DotAcpChat>,
  sessionTitles: ReadonlyMap<string, string>,
  runtimeByPaneKey: ReadonlyMap<string, SessionDotRuntime> = new Map()
): ActiveSessionDot[] {
  const dots: ActiveSessionDot[] = [];

  for (const pane of terminals) {
    if (pane.group !== "session") continue;
    const sessionKey = pane.sessionKey;
    const title = (sessionKey ? sessionTitles.get(sessionKey)?.trim() : "") || pane.title;
    const runtime = runtimeByPaneKey.get(pane.key);
    dots.push({
      paneKey: pane.key,
      projectPath: pane.projectPath,
      title,
      sessionKey: sessionKey || "",
      status: runtime?.status ?? "open",
      awaitingConfidence: runtime?.awaitingConfidence
    });
  }

  for (const pane of acpChats) {
    const key = `chat:${pane.recordId}`;
    const title = sessionTitles.get(key)?.trim() || pane.title;
    const runtime = runtimeByPaneKey.get(pane.key) ?? runtimeByPaneKey.get(acpPaneKey(pane.recordId));
    dots.push({
      paneKey: pane.key,
      projectPath: pane.projectPath,
      title,
      sessionKey: key,
      status: runtime?.status ?? "open",
      awaitingConfidence: runtime?.awaitingConfidence
    });
  }

  return dots;
}
