import { describe, expect, it } from "vitest";
import {
  RUNNING_WINDOW_MS,
  STREAMING_WINDOW_MS,
  advanceHysteresis,
  createHysteresis,
  evaluateStatus,
  screenHitFor
} from "./derive";
import type { PaneTelemetry } from "./types";

const NOW = 1_000_000;

function telemetry(overrides: Partial<PaneTelemetry> = {}): PaneTelemetry {
  return { paneId: 1, at: NOW, lastOutputAt: NOW, ...overrides };
}

function evaluate(input: Omit<Parameters<typeof evaluateStatus>[0], "now">) {
  return evaluateStatus({ ...input, now: NOW }).state;
}

const MENU = "❯ 1. Yes\n  2. No\nUse arrow keys to navigate";

describe("evaluateStatus", () => {
  it("believes an explicit agent report above everything else", () => {
    const state = evaluate({
      nativeState: "blocked",
      telemetry: telemetry({ screenText: "idle prompt", lastOutputAt: NOW }),
      hysteresis: createHysteresis(),
      screenHit: false
    });
    expect(state).toBe("blocked");
  });

  it("treats a running tool as work", () => {
    const result = evaluateStatus({
      telemetry: telemetry({ toolRunning: true, screenText: MENU, lastOutputAt: NOW - 5_000 }),
      hysteresis: createHysteresis(),
      screenHit: false,
      now: NOW
    });
    expect(result.state).toBe("working");
    expect(result.source).toBe("process");
  });

  it("lets live output outrank stale dialog text on screen", () => {
    const result = evaluateStatus({
      telemetry: telemetry({ screenText: MENU, lastOutputAt: NOW - 10 }),
      hysteresis: createHysteresis(),
      screenHit: false,
      now: NOW
    });
    expect(result.state).toBe("working");
    expect(result.source).toBe("activity");
  });

  it("reports blocked when the screen fingerprint matches a quiet pane", () => {
    const telemetryFrame = telemetry({ screenText: MENU, lastOutputAt: NOW - 1_000 });
    const hit = screenHitFor(telemetryFrame, NOW);
    expect(hit).toBe(true);
    const result = evaluateStatus({
      telemetry: telemetryFrame,
      hysteresis: advanceHysteresis(createHysteresis(), hit),
      screenHit: hit,
      now: NOW
    });
    expect(result.state).toBe("blocked");
    expect(result.source).toBe("screen");
  });

  it("keeps output inside the running window as work", () => {
    expect(evaluate({
      telemetry: telemetry({ lastOutputAt: NOW - STREAMING_WINDOW_MS - 1 }),
      hysteresis: createHysteresis(),
      screenHit: false
    })).toBe("working");
  });

  it("falls back to idle once nothing is fresh", () => {
    expect(evaluate({
      telemetry: telemetry({ lastOutputAt: NOW - RUNNING_WINDOW_MS - 1 }),
      hysteresis: createHysteresis(),
      screenHit: false
    })).toBe("idle");
  });

  it("never invents blocked without a screen hit", () => {
    expect(evaluate({ hysteresis: createHysteresis(), screenHit: false })).toBe("idle");
  });
});

describe("screenHitFor", () => {
  it("ignores screen text while a tool runs or output streams", () => {
    expect(screenHitFor(telemetry({ screenText: MENU, toolRunning: true }), NOW)).toBe(false);
    expect(screenHitFor(telemetry({ screenText: MENU, lastOutputAt: NOW - 100 }), NOW)).toBe(false);
  });

  it("ignores a screen with no dialog", () => {
    expect(screenHitFor(telemetry({ screenText: "❯ ", lastOutputAt: NOW - 1_000 }), NOW)).toBe(false);
  });
});

describe("advanceHysteresis", () => {
  it("keeps the alert through one redraw-free frame", () => {
    let state = advanceHysteresis(createHysteresis(), true);
    expect(state.confirmedAwaiting).toBe(true);
    state = advanceHysteresis(state, false);
    expect(state.confirmedAwaiting).toBe(true);
    state = advanceHysteresis(state, false);
    expect(state.confirmedAwaiting).toBe(false);
  });

  it("clears immediately when the screen matches again", () => {
    let state = advanceHysteresis(createHysteresis(), true);
    state = advanceHysteresis(state, false);
    state = advanceHysteresis(state, true);
    expect(state.confirmedAwaiting).toBe(true);
    expect(state.missStreak).toBe(0);
  });
});
