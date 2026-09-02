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
  pinToBottom?: boolean;
  onVisibleRangeChange?: (startIndex: number, endIndex: number) => void;
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
  empty?: ReactNode;
}

type Layout = { key: string; top: number; height: number };

type PendingScroll = {
  index: number;
  key: string;
  align: "start" | "center" | "end";
  steps: number;
};

const MAX_SCROLL_SETTLE_STEPS = 48;
const SCROLL_SETTLE_EPSILON = 1;

function clampScrollTop(top: number, totalHeight: number, viewportHeight: number): number {
  return Math.max(0, Math.min(Math.max(0, totalHeight - viewportHeight), top));
}

function alignedScrollTop(
  layout: Layout,
  viewportHeight: number,
  totalHeight: number,
  align: "start" | "center" | "end"
): number {
  const raw = align === "start"
    ? layout.top
    : align === "end"
      ? layout.top + layout.height - viewportHeight
      : layout.top + layout.height / 2 - viewportHeight / 2;
  return clampScrollTop(raw, totalHeight, viewportHeight);
}

function totalLayoutHeight(layouts: Layout[]): number {
  if (!layouts.length) return 0;
  const last = layouts[layouts.length - 1];
  return last.top + last.height;
}

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
    pinToBottom = false,
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
  const pendingScroll = useRef<PendingScroll | null>(null);
  const programmaticScroll = useRef(false);
  const pinHoldRef = useRef(false);
  const layoutsRef = useRef<Layout[]>([]);

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

  layoutsRef.current = layouts;
  const totalHeight = totalLayoutHeight(layouts);
  const visibleRange = useMemo(() => {
    let start = 0;
    while (start < layouts.length && layouts[start].top + layouts[start].height < scrollTop) start += 1;
    let end = start;
    const bottom = scrollTop + viewportHeight;
    while (end < layouts.length && layouts[end].top <= bottom) end += 1;
    return {
      start,
      end,
      renderStart: Math.max(0, start - overscan),
      renderEnd: Math.min(layouts.length, end + overscan)
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

  const applyViewportScroll = useCallback((top: number) => {
    const node = viewportRef.current;
    if (!node) return;
    programmaticScroll.current = true;
    node.scrollTop = top;
    setScrollTop(top);
  }, []);

  const settlePendingScroll = useCallback(() => {
    const request = pendingScroll.current;
    const node = viewportRef.current;
    if (!request || !node) return;
    const currentLayouts = layoutsRef.current;
    if (request.index < 0 || request.index >= currentLayouts.length) {
      pendingScroll.current = null;
      return;
    }
    const layout = currentLayouts[request.index];
    request.key = layout.key;
    const nextTop = alignedScrollTop(
      layout,
      node.clientHeight || viewportHeight,
      totalLayoutHeight(currentLayouts),
      request.align
    );
    const measured = measuredHeights.current.has(layout.key);
    const rendered = renderedRows.current.has(layout.key);
    const closeEnough = Math.abs(node.scrollTop - nextTop) < SCROLL_SETTLE_EPSILON;
    if (rendered && measured && closeEnough) {
      pendingScroll.current = null;
      return;
    }
    if (closeEnough) return;
    request.steps += 1;
    if (request.steps > MAX_SCROLL_SETTLE_STEPS) {
      pendingScroll.current = null;
      return;
    }
    applyViewportScroll(nextTop);
  }, [applyViewportScroll, viewportHeight]);

  const startScrollToIndex = useCallback((index: number, options: {
    align?: "start" | "center" | "end";
    behavior?: ScrollBehavior;
  } = {}) => {
    const node = viewportRef.current;
    const currentLayouts = layoutsRef.current;
    if (!node || index < 0 || index >= currentLayouts.length) return;
    const layout = currentLayouts[index];
    const align = options.align ?? "center";
    const behavior = options.behavior ?? "smooth";
    const nextTop = alignedScrollTop(
      layout,
      node.clientHeight || viewportHeight,
      totalLayoutHeight(currentLayouts),
      align
    );
    pinHoldRef.current = index !== currentLayouts.length - 1;
    const rendered = renderedRows.current.has(layout.key);
    const measured = measuredHeights.current.has(layout.key);
    const useSmooth = behavior === "smooth" && rendered && measured;
    if (useSmooth) {
      pendingScroll.current = null;
      programmaticScroll.current = true;
      if (typeof node.scrollTo === "function") {
        node.scrollTo({ top: nextTop, behavior: "smooth" });
      } else {
        node.scrollTop = nextTop;
      }
      setScrollTop(nextTop);
      return;
    }
    pendingScroll.current = { index, key: layout.key, align, steps: 0 };
    applyViewportScroll(nextTop);
    settlePendingScroll();
  }, [applyViewportScroll, settlePendingScroll, viewportHeight]);

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
      startScrollToIndex(index, options);
    }
  }), [startScrollToIndex]);

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
    settlePendingScroll();
  }, [layouts, renderedVersion, scrollTop, settlePendingScroll]);

  useLayoutEffect(() => {
    if (!pinToBottom) pinHoldRef.current = false;
  }, [pinToBottom]);

  useLayoutEffect(() => {
    if (!pinToBottom || !items.length || pendingScroll.current || pinHoldRef.current) return;
    const node = viewportRef.current;
    if (!node || node.clientHeight <= 0) return;
    const last = layouts[layouts.length - 1];
    if (!last) return;
    const nextTop = Math.max(0, last.top + last.height - node.clientHeight);
    if (Math.abs(node.scrollTop - nextTop) < 1) return;
    programmaticScroll.current = true;
    node.scrollTop = nextTop;
    setScrollTop(nextTop);
  }, [items.length, layouts, pinToBottom, viewportHeight]);

  useLayoutEffect(() => {
    if (!layouts.length) return;
    onVisibleRangeChange?.(
      visibleRange.start,
      Math.max(visibleRange.start, visibleRange.end - 1)
    );
  }, [layouts.length, onVisibleRangeChange, visibleRange]);

  if (!items.length) return <>{empty}</>;

  return (
    <div
      ref={measureViewport}
      className={`variable-virtual-list${className ? ` ${className}` : ""}`}
      onWheel={() => {
        if (pendingScroll.current) pendingScroll.current = null;
      }}
      onScroll={(event) => {
        setScrollTop(event.currentTarget.scrollTop);
        if (programmaticScroll.current) {
          programmaticScroll.current = false;
        } else if (pendingScroll.current) {
          pendingScroll.current = null;
        }
        onScroll?.(event);
      }}
    >
      <div className="variable-virtual-list-inner" style={{ height: totalHeight }}>
        {layouts.slice(visibleRange.renderStart, visibleRange.renderEnd).map((layout, offset) => {
          const index = visibleRange.renderStart + offset;
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
