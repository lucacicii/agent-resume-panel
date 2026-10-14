import { describe, expect, it } from "vitest";
import {
  activeAnchorIndex,
  buildTimelineItems,
  computeRailDots,
  DEFAULT_DOT_SIZE,
  DEFAULT_MIN_GAP,
  dotIndexForEntry,
  excerpt,
  scrollTopForAnchor,
  viewportWindow
} from "./timelineModel";
import type { TimelineEntry, TimelineSourceMessage } from "./timelineModel";

function entry(index: number, isLive = false): TimelineEntry {
  return { index, role: "assistant", excerpt: `m${index}`, isLive };
}

describe("excerpt", () => {
  it("returns an empty string for missing content", () => {
    expect(excerpt(undefined)).toBe("");
    expect(excerpt(null)).toBe("");
    expect(excerpt("   \n  ")).toBe("");
  });

  it("drops fenced code blocks and keeps the prose around them", () => {
    expect(excerpt("Before\n```ts\nconst a = 1;\n```\nAfter")).toBe("Before After");
  });

  it("strips inline code, link syntax and list markers", () => {
    expect(excerpt("## Title")).toBe("Title");
    expect(excerpt("- one\n- two")).toBe("one two");
    expect(excerpt("> quoted line")).toBe("quoted line");
    expect(excerpt("use `npm run test` now")).toBe("use npm run test now");
    expect(excerpt("see [the docs](https://example.com/x) for more")).toBe("see the docs for more");
    expect(excerpt("![shot](x.png) caption")).toBe("caption");
  });

  it("collapses whitespace and truncates on the character budget", () => {
    expect(excerpt("a\n\n  b\tc")).toBe("a b c");
    const long = "x".repeat(400);
    const cut = excerpt(long, 20);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(21);
  });

  it("leaves text shorter than the budget untouched", () => {
    expect(excerpt("short", 180)).toBe("short");
  });
});

describe("buildTimelineItems", () => {
  const messages: TimelineSourceMessage[] = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there", stats: { turn: 1, duration_ms: 1234 } },
    { role: "tool", content: "tool output" }
  ];

  it("makes one entry per rendered message and skips tool/system rows", () => {
    const items = buildTimelineItems(messages);
    expect(items.map((item) => item.index)).toEqual([0, 1]);
    expect(items[0]).toMatchObject({ role: "user", excerpt: "hello", isLive: false });
    expect(items[1]).toMatchObject({ turn: 1, durationMs: 1234 });
  });

  it("appends the in-flight turn as a live entry at the next index", () => {
    const items = buildTimelineItems(messages, { content: "streaming", streaming: true });
    expect(items).toHaveLength(3);
    expect(items[2]).toMatchObject({ index: 3, isLive: true, excerpt: "streaming" });
  });

  it("adds no live entry once the run settles", () => {
    expect(buildTimelineItems(messages, { content: "streaming", streaming: false })).toHaveLength(2);
    expect(buildTimelineItems(messages, null)).toHaveLength(2);
  });
});

describe("computeRailDots", () => {
  it("projects anchors proportionally into the rail", () => {
    // Four anchors spread evenly over 1000px of scrollable content, on a 100px
    // rail whose dots are 6px tall (usable travel = 94).
    const entries = [entry(0), entry(1), entry(2), entry(3)];
    const anchorTops = [0, 333.33, 666.67, 1000];
    const dots = computeRailDots({ entries, anchorTops, scrollable: 1000, railHeight: 100 });
    expect(dots).toHaveLength(4);
    expect(dots.map((dot) => Math.round(dot.y))).toEqual([0, 31, 63, 94]);
    expect(dots.every((dot) => dot.count === 1)).toBe(true);
  });

  it("collapses anchors closer than the minimum gap and counts them", () => {
    const entries = [entry(0), entry(1), entry(2), entry(3)];
    // All four within 1000px of a 4000px scrollable span → all land on top of each other.
    const anchorTops = [0, 10, 20, 30];
    const dots = computeRailDots({ entries, anchorTops, scrollable: 4000, railHeight: 400 });
    expect(dots).toHaveLength(1);
    expect(dots[0]).toMatchObject({ index: 0, firstEntryIndex: 0, count: 4 });
  });

  it("merges into the earlier dot and keeps the click target at the first member", () => {
    const entries = [entry(0), entry(1), entry(2)];
    const dots = computeRailDots({
      entries,
      // 0 and 5px are inside the gap; 200 is far away.
      anchorTops: [0, 5, 900],
      scrollable: 1000,
      railHeight: 300,
      dotSize: DEFAULT_DOT_SIZE,
      minGap: DEFAULT_MIN_GAP
    });
    expect(dots).toHaveLength(2);
    expect(dots[0]).toMatchObject({ index: 0, firstEntryIndex: 0, count: 2 });
    expect(dots[1]).toMatchObject({ index: 2, count: 1 });
  });

  it("sits a merged dot in the middle of what it stands for", () => {
    const entries = [entry(0), entry(1)];
    // usable travel = 594px. 0 → y 0; 15/1000 of it → y 8.91 (inside the 11px gap,
    // so they merge). The centre of the two is 4.455, not 0.
    const dots = computeRailDots({ entries, anchorTops: [0, 15], scrollable: 1000, railHeight: 600 });
    expect(dots).toHaveLength(1);
    expect(dots[0].y).toBeCloseTo(4.455, 4);
  });

  it("never lets a dot escape the rail, whatever the measurement says", () => {
    const entries = [entry(0), entry(1), entry(2)];
    const dots = computeRailDots({
      entries,
      // Overshooting top (stale measurement) and a negative one.
      anchorTops: [-500, 500, 99999],
      scrollable: 1000,
      railHeight: 200
    });
    for (const dot of dots) {
      expect(dot.y).toBeGreaterThanOrEqual(0);
      expect(dot.y).toBeLessThanOrEqual(200 - DEFAULT_DOT_SIZE);
    }
  });

  it("stacks dots at the top when there is nothing to scroll", () => {
    const entries = [entry(0), entry(1), entry(2)];
    const dots = computeRailDots({
      entries,
      anchorTops: [0, 100, 200],
      scrollable: 0,
      railHeight: 200
    });
    expect(dots).toHaveLength(1);
    expect(dots[0]).toMatchObject({ count: 3, y: 0 });
  });

  it("carries the live flag through a merge", () => {
    const entries = [entry(0), entry(1, true)];
    const dots = computeRailDots({ entries, anchorTops: [0, 2], scrollable: 1000, railHeight: 300 });
    expect(dots).toHaveLength(1);
    expect(dots[0].isLive).toBe(true);
  });

  it("treats a missing measurement as the top instead of dropping the anchor", () => {
    const entries = [entry(0), entry(1)];
    const dots = computeRailDots({ entries, anchorTops: [], scrollable: 1000, railHeight: 300 });
    expect(dots).toHaveLength(1);
    expect(dots[0].count).toBe(2);
  });

  it("returns nothing for no entries", () => {
    expect(computeRailDots({ entries: [], anchorTops: [], scrollable: 100, railHeight: 100 })).toEqual([]);
  });
});

describe("activeAnchorIndex", () => {
  it("picks the last anchor above the probe", () => {
    const tops = [0, 400, 800, 1200];
    // Probe = 500 + 500 * 0.3 = 650 → the 400 anchor has passed, the 800 one has not.
    expect(activeAnchorIndex(tops, 500, 500)).toBe(1);
  });

  it("counts an anchor sitting exactly on the probe as active", () => {
    // Probe = 500 + 300 = 800, which is the second anchor's own top.
    expect(activeAnchorIndex([0, 800], 500, 1000)).toBe(1);
  });

  it("returns the first anchor when scrolled to the very top", () => {
    expect(activeAnchorIndex([50, 400, 800], 0, 1000)).toBe(0);
  });

  it("returns the last anchor at the bottom", () => {
    expect(activeAnchorIndex([0, 400, 800], 2000, 1000)).toBe(2);
  });

  it("reports -1 when there is nothing to point at", () => {
    expect(activeAnchorIndex([], 0, 1000)).toBe(-1);
  });
});

describe("dotIndexForEntry", () => {
  const dots = [entry(0), entry(3), entry(7)].map((item, i) => ({
    index: item.index,
    firstEntryIndex: item.index,
    count: 1,
    y: i * 20,
    isLive: false
  }));

  it("maps an entry to the dot that stands for it", () => {
    expect(dotIndexForEntry(dots, 0)).toBe(0);
    expect(dotIndexForEntry(dots, 5)).toBe(1);
    expect(dotIndexForEntry(dots, 7)).toBe(2);
    expect(dotIndexForEntry(dots, 99)).toBe(2);
  });

  it("reports -1 for an empty rail or an unknown entry", () => {
    expect(dotIndexForEntry([], 3)).toBe(-1);
    expect(dotIndexForEntry(dots, -1)).toBe(-1);
  });
});

describe("scrollTopForAnchor", () => {
  it("puts the anchor just under the top of the feed", () => {
    // Feed top at 120 and row top at 900, with 300 already scrolled, means the row
    // sits 1080px into the scroll content. Landing 12px below the feed's top is
    // therefore scrollTop 1068 — not 480 (the on-screen offset), which is the
    // mistake this formula exists to avoid.
    expect(scrollTopForAnchor(120, 900, 300)).toBe(1068);
  });

  it("never scrolls above the start", () => {
    expect(scrollTopForAnchor(120, 100, 0)).toBe(0);
  });

  it("honours a custom padding", () => {
    expect(scrollTopForAnchor(0, 500, 0, 40)).toBe(460);
  });
});

describe("viewportWindow", () => {
  it("sizes the indicator by the visible fraction of the content", () => {
    const window = viewportWindow({ scrollTop: 0, scrollHeight: 2000, clientHeight: 500, railHeight: 200 });
    expect(window).toEqual({ top: 0, height: 50 });
  });

  it("slides the indicator across the remaining travel", () => {
    // 500 of the 1500px it can travel → one third of the 150px rail travel.
    const window = viewportWindow({ scrollTop: 500, scrollHeight: 2000, clientHeight: 500, railHeight: 200 });
    expect(window.height).toBe(50);
    expect(window.top).toBe(50);
  });

  it("fills the rail when the content fits", () => {
    expect(viewportWindow({ scrollTop: 0, scrollHeight: 400, clientHeight: 400, railHeight: 200 })).toEqual({
      top: 0,
      height: 200
    });
  });

  it("degrades to nothing without a measured box", () => {
    expect(viewportWindow({ scrollTop: 0, scrollHeight: 0, clientHeight: 0, railHeight: 0 })).toEqual({
      top: 0,
      height: 0
    });
  });

  it("clamps an out-of-range scrollTop", () => {
    const window = viewportWindow({ scrollTop: 99999, scrollHeight: 2000, clientHeight: 500, railHeight: 200 });
    expect(window.top).toBe(150);
  });
});
