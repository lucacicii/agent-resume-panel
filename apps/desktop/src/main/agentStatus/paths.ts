/**
 * Filesystem locations owned by the agent-status daemon.
 *
 * Everything lives under `<panelHome>/.desktop/agent-status/` so a single
 * `rm -rf` of the panel home removes the daemon's whole footprint.
 */

import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { agentStatusDir, resolvePanelHome } from "@agent-resume/core";

/** launchd label for the login-time daemon. */
export const AGENT_STATUS_LAUNCH_AGENT_LABEL = "dev.agentresume.agent-status";

/** Environment variable carrying the panel home into the daemon process. */
export const AGENT_STATUS_PANEL_HOME_ENV = "AGENT_RESUME_PANEL_HOME";
/** Environment variable carrying the app version into the daemon process. */
export const AGENT_STATUS_APP_VERSION_ENV = "AGENT_RESUME_APP_VERSION";

export type AgentStatusPaths = {
  dir: string;
  endpoint: string;
  socket: string;
  state: string;
  log: string;
};

/**
 * Unix socket paths are capped at ~104 bytes on macOS, so the socket cannot live
 * under the panel home: a long user name plus the panel-home path itself can
 * exceed the limit before we add a file name. It goes into the user's private
 * temp directory instead — short, per-user, and recreated on every daemon start
 * (the endpoint file is the discovery source of truth, and it records the real
 * socket path).
 */
export const AGENT_STATUS_SOCKET_MAX_BYTES = 100;

export function agentStatusSocketPath(panelHome: string): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  // Per-panel-home suffix so two profiles never share one socket.
  const profile = createHash("sha1").update(panelHome).digest("hex").slice(0, 8);
  return path.join(os.tmpdir(), `agent-resume-status-${uid}-${profile}.sock`);
}

export function agentStatusPaths(panelHome: string): AgentStatusPaths {
  const home = resolvePanelHome(panelHome);
  const dir = agentStatusDir(home);
  return {
    dir,
    endpoint: path.join(dir, "endpoint.json"),
    socket: agentStatusSocketPath(home),
    state: path.join(dir, "state.json"),
    log: path.join(dir, "daemon.log")
  };
}

export function launchAgentPlistPath(home: string = os.homedir()): string {
  return path.join(home, "Library", "LaunchAgents", `${AGENT_STATUS_LAUNCH_AGENT_LABEL}.plist`);
}
