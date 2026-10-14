import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import {
  activeAnchorIndex,
  computeRailDots,
  DEFAULT_DOT_SIZE,
  dotIndexForEntry,
  scrollableDistance,
  viewportWindow,
  type RailDot,
  type TimelineEntry
} from "./timelineModel";

interface ChatTimelineProps {
  /** The scrolling feed whose rows carry `data-timeline-index`. */
  feedRef: React.RefObject<HTMLElement | null>;
  /** One entry per message, in feed order, plus the in-flight turn. */
  entries: readonly TimelineEntry[];
  /** Jump the feed to a message index. Owned by the caller so the rail stays presentational. */
  onJump: (index: number) => void;
}

/** Whatever the DOM last told us about the feed's geometry. */
interface Geometry {
  /** Scroll-content offset of each entry's row, in `entries` order. */
  anchorTops: number[];
  railHeight: number;
}

interface Viewport {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

const EMPTY_VIEWPORT: Viewport = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };

/** Sub-pixel churn from a re-measure must not cause a render. */
const MEASURE_EPSILON = 0.5;

function sameTops(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > MEASURE_EPSILON) return false;
  }
  return true;
}

/**
 * The floating rail on the right edge of the chat.
 *
 * It measures the feed's real row offsets and projects them onto a fixed-height
 * rail, so dot spacing reflects where the conversation actually is in the
 * document. Anchors that would overlap collapse into one dot carrying a count.
 *
 * The rail never takes layout width — it is absolutely positioned over the
 * feed's own right padding — and it disappears whenever there is nothing to
 * navigate (one message, or a feed that does not scroll).
 */
export function ChatTimeline({ feedRef, entries, onJump }: ChatTimelineProps): React.JSX.Element | null {
  const { t } = useI18n();
  const railRef = useRef<HTMLDivElement | null>(null);
  const dotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [viewport, setViewport] = useState<Viewport>(EMPTY_VIEWPORT);
  const [previewEntryIndex, setPreviewEntryIndex] = useState<number | null>(null);
  const [previewHeight, setPreviewHeight] = useState(0);

  const measure = useCallback(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const feedTop = feed.getBoundingClientRect().top;
    const scrollTop = feed.scrollTop;
    const topsByIndex = new Map<number, number>();
    for (const row of Array.from(feed.querySelectorAll<HTMLElement>("[data-timeline-index]"))) {
      const index = Number(row.dataset.timelineIndex);
      if (!Number.isFinite(index)) continue;
      // Scroll-content offset: the row's viewport position plus what has already
      // scrolled past. Independent of whether the feed is a positioned ancestor.
      topsByIndex.set(index, row.getBoundingClientRect().top - feedTop + scrollTop);
    }
    const anchorTops = entries.map((entry) => topsByIndex.get(entry.index) ?? 0);
    const railHeight = railRef.current?.getBoundingClientRect().height ?? 0;
    setGeometry((previous) =>
      previous &&
      Math.abs(previous.railHeight - railHeight) <= MEASURE_EPSILON &&
      sameTops(previous.anchorTops, anchorTops)
        ? previous
        : { anchorTops, railHeight }
    );
  }, [entries, feedRef]);

  const readViewport = useCallback(() => {
    const feed = feedRef.current;
    if (!feed) return;
    setViewport((previous) =>
      previous.scrollTop === feed.scrollTop &&
      previous.scrollHeight === feed.scrollHeight &&
      previous.clientHeight === feed.clientHeight
        ? previous
        : { scrollTop: feed.scrollTop, scrollHeight: feed.scrollHeight, clientHeight: feed.clientHeight }
    );
  }, [feedRef]);

  // Measure after every commit that could move content: `entries` changes when a
  // message lands or a streaming chunk arrives.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    readViewport();
    feed.addEventListener("scroll", readViewport, { passive: true });

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      const remeasure = () => {
        measure();
        readViewport();
      };
      observer = new ResizeObserver(remeasure);
      observer.observe(feed);
      // The feed's own box only changes when the pane resizes; its content moves
      // behind it (markdown settling, images decoding, a new row).
      const content = feed.firstElementChild;
      if (content) observer.observe(content);
      if (railRef.current) observer.observe(railRef.current);
    }
    return () => {
      feed.removeEventListener("scroll", readViewport);
      observer?.disconnect();
    };
  }, [feedRef, measure, readViewport]);

  const dots = useMemo(() => {
    if (!geometry) return [];
    return computeRailDots({
      entries,
      anchorTops: geometry.anchorTops,
      scrollable: scrollableDistance(viewport.scrollHeight, viewport.clientHeight),
      railHeight: geometry.railHeight
    });
  }, [entries, geometry, viewport.scrollHeight, viewport.clientHeight]);

  const entryByIndex = useMemo(() => {
    const map = new Map<number, TimelineEntry>();
    entries.forEach((item) => map.set(item.index, item));
    return map;
  }, [entries]);

  /** 1-based position in the feed, which is what the preview shows. */
  const ordinalByIndex = useMemo(() => {
    const map = new Map<number, number>();
    entries.forEach((item, position) => map.set(item.index, position + 1));
    return map;
  }, [entries]);

  const activeEntryIndex = geometry
    ? activeAnchorIndex(geometry.anchorTops, viewport.scrollTop, viewport.clientHeight)
    : -1;
  const activeDotIndex = dotIndexForEntry(dots, activeEntryIndex);

  const scrollWindow = viewportWindow({
    scrollTop: viewport.scrollTop,
    scrollHeight: viewport.scrollHeight,
    clientHeight: viewport.clientHeight,
    railHeight: geometry?.railHeight ?? 0
  });

  const previewDotIndex = dotIndexForEntry(dots, previewEntryIndex ?? -1);
  const previewEntry = previewEntryIndex === null ? undefined : entryByIndex.get(previewEntryIndex);
  const previewDot = previewDotIndex >= 0 ? dots[previewDotIndex] : undefined;

  useLayoutEffect(() => {
    if (!previewEntry || !previewDot) {
      setPreviewHeight(0);
      return;
    }
    const height = previewRef.current?.getBoundingClientRect().height ?? 0;
    setPreviewHeight((previous) => (Math.abs(previous - height) > MEASURE_EPSILON ? height : previous));
  }, [previewEntry, previewDot]);

  /**
   * The dot nearest a pointer position, in rail coordinates.
   *
   * The rail resolves hover and clicks itself instead of letting each dot's own
   * box decide: neighbouring dots on a dense rail are closer together than any
   * usable hit box, so overlapping boxes would make hover land on whichever
   * happens to be later in the DOM. Nearest-centre is exact, gives the whole
   * rail as the target, and makes scrubbing up and down it work.
   *
   * Ties go to the earlier dot — the one being read towards.
   */
  const dotIndexAtPoint = useCallback(
    (clientY: number): number => {
      const rail = railRef.current;
      if (!rail || dots.length === 0) return -1;
      const y = clientY - rail.getBoundingClientRect().top;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      dots.forEach((dot: RailDot, dotIndex: number) => {
        const distance = Math.abs(dot.y + DEFAULT_DOT_SIZE / 2 - y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = dotIndex;
        }
      });
      return best;
    },
    [dots]
  );

  const handleDotKeyDown = useCallback(
    (dotIndex: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
      const { key } = event;
      if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "Home" && key !== "End") return;
      event.preventDefault();
      const next =
        key === "Home"
          ? 0
          : key === "End"
            ? dots.length - 1
            : key === "ArrowUp"
              ? (dotIndex - 1 + dots.length) % dots.length
              : (dotIndex + 1) % dots.length;
      dotRefs.current[next]?.focus();
    },
    [dots.length]
  );

  // The rail element always renders so it can be measured: the shell is what the
  // first measurement reads its height from, and an empty rail takes no space and
  // no pointer events.
  const isNavigable =
    geometry !== null &&
    geometry.railHeight > 0 &&
    entries.length > 1 &&
    dots.length > 0 &&
    scrollableDistance(viewport.scrollHeight, viewport.clientHeight) > 1;
  const railHeight = geometry?.railHeight ?? 0;
  // Centring the preview on its dot is only correct when there is room on both
  // sides; otherwise it must be pushed back inside the rail.
  const previewTop = previewDot
    ? Math.min(
        Math.max(0, previewDot.y + DEFAULT_DOT_SIZE / 2 - previewHeight / 2),
        Math.max(0, railHeight - previewHeight)
      )
    : 0;

  return (
    <nav
      className={`tb-chat-timeline${isNavigable ? "" : " is-empty"}`}
      aria-label={t("desktop.chat.timeline.label")}
      aria-hidden={isNavigable ? undefined : true}
      data-testid="chat-timeline"
    >
      <div
        className="tb-timeline-rail"
        ref={railRef}
        onMouseMove={(event) => {
          if (!isNavigable) return;
          const dotIndex = dotIndexAtPoint(event.clientY);
          const dot = dotIndex >= 0 ? dots[dotIndex] : undefined;
          setPreviewEntryIndex(dot ? dot.index : null);
        }}
        onMouseLeave={() => setPreviewEntryIndex(null)}
        onClick={(event) => {
          // Only pointer clicks land on the strip: the dots take no pointer
          // events, so a click whose target is a dot was synthesised by the
          // keyboard (Enter / Space on a focused dot). That dot already jumped
          // from its own handler, and resolving it here would jump twice —
          // keyboard clicks carry `clientY: 0`, i.e. somewhere else entirely.
          if (!isNavigable || event.target !== railRef.current) return;
          const dotIndex = dotIndexAtPoint(event.clientY);
          if (dotIndex >= 0) onJump(dots[dotIndex].index);
        }}
      >
        {isNavigable ? (
          <div
            className="tb-timeline-viewport"
            aria-hidden="true"
            style={{ top: `${scrollWindow.top}px`, height: `${scrollWindow.height}px` }}
          />
        ) : null}
        <div className="tb-timeline-dots" role="toolbar" aria-orientation="vertical">
          {isNavigable && dots.map((dot, dotIndex) => {
            const ordinal = ordinalByIndex.get(dot.index) ?? dotIndex + 1;
            const isActive = dotIndex === activeDotIndex;
            return (
              <button
                key={`dot_${dot.index}`}
                type="button"
                ref={(node) => {
                  dotRefs.current[dotIndex] = node;
                }}
                className={[
                  "tb-timeline-dot",
                  isActive ? "is-active" : "",
                  dot.isLive ? "is-live" : "",
                  dot.count > 1 ? "is-grouped" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ top: `${dot.y + DEFAULT_DOT_SIZE / 2}px` }}
                // Roving tab stop: the rail is one Tab stop, arrows move within it.
                tabIndex={isActive || (activeDotIndex < 0 && dotIndex === 0) ? 0 : -1}
                aria-label={t("desktop.chat.timeline.jumpTo", ordinal)}
                title={t("desktop.chat.timeline.jumpTo", ordinal)}
                onFocus={() => setPreviewEntryIndex(dot.index)}
                onBlur={() => setPreviewEntryIndex((current) => (current === dot.index ? null : current))}
                onKeyDown={(event) => handleDotKeyDown(dotIndex, event)}
                // Keyboard activation only: the rail resolves pointer input, and
                // the dots are pointer-events: none so a click cannot double-fire.
                onClick={() => onJump(dot.index)}
              >
                <span className="tb-timeline-dot-mark" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        {isNavigable && previewEntry && previewDot ? (
          <div
            className="tb-timeline-preview"
            ref={previewRef}
            role="presentation"
            data-testid="chat-timeline-preview"
            style={{ top: `${previewTop}px` }}
          >
            <div className="tb-timeline-preview-head">
              <span className={`tb-timeline-preview-role${previewEntry.role === "user" ? " is-user" : ""}`}>
                {previewEntry.role === "user"
                  ? t("desktop.chat.timeline.roleUser")
                  : t("desktop.chat.timeline.roleAgent")}
              </span>
              <span className="tb-timeline-preview-seq">#{ordinalByIndex.get(previewEntry.index) ?? 0}</span>
              {typeof previewEntry.turn === "number" ? (
                <span className="tb-timeline-preview-meta">
                  {t("desktop.chat.timeline.turn", previewEntry.turn)}
                </span>
              ) : null}
              {typeof previewEntry.durationMs === "number" && previewEntry.durationMs > 0 ? (
                <span className="tb-timeline-preview-meta">
                  {t("desktop.chat.timeline.duration", (previewEntry.durationMs / 1000).toFixed(1))}
                </span>
              ) : null}
              {previewEntry.isLive ? (
                <span className="tb-timeline-preview-meta is-live">
                  {t("desktop.chat.timeline.live")}
                </span>
              ) : null}
            </div>
            {previewEntry.excerpt ? (
              <div className="tb-timeline-preview-excerpt">{previewEntry.excerpt}</div>
            ) : null}
            {previewDot.count > 1 ? (
              <div className="tb-timeline-preview-grouped">
                {t("desktop.chat.timeline.grouped", previewDot.count)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
