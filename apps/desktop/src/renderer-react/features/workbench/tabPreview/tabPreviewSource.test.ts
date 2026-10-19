import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  agentStatusScreen: vi.fn(),
  previewSession: vi.fn(),
  acpLoadMessages: vi.fn(),
  thunderChatGetConversation: vi.fn(),
  notesRead: vi.fn()
}));

vi.mock("../../../bridge", () => ({ desktopApi: () => apiMocks }));

const {
  clearTabPreviewCache,
  firstLines,
  loadTabPreview,
  stripAnsi,
  stripFrontmatter,
  summarizeTextDiff,
  tailLines
} = await import("./tabPreviewSource");

type ScreenTarget = Parameters<typeof loadTabPreview>[0] & { kind: "screen" };

const screenTarget = (overrides: Partial<ScreenTarget> = {}): ScreenTarget => ({
  kind: "screen",
  key: "terminal:1",
  title: "Terminal 1",
  accent: "terminal",
  ptyId: 7,
  ...overrides
} as ScreenTarget);

beforeEach(() => {
  clearTabPreviewCache();
  for (const mock of Object.values(apiMocks)) mock.mockReset();
});

afterEach(() => {
  clearTabPreviewCache();
});

describe("line helpers", () => {
  it("keeps the bottom of a screen, strips ANSI and trailing blank rows", () => {
    const text = "\x1b[32mfirst\x1b[0m\r\nsecond\r\n\r\nthird\r\n  \r\n";
    // Interior blank rows are part of a terminal's visible layout; only the
    // trailing ones are dropped.
    expect(tailLines(text, 3)).toEqual(["second", "", "third"]);
    expect(stripAnsi("\x1b[1mhi\x1b[0m")).toBe("hi");
  });

  it("keeps the head of a document and drops its trailing blanks", () => {
    expect(firstLines("one\ntwo\n\n\n", 1)).toEqual(["one"]);
    expect(firstLines("a\r\nb", 5)).toEqual(["a", "b"]);
  });

  it("removes only a leading YAML block from a note", () => {
    const text = "---\nwork: true\n---\n# Task\nbody";
    expect(stripFrontmatter(text)).toBe("# Task\nbody");
    expect(stripFrontmatter("# Task")).toBe("# Task");
  });
});

describe("summarizeTextDiff", () => {
  it("counts the changed middle and excerpts it", () => {
    const summary = summarizeTextDiff("a\nb\nc", "a\nB\nc");
    expect(summary).toMatchObject({ added: 1, removed: 1 });
    expect(summary.lines).toEqual([
      { kind: "del", text: "b" },
      { kind: "add", text: "B" }
    ]);
  });

  it("reports no change for identical text", () => {
    expect(summarizeTextDiff("same", "same")).toEqual({ added: 0, removed: 0, lines: [] });
  });
});

describe("loadTabPreview", () => {
  it("reads the pane mirror for a terminal", async () => {
    apiMocks.agentStatusScreen.mockResolvedValue({ screenText: "$ npm test\nall green\n" });
    await expect(loadTabPreview(screenTarget())).resolves.toEqual({
      kind: "screen",
      lines: ["$ npm test", "all green"]
    });
    expect(apiMocks.agentStatusScreen).toHaveBeenCalledWith({ paneId: 7 });
  });

  it("falls back to the session transcript when the mirror is empty", async () => {
    apiMocks.agentStatusScreen.mockResolvedValue({ screenText: "" });
    apiMocks.previewSession.mockResolvedValue({
      session: {},
      preview: {
        title: "t",
        messages: [
          { role: "user", text: "one" },
          { role: "assistant", text: "two" },
          { role: "assistant", text: "three" },
          { role: "assistant", text: "four" }
        ]
      }
    });
    const target = screenTarget({
      accent: "session",
      session: { provider: "codex", id: "s-1" }
    });
    await expect(loadTabPreview(target)).resolves.toEqual({
      kind: "messages",
      messages: [
        { role: "assistant", text: "two" },
        { role: "assistant", text: "three" },
        { role: "assistant", text: "four" }
      ]
    });
    expect(apiMocks.previewSession).toHaveBeenCalledWith({ provider: "codex", id: "s-1" });
  });

  it("returns null when neither the mirror nor a transcript has content", async () => {
    apiMocks.agentStatusScreen.mockResolvedValue(null);
    await expect(loadTabPreview(screenTarget({ session: undefined }))).resolves.toBeNull();
  });

  it("reads the last three ACP messages", async () => {
    apiMocks.acpLoadMessages.mockResolvedValue([
      { id: "1", role: "user", text: "old", timestamp: 1 },
      { id: "2", role: "user", text: "one", timestamp: 2 },
      { id: "3", role: "assistant", text: "two", timestamp: 3 },
      { id: "4", role: "assistant", text: "  ", timestamp: 4 },
      { id: "5", role: "assistant", text: "three", timestamp: 5 }
    ]);
    await expect(loadTabPreview({
      kind: "acp",
      key: "acp:1",
      title: "Chat",
      accent: "session",
      recordId: "chat-1"
    })).resolves.toEqual({
      kind: "messages",
      messages: [
        { role: "user", text: "one" },
        { role: "assistant", text: "two" },
        { role: "assistant", text: "three" }
      ]
    });
    expect(apiMocks.acpLoadMessages).toHaveBeenCalledWith({ chatId: "chat-1" });
  });

  it("reads the last three Thunder messages and ignores reasoning", async () => {
    apiMocks.thunderChatGetConversation.mockResolvedValue({
      id: "t-1",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "ask" },
        { role: "assistant", content: "answer", reasoning: "hidden" }
      ]
    });
    await expect(loadTabPreview({
      kind: "thunder",
      key: "thunder:t-1",
      title: "Thunder",
      accent: "session",
      sessionId: "t-1"
    })).resolves.toEqual({
      kind: "messages",
      messages: [
        { role: "user", text: "ask" },
        { role: "assistant", text: "answer" }
      ]
    });
  });

  it("does not call Thunder for a draft pane", async () => {
    await expect(loadTabPreview({
      kind: "thunder",
      key: "thunder:draft:1",
      title: "Draft",
      accent: "session"
    })).resolves.toBeNull();
    expect(apiMocks.thunderChatGetConversation).not.toHaveBeenCalled();
  });

  it("reads a note head without its frontmatter", async () => {
    apiMocks.notesRead.mockResolvedValue({
      record: {},
      content: "---\ntitle: x\n---\n# Heading\nbody"
    });
    await expect(loadTabPreview({
      kind: "note",
      key: "note:1",
      title: "Note",
      accent: "note",
      noteId: "n-1"
    })).resolves.toEqual({ kind: "text", lines: ["# Heading", "body"] });
  });

  it("answers local editor and diff panes without the bridge", async () => {
    await expect(loadTabPreview({
      kind: "text",
      key: "editor:1",
      title: "a.ts",
      accent: "code",
      text: "const a = 1;\n",
      mono: true
    })).resolves.toEqual({ kind: "text", lines: ["const a = 1;"] });
    await expect(loadTabPreview({
      kind: "diff",
      key: "diff:1",
      title: "a.ts",
      accent: "code",
      oldText: "a\nb",
      newText: "a\nc"
    })).resolves.toMatchObject({ kind: "diff", added: 1, removed: 1 });
    expect(apiMocks.agentStatusScreen).not.toHaveBeenCalled();
    expect(apiMocks.notesRead).not.toHaveBeenCalled();
  });

  it("reuses the cached live preview inside the TTL", async () => {
    apiMocks.agentStatusScreen.mockResolvedValue({ screenText: "x" });
    await loadTabPreview(screenTarget());
    await loadTabPreview(screenTarget());
    expect(apiMocks.agentStatusScreen).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent reads of the same pane", async () => {
    apiMocks.agentStatusScreen.mockResolvedValue({ screenText: "x" });
    await Promise.all([loadTabPreview(screenTarget()), loadTabPreview(screenTarget())]);
    expect(apiMocks.agentStatusScreen).toHaveBeenCalledTimes(1);
  });
});
