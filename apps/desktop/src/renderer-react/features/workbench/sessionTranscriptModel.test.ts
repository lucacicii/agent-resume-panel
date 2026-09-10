import { describe, expect, it } from "vitest";
import {
  buildSessionTranscriptModel,
  filterSessionTranscript,
  mergePendingTranscript,
  sameTranscriptPreview,
  transcriptStreamCaret,
  TRANSCRIPT_PENDING_ASSISTANT_ID,
  TRANSCRIPT_PENDING_USER_ID,
  transcriptOutlineTitle
} from "./sessionTranscriptModel";

describe("transcriptOutlineTitle", () => {
  it("uses the first non-empty line and truncates long titles", () => {
    expect(transcriptOutlineTitle("  \nFix the flaky renderer test\nmore")).toBe("Fix the flaky renderer test");
    expect(transcriptOutlineTitle("x".repeat(60))).toBe(`${"x".repeat(47)}…`);
  });
});

describe("buildSessionTranscriptModel", () => {
  it("keeps user and assistant turns and builds a user-only outline", () => {
    const model = buildSessionTranscriptModel([
      { role: "system", text: "ignore" },
      { role: "user", text: "  Add a transcript pane  " },
      { role: "assistant", text: "Dock it beside the TUI." },
      { role: "user", text: "" },
      { role: "user", text: "Keep the terminal visible." }
    ]);

    expect(model.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(model.outline).toEqual([
      { id: "transcript-turn-1", messageId: "transcript-msg-1", index: 1, title: "Add a transcript pane" },
      { id: "transcript-turn-2", messageId: "transcript-msg-4", index: 2, title: "Keep the terminal visible." }
    ]);
  });

  it("reuses unchanged messages so live polls do not re-render every row", () => {
    const messages = [
      { role: "user", text: "Add a transcript pane" },
      { role: "assistant", text: "Dock it beside the TUI." },
      { role: "assistant", text: "Growing" }
    ];
    const first = buildSessionTranscriptModel(messages);
    const streaming = buildSessionTranscriptModel([
      messages[0]!,
      messages[1]!,
      { role: "assistant", text: "Growing answer" }
    ], first);

    expect(streaming.messages[0]).toBe(first.messages[0]);
    expect(streaming.messages[1]).toBe(first.messages[1]);
    expect(streaming.messages[2]).not.toBe(first.messages[2]);
    expect(streaming.outline[0]).toBe(first.outline[0]);

    // Same payload keeps identity, a replaced payload rebuilds.
    const unchanged = buildSessionTranscriptModel(messages, first);
    expect(unchanged.messages[0]).toBe(first.messages[0]);
    expect(unchanged.messages[2]).toBe(first.messages[2]);
    const rebuilt = buildSessionTranscriptModel([{ role: "user", text: "New session prompt" }], first);
    expect(rebuilt.messages[0]).not.toBe(first.messages[0]);
  });
});

describe("sameTranscriptPreview", () => {
  const preview = {
    title: "Fix renderer",
    truncated: false,
    warning: "",
    messages: [
      { role: "user", text: "Add a transcript pane", timestamp: "1" },
      { role: "assistant", text: "Dock it beside the TUI.", thinking: "Keep selection stable." }
    ]
  };

  it("treats equivalent preview payloads as unchanged",
    () => {
      expect(sameTranscriptPreview(preview, {
        ...preview,
        messages: preview.messages.map((message) => ({ ...message }))
      })).toBe(true);
    });

  it("detects visible text, thinking, and metadata changes",
    () => {
      expect(sameTranscriptPreview(preview, { ...preview, title: "Renamed" })).toBe(false);
      expect(sameTranscriptPreview(preview, {
        ...preview,
        messages: [{ ...preview.messages[0]! }, { ...preview.messages[1]!, thinking: "Changed." }]
      })).toBe(false);
    });
});

describe("filterSessionTranscript", () => {
  const model = buildSessionTranscriptModel([
    { role: "user", text: "Add a minimap" },
    { role: "assistant", text: "A content minimap will not work." },
    { role: "user", text: "Show the original transcript instead." },
    { role: "assistant", text: "Dock a reader beside the TUI." }
  ]);

  it("returns the original model for a blank query", () => {
    expect(filterSessionTranscript(model, "   ")).toEqual(model);
  });

  it("keeps matching messages and the outline entries that still have a user hit", () => {
    const filtered = filterSessionTranscript(model, "tui");
    expect(filtered.messages.map((message) => message.text)).toEqual(["Dock a reader beside the TUI."]);
    expect(filtered.outline).toEqual([]);
  });

  it("keeps thinking on assistant messages and can match search against it", () => {
    const model = buildSessionTranscriptModel([
      { role: "assistant", text: "The folder is empty because git drops it.", thinking: "Inspect status parsing." }
    ]);
    expect(model.messages[0]?.thinking).toBe("Inspect status parsing.");
    expect(filterSessionTranscript(model, "status parsing").messages).toHaveLength(1);
  });

  it("keeps a user outline item when the query matches that prompt", () => {
    const filtered = filterSessionTranscript(model, "original");
    expect(filtered.outline.map((item) => item.title)).toEqual(["Show the original transcript instead."]);
    expect(filtered.messages).toHaveLength(1);
  });
});

describe("transcriptStreamCaret", () => {
  const withReply = buildSessionTranscriptModel([
    { role: "user", text: "Why is the folder missing?" },
    { role: "assistant", text: "Because git drops empty folders." }
  ]);

  it("shows nothing while the session is idle", () => {
    expect(transcriptStreamCaret(withReply.messages, false)).toBe("none");
  });

  it("rides at the end of the streaming message when it has text", () => {
    expect(transcriptStreamCaret(withReply.messages, true)).toBe("inline");
  });

  it("falls back to the tail when the running turn has no answer text yet", () => {
    const reasoningOnly = buildSessionTranscriptModel([
      { role: "user", text: "Why is the folder missing?" },
      { role: "assistant", text: "", thinking: "Checking status parsing." }
    ]);
    expect(transcriptStreamCaret(reasoningOnly.messages, true)).toBe("tail");

    // The transcript can also lag behind the agent: the user prompt is on
    // screen while the answer is still being written.
    const lagging = buildSessionTranscriptModel([{ role: "user", text: "Why is the folder missing?" }]);
    expect(transcriptStreamCaret(lagging.messages, true)).toBe("tail");
  });

  it("leaves the optimistic rows to their own activity signal", () => {
    const merged = mergePendingTranscript(withReply, {
      pendingUser: { text: "Keep the terminal visible.", sentAtMs: Date.now() },
      isRunning: true,
      pendingTitle: "Working…"
    });
    expect(merged.messages.at(-1)?.id).toBe(TRANSCRIPT_PENDING_ASSISTANT_ID);
    expect(transcriptStreamCaret(merged.messages, true)).toBe("none");
  });

  it("shows nothing at all when there is no transcript", () => {
    expect(transcriptStreamCaret([], true)).toBe("none");
  });
});

describe("mergePendingTranscript", () => {
  const base = buildSessionTranscriptModel([
    { role: "user", text: "Add a transcript pane" },
    { role: "assistant", text: "Dock it beside the TUI." }
  ]);

  it("appends an optimistic user turn and a waiting assistant bubble", () => {
    const merged = mergePendingTranscript(base, {
      pendingUser: { text: "Keep the terminal visible.", sentAtMs: Date.now() },
      isRunning: true,
      pendingTitle: "Working…"
    });
    expect(merged.messages.map((message) => message.id)).toEqual([
      "transcript-msg-0",
      "transcript-msg-1",
      TRANSCRIPT_PENDING_USER_ID,
      TRANSCRIPT_PENDING_ASSISTANT_ID
    ]);
    expect(merged.outline.map((item) => item.title)).toEqual([
      "Add a transcript pane",
      "Keep the terminal visible.",
      "Working…"
    ]);
    expect(merged.outline.at(-1)?.pending).toBe(true);
  });

  it("does not duplicate a user prompt already on disk", () => {
    const merged = mergePendingTranscript(base, {
      pendingUser: { text: "Add a transcript pane", sentAtMs: Date.now() },
      isRunning: true,
      pendingTitle: "Working…"
    });
    expect(merged.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(merged.messages.some((message) => message.id === TRANSCRIPT_PENDING_USER_ID)).toBe(false);
  });

  it("drops the waiting assistant once real assistant content arrives", () => {
    const withReply = buildSessionTranscriptModel([
      { role: "user", text: "Keep the terminal visible." },
      { role: "assistant", text: "Still docking." }
    ]);
    const merged = mergePendingTranscript(withReply, {
      pendingUser: { text: "Keep the terminal visible.", sentAtMs: Date.now() },
      isRunning: true,
      pendingTitle: "Working…"
    });
    expect(merged.messages.map((message) => message.id)).toEqual([
      "transcript-msg-0",
      "transcript-msg-1"
    ]);
  });

  it("reuses overlay rows across repeated merges", () => {
    const options = {
      pendingUser: { text: "Keep the terminal visible.", sentAtMs: Date.now() },
      isRunning: true,
      pendingTitle: "Working…"
    };
    const first = mergePendingTranscript(base, options);
    const second = mergePendingTranscript(base, options, first);

    // Live polls re-run the merge; the overlay rows must keep their identity
    // so the memoized rows (and their markdown) never re-render.
    expect(second.messages.at(-2)).toBe(first.messages.at(-2));
    expect(second.messages.at(-1)).toBe(first.messages.at(-1));
    expect(second.outline.at(-2)).toBe(first.outline.at(-2));
    expect(second.outline.at(-1)).toBe(first.outline.at(-1));

    // A different prompt or a different waiting label still rebuilds them.
    const changed = mergePendingTranscript(base, {
      ...options,
      pendingUser: { text: "A different prompt.", sentAtMs: options.pendingUser.sentAtMs }
    }, first);
    expect(changed.messages.at(-2)).not.toBe(first.messages.at(-2));
  });
});
