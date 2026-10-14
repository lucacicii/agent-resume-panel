/**
 * Geometry and text model for the chat timeline rail.
 *
 * Everything here is pure: the component measures the DOM and hands the numbers
 * in, so dot collapsing, the active-anchor rule and the jump offset can be
 * tested without a layout engine (jsdom has none).
 *
 * Two coordinate systems meet in this file:
 *
 * - **scroll-content px** — `anchorTops`, measured as
 *   `row.getBoundingClientRect().top - feed.getBoundingClientRect().top + feed.scrollTop`,
 *   i.e. distance from the top of the scrollable content.
 * - **rail px** — `y` on the rail, `0..railHeight`, where a dot is the top-left
 *   of a `dotSize` box.
 */

/** One message the rail offers a jump target for. */
export interface TimelineEntry {
  /** Message index in the feed's array — the same value the row carries in `data-timeline-index`. */
  index: number;
  role: "user" | "assistant";
  /** One-line plain-text preview of the message body. */
  excerpt: string;
  /** Engine step that produced this message, when the daemon reported one. */
  turn?: number;
  durationMs?: number;
  /** The in-flight turn: rendered last, and pulsing rather than settled. */
  isLive: boolean;
}

/** A rendered point on the rail. */
export interface RailDot {
  /** First message index this dot stands for — the click target. */
  index: number;
  /** Position within `entries` of the first entry in this dot. */
  firstEntryIndex: number;
  /** How many consecutive anchors collapsed into this dot. 1 = ungrouped. */
  count: number;
  /** Center y on the rail, in rail px. */
  y: number;
  isLive: boolean;
}

export const DEFAULT_DOT_SIZE = 6;
/**
 * Minimum center-to-center distance before two anchors merge into one dot.
 *
 * The hit box is exactly this tall (see `.tb-timeline-dot` in styles.css), so at
 * the tightest two boxes are adjacent rather than overlapping — otherwise hover
 * would land on an arbitrary one of them. The 6px mark inside leaves a wider
 * visual gap than the boxes suggest.
 */
export const DEFAULT_MIN_GAP = 12;

/** How far the message is allowed to slide under the top of the feed on a jump. */
export const JUMP_TOP_PADDING = 12;

/** A message shape the rail needs. Structurally satisfied by `ThunderChatMessage`. */
export interface TimelineSourceMessage {
  role: string;
  content?: string | null;
  stats?: { turn?: number; duration_ms?: number };
}

/**
 * Plain-text excerpt for the hover preview.
 *
 * Fenced code blocks are dropped whole (their first line is rarely the point and
 * they wreck the two-line budget); inline code, links and list markers keep
 * their text; everything else that is punctuation is stripped and whitespace
 * collapsed.
 */
export function excerpt(text: string | null | undefined, max = 180): string {
  if (!text) return "";
  const flattened = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/\*\*|__|~~/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened.length <= max) return flattened;
  return `${flattened.slice(0, max).trimEnd()}…`;
}

/**
 * One entry per message, plus the in-flight turn when the agent is streaming.
 *
 * Historical and live turns produce entries through the same path: a stored
 * turn is already one assistant message per engine step, and the live turn is
 * one rendered row — so the rail's dot count matches the feed's row count.
 */
export function buildTimelineItems(
  messages: readonly TimelineSourceMessage[],
  live?: { content?: string | null; streaming: boolean } | null
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  messages.forEach((message, index) => {
    if (message.role !== "user" && message.role !== "assistant") return;
    entries.push({
      index,
      role: message.role,
      excerpt: excerpt(message.content),
      turn: message.stats?.turn,
      durationMs: message.stats?.duration_ms,
      isLive: false
    });
  });
  if (live?.streaming) {
    entries.push({
      index: messages.length,
      role: "assistant",
      excerpt: excerpt(live.content),
      isLive: true
    });
  }
  return entries;
}

/** `scrollHeight - clientHeight`, clamped: the distance the feed can actually travel. */
export function scrollableDistance(scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight);
}

/**
 * Collapse anchors into dots, in one pass over the measured tops.
 *
 * Anchors are projected by their real position in the scroll content, so the
 * rail shows where the conversation is dense — an answer that ran for 40
 * messages spreads out, a single short exchange stays as one point. Consecutive
 * anchors closer than `minGap` merge into the earlier dot and increment its
 * `count`, which is what keeps the rail from turning into a solid line.
 */
export function computeRailDots(params: {
  entries: readonly TimelineEntry[];
  /** Measured scroll-content offset per entry; missing entries are treated as 0. */
  anchorTops: readonly number[];
  /** `scrollHeight - clientHeight` of the feed. */
  scrollable: number;
  railHeight: number;
  dotSize?: number;
  minGap?: number;
}): RailDot[] {
  const { entries, anchorTops, scrollable, railHeight } = params;
  const dotSize = params.dotSize ?? DEFAULT_DOT_SIZE;
  const minGap = params.minGap ?? DEFAULT_MIN_GAP;
  const usable = Math.max(0, railHeight - dotSize);

  const dots: RailDot[] = [];
  for (let i = 0; i < entries.length; i++) {
    const top = anchorTops[i] ?? 0;
    const ratio = scrollable > 0 ? Math.min(1, Math.max(0, top / scrollable)) : 0;
    const y = ratio * usable;
    const last = dots[dots.length - 1];
    if (last && y - last.y < minGap) {
      last.count += 1;
      last.isLive = last.isLive || entries[i].isLive;
      // Average so a merged dot sits in the middle of what it stands for
      // instead of drifting to the first or last member.
      last.y = (last.y * (last.count - 1) + y) / last.count;
      continue;
    }
    dots.push({
      index: entries[i].index,
      firstEntryIndex: i,
      count: 1,
      y,
      isLive: entries[i].isLive
    });
  }
  return dots;
}

/**
 * The entry the reader is looking at: the last one whose top has passed a probe
 * 30% down the viewport. Anchoring the probe below the very top means the answer
 * currently being read counts as active, rather than the one scrolled off.
 */
export function activeAnchorIndex(
  anchorTops: readonly number[],
  scrollTop: number,
  clientHeight: number,
  focusRatio = 0.3
): number {
  if (anchorTops.length === 0) return -1;
  const probe = scrollTop + clientHeight * focusRatio;
  let active = 0;
  for (let i = 0; i < anchorTops.length; i++) {
    if (anchorTops[i] > probe) break;
    active = i;
  }
  return active;
}

/** Index into `dots` of the dot that owns `entryIndex`, or -1 when empty. */
export function dotIndexForEntry(dots: readonly RailDot[], entryIndex: number): number {
  if (dots.length === 0 || entryIndex < 0) return -1;
  let found = 0;
  for (let i = 0; i < dots.length; i++) {
    if (dots[i].firstEntryIndex > entryIndex) break;
    found = i;
  }
  return found;
}

/**
 * The `scrollTop` that puts `anchorTop` just under the top of the feed.
 *
 * Computed rather than delegated to `scrollIntoView`, which also scrolls
 * ancestors and the window — unusable inside the Workbench pane, where the chat
 * is one of several columns.
 */
export function scrollTopForAnchor(
  feedTop: number,
  anchorTop: number,
  scrollTop: number,
  padding = JUMP_TOP_PADDING
): number {
  return Math.max(0, anchorTop - feedTop + scrollTop - padding);
}

/** The viewport indicator: where the visible slice sits on the rail. */
export function viewportWindow(params: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  railHeight: number;
}): { top: number; height: number } {
  const { scrollTop, scrollHeight, clientHeight, railHeight } = params;
  if (scrollHeight <= 0 || railHeight <= 0) return { top: 0, height: 0 };
  const height = Math.min(railHeight, (clientHeight / scrollHeight) * railHeight);
  const travel = Math.max(0, railHeight - height);
  const scrollable = scrollableDistance(scrollHeight, clientHeight);
  const ratio = scrollable > 0 ? Math.min(1, Math.max(0, scrollTop / scrollable)) : 0;
  return { top: ratio * travel, height };
}
