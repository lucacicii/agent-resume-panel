/**
 * Subscribe the UI to the daemon's status snapshot.
 *
 * The renderer owns no detection state at all: it declares which panes exist,
 * asks for the current snapshot on mount, and then receives pushes. The daemon
 * (and the sensor in main) can be closed, restarted, or replaced underneath
 * without this hook caring.
 */

import { useEffect, useMemo, useState } from "react";
import type { PaneStatus, StatusSnapshot } from "../../../../shared/agentStatusTypes";
import { desktopApi } from "../../../bridge";
import { agentStateToDotStatus, type SessionDotRuntime } from "./types";

/** A pane the status plane should answer for. */
export type StatusPane = {
  /** Workbench pane key, e.g. `terminal:1`. */
  key: string;
  ptyId?: number | null;
  sessionKey?: string;
};

export type AgentStatusView = {
  /** paneKey → settled dot status, for every pane the daemon knows about. */
  byPaneKey: ReadonlyMap<string, SessionDotRuntime>;
  /** paneKey → full record, for diagnostics and the explain panel. */
  detailByPaneKey: ReadonlyMap<string, PaneStatus>;
  /** False until the first snapshot arrives (daemon starting or unavailable). */
  connected: boolean;
};

const EMPTY_VIEW: AgentStatusView = {
  byPaneKey: new Map(),
  detailByPaneKey: new Map(),
  connected: false
};

export function useAgentStatus(panes: readonly StatusPane[]): AgentStatusView {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);

  useEffect(() => {
    const api = desktopApi();
    let alive = true;
    void api
      .agentStatusGetSnapshot?.()
      .then((next) => {
        if (alive && next) setSnapshot(next);
      })
      .catch(() => undefined);
    const off = api.onAgentStatusChanged?.((next) => {
      if (alive) setSnapshot(next);
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  return useMemo(() => {
    if (!snapshot) return EMPTY_VIEW;
    const byPaneKey = new Map<string, SessionDotRuntime>();
    const detailByPaneKey = new Map<string, PaneStatus>();
    for (const pane of panes) {
      const record = lookupPaneStatus(snapshot, pane);
      if (!record) continue;
      detailByPaneKey.set(pane.key, record);
      byPaneKey.set(pane.key, { status: agentStateToDotStatus(record.state) });
    }
    return { byPaneKey, detailByPaneKey, connected: true };
  }, [panes, snapshot]);
}

/**
 * A pane is identified by its PTY while it has one, and by its session key when
 * the PTY is gone (respawn, restore) so the indicator does not blink out.
 */
function lookupPaneStatus(snapshot: StatusSnapshot, pane: StatusPane): PaneStatus | undefined {
  if (typeof pane.ptyId === "number") {
    const byPty = snapshot.byPaneId[String(pane.ptyId)];
    if (byPty) return byPty;
  }
  if (pane.sessionKey) return snapshot.bySessionKey[pane.sessionKey];
  return undefined;
}
