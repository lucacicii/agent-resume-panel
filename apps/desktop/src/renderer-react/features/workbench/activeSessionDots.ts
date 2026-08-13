export type ActiveSessionDot = {
  paneKey: string;
  projectPath: string;
  title: string;
  sessionKey: string;
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
  sessionTitles: ReadonlyMap<string, string>
): ActiveSessionDot[] {
  const dots: ActiveSessionDot[] = [];
  for (const pane of terminals) {
    if (pane.group !== "session") continue;
    const key = pane.sessionKey;
    const title = (key ? sessionTitles.get(key)?.trim() : "") || pane.title;
    dots.push({ paneKey: pane.key, projectPath: pane.projectPath, title, sessionKey: key || "" });
  }
  for (const pane of acpChats) {
    const key = `chat:${pane.recordId}`;
    const title = sessionTitles.get(key)?.trim() || pane.title;
    dots.push({ paneKey: pane.key, projectPath: pane.projectPath, title, sessionKey: key });
  }
  return dots;
}
