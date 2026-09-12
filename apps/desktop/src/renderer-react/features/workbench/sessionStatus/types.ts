/**
 * Session indicator vocabulary — the UI projection of daemon state.
 *
 * The daemon settles every pane into an `AgentState` (`idle` / `working` /
 * `blocked` / `unknown`); this module maps that onto the dot vocabulary the
 * workbench, nav rail, and tray already render. `connecting` and `error` are
 * ACP transport states and never come from the daemon.
 */

import type { AgentState } from "../../../../shared/agentStatusTypes";

export const SESSION_DOT_STATUSES = [
  "awaiting_user",
  "running",
  "connecting",
  "error",
  "open"
] as const;

export type SessionDotStatus = (typeof SESSION_DOT_STATUSES)[number];

/** Runtime status for one session pane. */
export type SessionDotRuntime = {
  status: SessionDotStatus;
};

/**
 * `blocked` is the only state worth a dot: it means the agent cannot continue
 * without a human. `working` is informational; `idle` / `unknown` show nothing,
 * because a false "waiting for you" costs more than a missed cue.
 */
export function agentStateToDotStatus(state: AgentState): SessionDotStatus {
  if (state === "blocked") return "awaiting_user";
  if (state === "working") return "running";
  return "open";
}
