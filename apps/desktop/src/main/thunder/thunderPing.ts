/**
 * Normalizer for the daemon heartbeat reply.
 *
 * Two spellings are live at once:
 *
 *   - the pre-rewrite `thunder-agent-daemon` sidecar answered `{"pong": true, ...}`
 *   - the microkernel `thunder-daemon` (protocol v3) answers `{"status": "pong", ...}`
 *
 * Reading one field name directly is what made `getStatus()` report a live daemon
 * as offline: `Boolean(ping?.pong)` was silently `false` for every protocol-v3
 * build, so the chat surface showed "initializing or offline" while tasks ran
 * against the daemon just fine. Collapse both shapes here, once, so no caller
 * has to know which daemon it is talking to.
 */

/** Raw `ping` reply, with both heartbeat spellings as optional fields. */
export interface ThunderPingResponse {
  /** Heartbeat flag used by the pre-rewrite sidecar. */
  pong?: boolean;
  /** Heartbeat value used by the microkernel daemon: `"pong"` when alive. */
  status?: string;
  version?: string;
  protocol_version?: number;
}

/** Normalized heartbeat, identical whichever daemon answered. */
export interface ThunderPingResult {
  pong: boolean;
  version?: string;
  protocolVersion?: number;
}

/** Fold either heartbeat spelling into one answer. A missing reply is *not* alive. */
export function normalizePingResponse(res: ThunderPingResponse | null | undefined): ThunderPingResult {
  return {
    pong: res?.pong === true || res?.status === "pong",
    version: res?.version,
    protocolVersion: res?.protocol_version
  };
}
