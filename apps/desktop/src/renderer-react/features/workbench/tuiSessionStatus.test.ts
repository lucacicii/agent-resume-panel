import { describe, expect, it } from "vitest";
import {
  applyTuiDebounce,
  createTuiDebounceState,
  detectInteractiveSelector,
  detectPermissionPromptText,
  detectTuiFingerprint,
  detectTuiSessionStatus,
  parseOscAgentStatus,
  stripAnsi,
  stripOscAgentStatus,
  TUI_RUNNING_MS
} from "./tuiSessionStatus";

describe("stripAnsi", () => {
  it("removes CSI sequences", () => {
    expect(stripAnsi("\x1b[31mAllow once\x1b[0m")).toBe("Allow once");
  });

  it("removes OSC sequences", () => {
    expect(stripAnsi("\x1b]0;Title\x07Hello")).toBe("Hello");
  });
});

describe("parseOscAgentStatus", () => {
  it("parses Agent Resume AR sequences", () => {
    expect(parseOscAgentStatus("\x1b]633;AR;awaiting;select\x07")).toEqual({
      status: "awaiting_user",
      awaitingConfidence: "confirmed",
      detail: "select"
    });
    expect(parseOscAgentStatus("\x1b]633;AR;running\x07")).toEqual({
      status: "running",
      detail: undefined
    });
    expect(parseOscAgentStatus("\x1b]633;AR;idle\x07")).toEqual({
      status: "open",
      detail: undefined
    });
  });

  it("parses VS Code shell integration OSC 633 sequences", () => {
    expect(parseOscAgentStatus("\x1b]633;A\x07")).toEqual({ status: "open" });
    expect(parseOscAgentStatus("\x1b]633;C\x07")).toEqual({ status: "running" });
    expect(parseOscAgentStatus("\x1b]633;D;0\x07")).toEqual({ status: "open" });
    expect(parseOscAgentStatus("\x1b]633;D;1\x07")).toEqual({ status: "error" });
  });

  it("returns null for unrelated chunks", () => {
    expect(parseOscAgentStatus("Hello world\r\n")).toBeNull();
    expect(parseOscAgentStatus("\x1b]633;P;Cwd=/tmp\x07")).toBeNull();
  });
});

describe("stripOscAgentStatus", () => {
  it("removes AR escape codes cleanly", () => {
    expect(stripOscAgentStatus("Prefix\x1b]633;AR;awaiting;select\x07Suffix")).toBe("PrefixSuffix");
  });
});

describe("detectInteractiveSelector (Tier 2 Fingerprint)", () => {
  it("matches user reported Pi plan mode selector menu", () => {
    const userPrompt = [
      "Plan mode — what next?",
      "",
      " → Execute the plan",
      "   Stay in plan mode",
      "   Refine the plan",
      "",
      " ↑↓ navigate  enter select  escape/ctrl+c cancel"
    ].join("\n");
    expect(detectInteractiveSelector(userPrompt)).toBe(true);
  });

  it("matches Pi plan plugin menu with up/down arrow selection", () => {
    const planMenu = [
      "Select an action for the current plan:",
      "❯ 1. Execute next step",
      "  2. Revise plan with advisor",
      "  3. Abort plan",
      "",
      "Use arrow keys to navigate, press Enter to confirm"
    ].join("\n");
    expect(detectInteractiveSelector(planMenu)).toBe(true);
  });

  it("matches inquirer / ink style radio selection lists", () => {
    const radioMenu = [
      "Choose deployment target:",
      "(*) Production (us-east-1)",
      "( ) Staging (eu-west-1)",
      "( ) Development"
    ].join("\n");
    expect(detectInteractiveSelector(radioMenu)).toBe(true);
  });

  it("matches menu with hidden cursor indicator", () => {
    const menuWithHiddenCursor = [
      "Select component:",
      "❯ Button",
      "  Input"
    ].join("\n");
    expect(detectInteractiveSelector(menuWithHiddenCursor, true)).toBe(true);
  });

  it("ignores bash shell redirects", () => {
    expect(detectInteractiveSelector("cat << EOF\nHello world\nEOF")).toBe(false);
  });
});

describe("detectPermissionPromptText (Tier 2 Permissions)", () => {
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

  it("matches modern Claude Code tool approval format", () => {
    const claudeCode = [
      "Allow bash command:",
      "  git status",
      "",
      "› 1. Yes, run this command",
      "  2. Yes, and don't ask again",
      "  3. No, tell Claude what to do instead"
    ].join("\n");
    expect(detectPermissionPromptText(claudeCode)).toBe(true);
  });

  it("matches [y/N] bracketed prompt formats", () => {
    expect(detectPermissionPromptText("Allow git push origin main? [y/N]")).toBe(true);
    expect(detectPermissionPromptText("Do you want to continue? [Y/n]")).toBe(true);
  });

  it("matches Chinese approval and confirmation prompts", () => {
    expect(detectPermissionPromptText("是否允许执行以下命令？\n1. 确认\n2. 取消")).toBe(true);
    expect(detectPermissionPromptText("需要确认：是否继续运行构建脚本？(是/否)")).toBe(true);
    expect(detectPermissionPromptText("等待用户确认执行…")).toBe(true);
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

describe("detectTuiFingerprint", () => {
  it("matches both menu selectors and permission prompts", () => {
    expect(detectTuiFingerprint({ visibleText: "❯ 1. Step A\n  2. Step B\nUse arrow keys" })).toBe(true);
    expect(detectTuiFingerprint({ visibleText: "Allow once\nDon't allow" })).toBe(true);
  });
});

describe("detectTuiSessionStatus (Multi-Tier Resolution)", () => {
  const base = {
    visibleText: "",
    lastOutputAt: 10_000,
    now: 11_000, // 1s silent
    isAlternateBuffer: true,
    isSessionPane: true
  };

  it("returns open for non-session panes", () => {
    expect(detectTuiSessionStatus({ ...base, isSessionPane: false, now: 20_000 }).status).toBe("open");
  });

  it("prioritizes Tier 1 protocol override immediately", () => {
    const result = detectTuiSessionStatus({
      ...base,
      protocolOverride: { status: "awaiting_user", awaitingConfidence: "confirmed", detail: "select" }
    });
    expect(result).toMatchObject({
      status: "awaiting_user",
      awaitingConfidence: "confirmed",
      source: "protocol"
    });
  });

  it("treats active streaming output (< 600ms) as running even with residual prompt text", () => {
    const result = detectTuiSessionStatus({
      ...base,
      visibleText: "Allow once\nDon't allow",
      lastOutputAt: 10_000,
      now: 10_200 // 200ms ago -> actively streaming!
    });
    expect(result).toMatchObject({ status: "running", source: "activity" });
  });

  it("returns confirmed awaiting on quiet window when fingerprint matches", () => {
    const result = detectTuiSessionStatus({
      ...base,
      visibleText: "Do you want to proceed?\nAllow once\nEsc to cancel",
      lastOutputAt: 10_000,
      now: 11_000 // 1000ms quiet
    });
    expect(result).toMatchObject({
      status: "awaiting_user",
      awaitingConfidence: "confirmed",
      textHit: true,
      source: "fingerprint"
    });
  });

  it("returns running when output is recent and no dialog matches", () => {
    const result = detectTuiSessionStatus({
      ...base,
      visibleText: "Compiling project...",
      now: base.lastOutputAt + TUI_RUNNING_MS - 100
    });
    expect(result).toMatchObject({ status: "running", source: "activity" });
  });

  it("safely falls back to open/idle on silence without false-alarm awaiting", () => {
    const result = detectTuiSessionStatus({
      ...base,
      visibleText: "pi >",
      now: base.lastOutputAt + TUI_RUNNING_MS + 2_000
    });
    expect(result).toMatchObject({ status: "open", textHit: false, source: "idle" });
  });
});

describe("applyTuiDebounce", () => {
  it("applies protocol status immediately without requiring two streak hits", () => {
    const state = createTuiDebounceState();
    const protocolSample = {
      status: "awaiting_user" as const,
      awaitingConfidence: "confirmed" as const,
      textHit: true,
      source: "protocol" as const
    };
    const result = applyTuiDebounce(state, protocolSample);
    expect(result.status).toBe("awaiting_user");
    expect(result.state.confirmedTextAwaiting).toBe(true);
  });

  it("requires two fingerprint text hits before confirmed awaiting", () => {
    let state = createTuiDebounceState();
    const hit = {
      status: "awaiting_user" as const,
      awaitingConfidence: "confirmed" as const,
      textHit: true,
      source: "fingerprint" as const
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
      textHit: true,
      source: "fingerprint" as const
    };
    state = applyTuiDebounce(state, hit).state;
    state = applyTuiDebounce(state, hit).state;
    expect(state.confirmedTextAwaiting).toBe(true);

    const miss = { status: "open" as const, textHit: false, source: "idle" as const };
    let result = applyTuiDebounce(state, miss);
    state = result.state;
    result = applyTuiDebounce(state, miss);
    expect(result.state.confirmedTextAwaiting).toBe(false);
    expect(result.status).toBe("open");
  });
});
