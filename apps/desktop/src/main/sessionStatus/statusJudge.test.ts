import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JudgeRequest } from "./prompt";

// ── LLM 原语 mock（不发起任何网络请求）──────────────────────────────────
const chatCompletionDetailed = vi.fn();
vi.mock("@agent-resume/core", () => ({
  chatCompletionDetailed: (...args: unknown[]) => chatCompletionDetailed(...args),
  recordLlmUsage: vi.fn(async () => "id"),
  sessionStatusLlmConfigFromSettings: (settings: { configured?: boolean }) =>
    settings?.configured === false
      ? undefined
      : { baseUrl: "https://api.example.com", model: "judge-mini", apiKey: "k" }
}));

import { StatusJudge, HOURLY_CALL_LIMIT_PER_PANE, MAX_REQUESTS_PER_CALL } from "./statusJudge";

const REQ = (paneKey: string): JudgeRequest => ({
  paneKey,
  screenText: "Plan mode — what next?\n → Execute the plan",
  silentMs: 4_000,
  toolRunning: false
});

const settingsWith = (configured: boolean) => ({ configured }) as never;

describe("StatusJudge", () => {
  beforeEach(() => {
    chatCompletionDetailed.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies verdicts returned by the model", async () => {
    chatCompletionDetailed.mockResolvedValue({
      content: '{"verdicts":[{"id":"p1","awaiting":true,"reason":"menu"}]}',
      model: "judge-mini",
      durationMs: 120
    });

    const judge = new StatusJudge({ loadSettings: () => settingsWith(true) });
    const verdicts = await judge.judge([REQ("p1")]);
    expect(verdicts).toEqual([{ paneKey: "p1", awaiting: true, reason: "menu" }]);
  });

  it("sends one batched call for many panes", async () => {
    chatCompletionDetailed.mockResolvedValue({ content: '{"verdicts":[]}', durationMs: 50 });

    const judge = new StatusJudge({ loadSettings: () => settingsWith(true) });
    await judge.judge([REQ("p1"), REQ("p2"), REQ("p3")]);

    expect(chatCompletionDetailed).toHaveBeenCalledTimes(1);
    const prompt = chatCompletionDetailed.mock.calls[0][1][0].content as string;
    expect(prompt).toContain("id: p1");
    expect(prompt).toContain("id: p3");
  });

  it("caps the number of panes per call", async () => {
    chatCompletionDetailed.mockResolvedValue({ content: '{"verdicts":[]}', durationMs: 10 });
    const many = Array.from({ length: MAX_REQUESTS_PER_CALL + 4 }, (_, i) => REQ(`p${i}`));

    const judge = new StatusJudge({ loadSettings: () => settingsWith(true) });
    const verdicts = await judge.judge(many);

    // Every request is answered, but only the first batch reaches the model.
    expect(verdicts).toHaveLength(many.length);
    const prompt = chatCompletionDetailed.mock.calls[0][1][0].content as string;
    expect(prompt).not.toContain(`id: p${MAX_REQUESTS_PER_CALL + 3}`);
  });

  it("does not call the model when nothing is configured", async () => {
    const judge = new StatusJudge({ loadSettings: () => settingsWith(false) });
    const verdicts = await judge.judge([REQ("p1")]);
    expect(chatCompletionDetailed).not.toHaveBeenCalled();
    expect(verdicts).toEqual([{ paneKey: "p1", awaiting: false }]);
  });

  it("degrades to not-waiting on a malformed reply", async () => {
    chatCompletionDetailed.mockResolvedValue({ content: "I cannot help with that.", durationMs: 30 });
    const judge = new StatusJudge({ loadSettings: () => settingsWith(true) });
    expect(await judge.judge([REQ("p1")])).toEqual([{ paneKey: "p1", awaiting: false }]);
  });

  it("degrades to not-waiting when the request fails", async () => {
    chatCompletionDetailed.mockRejectedValue(new Error("connection refused"));
    const judge = new StatusJudge({ loadSettings: () => settingsWith(true) });
    expect(await judge.judge([REQ("p1")])).toEqual([{ paneKey: "p1", awaiting: false }]);
  });

  it("degrades to not-waiting on timeout without throwing", async () => {
    chatCompletionDetailed.mockImplementation(async (_cfg, _msgs, _tokens, signal: AbortSignal) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (signal?.aborted) {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
      return { content: "", durationMs: 5 };
    });

    const judge = new StatusJudge({ loadSettings: () => settingsWith(true) });
    const verdicts = await judge.judge([REQ("p1")]);
    expect(verdicts).toEqual([{ paneKey: "p1", awaiting: false }]);
  });

  it("keeps a second concurrent batch from doubling spend", async () => {
    let release = () => {};
    chatCompletionDetailed.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { content: '{"verdicts":[]}', durationMs: 10 };
    });

    const judge = new StatusJudge({ loadSettings: () => settingsWith(true) });
    const first = judge.judge([REQ("p1")]);
    // Let the first call enter flight before the second arrives.
    await Promise.resolve();
    const second = await judge.judge([REQ("p2")]);
    expect(second).toEqual([{ paneKey: "p2", awaiting: false }]);
    expect(chatCompletionDetailed).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it("stops calling the model once the hourly per-pane budget is spent", async () => {
    vi.useFakeTimers();
    chatCompletionDetailed.mockResolvedValue({ content: '{"verdicts":[]}', durationMs: 5 });

    const judge = new StatusJudge({ loadSettings: () => settingsWith(true) });
    for (let i = 0; i < HOURLY_CALL_LIMIT_PER_PANE; i += 1) {
      await judge.judge([REQ("p1")]);
    }
    const callsAtLimit = chatCompletionDetailed.mock.calls.length;
    expect(callsAtLimit).toBe(HOURLY_CALL_LIMIT_PER_PANE);

    // Over budget: answered, but no further spend.
    expect(await judge.judge([REQ("p1")])).toEqual([{ paneKey: "p1", awaiting: false }]);
    expect(chatCompletionDetailed).toHaveBeenCalledTimes(callsAtLimit);

    // A different pane has its own budget.
    await judge.judge([REQ("p2")]);
    expect(chatCompletionDetailed).toHaveBeenCalledTimes(callsAtLimit + 1);

    // After the window slides, budget is restored.
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    await judge.judge([REQ("p1")]);
    expect(chatCompletionDetailed).toHaveBeenCalledTimes(callsAtLimit + 2);
  });

  it("returns nothing for an empty batch without calling the model", async () => {
    const judge = new StatusJudge({ loadSettings: () => settingsWith(true) });
    expect(await judge.judge([])).toEqual([]);
    expect(chatCompletionDetailed).not.toHaveBeenCalled();
  });
});
