/**
 * Session status — deciding whether an agent session is running, waiting for
 * the user, connecting, or idle.
 *
 * Layered by trust:
 *   1. `protocol`    — explicit status escape sequences in the PTY stream.
 *   2. `fingerprint` — screen text (menus, approval dialogs).
 *   3. `activity`    — output throughput inference.
 *   4. `idle`        — fail-safe default.
 *
 * The store owns all state; `react.ts` binds it to a component; `store.ts`
 * feeds it. Nothing here imports React or Electron beyond the binding layer.
 */

export {
  SESSION_DOT_STATUSES,
  SESSION_STATUS_SOURCES,
  SOURCE_TRUST,
  type ReportedStatus,
  type SessionAwaitingConfidence,
  type SessionDotRuntime,
  type SessionDotStatus,
  type SessionStatusSource,
  type StatusHysteresis,
  type StatusProbeInput,
  type StatusProbeResult
} from "./types";

export {
  parseReportedStatus,
  stripAnsi,
  stripReportedStatus,
  trackCursorVisibility
} from "./protocol";

export {
  detectInteractiveSelector,
  detectPermissionPromptText,
  detectScreenFingerprint
} from "./fingerprint";

export {
  createHysteresis,
  HIT_STREAK_TO_CONFIRM,
  MISS_STREAK_TO_CLEAR,
  probeSessionStatus,
  RUNNING_WINDOW_MS,
  settleStatus,
  STREAMING_WINDOW_MS,
  type HysteresisOutcome
} from "./resolver";

export {
  acpEventToStatus,
  SessionStatusStore,
  type AcpStatusEvent,
  type SessionStatusPane,
  type SessionStatusSnapshot,
  type StatusScreenReader
} from "./store";

export { useSessionStatus, type UseSessionStatusResult } from "./react";
