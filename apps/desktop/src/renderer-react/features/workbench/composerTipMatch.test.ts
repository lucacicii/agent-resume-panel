import { describe, expect, it } from "vitest";
import { findTranscriptUserMessage, normalizeTipText } from "./composerTipMatch";

describe("normalizeTipText", () => {
  it("collapses whitespace and strips image markdown", () => {
    expect(normalizeTipText("  please  inspect\nsrc  ")).toBe("please inspect src");
    expect(normalizeTipText("![shot](./a.png) please inspect src")).toBe("please inspect src");
  });
});

describe("findTranscriptUserMessage", () => {
  it("prefers the later exact match when the same text appears twice", () => {
    expect(findTranscriptUserMessage([
      { id: "transcript-msg-1", text: "please inspect src" },
      { id: "transcript-msg-2", text: "please inspect src" }
    ], "please inspect src")?.id).toBe("transcript-msg-2");
  });

  it("matches a composer suffix pasted after TUI image text", () => {
    expect(findTranscriptUserMessage([
      { id: "transcript-msg-1", text: "./shot.png please look at the login form" }
    ], "please look at the login form")?.id).toBe("transcript-msg-1");
  });

  it("returns null when nothing is similar enough", () => {
    expect(findTranscriptUserMessage([
      { id: "transcript-msg-0", text: "unrelated" }
    ], "totally different prompt")).toBeNull();
  });
});
