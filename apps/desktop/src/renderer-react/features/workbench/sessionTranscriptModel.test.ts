import { describe, expect, it } from "vitest";
import {
  buildSessionTranscriptModel,
  filterSessionTranscript,
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
