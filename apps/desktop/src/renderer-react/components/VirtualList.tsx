import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

interface VirtualListProps<T> {
  items: readonly T[];
  itemHeight: number;
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  overscan?: number;
  scrollToIndex?: number;
  /** Called once when the viewport approaches the end of the rendered items. */
  onEndReached?: () => void;
  endReachedThreshold?: number;
}

/** Fixed-height virtual list used by the Desktop session surfaces. */
export function VirtualList<T>({
  items,
  itemHeight,
  getKey,
  renderItem,
  className = "",
  overscan = 6,
  scrollToIndex,
  onEndReached,
  endReachedThreshold = 20
}: VirtualListProps<T>): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(itemHeight * 12);
  const endTriggeredForLength = useRef(-1);
  const totalHeight = items.length * itemHeight;

  const measureViewport = useCallback((node: HTMLDivElement | null) => {
    if (!node || node.clientHeight <= 0) return;
    setViewportHeight(node.clientHeight);
  }, []);

  const setViewportRef = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    measureViewport(node);
  }, [measureViewport]);

  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    measureViewport(node);
    if (typeof ResizeObserver === "undefined") {
      const onResize = () => measureViewport(node);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    const observer = new ResizeObserver(() => measureViewport(node));
    observer.observe(node);
    return () => observer.disconnect();
  }, [measureViewport]);

  useEffect(() => {
    if (endTriggeredForLength.current > items.length) endTriggeredForLength.current = -1;
  }, [items.length]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const maxScrollTop = Math.max(0, totalHeight - node.clientHeight);
    if (node.scrollTop > maxScrollTop) {
      node.scrollTop = maxScrollTop;
      setScrollTop(maxScrollTop);
    }
  }, [totalHeight]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node || scrollToIndex == null || scrollToIndex < 0 || scrollToIndex >= items.length) return;
    const itemTop = scrollToIndex * itemHeight;
    const itemBottom = itemTop + itemHeight;
    const viewportBottom = node.scrollTop + node.clientHeight;
    if (itemTop < node.scrollTop) node.scrollTop = itemTop;
    else if (itemBottom > viewportBottom) node.scrollTop = Math.max(0, itemBottom - node.clientHeight);
    setScrollTop(node.scrollTop);
  }, [itemHeight, items.length, scrollToIndex]);

  const range = useMemo(() => {
    const firstVisible = Math.max(0, Math.floor(scrollTop / itemHeight));
    const lastVisible = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / itemHeight));
    return {
      start: Math.max(0, firstVisible - overscan),
      end: Math.min(items.length, lastVisible + overscan)
    };
  }, [itemHeight, items.length, overscan, scrollTop, viewportHeight]);

  return (
    <div
      ref={setViewportRef}
      className={`virtual-list-viewport${className ? ` ${className}` : ""}`}
      data-virtual-count={items.length}
      onScroll={(event) => {
        const node = event.currentTarget;
        const nextScrollTop = node.scrollTop;
        setScrollTop(nextScrollTop);
        measureViewport(node);
        const firstVisible = Math.floor(nextScrollTop / itemHeight);
        if (onEndReached && items.length - (firstVisible + Math.ceil(node.clientHeight / itemHeight)) <= endReachedThreshold) {
          if (endTriggeredForLength.current !== items.length) {
            endTriggeredForLength.current = items.length;
            onEndReached();
          }
        }
      }}
    >
      <div className="virtual-list-inner" style={{ height: totalHeight }}>
        <div className="virtual-list-window" style={{ transform: `translateY(${range.start * itemHeight}px)` }}>
          {items.slice(range.start, range.end).map((item, offset) => {
            const index = range.start + offset;
            return <div className="virtual-list-row" style={{ height: itemHeight }} key={getKey(item)}>{renderItem(item, index)}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
