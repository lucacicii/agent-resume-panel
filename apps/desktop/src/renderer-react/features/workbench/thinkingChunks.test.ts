import { describe, expect, it } from "vitest";
import { THINKING_CHUNK_MAX_CHARS, splitThinkingChunks } from "./thinkingChunks";

describe("splitThinkingChunks", () => {
  it("returns nothing for blank reasoning", () => {
    expect(splitThinkingChunks("")).toEqual([]);
    expect(splitThinkingChunks("   \n\n  \t ")).toEqual([]);
  });

  it("closes a line on newlines and CJK sentence enders", () => {
    expect(splitThinkingChunks("先看一下磁盘状态。\n然后检查 git 分支！最后收尾。")).toEqual([
      "先看一下磁盘状态。",
      "然后检查 git 分支！",
      "最后收尾。"
    ]);
  });

  it("closes a line on ASCII sentence enders only when whitespace follows", () => {
    expect(splitThinkingChunks("Check the file path. Then run git status. Done.")).toEqual([
      "Check the file path.",
      "Then run git status.",
      "Done."
    ]);
    // Version numbers and decimals must not split mid-number.
    expect(splitThinkingChunks("Upgrade to 1.2.3 today")).toEqual(["Upgrade to 1.2.3 today"]);
  });

  it("keeps short fragments together and splits commas only on long lines", () => {
    expect(splitThinkingChunks("好，继续")).toEqual(["好，继续"]);
    const long = "The transcript pane already groups blocks, so the renderer can reuse closed segments instead of re-parsing everything on each poll";
    const chunks = splitThinkingChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= THINKING_CHUNK_MAX_CHARS)).toBe(true);
  });

  it("hard-wraps reasoning without punctuation", () => {
    const chunks = splitThinkingChunks("a".repeat(200));
    expect(chunks.map((chunk) => chunk.length)).toEqual([64, 64, 64, 8]);
  });

  it("collapses whitespace and drops empty lines", () => {
    expect(splitThinkingChunks("  First   thought  \n\n\n  second   thought  ")).toEqual([
      "First thought",
      "second thought"
    ]);
  });

  it("never re-cuts earlier lines when more reasoning is appended", () => {
    const doc = [
      "Let me inspect the transcript pane.",
      "The renderer re-parses on every poll, which is expensive.",
      "先确认一下 markdown 分块逻辑，再考虑动画。",
      "Then I will wire the reel into the collapsed header.",
      "最后再补一个测试。"
    ].join("\n");

    let previous: string[] = [];
    for (let length = 1; length <= doc.length; length += 3) {
      const chunks = splitThinkingChunks(doc.slice(0, length));
      // The reel only ever gains lines, and everything that already sealed
      // keeps its exact text at the same index.
      expect(chunks.length).toBeGreaterThanOrEqual(previous.length);
      const sealed = Math.max(0, previous.length - 1);
      expect(chunks.slice(0, sealed)).toEqual(previous.slice(0, sealed));
      previous = chunks;
    }
  });
});
