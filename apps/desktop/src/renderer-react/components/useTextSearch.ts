import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared text search + highlight built on the CSS Custom Highlight API.
 * Extracted from the pattern used by SessionTranscriptPane / NotePaneView so
 * new surfaces (e.g. the AI chat feed) get find-in-page for free.
 *
 * Usage:
 *   const feedRef = useRef<HTMLDivElement>(null);
 *   const search = useTextSearchHighlight({ rootRef: feedRef, highlightPrefix: "chat-search", deps: [messages] });
 *   search.query / search.setQuery / search.next / search.prev / search.totalMatches / search.currentMatchIndex
 */

interface TextSearchOptions {
  /** Element whose rendered DOM is searched. */
  rootRef: React.RefObject<HTMLElement | null>;
  /** Registry names become `<prefix>` and `<prefix>-active`. */
  highlightPrefix: string;
  /** Re-collect ranges when these change (e.g. message list identity). */
  deps?: React.DependencyList;
  /** Extra selectors to skip while walking text nodes (defaults: buttons). */
  skipSelectors?: string[];
}

/** Collect one Range per case-insensitive occurrence of `needle` under `root`. */
export function findTextRanges(root: HTMLElement | null, needle: string, skipSelectors: string[] = []): Range[] {
  const ranges: Range[] = [];
  if (!root || !needle) return ranges;
  const lowerNeedle = needle.toLowerCase();
  const skip = skipSelectors.length > 0 ? skipSelectors : ["button"];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent || !node.textContent.toLowerCase().includes(lowerNeedle)) {
        return NodeFilter.FILTER_SKIP;
      }
      const parent = node.parentElement;
      if (parent && skip.some((selector) => parent.closest(selector))) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    const text = textNode.textContent || "";
    const lowerText = text.toLowerCase();
    let pos = 0;
    while ((pos = lowerText.indexOf(lowerNeedle, pos)) !== -1) {
      try {
        const range = new Range();
        range.setStart(textNode, pos);
        range.setEnd(textNode, pos + needle.length);
        ranges.push(range);
      } catch {
        // Range offsets can go stale mid-render; skip this occurrence.
      }
      pos += needle.length;
    }
  }
  return ranges;
}

function highlightRegistry(): { highlights?: Map<string, unknown> } | undefined {
  return (window as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
}

function highlightCtor(): (new (...ranges: Range[]) => unknown) | undefined {
  const ctor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  return typeof ctor === "function" ? ctor : undefined;
}

export function useTextSearchHighlight({ rootRef, highlightPrefix, deps = [], skipSelectors }: TextSearchOptions) {
  const [query, setQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const rangesRef = useRef<Range[]>([]);
  const normalizedQuery = query.trim().toLowerCase();

  const applyHighlightRanges = useCallback((ranges: Range[], activeIdx: number) => {
    const css = highlightRegistry();
    const Highlight = highlightCtor();
    if (!css?.highlights) return;
    const allKey = highlightPrefix;
    const activeKey = `${highlightPrefix}-active`;
    try {
      if (ranges.length === 0) {
        css.highlights.delete(allKey);
        css.highlights.delete(activeKey);
        return;
      }
      if (Highlight) {
        css.highlights.set(allKey, new Highlight(...ranges));
      }
      const targetRange = ranges[activeIdx];
      if (targetRange && Highlight) {
        css.highlights.set(activeKey, new Highlight(targetRange));
        const el = targetRange.startContainer.parentElement;
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      } else {
        css.highlights.delete(activeKey);
      }
    } catch {
      // Highlight API safety
    }
  }, [highlightPrefix]);

  const clearHighlights = useCallback(() => {
    const css = highlightRegistry();
    if (!css?.highlights) return;
    css.highlights.delete(highlightPrefix);
    css.highlights.delete(`${highlightPrefix}-active`);
  }, [highlightPrefix]);

  useEffect(() => {
    const root = rootRef.current;
    if (!normalizedQuery || !root) {
      rangesRef.current = [];
      setTotalMatches(0);
      setCurrentMatchIndex(0);
      clearHighlights();
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const liveRoot = rootRef.current;
      if (!liveRoot) return;
      const ranges = findTextRanges(liveRoot, normalizedQuery, skipSelectors);
      rangesRef.current = ranges;
      setTotalMatches(ranges.length);
      const initialIdx = 0;
      setCurrentMatchIndex(initialIdx);
      applyHighlightRanges(ranges, initialIdx);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      clearHighlights();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedQuery, ...deps]);

  // Drop highlights when the consumer unmounts.
  useEffect(() => clearHighlights, [clearHighlights]);

  const nextMatch = useCallback(() => {
    const count = rangesRef.current.length;
    if (count === 0) return;
    const nextIdx = (currentMatchIndex + 1) % count;
    setCurrentMatchIndex(nextIdx);
    applyHighlightRanges(rangesRef.current, nextIdx);
  }, [currentMatchIndex, applyHighlightRanges]);

  const prevMatch = useCallback(() => {
    const count = rangesRef.current.length;
    if (count === 0) return;
    const prevIdx = (currentMatchIndex - 1 + count) % count;
    setCurrentMatchIndex(prevIdx);
    applyHighlightRanges(rangesRef.current, prevIdx);
  }, [currentMatchIndex, applyHighlightRanges]);

  const reset = useCallback(() => {
    setQuery("");
    rangesRef.current = [];
    setTotalMatches(0);
    setCurrentMatchIndex(0);
    clearHighlights();
  }, [clearHighlights]);

  return {
    query,
    setQuery,
    normalizedQuery,
    currentMatchIndex,
    totalMatches,
    nextMatch,
    prevMatch,
    reset
  };
}
