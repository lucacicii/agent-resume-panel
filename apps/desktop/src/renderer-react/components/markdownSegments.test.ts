import { describe, expect, it } from "vitest";
import { parseMarkdownIntoBlocks } from "streamdown";
import {
  buildMarkdownSegments,
  prepareMarkdownFragment,
  type MarkdownSegmentState
} from "./markdownSegments";

const DOC = [
  "# Streaming answer",
  "",
  "Intro paragraph with **bold**, `inline code` and a [link](https://example.com).",
  "",
  "```ts",
  "const a = 1;",
  "",
  "const b = 2;",
  "```",
  "",
  "- first bullet",
  "",
  "- second bullet",
  "",
  "> quoted line",
  "",
  "| name | value |",
  "| --- | --- |",
  "| one | 1 |",
  "",
  "Use **N1** and noteId: `3f1b9c9e-1111-2222-3333-444455556666` for links.",
  "",
  "Trailing paragraph that keeps growing token by token",
  ""
].join("\n");

function join(parts: readonly string[]): string {
  return parts.join("");
}

function grow(state: MarkdownSegmentState | null, content: string, minChars: number): MarkdownSegmentState {
  return buildMarkdownSegments(state, content, undefined, minChars);
}

describe("markdownSegments", () => {
  it("segments the document without losing characters", () => {
    expect(join(parseMarkdownIntoBlocks(DOC))).toBe(DOC);

    const state = grow(null, DOC, 120);
    expect(state.segments.length).toBeGreaterThan(1);
    expect(join(state.segments.map((segment) => segment.raw))).toBe(DOC);
  });

  it("sanitizes per segment exactly like the whole document", () => {
    for (const minChars of [20, 60, 200]) {
      const state = grow(null, DOC, minChars);
      expect(state.segments.length).toBeGreaterThan(1);
      expect(join(state.segments.map((segment) => segment.prepared))).toBe(prepareMarkdownFragment(DOC));
    }
  });

  it("reuses closed segments while the tail keeps growing", () => {
    let state = grow(null, DOC, 120);
    const closedBefore = state.segments.slice(0, -1);
    expect(closedBefore.length).toBeGreaterThan(0);

    for (const suffix of [" more", " tokens", " arrive", " here"]) {
      const next = grow(state, `${state.source}${suffix}`, 120);
      expect(next.source.endsWith(suffix)).toBe(true);
      // Same objects, so the memoized markdown render for those segments bails out.
      for (const [index, segment] of closedBefore.entries()) {
        expect(next.segments[index]).toBe(segment);
      }
      expect(join(next.segments.map((segment) => segment.raw))).toBe(next.source);
      expect(join(next.segments.map((segment) => segment.prepared))).toBe(prepareMarkdownFragment(next.source));
      state = next;
    }
  });

  it("never re-prepares a sealed segment", () => {
    let state = grow(null, DOC, 120);
    const seen = new Set(state.segments.map((segment) => segment.prepared));
    const sealedPrepared = new Set<string>();

    // Grow one character at a time. Only the open segment may be re-prepared:
    // a segment that just closed must reuse the text prepared while it was open,
    // and a closed segment must never be prepared again afterwards.
    for (let index = 0; index < 300; index += 1) {
      const next = grow(state, `${state.source}x`, 120);
      for (const segment of next.segments.slice(0, -1)) {
        expect(seen.has(segment.prepared)).toBe(true);
        sealedPrepared.add(segment.prepared);
      }
      for (const segment of next.segments) seen.add(segment.prepared);
      expect(join(next.segments.map((segment) => segment.prepared))).toBe(prepareMarkdownFragment(next.source));
      state = next;
    }
    expect(sealedPrepared.size).toBeLessThanOrEqual(state.segments.length);
  });

  it("matches a fresh build at every growth step", () => {
    let incremental: MarkdownSegmentState | null = null;
    for (let length = 1; length <= DOC.length; length += 7) {
      const content = DOC.slice(0, length);
      incremental = grow(incremental, content, 120);
      const fresh = buildMarkdownSegments(null, content, undefined, 120);
      expect(incremental.segments).toEqual(fresh.segments);
    }
  });

  it("rebuilds when content is replaced, never when it is identical", () => {
    const state = grow(null, DOC, 120);
    expect(buildMarkdownSegments(state, DOC, undefined, 120)).toBe(state);

    const replaced = grow(state, "Completely different body", 120);
    expect(join(replaced.segments.map((segment) => segment.prepared))).toBe(
      prepareMarkdownFragment("Completely different body")
    );
  });

  it("marks only the segments that received text as animating", () => {
    const staticBuild = grow(null, DOC, 120);
    expect(staticBuild.segments.every((segment) => segment.animate === false)).toBe(true);

    // First streaming build: everything on screen arrived just now.
    let state = buildMarkdownSegments(null, DOC, undefined, 120, true);
    expect(state.segments.every((segment) => segment.animate === true)).toBe(true);

    // A growing tail animates, sealed segments are reused as-is, and a parent
    // re-render that changed nothing keeps the flags untouched.
    const closed = state.segments.slice(0, -1);
    state = buildMarkdownSegments(state, `${DOC}more tokens`, undefined, 120, true);
    expect(state.segments.slice(0, closed.length)).toEqual(closed);
    expect(state.segments.at(-1)?.animate).toBe(true);
    expect(buildMarkdownSegments(state, state.source, undefined, 120, true)).toBe(state);

    // Streaming stopped and the text did not move: nothing new to fade in.
    const quiet = buildMarkdownSegments(state, `${state.source} and one more`, undefined, 120, false);
    expect(quiet.segments.at(-1)?.animate).toBe(false);
  });

  it("rebuilds when image options change", () => {
    const state = buildMarkdownSegments(null, "![x](./a.png)", { baseDir: "/work/a" });
    expect(state.segments[0].prepared).toContain("agent-resume.local");
    const next = buildMarkdownSegments(state, "![x](./a.png)", { baseDir: "/work/b" });
    expect(next).not.toBe(state);
    expect(next.segments[0].prepared).not.toBe(state.segments[0].prepared);
  });

  it("handles empty and whitespace-only content", () => {
    const empty = buildMarkdownSegments(null, "", undefined);
    expect(empty.segments).toEqual([]);

    const spaced = buildMarkdownSegments(empty, "   ", undefined);
    expect(join(spaced.segments.map((segment) => segment.raw))).toBe("   ");
  });
});
