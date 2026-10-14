import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ChatTimeline } from "./ChatTimeline";
import type { TimelineEntry } from "./timelineModel";

/**
 * The rail reads real geometry, which jsdom does not model: every rect is zero
 * and nothing scrolls. These tests therefore install the measurements the
 * component would see in the browser (a fixed feed box, a per-row offset, a
 * scrollable feed and a 400px rail) and assert on what the rail does with them.
 *
 * The stub is installed on the prototype and dispatches on the element's own
 * class / dataset, because the rail element only exists once the component has
 * rendered — too late to mock the instance.
 */
const layout = {
  feedTop: 100,
  clientHeight: 500,
  scrollHeight: 4000,
  scrollTop: 0,
  railHeight: 400,
  /** Row offset within the scroll content, keyed by `data-timeline-index`. */
  rowTops: new Map<number, number>(),
  rowSpacing: 400,
  /** Take the real, unstubbed measurement. */
  passthrough: false
};

function rect(top: number, height: number, width = 12): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: width,
    width,
    height,
    x: 0,
    y: top,
    toJSON: () => ({})
  } as DOMRect;
}

let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;

function installLayoutStub(): void {
  originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function stubbedRect(this: HTMLElement): DOMRect {
    if (layout.passthrough) return originalRect.call(this);
    if (this.classList.contains("tb-chat-feed")) {
      return rect(layout.feedTop, layout.clientHeight, 800);
    }
    if (this.classList.contains("tb-timeline-rail")) {
      return rect(layout.feedTop, layout.railHeight);
    }
    const index = this.dataset?.timelineIndex;
    if (index !== undefined) {
      const offset = layout.rowTops.get(Number(index)) ?? Number(index) * layout.rowSpacing;
      return rect(layout.feedTop + offset - layout.scrollTop, 80, 800);
    }
    return rect(0, 0, 0);
  };
}

/** A feed with `rows` rows, wired to the same stub the rail reads. */
function mountFeed(rows: number): HTMLElement {
  const feed = document.createElement("div");
  feed.className = "tb-chat-feed";
  Object.defineProperty(feed, "scrollHeight", { configurable: true, get: () => layout.scrollHeight });
  Object.defineProperty(feed, "clientHeight", { configurable: true, get: () => layout.clientHeight });
  Object.defineProperty(feed, "scrollTop", {
    configurable: true,
    get: () => layout.scrollTop,
    set: (value: number) => {
      layout.scrollTop = value;
    }
  });
  feed.scrollTo = vi.fn((options: ScrollToOptions | number) => {
    if (typeof options === "object" && typeof options.top === "number") layout.scrollTop = options.top;
  }) as unknown as typeof feed.scrollTo;

  const content = document.createElement("div");
  for (let i = 0; i < rows; i++) {
    const row = document.createElement("div");
    row.className = "tb-message-row";
    row.dataset.timelineIndex = String(i);
    content.appendChild(row);
  }
  feed.appendChild(content);
  document.body.appendChild(feed);
  return feed;
}

function entries(count: number, live = false): TimelineEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    role: i % 2 === 0 ? "user" : "assistant",
    excerpt: `message ${i}`,
    turn: i % 2 === 1 ? Math.ceil(i / 2) : undefined,
    durationMs: i % 2 === 1 ? 2500 : undefined,
    isLive: live && i === count - 1
  }));
}

function renderRail(feed: HTMLElement, list: TimelineEntry[], onJump = vi.fn()) {
  const rendered = render(
    <I18nProvider>
      <ChatTimeline feedRef={{ current: feed }} entries={list} onJump={onJump} />
    </I18nProvider>
  );
  return { ...rendered, onJump };
}

function railDots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".tb-timeline-dot"));
}

function rail(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".tb-chat-timeline");
}

/** The strip that resolves pointer input (not the outer nav). */
function railStrip(): HTMLElement {
  return document.querySelector<HTMLElement>(".tb-timeline-rail") as HTMLElement;
}

/** Centre of a dot, in client coordinates, as the component would see it. */
function dotCentreY(dot: HTMLElement): number {
  // Dots are centred on their measured y (the component adds half of dotSize).
  return layout.feedTop + Number.parseFloat(dot.style.top);
}

/** Hover the dot the rail would resolve at that position. */
function hoverDot(dot: HTMLElement): void {
  fireEvent.mouseMove(railStrip(), { clientY: dotCentreY(dot) });
}

function clickDotAt(dot: HTMLElement): void {
  fireEvent.click(railStrip(), { clientY: dotCentreY(dot) });
}

describe("ChatTimeline", () => {
  beforeEach(() => {
    layout.feedTop = 100;
    layout.clientHeight = 500;
    layout.scrollHeight = 4000;
    layout.scrollTop = 0;
    layout.railHeight = 400;
    layout.rowSpacing = 400;
    layout.rowTops = new Map();
    layout.passthrough = false;
    installLayoutStub();

    window.agentResume = {
      getI18nBundle: vi.fn().mockResolvedValue({
        locale: "en",
        messages: {
          "desktop.chat.timeline.label": "Conversation timeline",
          "desktop.chat.timeline.roleUser": "You",
          "desktop.chat.timeline.roleAgent": "Agent",
          "desktop.chat.timeline.turn": "Turn {0}",
          "desktop.chat.timeline.duration": "{0}s",
          "desktop.chat.timeline.live": "Streaming",
          "desktop.chat.timeline.grouped": "{0} messages",
          "desktop.chat.timeline.jumpTo": "Jump to message {0}"
        }
      }),
      onI18nBundleChanged: vi.fn().mockReturnValue(() => undefined),
      onLocaleChanged: vi.fn().mockReturnValue(() => undefined),
      contextMenuShow: vi.fn().mockResolvedValue(null)
    } as any;
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });

  it("renders one dot per message when the rows are far apart", async () => {
    const feed = mountFeed(5);
    renderRail(feed, entries(5));

    await waitFor(() => expect(railDots()).toHaveLength(5));
  });

  it("positions dots from the rows' measured offsets, not from their order", async () => {
    // Row 1 sits 3000px into the content of a 3500px scrollable feed, so it must
    // land near the bottom of the rail rather than next to the others.
    layout.rowTops = new Map([
      [0, 0],
      [1, 3000],
      [2, 3400]
    ]);
    const feed = mountFeed(3);
    renderRail(feed, entries(3));

    await waitFor(() => expect(railDots()).toHaveLength(3));
    const tops = railDots().map((dot) => Number.parseFloat(dot.style.top));
    expect(tops[0]).toBeLessThan(tops[1]);
    expect(tops[1]).toBeGreaterThan(300);
  });

  it("merges anchors that would overlap into a single counted dot", async () => {
    // 4 messages 20px apart inside 3500px of scrollable content all land within
    // the 12px minimum gap on a 400px rail.
    layout.rowTops = new Map([
      [0, 0],
      [1, 20],
      [2, 40],
      [3, 60]
    ]);
    const feed = mountFeed(4);
    renderRail(feed, entries(4));

    await waitFor(() => expect(railDots().length).toBeGreaterThan(0));
    const dots = railDots();
    expect(dots).toHaveLength(1);
    expect(dots[0].className).toContain("is-grouped");
  });

  it("reports the merge count and the first member in the preview", async () => {
    layout.rowTops = new Map([
      [0, 0],
      [1, 20],
      [2, 40],
      [3, 60]
    ]);
    const feed = mountFeed(4);
    const { onJump } = renderRail(feed, entries(4));

    await waitFor(() => expect(railDots()).toHaveLength(1));
    hoverDot(railDots()[0]);
    await waitFor(() =>
      expect(document.querySelector("[data-testid='chat-timeline-preview']")?.textContent).toContain("4 messages")
    );

    clickDotAt(railDots()[0]);
    expect(onJump).toHaveBeenCalledWith(0);
  });

  it("shows role, ordinal, turn and duration in the hover preview", async () => {
    const feed = mountFeed(3);
    renderRail(feed, entries(3));

    await waitFor(() => expect(railDots()).toHaveLength(3));
    expect(document.querySelector("[data-testid='chat-timeline-preview']")).toBeNull();

    hoverDot(railDots()[1]);
    const preview = await waitFor(() => {
      const node = document.querySelector("[data-testid='chat-timeline-preview']");
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    expect(preview.textContent).toContain("Agent");
    expect(preview.textContent).toContain("#2");
    expect(preview.textContent).toContain("Turn 1");
    expect(preview.textContent).toContain("2.5s");
    expect(preview.textContent).toContain("message 1");

    fireEvent.mouseLeave(railStrip());
    await waitFor(() => expect(document.querySelector("[data-testid='chat-timeline-preview']")).toBeNull());
  });

  it("marks the streaming turn as live and shows it in the preview", async () => {
    const feed = mountFeed(3);
    renderRail(feed, entries(3, true));

    await waitFor(() => expect(railDots()).toHaveLength(3));
    expect(railDots()[2].className).toContain("is-live");

    hoverDot(railDots()[2]);
    await waitFor(() =>
      expect(document.querySelector("[data-testid='chat-timeline-preview']")?.textContent).toContain("Streaming")
    );
  });

  it("reports the jump target the dot stands for", async () => {
    const feed = mountFeed(4);
    const { onJump } = renderRail(feed, entries(4));

    await waitFor(() => expect(railDots()).toHaveLength(4));
    clickDotAt(railDots()[2]);
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it("highlights the message the reader is looking at", async () => {
    layout.scrollTop = 850;
    const feed = mountFeed(6);
    renderRail(feed, entries(6));

    await waitFor(() => expect(railDots()).toHaveLength(6));
    // Probe = 850 + 500 * 0.3 = 1000 → the row at 800 is the last one passed.
    const activeIndex = railDots().findIndex((dot) => dot.className.includes("is-active"));
    expect(activeIndex).toBe(2);
    expect(railDots()[2].tabIndex).toBe(0);
    expect(railDots().filter((dot) => dot.tabIndex === 0)).toHaveLength(1);
  });

  it("moves focus with the arrow keys, Home and End", async () => {
    const feed = mountFeed(4);
    renderRail(feed, entries(4));

    await waitFor(() => expect(railDots()).toHaveLength(4));
    const dots = railDots();
    expect(dots.map((dot) => dot.tabIndex)).toEqual([0, -1, -1, -1]);

    dots[0].focus();
    fireEvent.keyDown(dots[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(dots[1]);
    fireEvent.keyDown(dots[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(dots[0]);
    fireEvent.keyDown(dots[0], { key: "End" });
    expect(document.activeElement).toBe(dots[3]);
    // Wrapping past the end returns to the start.
    fireEvent.keyDown(dots[3], { key: "ArrowDown" });
    expect(document.activeElement).toBe(dots[0]);
    fireEvent.keyDown(dots[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(dots[3]);
  });

  it("renders an inert shell rather than dots for a single message", async () => {
    const feed = mountFeed(1);
    renderRail(feed, entries(1));

    await waitFor(() => expect(rail()).toBeTruthy());
    expect(rail()?.className).toContain("is-empty");
    expect(rail()?.getAttribute("aria-hidden")).toBe("true");
    expect(railDots()).toHaveLength(0);
  });

  it("offers nothing to navigate while the conversation does not scroll", async () => {
    layout.scrollHeight = 500;
    layout.clientHeight = 500;
    const feed = mountFeed(6);
    renderRail(feed, entries(6));

    await waitFor(() => expect(rail()).toBeTruthy());
    expect(railDots()).toHaveLength(0);
    expect(document.querySelector(".tb-timeline-viewport")).toBeNull();
  });

  it("shows the visible window on the rail while the conversation scrolls", async () => {
    layout.scrollTop = 1750;
    const feed = mountFeed(6);
    renderRail(feed, entries(6));

    await waitFor(() => expect(railDots()).toHaveLength(6));
    const indicator = document.querySelector<HTMLElement>(".tb-timeline-viewport");
    expect(indicator).toBeTruthy();
    // 500 of 4000px visible → an eighth of the 400px rail; scrolled half way.
    expect(indicator?.style.height).toBe("50px");
    expect(indicator?.style.top).toBe("175px");
  });

  it("resolves the nearest dot from the pointer, not from the box it is over", async () => {
    // Rows 1200px apart inside 3500px of scrollable content land ~137px apart on
    // the rail — far enough not to merge, but with the 12px boxes overlapping
    // nothing. The rail must pick by distance so a click between two dots can
    // never be ambiguous.
    layout.rowTops = new Map([
      [0, 0],
      [1, 1200],
      [2, 2400]
    ]);
    const feed = mountFeed(3);
    const { onJump } = renderRail(feed, entries(3));

    await waitFor(() => expect(railDots()).toHaveLength(3));
    const dots = railDots();

    // A few pixels above a dot's centre still resolves to that dot...
    fireEvent.click(railStrip(), { clientY: dotCentreY(dots[1]) - 4 });
    expect(onJump).toHaveBeenLastCalledWith(1);

    // ...and the midpoint between two dots goes to the nearer one.
    const midpoint = (dotCentreY(dots[1]) + dotCentreY(dots[2])) / 2;
    fireEvent.click(railStrip(), { clientY: midpoint + 10 });
    expect(onJump).toHaveBeenLastCalledWith(2);
  });

  it("previews the resolved dot while scrubbing the rail", async () => {
    const feed = mountFeed(4);
    renderRail(feed, entries(4));

    await waitFor(() => expect(railDots()).toHaveLength(4));
    const dots = railDots();

    fireEvent.mouseMove(railStrip(), { clientY: dotCentreY(dots[0]) });
    await waitFor(() =>
      expect(document.querySelector("[data-testid='chat-timeline-preview']")?.textContent).toContain("message 0")
    );

    // Moving without leaving swaps the preview instead of clearing it.
    fireEvent.mouseMove(railStrip(), { clientY: dotCentreY(dots[3]) });
    await waitFor(() =>
      expect(document.querySelector("[data-testid='chat-timeline-preview']")?.textContent).toContain("message 3")
    );
    expect(document.querySelectorAll("[data-testid='chat-timeline-preview']")).toHaveLength(1);
  });

  it("jumps once when a focused dot is activated from the keyboard", async () => {
    const feed = mountFeed(4);
    const { onJump } = renderRail(feed, entries(4));

    await waitFor(() => expect(railDots()).toHaveLength(4));
    const dot = railDots()[2];
    dot.focus();
    // A keyboard click on a button bubbles to the rail, but the dots take no
    // pointer events — resolving it again at the rail would jump to whatever
    // `clientY: 0` lands on, and would fire a second time.
    fireEvent.click(dot);
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it("does not jump when the pointer lands off the strip entirely", async () => {
    const feed = mountFeed(4);
    const { onJump } = renderRail(feed, entries(4));

    await waitFor(() => expect(railDots()).toHaveLength(4));
    fireEvent.click(document.querySelector(".tb-chat-timeline") as HTMLElement, { clientY: 10 });
    expect(onJump).not.toHaveBeenCalled();
  });

  it("keeps the shell mounted but empty before the rail has a measured height", async () => {
    layout.railHeight = 0;
    const feed = mountFeed(6);
    renderRail(feed, entries(6));

    // A zero-height rail is the one case where the shell exists purely to be
    // measured later; it must be inert and dot-free rather than absent.
    await waitFor(() => expect(rail()).toBeTruthy());
    expect(railDots()).toHaveLength(0);
    expect(rail()?.className).toContain("is-empty");
  });
});
