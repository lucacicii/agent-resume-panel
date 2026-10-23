import type { RefObject } from "react";
import { usePaneTabThumb } from "./usePaneTabThumb";

type Props = {
  listRef: RefObject<HTMLDivElement | null>;
  activeKey: string;
  tabCount: number;
};

/**
 * Owns the thumb's measured state so a tab-width animation (which fires the
 * ResizeObserver every frame) re-renders this span instead of the whole
 * Workbench panel. The caller renders it inside the list it points at.
 */
export function PaneTabThumb({ listRef, activeKey, tabCount }: Props): React.JSX.Element | null {
  const { thumb } = usePaneTabThumb(activeKey, tabCount, listRef);
  if (!thumb.visible) return null;
  return (
    <span
      className="wb-pane-tab-thumb"
      aria-hidden="true"
      style={{ transform: `translateX(${thumb.x}px)`, width: thumb.width }}
    />
  );
}
