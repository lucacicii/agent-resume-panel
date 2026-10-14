/**
 * Session status for the desktop workbench.
 *
 * Detection lives in the background `agent-status` daemon (sensor in Electron
 * main, verdicts in the daemon). The renderer only projects the settled state
 * into the dot vocabulary the UI renders:
 *
 *   - `useAgentStatus`  — daemon snapshot for PTY-backed panes
 *   - `useAcpStatus`    — ACP chat lifecycle, which never leaves this process
 *   - `useThunderChatStatus` — Thunder runs, which report their own phase
 *   - `types`           — `AgentState` → `SessionDotStatus` projection
 */

export {
  SESSION_DOT_STATUSES,
  agentStateToDotStatus,
  type SessionDotRuntime,
  type SessionDotStatus
} from "./types";

export { useAgentStatus, type AgentStatusView, type StatusPane } from "./useAgentStatus";

export { acpStatusFor, useAcpStatus, type AcpStatusEvent } from "./useAcpStatus";

export {
  agentPhaseToDotStatus,
  isNewerAgentStatus,
  useThunderChatStatus,
  type ThunderStatusEvent
} from "./useThunderChatStatus";
