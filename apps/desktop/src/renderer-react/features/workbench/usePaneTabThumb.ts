import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export type PaneTabThumb = { x: number; width: number; visible: boolean };

const HIDDEN_THUMB: PaneTabThumb = { x: 0, width: 0, visible: false };

/**
 * Horizontal counterpart of the sidebar's glide pill: a group's tab list is
 * measured so one pill can travel between tabs whose widths vary with their
 * titles. The pill lives inside the horizontal scroller, so positions are in
 * content coordinates and scrolling needs no listener of its own.
 */
export function usePaneTabThumb(
  activeKey: string,
  tabCount: number
): { listRef: RefObject<HTMLDivElement | null>; thumb: PaneTabThumb } {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState<PaneTabThumb>(HIDDEN_THUMB);

  const measure = useCallback(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>(".wb-terminal-tab.active") ?? null;
    if (!list || !tab || tab.offsetWidth < 1 || list.offsetWidth < 1) {
      setThumb((current) => (current.visible ? HIDDEN_THUMB : current));
      return;
    }
    const next = { x: tab.offsetLeft, width: tab.offsetWidth, visible: true };
    // Writing the same box again would re-render every measured frame.
    setThumb((current) =>
      current.visible && current.x === next.x && current.width === next.width ? current : next
    );
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, activeKey, tabCount]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    // Tab widths follow their titles, and an inactive tab resizing shifts the
    // active one, so every tab is watched rather than only the current one.
    for (const tab of list.querySelectorAll(".wb-terminal-tab")) observer.observe(tab);
    return () => observer.disconnect();
  }, [measure, activeKey, tabCount]);

  return { listRef, thumb };
}
