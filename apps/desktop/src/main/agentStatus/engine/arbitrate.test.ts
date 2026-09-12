import { describe, expect, it } from "vitest";
import {
  MISS_STREAK_TO_CLEAR,
  RUNNING_WINDOW_MS,
  STREAMING_WINDOW_MS,
  advanceHysteresis,
  arbitrateStatus,
  createHysteresis
} from "./arbitrate";
import type { ScreenVerdict } from "./evaluate";
import type { PaneTelemetry } from "../types";

const NOW = 1_000_000;

function telemetry(overrides: Partial<PaneTelemetry> = {}): PaneTelemetry {
  return { paneId: 1, at: NOW, lastOutputAt: NOW, ...overrides };
}

function screen(overrides: Partial<ScreenVerdict> = {}): ScreenVerdict {
  return {
    state: "blocked",
    source: "screen",
    matchedRule: { id: "rule", priority: 800, region: "whole_recent" },
    visible: { idle: false, blocker: false, working: false },
    skipStateUpdate: false,
    reason: "rule rule matched",
    ...overrides
  };
}

function arbitrate(input: Omit<Parameters<typeof arbitrateStatus>[0], "now">) {
  return arbitrateStatus({ ...input, now: NOW });
}

describe("arbitrateStatus", () => {
  it("believes an explicit agent report above everything else", () => {
    const verdict = arbitrate({
      nativeState: "blocked",
      telemetry: telemetry({ toolRunning: true }),
      hysteresis: createHysteresis(),
      screen: screen()
    });
    expect(verdict.state).toBe("blocked");
    expect(verdict.source).toBe("native");
  });

  it("treats a foreground command as work", () => {
    const verdict = arbitrate({
      telemetry: telemetry({ toolRunning: true, lastOutputAt: NOW - 5_000 }),
      hysteresis: createHysteresis(),
      screen: screen()
    });
    expect(verdict.state).toBe("working");
    expect(verdict.source).toBe("process");
  });

  it("keeps the previous state while a viewer is on screen", () => {
    const verdict = arbitrate({
      telemetry: telemetry({ lastOutputAt: NOW - 2_000 }),
      hysteresis: createHysteresis(),
      screen: screen({ skipStateUpdate: true, state: "unknown" }),
      previousState: "working"
    });
    expect(verdict.state).toBe("working");
    expect(verdict.reason).toMatch(/viewer/);
  });

  it("ignores a viewer when there is no previous state", () => {
    const verdict = arbitrate({
      telemetry: telemetry({ lastOutputAt: NOW - RUNNING_WINDOW_MS - 1 }),
      hysteresis: createHysteresis(),
      screen: screen({ skipStateUpdate: true, state: "unknown" })
    });
    expect(verdict.state).toBe("idle");
  });

  it("lets a visible blocker outrank the output that drew it", () => {
    const verdict = arbitrate({
      telemetry: telemetry({ lastOutputAt: NOW - 10 }),
      hysteresis: createHysteresis(),
      screen: screen({ visible: { idle: false, blocker: true, working: false } })
    });
    expect(verdict.state).toBe("blocked");
    expect(verdict.source).toBe("screen");
  });

  it("lets live output outrank a stale dialog", () => {
    const verdict = arbitrate({
      telemetry: telemetry({ lastOutputAt: NOW - 10 }),
      hysteresis: createHysteresis(),
      screen: screen()
    });
    expect(verdict.state).toBe("working");
    expect(verdict.source).toBe("activity");
  });

  it("uses a quiet screen match as the verdict", () => {
    const verdict = arbitrate({
      telemetry: telemetry({ lastOutputAt: NOW - 1_000 }),
      hysteresis: createHysteresis(),
      screen: screen()
    });
    expect(verdict.state).toBe("blocked");
    expect(verdict.reason).toMatch(/rule rule matched/);
  });

  it("keeps a held alert for one frame after the screen changes", () => {
    const hysteresis = advanceHysteresis(createHysteresis(), { blocked: true, visibleIdle: false });
    const verdict = arbitrate({
      telemetry: telemetry({ lastOutputAt: NOW - 1_000 }),
      hysteresis,
      screen: null
    });
    expect(verdict.state).toBe("blocked");
    expect(verdict.reason).toMatch(/previous frame|last frame/);
  });

  it("honours the running window, then falls back to idle", () => {
    expect(arbitrate({
      telemetry: telemetry({ lastOutputAt: NOW - STREAMING_WINDOW_MS - 1 }),
      hysteresis: createHysteresis(),
      screen: null
    }).state).toBe("working");
    expect(arbitrate({
      telemetry: telemetry({ lastOutputAt: NOW - RUNNING_WINDOW_MS - 1 }),
      hysteresis: createHysteresis(),
      screen: null
    }).state).toBe("idle");
  });

  it("never invents blocked without a rule or a held alert", () => {
    expect(arbitrate({ hysteresis: createHysteresis(), screen: null }).state).toBe("idle");
  });
});

describe("advanceHysteresis", () => {
  it("holds the alert through one unconfirmed frame", () => {
    let state = advanceHysteresis(createHysteresis(), { blocked: true, visibleIdle: false });
    expect(state.confirmedAwaiting).toBe(true);
    state = advanceHysteresis(state, { blocked: false, visibleIdle: false });
    expect(state.confirmedAwaiting).toBe(true);
    state = advanceHysteresis(state, { blocked: false, visibleIdle: false });
    expect(state.confirmedAwaiting).toBe(false);
    expect(state.missStreak).toBe(MISS_STREAK_TO_CLEAR);
  });

  it("clears immediately when the live prompt is visibly back", () => {
    let state = advanceHysteresis(createHysteresis(), { blocked: true, visibleIdle: false });
    state = advanceHysteresis(state, { blocked: false, visibleIdle: true });
    expect(state.confirmedAwaiting).toBe(false);
  });

  it("re-arms while the screen still matches", () => {
    let state = advanceHysteresis(createHysteresis(), { blocked: true, visibleIdle: false });
    state = advanceHysteresis(state, { blocked: false, visibleIdle: false });
    state = advanceHysteresis(state, { blocked: true, visibleIdle: false });
    expect(state.confirmedAwaiting).toBe(true);
    expect(state.missStreak).toBe(0);
  });
});
