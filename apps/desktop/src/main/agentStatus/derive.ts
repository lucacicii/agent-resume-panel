/**
 * Verdict derivation for a pane.
 *
 * Order of trust, highest first:
 *   1. `native`     — the agent reported its own state (hook or status sequence)
 *   2. `process`    — a command is executing beneath the pane
 *   3. `activity`   — output arrived within the last 250ms
 *   4. `screen`     — the visible text matches a prompt fingerprint
 *   5. `activity`   — output arrived within the last 5s
 *   6. `fallback`   — nothing certain, so report `idle` rather than guess
 *
 * This is a faithful port of the previous renderer-side resolver: the UI must
 * behave identically while the source of truth moves into the daemon. Stage 4
 * replaces the screen branch with declarative per-agent manifests and the
 * `screen.ts` fingerprint module goes away with it.
 *
 * Evaluation is pure. Hysteresis is advanced exactly once per sensor frame by
 * the caller, so a snapshot read never changes a verdict.
 */

import { detectScreenFingerprint } from "./screen";
import type { AgentState, DetectionSource, PaneTelemetry } from "./types";

/** Recent output is evidence of work. Wide enough to cover model thinking. */
export const RUNNING_WINDOW_MS = 5_000;
/**
 * While output is this fresh the stream wins over any text left on screen: a
 * stale approval dialog must never outrank live output.
 */
export const STREAMING_WINDOW_MS = 250;
/** Two negative frames are required to clear an alert, so redraws do not flicker. */
export const MISS_STREAK_TO_CLEAR = 2;

export type StatusHysteresis = {
  hitStreak: number;
  missStreak: number;
  confirmedAwaiting: boolean;
};

export type Verdict = {
  state: AgentState;
  source: DetectionSource;
  /** Human-readable justification, surfaced by `status.explain`. */
  reason: string;
};

export function createHysteresis(): StatusHysteresis {
  return { hitStreak: 0, missStreak: 0, confirmedAwaiting: false };
}

/** Milliseconds since the pane last produced output. */
export function silentForMs(telemetry: PaneTelemetry | undefined, now: number): number {
  const lastOutputAt = telemetry?.lastOutputAt ?? telemetry?.at ?? 0;
  return Math.max(0, now - lastOutputAt);
}

/**
 * Whether this frame's screen text looks like a blocking prompt.
 *
 * Mirrors the old probe order: while a tool runs or output is streaming, screen
 * text is stale by definition, so it is not evidence of anything.
 */
export function screenHitFor(telemetry: PaneTelemetry | undefined, now: number): boolean {
  if (!telemetry?.screenText) return false;
  if (telemetry.toolRunning) return false;
  if (silentForMs(telemetry, now) < STREAMING_WINDOW_MS) return false;
  return detectScreenFingerprint({
    visibleText: telemetry.screenText,
    cursorHidden: telemetry.cursorHidden
  });
}

/** Advance the anti-flicker counters. Called once per sensor frame. */
export function advanceHysteresis(
  state: StatusHysteresis,
  screenHit: boolean
): StatusHysteresis {
  if (screenHit) {
    return { hitStreak: state.hitStreak + 1, missStreak: 0, confirmedAwaiting: true };
  }
  const missStreak = state.missStreak + 1;
  return {
    hitStreak: 0,
    missStreak,
    confirmedAwaiting: missStreak >= MISS_STREAK_TO_CLEAR ? false : state.confirmedAwaiting
  };
}

export function evaluateStatus(input: {
  nativeState?: AgentState;
  telemetry?: PaneTelemetry;
  hysteresis: StatusHysteresis;
  screenHit: boolean;
  now: number;
}): Verdict {
  // 1. The agent told us directly. Nothing beats this.
  if (input.nativeState) {
    return {
      state: input.nativeState,
      source: "native",
      reason: "the agent reported its own state"
    };
  }

  const silent = silentForMs(input.telemetry, input.now);

  // 2. A command is executing beneath the pane: the agent cannot be waiting.
  if (input.telemetry?.toolRunning) {
    return { state: "working", source: "process", reason: "a command is running beneath the pane" };
  }

  // 3. Live output outranks any residual dialog text still on screen.
  if (input.telemetry && silent < STREAMING_WINDOW_MS) {
    return { state: "working", source: "activity", reason: `output ${silent}ms ago` };
  }

  // 4 + 5. Screen evidence, held by the hysteresis window so redraws do not flicker.
  if (input.screenHit || input.hysteresis.confirmedAwaiting) {
    return {
      state: "blocked",
      source: "screen",
      reason: input.screenHit
        ? "the screen matches an interactive prompt fingerprint"
        : "an interactive prompt was on screen within the last frame"
    };
  }

  if (input.telemetry && silent < RUNNING_WINDOW_MS) {
    return { state: "working", source: "activity", reason: `output ${silent}ms ago` };
  }

  // 6. Nothing certain. Reporting `idle` beats inventing `blocked`.
  return {
    state: "idle",
    source: "fallback",
    reason: "no report, no running tool, and no prompt on screen"
  };
}
