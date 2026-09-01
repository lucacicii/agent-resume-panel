import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref
} from "react";

export interface VariableVirtualListHandle {
  scrollToIndex: (index: number, options?: {
    align?: "start" | "center" | "end";
    behavior?: ScrollBehavior;
  }) => void;
}

interface VariableVirtualListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  estimateSize: (item: T, index: number) => number;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  gap?: number;
  overscan?: number;
  onVisibleRangeChange?: (startIndex: number, endIndex: number) => void;
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
  empty?: ReactNode;
}

type Layout = { key: string; top: number; height: number };

function VirtualRow({
  layout,
  children,
  onResize,
  onMount,
  onUnmount
}: {
  layout: Layout;
  children: ReactNode;
  onResize: (key: string, height: number) => void;
  onMount: (key: string, node: HTMLDivElement) => void;
  onUnmount: (key: string) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback((node: HTMLDivElement | null) => {
    ref.current = node;
    if (node) onMount(layout.key, node);
    else onUnmount(layout.key);
  }, [layout.key, onMount, onUnmount]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => onResize(layout.key, node.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [layout.key, onResize]);

  return (
    <div
      ref={setRef}
      className="virtual-list-row virtual-list-row-variable"
      style={{ position: "absolute", top: layout.top, left: 0, right: 0 }}
      data-virtual-key={layout.key}
    >
      {children}
    </div>
  );
}

function VariableVirtualListInner<T>(
  {
    items,
    getKey,
    estimateSize,
    renderItem,
    className = "",
    gap = 0,
    overscan = 4,
    onVisibleRangeChange,
    onScroll,
    empty
  }: VariableVirtualListProps<T>,
  forwardedRef: Ref<VariableVirtualListHandle>
): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [renderedVersion, setRenderedVersion] = useState(0);
  const measuredHeights = useRef(new Map<string, number>());
  const renderedRows = useRef(new Map<string, HTMLElement>());
  const pendingScroll = useRef<{
    index: number;
    key: string;
    align: "start" | "center" | "end";
    behavior: ScrollBehavior;
  } | null>(null);

  const layouts = useMemo(() => {
    const result: Layout[] = [];
    let top = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const key = getKey(item);
      const height = Math.max(1, measuredHeights.current.get(key) ?? estimateSize(item, index));
      result.push({ key, top, height });
      top += height;
      if (index < items.length - 1) top += gap;
    }
    return result;
  }, [estimateSize, gap, getKey, items, layoutVersion]);

  const totalHeight = layouts.length ? layouts[layouts.length - 1].top + layouts[layouts.length - 1].height : 0;
  const visibleRange = useMemo(() => {
    let start = 0;
    while (start < layouts.length && layouts[start].top + layouts[start].height < scrollTop) start += 1;
    let end = start;
    const bottom = scrollTop + viewportHeight;
    while (end < layouts.length && layouts[end].top <= bottom) end += 1;
    return {
      start: Math.max(0, start - overscan),
      end: Math.min(layouts.length, end + overscan)
    };
  }, [layouts, overscan, scrollTop, viewportHeight]);

  const registerRow = useCallback((key: string, node: HTMLElement) => {
    renderedRows.current.set(key, node);
    if (pendingScroll.current?.key === key) {
      setRenderedVersion((version) => version + 1);
    }
  }, []);

  const unregisterRow = useCallback((key: string) => {
    renderedRows.current.delete(key);
  }, []);

  const alignRenderedRow = useCallback((node: HTMLElement, align: "start" | "center" | "end", behavior: ScrollBehavior) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (typeof node.scrollIntoView === "function") {
      node.scrollIntoView({
        block: align === "start" ? "start" : align === "end" ? "end" : "center",
        inline: "nearest",
        behavior
      });
      return;
    }

    const nodeRect = node.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const delta = align === "start"
      ? nodeRect.top - viewportRect.top
      : align === "end"
        ? nodeRect.bottom - viewportRect.bottom
        : (nodeRect.top + nodeRect.height / 2) - (viewportRect.top + viewportRect.height / 2);
    viewport.scrollTop += delta;
  }, []);

  const measureRow = useCallback((key: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    const previous = measuredHeights.current.get(key);
    if (previous != null && Math.abs(previous - height) < 1) return;
    measuredHeights.current.set(key, height);
    setLayoutVersion((version) => version + 1);
  }, []);

  const measureViewport = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    if (node && node.clientHeight > 0) setViewportHeight(node.clientHeight);
  }, []);

  useImperativeHandle(forwardedRef, () => ({
    scrollToIndex(index, options = {}) {
      const node = viewportRef.current;
      if (!node || index < 0 || index >= layouts.length) return;
      const layout = layouts[index];
      const align = options.align ?? "center";
      const behavior = options.behavior ?? "smooth";
      const target = align === "start"
        ? layout.top
        : align === "end"
          ? layout.top + layout.height - node.clientHeight
          : layout.top + layout.height / 2 - node.clientHeight / 2;
      pendingScroll.current = { index, key: layout.key, align, behavior };
      const renderedRow = renderedRows.current.get(layout.key);
      if (renderedRow) {
        alignRenderedRow(renderedRow, align, behavior);
        pendingScroll.current = null;
        return;
      }
      const nextTop = Math.max(0, Math.min(totalHeight - node.clientHeight, target));
      if (typeof node.scrollTo === "function") {
        node.scrollTo({ top: nextTop, behavior });
      } else {
        node.scrollTop = nextTop;
      }
    }
  }), [layouts, totalHeight]);

  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (node.clientHeight > 0) setViewportHeight(node.clientHeight);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const request = pendingScroll.current;
    if (!request || !layouts[request.index]) return;
    const renderedRow = renderedRows.current.get(request.key);
    if (!renderedRow) return;
    alignRenderedRow(renderedRow, request.align, "auto");
    pendingScroll.current = null;
  }, [alignRenderedRow, layouts, renderedVersion]);

  useLayoutEffect(() => {
    onVisibleRangeChange?.(visibleRange.start, Math.max(visibleRange.start, visibleRange.end - 1));
  }, [onVisibleRangeChange, visibleRange]);

  if (!items.length) return <>{empty}</>;

  return (
    <div
      ref={measureViewport}
      className={`variable-virtual-list${className ? ` ${className}` : ""}`}
      onScroll={(event) => {
        setScrollTop(event.currentTarget.scrollTop);
        onScroll?.(event);
      }}
    >
      <div className="variable-virtual-list-inner" style={{ height: totalHeight }}>
        {layouts.slice(visibleRange.start, visibleRange.end).map((layout, offset) => {
          const index = visibleRange.start + offset;
          return (
            <VirtualRow
              key={layout.key}
              layout={layout}
              onResize={measureRow}
              onMount={registerRow}
              onUnmount={unregisterRow}
            >
              {renderItem(items[index], index)}
            </VirtualRow>
          );
        })}
      </div>
    </div>
  );
}

export const VariableVirtualList = forwardRef(VariableVirtualListInner) as <T>(
  props: VariableVirtualListProps<T> & { ref?: Ref<VariableVirtualListHandle> }
) => React.JSX.Element;
