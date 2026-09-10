/**
 * Tier resolution and hysteresis.
 *
 * The resolver is a pure function pair: probe the layers, then smooth the
 * result. It owns no timers and no per-pane storage — the caller keeps the
 * `StatusHysteresis` value between ticks.
 */

import { detectScreenFingerprint } from "./fingerprint";
import type {
  SessionAwaitingConfidence,
  SessionDotStatus,
  StatusHysteresis,
  StatusProbeInput,
  StatusProbeResult
} from "./types";

/** Recent PTY output ⇒ running. Wide enough to cover model thinking / TTFT. */
export const RUNNING_WINDOW_MS = 5_000;

/**
 * While output is this fresh, the stream wins over any text left on screen.
 * A stale approval dialog must never outrank live output.
 */
export const STREAMING_WINDOW_MS = 250;

/** A single positive screen match is enough to raise the alert. */
export const HIT_STREAK_TO_CONFIRM = 1;

/** Two negative samples are required to clear it, so redraws do not flicker. */
export const MISS_STREAK_TO_CLEAR = 2;

/**
 * Evaluate every tier for one pane at one instant.
 *
 * Order matters: native report > status sequence > streaming output >
 * screen fingerprint > running window > idle.
 */
export function probeSessionStatus(input: StatusProbeInput): StatusProbeResult {
  // Tier 0/1 — the agent told us directly. Nothing beats this.
  if (input.reported) {
    const awaiting = input.reported.status === "awaiting_user";
    return {
      status: input.reported.status,
      awaitingConfidence: input.reported.awaitingConfidence,
      textHit: awaiting,
      source: "native"
    };
  }

  const silentFor = Math.max(0, input.now - input.lastOutputAt);

  // Live output outranks any residual dialog text still on screen.
  if (silentFor < STREAMING_WINDOW_MS) {
    return { status: "running", textHit: false, source: "activity" };
  }

  // Tier 2 — screen fingerprint (choice menu or approval dialog).
  if (detectScreenFingerprint({ visibleText: input.visibleText, cursorHidden: input.cursorHidden })) {
    return {
      status: "awaiting_user",
      awaitingConfidence: "confirmed",
      textHit: true,
      source: "fingerprint"
    };
  }

  if (silentFor < RUNNING_WINDOW_MS) {
    return { status: "running", textHit: false, source: "activity" };
  }

  // Nothing running, nothing on screen. Fail safe: silence is idle, never
  // "waiting for you" — a false alarm costs more than a missed cue.
  return { status: "open", textHit: false, source: "idle" };
}

export function createHysteresis(): StatusHysteresis {
  return { hitStreak: 0, missStreak: 0, confirmedTextAwaiting: false };
}

export type HysteresisOutcome = {
  status: SessionDotStatus;
  awaitingConfidence?: SessionAwaitingConfidence;
  state: StatusHysteresis;
};

/**
 * Smooth a probe result into a stable status.
 *
 * Exact sources (native report, status sequence) bypass hysteresis entirely —
 * an agent that says "I am waiting" is believed on the first sample.
 */
export function settleStatus(state: StatusHysteresis, probe: StatusProbeResult): HysteresisOutcome {
  if (probe.source === "native") {
    const awaiting = probe.status === "awaiting_user";
    return {
      status: probe.status,
      awaitingConfidence: probe.awaitingConfidence,
      state: {
        hitStreak: awaiting ? HIT_STREAK_TO_CONFIRM : 0,
        missStreak: awaiting ? 0 : MISS_STREAK_TO_CLEAR,
        confirmedTextAwaiting: awaiting
      }
    };
  }

  const next: StatusHysteresis = { ...state };

  if (probe.textHit) {
    next.hitStreak += 1;
    next.missStreak = 0;
    if (next.hitStreak >= HIT_STREAK_TO_CONFIRM) next.confirmedTextAwaiting = true;
  } else {
    next.missStreak += 1;
    next.hitStreak = 0;
    if (next.missStreak >= MISS_STREAK_TO_CLEAR) next.confirmedTextAwaiting = false;
  }

  if (next.confirmedTextAwaiting) {
    return { status: "awaiting_user", awaitingConfidence: "confirmed", state: next };
  }

  // First positive sample, not yet confirmed: do not flash the alert.
  if (probe.textHit) {
    return { status: "running", state: next };
  }

  return {
    status: probe.status,
    awaitingConfidence: probe.status === "awaiting_user" ? probe.awaitingConfidence : undefined,
    state: next
  };
}
