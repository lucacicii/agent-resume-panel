/**
 * Session status vocabulary.
 *
 * This module owns every type that describes "what state is this agent
 * session in". Nothing here knows about React, the Workbench, terminals, or
 * how a status is obtained — only what a status *is*.
 */

export const SESSION_DOT_STATUSES = [
  "awaiting_user",
  "running",
  "connecting",
  "error",
  "open"
] as const;

export type SessionDotStatus = (typeof SESSION_DOT_STATUSES)[number];

/** How strongly we believe an `awaiting_user` verdict. */
export type SessionAwaitingConfidence = "confirmed" | "possible";

/** Runtime status for one session pane. */
export type SessionDotRuntime = {
  status: SessionDotStatus;
  awaitingConfidence?: SessionAwaitingConfidence;
};

/**
 * Which layer produced a verdict, in descending order of trust.
 *
 * - `native`     — the agent itself reported it (hook, notify, ACP request).
 * - `protocol`   — the agent emitted a status escape sequence (OSC 633;AR).
 * - `process`    — a command is executing beneath the agent (process tree).
 * - `fingerprint`— detected from screen content (menu / approval dialog).
 * - `judge`      — an LLM adjudicated an ambiguous screen.
 * - `activity`   — inferred from recent output throughput.
 * - `idle`       — nothing happened; fail-safe default.
 */
export const SESSION_STATUS_SOURCES = [
  "native",
  "protocol",
  "process",
  "fingerprint",
  "judge",
  "activity",
  "idle"
] as const;

export type SessionStatusSource = (typeof SESSION_STATUS_SOURCES)[number];

/** Trust ranking; higher wins when two layers disagree in the same tick. */
export const SOURCE_TRUST: Record<SessionStatusSource, number> = {
  native: 6,
  protocol: 5,
  process: 4,
  fingerprint: 3,
  judge: 3,
  activity: 2,
  idle: 1
};

/** A status reported by the agent through an out-of-band channel. */
export type ReportedStatus = {
  status: SessionDotStatus;
  awaitingConfidence?: SessionAwaitingConfidence;
  detail?: string;
};

/** Inputs to one status evaluation tick for a single pane. */
export type StatusProbeInput = {
  /** Screen text (Tier 2 fingerprint) — empty when unavailable. */
  visibleText: string;
  /** Timestamp of the most recent PTY output. */
  lastOutputAt: number;
  /** Evaluation time. */
  now: number;
  /** Whether the terminal has hidden its cursor (menu / dialog affordance). */
  cursorHidden?: boolean;
  /**
   * Tier 1: a non-infrastructure process is running beneath the agent.
   * Deterministic evidence that a command is executing.
   */
  toolRunning?: boolean;
  /** Tier 0 / 1 verdict that outranks screen scraping. */
  reported?: ReportedStatus | null;
};

export type StatusProbeResult = {
  status: SessionDotStatus;
  awaitingConfidence?: SessionAwaitingConfidence;
  /** Tier 2 reported a positive screen match this tick. */
  textHit: boolean;
  source: SessionStatusSource;
};

/** Per-pane hysteresis so screen redraws do not flicker the indicator. */
export type StatusHysteresis = {
  hitStreak: number;
  missStreak: number;
  confirmedTextAwaiting: boolean;
};
