import { describe, expect, it } from "vitest";
import {
  createHysteresis,
  probeSessionStatus,
  RUNNING_WINDOW_MS,
  settleStatus,
  STREAMING_WINDOW_MS
} from "./resolver";

const BASE = {
  visibleText: "",
  lastOutputAt: 10_000,
  now: 11_000
};

describe("probeSessionStatus", () => {
  it("believes an explicit report above everything else", () => {
    const result = probeSessionStatus({
      ...BASE,
      visibleText: "Allow once\nDon't allow",
      reported: { status: "awaiting_user", awaitingConfidence: "confirmed", detail: "select" }
    });
    expect(result).toMatchObject({
      status: "awaiting_user",
      awaitingConfidence: "confirmed",
      source: "native"
    });
  });

  it("treats live output as running even with a stale dialog on screen", () => {
    const result = probeSessionStatus({
      ...BASE,
      visibleText: "Allow once\nDon't allow",
      lastOutputAt: 10_000,
      now: 10_000 + STREAMING_WINDOW_MS - 50
    });
    expect(result).toMatchObject({ status: "running", source: "activity" });
  });

  it("reports awaiting on a confident screen match once output goes quiet", () => {
    const result = probeSessionStatus({
      ...BASE,
      visibleText: "Do you want to proceed?\nAllow once\nEsc to cancel"
    });
    expect(result).toMatchObject({
      status: "awaiting_user",
      awaitingConfidence: "confirmed",
      textHit: true,
      source: "fingerprint"
    });
  });

  it("stays running while output is recent but unmatched", () => {
    const result = probeSessionStatus({
      ...BASE,
      visibleText: "Compiling project...",
      now: BASE.lastOutputAt + RUNNING_WINDOW_MS - 100
    });
    expect(result).toMatchObject({ status: "running", source: "activity" });
  });

  it("falls back to idle on silence — never a false 'waiting for you'", () => {
    const result = probeSessionStatus({
      ...BASE,
      visibleText: "pi >",
      now: BASE.lastOutputAt + RUNNING_WINDOW_MS + 2_000
    });
    expect(result).toMatchObject({ status: "open", textHit: false, source: "idle" });
  });

  it("treats a never-seen pane as idle rather than running", () => {
    const result = probeSessionStatus({ visibleText: "", lastOutputAt: 5_000, now: 5_000 });
    expect(result.status).toBe("running"); // fresh spawn still counts as activity
  });
});

describe("settleStatus", () => {
  it("applies an exact native report without hysteresis", () => {
    const outcome = settleStatus(createHysteresis(), {
      status: "awaiting_user",
      awaitingConfidence: "confirmed",
      textHit: true,
      source: "native"
    });
    expect(outcome.status).toBe("awaiting_user");
    expect(outcome.state.confirmedTextAwaiting).toBe(true);
  });

  it("raises awaiting on the first fingerprint hit (fast attack)", () => {
    const outcome = settleStatus(createHysteresis(), {
      status: "awaiting_user",
      awaitingConfidence: "confirmed",
      textHit: true,
      source: "fingerprint"
    });
    expect(outcome.status).toBe("awaiting_user");
    expect(outcome.state.confirmedTextAwaiting).toBe(true);
  });

  it("clears a confirmed awaiting only after two misses (slow decay)", () => {
    let state = createHysteresis();
    state = settleStatus(state, {
      status: "awaiting_user",
      awaitingConfidence: "confirmed",
      textHit: true,
      source: "fingerprint"
    }).state;
    expect(state.confirmedTextAwaiting).toBe(true);

    const miss = { status: "open" as const, textHit: false, source: "idle" as const };
    state = settleStatus(state, miss).state;
    expect(state.confirmedTextAwaiting).toBe(true);

    const final = settleStatus(state, miss);
    expect(final.state.confirmedTextAwaiting).toBe(false);
    expect(final.status).toBe("open");
  });

  it("holds the alert across a single transient miss (redraw noise)", () => {
    let state = createHysteresis();
    state = settleStatus(state, {
      status: "awaiting_user",
      awaitingConfidence: "confirmed",
      textHit: true,
      source: "fingerprint"
    }).state;

    const held = settleStatus(state, { status: "running" as const, textHit: false, source: "activity" as const });
    expect(held.status).toBe("awaiting_user");
  });

  it("does not flash awaiting while a hit is still unconfirmed", () => {
    const state = { hitStreak: 0, missStreak: 1, confirmedTextAwaiting: false };
    const outcome = settleStatus(state, {
      status: "awaiting_user",
      awaitingConfidence: "confirmed",
      textHit: true,
      source: "fingerprint"
    });
    // Hit streak reaches the confirm threshold in one step, so this is awaiting.
    expect(outcome.status).toBe("awaiting_user");
  });
});
