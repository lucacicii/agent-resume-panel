import { describe, expect, it } from "vitest";
import {
  applyTuiDebounce,
  createTuiDebounceState,
  detectPermissionPromptText,
  detectTuiSessionStatus,
  stripAnsi,
  TUI_IDLE_AWAIT_MS,
  TUI_RUNNING_MS
} from "./tuiSessionStatus";

describe("stripAnsi", () => {
  it("removes CSI sequences", () => {
    expect(stripAnsi("\x1b[31mAllow once\x1b[0m")).toBe("Allow once");
  });
});

describe("detectPermissionPromptText", () => {
  it("matches Claude-style permission dialog", () => {
    const text = [
      "Do you want to proceed?",
      " 1. Allow once",
      " 2. Yes, and don't ask again",
      " 3. No, and tell Claude what to do differently",
      "Esc to cancel"
    ].join("\n");
    expect(detectPermissionPromptText(text)).toBe(true);
  });

  it("matches Codex allow / don't allow pair", () => {
    expect(detectPermissionPromptText("Allow\nDon't allow\nEdit command")).toBe(true);
  });

  it("matches waiting-for-approval copy", () => {
    expect(detectPermissionPromptText("Waiting for approval…")).toBe(true);
  });

  it("ignores system permission denied logs", () => {
    expect(detectPermissionPromptText("bash: /etc/shadow: permission denied")).toBe(false);
  });

  it("ignores lone Allow without a deny/option pair", () => {
    expect(detectPermissionPromptText("Allow network access in settings")).toBe(false);
  });
});

describe("detectTuiSessionStatus", () => {
  const base = {
    visibleText: "",
    lastOutputAt: 1_000,
    now: 1_000,
    isAlternateBuffer: true,
    isSessionPane: true
  };

  it("returns open for non-session panes", () => {
    expect(detectTuiSessionStatus({ ...base, isSessionPane: false, now: 20_000 }).status).toBe("open");
  });

  it("returns confirmed awaiting on permission text", () => {
    const result = detectTuiSessionStatus({
      ...base,
      visibleText: "Do you want to proceed?\nAllow once\nEsc to cancel"
    });
    expect(result).toMatchObject({ status: "awaiting_user", awaitingConfidence: "confirmed", textHit: true });
  });

  it("returns running when output is recent", () => {
    const result = detectTuiSessionStatus({
      ...base,
      now: base.lastOutputAt + TUI_RUNNING_MS - 1
    });
    expect(result.status).toBe("running");
  });

  it("returns possible awaiting after idle silence on alternate buffer", () => {
    const result = detectTuiSessionStatus({
      ...base,
      now: base.lastOutputAt + TUI_IDLE_AWAIT_MS
    });
    expect(result).toMatchObject({ status: "awaiting_user", awaitingConfidence: "possible" });
  });

  it("does not idle-await on normal buffer", () => {
    const result = detectTuiSessionStatus({
      ...base,
      isAlternateBuffer: false,
      now: base.lastOutputAt + TUI_IDLE_AWAIT_MS + 5_000
    });
    expect(result.status).toBe("open");
  });

  it("stays open when silent but under idle threshold", () => {
    const result = detectTuiSessionStatus({
      ...base,
      now: base.lastOutputAt + TUI_RUNNING_MS + 100
    });
    expect(result.status).toBe("open");
  });
});

describe("applyTuiDebounce", () => {
  it("requires two text hits before confirmed awaiting", () => {
    let state = createTuiDebounceState();
    const hit = {
      status: "awaiting_user" as const,
      awaitingConfidence: "confirmed" as const,
      textHit: true
    };
    const first = applyTuiDebounce(state, hit);
    expect(first.status).not.toBe("awaiting_user");
    state = first.state;
    const second = applyTuiDebounce(state, hit);
    expect(second).toMatchObject({ status: "awaiting_user", awaitingConfidence: "confirmed" });
  });

  it("clears confirmed text awaiting after two misses", () => {
    let state = createTuiDebounceState();
    const hit = {
      status: "awaiting_user" as const,
      awaitingConfidence: "confirmed" as const,
      textHit: true
    };
    state = applyTuiDebounce(state, hit).state;
    state = applyTuiDebounce(state, hit).state;
    expect(state.confirmedTextAwaiting).toBe(true);

    const miss = { status: "open" as const, textHit: false };
    let result = applyTuiDebounce(state, miss);
    state = result.state;
    result = applyTuiDebounce(state, miss);
    expect(result.state.confirmedTextAwaiting).toBe(false);
    expect(result.status).toBe("open");
  });

  it("applies idle possible awaiting without text streak", () => {
    const state = createTuiDebounceState();
    const sample = {
      status: "awaiting_user" as const,
      awaitingConfidence: "possible" as const,
      textHit: false
    };
    const result = applyTuiDebounce(state, sample);
    expect(result).toMatchObject({ status: "awaiting_user", awaitingConfidence: "possible" });
  });
});
