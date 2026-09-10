import { describe, expect, it } from "vitest";
import {
  buildJudgePrompt,
  MAX_SCREEN_CHARS,
  parseJudgeVerdicts,
  prepareScreenText,
  type JudgeRequest
} from "./prompt";

const REQ = (paneKey: string, overrides: Partial<JudgeRequest> = {}): JudgeRequest => ({
  paneKey,
  screenText: "Plan mode — what next?\n → Execute the plan\n ↑↓ navigate",
  silentMs: 4_000,
  toolRunning: false,
  ...overrides
});

describe("prepareScreenText", () => {
  it("keeps the bottom of the screen when trimming to the cap", () => {
    const long = Array.from({ length: 500 }, (_, i) => `line-${i}`).join("\n");
    const prepared = prepareScreenText(long, 100);
    expect(prepared.length).toBeLessThanOrEqual(100);
    // The prompt lives at the bottom, so that is what must survive.
    expect(prepared.endsWith("line-499")).toBe(true);
  });

  it("collapses blank lines and trailing whitespace", () => {
    expect(prepareScreenText("a   \n\n\n  b\t\n")).toBe("a\n  b");
  });

  it("returns empty for blank input", () => {
    expect(prepareScreenText("   \n\n  ")).toBe("");
  });
});

describe("buildJudgePrompt", () => {
  it("includes every request with its id and evidence", () => {
    const prompt = buildJudgePrompt([REQ("p1"), REQ("p2", { toolRunning: true, silentMs: 9_000 })]);
    expect(prompt).toContain("id: p1");
    expect(prompt).toContain("id: p2");
    expect(prompt).toContain("toolRunning: false");
    expect(prompt).toContain("toolRunning: true");
    expect(prompt).toContain("silentForMs: 4000");
    expect(prompt).toContain("You will receive 2 screen(s)");
  });

  it("states the fail-safe rule and the counter-examples", () => {
    const prompt = buildJudgePrompt([REQ("p1")]);
    expect(prompt).toMatch(/when unsure, answer false/i);
    expect(prompt).toMatch(/scrollback/i);
    expect(prompt).toMatch(/toolRunning is true/i);
    expect(prompt).toContain('"awaiting"');
  });

  it("marks an empty screen instead of leaving a blank block", () => {
    expect(buildJudgePrompt([REQ("p1", { screenText: "  " })])).toContain("(screen is empty)");
  });

  it("caps each screen so batching stays bounded", () => {
    const huge = "x".repeat(MAX_SCREEN_CHARS * 3);
    const prompt = buildJudgePrompt([REQ("p1", { screenText: huge })]);
    expect(prompt.length).toBeLessThan(MAX_SCREEN_CHARS + 2_000);
  });
});

describe("parseJudgeVerdicts", () => {
  const requests = [REQ("p1"), REQ("p2")];

  it("parses a clean JSON reply", () => {
    const raw = '{"verdicts":[{"id":"p1","awaiting":true,"reason":"menu open"},{"id":"p2","awaiting":false}]}';
    expect(parseJudgeVerdicts(raw, requests)).toEqual([
      { paneKey: "p1", awaiting: true, reason: "menu open" },
      { paneKey: "p2", awaiting: false, reason: undefined }
    ]);
  });

  it("tolerates markdown fences and surrounding prose", () => {
    const raw = 'Sure, here you go:\n```json\n{"verdicts":[{"id":"p1","awaiting":true}]}\n```\nHope that helps!';
    expect(parseJudgeVerdicts(raw, requests)[0]).toMatchObject({ paneKey: "p1", awaiting: true });
  });

  it("accepts a bare array", () => {
    const raw = '[{"id":"p1","awaiting":true},{"id":"p2","awaiting":true}]';
    expect(parseJudgeVerdicts(raw, requests).every((v) => v.awaiting)).toBe(true);
  });

  it("defaults omitted panes to not-waiting", () => {
    const raw = '{"verdicts":[{"id":"p1","awaiting":true}]}';
    const verdicts = parseJudgeVerdicts(raw, requests);
    expect(verdicts).toHaveLength(2);
    expect(verdicts[1]).toEqual({ paneKey: "p2", awaiting: false });
  });

  it("fails safe on malformed replies", () => {
    for (const raw of [
      "I cannot help with that.",
      '{"verdicts": "nope"}',
      '{"verdicts":[{"id":"p1"}]}',
      '{"verdicts":[{"id":"","awaiting":true}]}',
      '{"verdicts":[{"id":"p1","awaiting":"yes"}]}',
      ""
    ]) {
      expect(parseJudgeVerdicts(raw, requests)).toEqual([
        { paneKey: "p1", awaiting: false },
        { paneKey: "p2", awaiting: false }
      ]);
    }
  });

  it("ignores ids that were not requested", () => {
    const raw = '{"verdicts":[{"id":"ghost","awaiting":true}]}';
    expect(parseJudgeVerdicts(raw, requests).every((v) => !v.awaiting)).toBe(true);
  });

  it("truncates an overlong reason", () => {
    const raw = JSON.stringify({ verdicts: [{ id: "p1", awaiting: true, reason: "x".repeat(400) }] });
    expect(parseJudgeVerdicts(raw, requests)[0]!.reason!.length).toBeLessThanOrEqual(120);
  });
});
