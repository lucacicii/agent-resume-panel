/**
 * Verdict arbitration.
 *
 * Order of trust, highest first:
 *   1. `native`     — the agent reported its own state (hook or status sequence)
 *   2. `process`    — a command is executing beneath the pane
 *   3. `skipStateUpdate` — a viewer is on screen: keep the previous state
 *   4. `screen`     — a rule with `visibleBlocker` (a dialog the agent is drawing)
 *   5. `activity`   — output arrived within the last 250ms
 *   6. `screen`     — any other rule match
 *   7. `activity`   — output arrived within the last 5s
 *   8. `fallback`   — nothing certain, so report `idle` rather than guess
 *
 * The order is the whole design: stale dialog text must never outrank live
 * output (4 before 5), while a *live* blocker must outrank the output that drew
 * it (3 before 5). The anti-flicker hysteresis keeps an alert for one extra
 * frame so a redraw cannot make the indicator blink.
 *
 * Evaluation is pure. The caller advances hysteresis exactly once per sensor
 * frame, so reading a snapshot never changes a verdict.
 */

import type { ScreenVerdict } from "./evaluate";
import type { AgentState, DetectionSource, PaneTelemetry } from "../types";

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
 * Advance the anti-flicker counters. Called once per sensor frame.
 *
 * `visibleIdle` is an explicit "the agent is showing its live prompt", so it
 * clears a held alert immediately instead of waiting out the miss streak.
 */
export function advanceHysteresis(
  state: StatusHysteresis,
  input: { blocked: boolean; visibleIdle: boolean }
): StatusHysteresis {
  if (input.blocked) {
    return { hitStreak: state.hitStreak + 1, missStreak: 0, confirmedAwaiting: true };
  }
  if (input.visibleIdle) {
    return { hitStreak: 0, missStreak: MISS_STREAK_TO_CLEAR, confirmedAwaiting: false };
  }
  const missStreak = state.missStreak + 1;
  return {
    hitStreak: 0,
    missStreak,
    confirmedAwaiting: missStreak >= MISS_STREAK_TO_CLEAR ? false : state.confirmedAwaiting
  };
}

export function arbitrateStatus(input: {
  nativeState?: AgentState;
  telemetry?: PaneTelemetry;
  hysteresis: StatusHysteresis;
  /** Rule engine result for this frame; null when no manifest was available. */
  screen: ScreenVerdict | null;
  /** Last state published for this pane, so a viewer keeps showing it. */
  previousState?: AgentState;
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
    return { state: "working", source: "process", reason: "a command is running in the foreground" };
  }

  // 3. A viewer (transcript, history) is not the live prompt: keep what we knew.
  if (input.screen?.skipStateUpdate && input.previousState && input.previousState !== "unknown") {
    return {
      state: input.previousState,
      source: "screen",
      reason: "the pane is showing a viewer, so the previous state is kept"
    };
  }

  // 4. A visible blocker outranks the output that drew it.
  if (input.screen?.visible.blocker && input.screen.state === "blocked") {
    return { state: "blocked", source: input.screen.source, reason: input.screen.reason };
  }

  // 5. Live output outranks any residual dialog text still on screen.
  if (input.telemetry && silent < STREAMING_WINDOW_MS) {
    return { state: "working", source: "activity", reason: `output ${silent}ms ago` };
  }

  // 6. Any other rule match, when the pane is not showing a viewer.
  if (input.screen && !input.screen.skipStateUpdate) {
    return {
      state: input.screen.state,
      source: input.screen.source,
      reason: input.screen.reason
    };
  }

  // 7. The alert from the last frame is still inside its grace window.
  if (input.hysteresis.confirmedAwaiting) {
    return {
      state: "blocked",
      source: "screen",
      reason: "a prompt was on screen within the last frame"
    };
  }

  if (input.telemetry && silent < RUNNING_WINDOW_MS) {
    return { state: "working", source: "activity", reason: `output ${silent}ms ago` };
  }

  // 8. Nothing certain. Reporting `idle` beats inventing `blocked`.
  return {
    state: "idle",
    source: "fallback",
    reason: "no report, no running command, and no rule matched"
  };
}
