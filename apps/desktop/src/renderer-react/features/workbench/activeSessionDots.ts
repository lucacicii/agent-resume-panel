export type SessionDotStatus =
  | "awaiting_user"
  | "running"
  | "connecting"
  | "error"
  | "open";

export type ActiveSessionDot = {
  paneKey: string;
  projectPath: string;
  title: string;
  sessionKey: string;
  status: SessionDotStatus;
  /** Weak heuristic (TUI idle) vs confirmed (ACP permission / strong TUI text). */
  awaitingConfidence?: "confirmed" | "possible";
};

export type SessionDotRuntime = {
  status: SessionDotStatus;
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

const STATUS_RANK: Record<SessionDotStatus, number> = {
  awaiting_user: 5,
  error: 4,
  connecting: 3,
  running: 2,
  open: 1
};

export function pickHigherStatus(a: SessionDotStatus, b: SessionDotStatus): SessionDotStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export function acpRuntimeToStatus(runtime: {
  isRunning?: boolean;
  isConnecting?: boolean;
  status?: string;
  pendingRequestCount?: number;
}): SessionDotStatus {
  if ((runtime.pendingRequestCount ?? 0) > 0) return "awaiting_user";
  if (runtime.status === "error") return "error";
  if (runtime.isConnecting || runtime.status === "connecting") return "connecting";
  if (runtime.isRunning || runtime.status === "running" || runtime.status === "thinking") return "running";
  return "open";
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
    const key = pane.sessionKey;
    const title = (key ? sessionTitles.get(key)?.trim() : "") || pane.title;
    const runtime = runtimeByPaneKey.get(pane.key);
    dots.push({
      paneKey: pane.key,
      projectPath: pane.projectPath,
      title,
      sessionKey: key || "",
      status: runtime?.status ?? "open",
      awaitingConfidence: runtime?.awaitingConfidence
    });
  }
  for (const pane of acpChats) {
    const key = `chat:${pane.recordId}`;
    const title = sessionTitles.get(key)?.trim() || pane.title;
    const runtime = runtimeByPaneKey.get(pane.key) ?? runtimeByPaneKey.get(`acp:${pane.recordId}`);
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
