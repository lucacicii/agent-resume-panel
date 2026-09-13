/**
 * Daemon wire protocol.
 *
 * Transport: a unix socket, newline-delimited JSON, one request per line and
 * one response line per request plus unsolicited event lines. Shared vocabulary
 * (states, statuses, snapshots) lives in `shared/agentStatusTypes.ts` and is
 * re-exported here so daemon modules have a single import site.
 *
 * Keep this file free of Electron, React, and Node-specific imports.
 */

import type {
  AgentKind,
  AgentState,
  DetectionSource,
  HelloResult,
  PaneAuthority,
  StatusSnapshot
} from "../../shared/agentStatusTypes";

export type {
  AgentKind,
  AgentState,
  DetectionExplain,
  DetectionSource,
  EvaluatedRule,
  HelloResult,
  PaneAuthority,
  PaneScreenDump,
  PaneStatus,
  StatusSnapshot
} from "../../shared/agentStatusTypes";
export { AGENT_STATUS_API_VERSION } from "../../shared/agentStatusTypes";

/** A pane's own view of reality, published by the sensor in Electron main. */
export type PaneTelemetry = {
  /** PTY id as known by `ptyHost`; stable for the process lifetime. */
  paneId: number;
  /** OS pid backing the PTY shell. */
  ptyPid?: number;
  cwd?: string;
  /** Stable session identity, e.g. `cli:abc123`. */
  sessionKey?: string;
  /** Visible screen text (ANSI free), bottom weighted. */
  screenText?: string;
  /** Latest OSC 0/2 title. */
  oscTitle?: string;
  /** Latest OSC 9;4 progress payload, e.g. `4;0`. */
  oscProgress?: string;
  /** DEC private mode 25 as tracked from the raw byte stream. */
  cursorHidden?: boolean;
  /** True when a non-infrastructure process runs beneath the pane. */
  toolRunning?: boolean;
  /** Foreground process names, for diagnostics and identity. */
  foregroundProcesses?: string[];
  /** Agent identified from the process tree (stage 3). */
  agent?: AgentKind;
  /** Executable path of the identified agent process. */
  agentProcess?: string;
  /** Sensor-side timestamp of the most recent PTY output. */
  lastOutputAt?: number;
  /** When the sensor produced this frame. */
  at: number;
};

/** An explicit lifecycle report from an agent hook or status sequence. */
export type NativeReport = {
  paneId: number;
  /** Reporting integration, e.g. `agent-resume:claude`. */
  source: string;
  agent: AgentKind;
  state: AgentState;
  /** Monotonic per source. Out-of-order reports are dropped. */
  seq: number;
  sessionKey?: string;
  sessionRef?: { provider: string; sessionId: string };
  /** Sub-agent hooks report identity but never own the pane state. */
  subagent?: boolean;
};

/**
 * One settled state change for a pane, captured the moment it happened.
 *
 * Snapshots describe "now"; this is the durable-to-the-process record of
 * "what changed and why" that callers use to react once (promote a blocked
 * session, capture a stop reason) instead of polling for a state.
 */
export type StatusTransition = {
  paneId: number;
  sessionKey?: string;
  agent: AgentKind;
  from: AgentState;
  to: AgentState;
  authority: PaneAuthority;
  source: DetectionSource;
  /** Rule that produced the screen verdict, when one did. */
  reason?: string;
  at: number;
  seq: number;
};

export type HelloParams = {
  apiVersion: number;
  role: "app" | "cli" | "test";
  appVersion?: string;
};

export type AgentStatusRequest =
  | { id: string; method: "hello"; params: HelloParams }
  | { id: string; method: "telemetry.publish"; params: PaneTelemetry }
  | { id: string; method: "pane.report_state"; params: NativeReport }
  | { id: string; method: "pane.forget"; params: { paneId: number } }
  | { id: string; method: "status.snapshot"; params?: Record<string, never> }
  /** Transitions newer than `sinceSeq`, oldest first. */
  | { id: string; method: "status.transitions"; params?: { sinceSeq?: number } }
  | { id: string; method: "status.explain"; params: { paneId: number } }
  /** Diagnostics: the screen text and verdict behind a pane, for capture tooling. */
  | { id: string; method: "pane.screen"; params: { paneId: number } }
  /** Which detection manifests the daemon loaded, for the settings pane. */
  | { id: string; method: "status.manifests"; params?: Record<string, never> }
  | { id: string; method: "status.subscribe"; params?: Record<string, never> }
  | { id: string; method: "daemon.shutdown"; params: { reason: string } };

export type AgentStatusRequestMethod = AgentStatusRequest["method"];

export type AgentStatusResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: string; message: string } };

export type AgentStatusEvent =
  | { event: "status.changed"; data: StatusSnapshot }
  | { event: "status.transition"; data: StatusTransition }
  | { event: "daemon.shutting_down"; data: { reason: string; at: number } };
