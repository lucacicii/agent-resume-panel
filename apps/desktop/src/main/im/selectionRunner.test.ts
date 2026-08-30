import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-resume/core", async () => {
  const actual = await vi.importActual<typeof import("@agent-resume/core")>("@agent-resume/core");
  return {
    ...actual,
    loadSettings: vi.fn(async () => ({ panelHome: "/tmp/im-runner-home" })),
    effectivePanelHome: (settings: { panelHome?: string }) => settings.panelHome ?? "/tmp",
    chatLlmConfigFromSettings: vi.fn(() => ({ baseUrl: "https://example.test/v1", model: "chat-test", apiKey: "k" })),
    chatCompletionDetailed: vi.fn(async () => ({
      content: "translated answer",
      model: "chat-test",
      durationMs: 42
    })),
    recordLlmUsage: vi.fn(async () => "usage-id")
  };
});

import { desktopDbPath, ensureDesktopDbSchema } from "@agent-resume/core";
import { ImStore } from "./store";
import { runIndependentSelectionAction } from "./selectionRunner";

const homes: string[] = [];

async function createStore(): Promise<ImStore> {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-im-runner-"));
  homes.push(panelHome);
  const dbPath = desktopDbPath(panelHome);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await ensureDesktopDbSchema(dbPath);
  const store = new ImStore(dbPath);
  await store.initialize();
  return store;
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

describe("runIndependentSelectionAction", () => {
  it("fills the {selection} template and returns chat model text", async () => {
    const store = await createStore();
    const result = await runIndependentSelectionAction(store, "translate", "hello world");
    expect(result.text).toBe("translated answer");
    const { chatCompletionDetailed } = await import("@agent-resume/core");
    const call = vi.mocked(chatCompletionDetailed).mock.calls.at(-1);
    const prompt = (call?.[1] as Array<{ content: string }>)[0]?.content ?? "";
    expect(prompt).toContain("hello world");
  });

  it("rejects context-kind actions and missing chat LLM config", async () => {
    const store = await createStore();
    await expect(runIndependentSelectionAction(store, "quote", "text")).rejects.toThrow(/independent/i);
    const { chatLlmConfigFromSettings } = await import("@agent-resume/core");
    vi.mocked(chatLlmConfigFromSettings).mockReturnValueOnce(undefined);
    await expect(runIndependentSelectionAction(store, "translate", "text")).rejects.toThrow(/not configured|configured/i);
  });
});