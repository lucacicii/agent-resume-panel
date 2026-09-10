import { describe, expect, it } from "vitest";
import {
  detectInteractiveSelector,
  detectPermissionPromptText,
  detectScreenFingerprint
} from "./fingerprint";

describe("detectInteractiveSelector", () => {
  it("matches a Pi plan-mode menu (the real reported shape)", () => {
    const prompt = [
      "Plan mode — what next?",
      "",
      " → Execute the plan",
      "   Stay in plan mode",
      "   Refine the plan",
      "",
      " ↑↓ navigate  enter select  escape/ctrl+c cancel"
    ].join("\n");
    expect(detectInteractiveSelector(prompt)).toBe(true);
  });

  it("matches an arrow-menu with an explicit navigation hint", () => {
    const menu = [
      "Select an action for the current plan:",
      "❯ 1. Execute next step",
      "  2. Revise plan with advisor",
      "  3. Abort plan",
      "",
      "Use arrow keys to navigate, press Enter to confirm"
    ].join("\n");
    expect(detectInteractiveSelector(menu)).toBe(true);
  });

  it("matches inquirer / ink style radio lists", () => {
    const menu = [
      "Choose deployment target:",
      "(*) Production (us-east-1)",
      "( ) Staging (eu-west-1)",
      "( ) Development"
    ].join("\n");
    expect(detectInteractiveSelector(menu)).toBe(true);
  });

  it("matches a pointer menu when the cursor is hidden", () => {
    expect(detectInteractiveSelector("Select component:\n❯ Button\n  Input", true)).toBe(true);
  });

  it("matches a pointer menu once a navigation hint corroborates it", () => {
    expect(detectInteractiveSelector("→ Option A\n  Option B\n  Option C\n↑↓ navigate")).toBe(true);
    expect(detectInteractiveSelector("› Option A\n  Option B\nUse arrow keys", false)).toBe(true);
  });

  it("matches a pointer menu when the cursor is hidden", () => {
    expect(detectInteractiveSelector("→ Option A\n  Option B\n  Option C", true)).toBe(true);
  });

  it("matches a multi-item radio / checkbox list without a hint", () => {
    expect(detectInteractiveSelector("❯ Option A\n❯ Option B")).toBe(true);
    expect(detectInteractiveSelector("[x] Option A\n[ ] Option B")).toBe(true);
  });

  it("accepts every pointer glyph agent TUIs use", () => {
    for (const glyph of ["❯", "›", "▶", "▸", "●", "◉", "→"]) {
      expect(detectInteractiveSelector(`${glyph} Option A\n↑↓ navigate`), `glyph ${glyph}`).toBe(true);
    }
  });

  it("requires corroboration for a lone pointer, to stay precise", () => {
    // A single arrowed line plus plain text is not enough evidence.
    expect(detectInteractiveSelector("→ Option A\n  Option B\n  Option C")).toBe(false);
    // ASCII arrows show up in prose and redirects, so they are never trusted alone.
    expect(detectInteractiveSelector("-> Option A\n=> Option B")).toBe(false);
  });

  it("ignores heredoc / redirect noise", () => {
    expect(detectInteractiveSelector("cat << EOF\nHello world\nEOF")).toBe(false);
  });

  it("ignores ordinary agent output", () => {
    expect(detectInteractiveSelector("Compiling project...\nDone in 1.2s")).toBe(false);
    expect(detectInteractiveSelector("")).toBe(false);
  });
});

describe("detectPermissionPromptText", () => {
  it("matches a Claude-style multi-option dialog", () => {
    const text = [
      "Do you want to proceed?",
      " 1. Allow once",
      " 2. Yes, and don't ask again",
      " 3. No, and tell Claude what to do differently",
      "Esc to cancel"
    ].join("\n");
    expect(detectPermissionPromptText(text)).toBe(true);
  });

  it("matches the modern Claude Code tool approval layout", () => {
    const text = [
      "Allow bash command:",
      "  git status",
      "",
      "› 1. Yes, run this command",
      "  2. Yes, and don't ask again",
      "  3. No, tell Claude what to do instead"
    ].join("\n");
    expect(detectPermissionPromptText(text)).toBe(true);
  });

  it("matches [y/N] and [Y/n] bracketed prompts", () => {
    expect(detectPermissionPromptText("Allow git push origin main? [y/N]")).toBe(true);
    expect(detectPermissionPromptText("Do you want to continue? [Y/n]")).toBe(true);
  });

  it("matches Codex allow / don't allow pair", () => {
    expect(detectPermissionPromptText("Allow\nDon't allow\nEdit command")).toBe(true);
  });

  it("matches waiting-for-approval copy", () => {
    expect(detectPermissionPromptText("Waiting for approval…")).toBe(true);
    expect(detectPermissionPromptText("Awaiting confirmation")).toBe(true);
  });

  it("matches Chinese approval prompts", () => {
    expect(detectPermissionPromptText("是否允许执行以下命令？\n1. 确认\n2. 取消")).toBe(true);
    expect(detectPermissionPromptText("需要确认：是否继续运行构建脚本？(是/否)")).toBe(true);
    expect(detectPermissionPromptText("等待用户确认执行…")).toBe(true);
  });

  it("ignores system permission-denied errors", () => {
    expect(detectPermissionPromptText("bash: /etc/shadow: permission denied")).toBe(false);
  });

  it("ignores a lone Allow with no deny / option pair", () => {
    expect(detectPermissionPromptText("Allow network access in settings")).toBe(false);
  });

  it("ignores ordinary output", () => {
    expect(detectPermissionPromptText("")).toBe(false);
    expect(detectPermissionPromptText("Build succeeded")).toBe(false);
  });
});

describe("detectScreenFingerprint", () => {
  it("matches selectors and permission dialogs alike", () => {
    expect(detectScreenFingerprint({ visibleText: "❯ 1. Step A\n  2. Step B\nUse arrow keys" })).toBe(true);
    expect(detectScreenFingerprint({ visibleText: "Allow once\nDon't allow" })).toBe(true);
  });

  it("returns false for plain output", () => {
    expect(detectScreenFingerprint({ visibleText: "npm test\nPASS" })).toBe(false);
  });
});
