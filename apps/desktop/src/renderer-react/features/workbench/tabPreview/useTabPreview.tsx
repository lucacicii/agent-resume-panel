import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusEvent, PointerEvent, ReactNode, RefObject } from "react";
import { loadTabPreview } from "./tabPreviewSource";
import { TabPreviewCard } from "./TabPreviewCard";
import type { TabPreviewContent, TabPreviewTarget } from "./types";

/** Chrome's intent delay: long enough that sweeping the strip opens nothing. */
const INTENT_DELAY_MS = 350;
/** Grace for crossing the gap between the tab and the card. */
const LEAVE_GRACE_MS = 140;

type OpenPreview =
  | { phase: "loading"; target: TabPreviewTarget; anchor: DOMRect }
  | { phase: "ready"; target: TabPreviewTarget; anchor: DOMRect; content: TabPreviewContent }
  | { phase: "error"; target: TabPreviewTarget; anchor: DOMRect };

export type TabPreviewState = OpenPreview;

export type TabPreviewBindings = {
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: () => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
};

const EMPTY_BINDINGS: TabPreviewBindings = {};

/**
 * Intent-delayed hover preview for inactive pane tabs.
 *
 * The active tab is never bound (`bind(null)`), because its content is already
 * on screen. Opening is deferred, switching between already-open targets is
 * immediate, and the card stays open while the pointer is inside it.
 */
export function useTabPreview(): {
  bind: (target: TabPreviewTarget | null) => TabPreviewBindings;
  card: ReactNode;
} {
  const [open, setOpen] = useState<OpenPreview | null>(null);
  const openRef = useRef<OpenPreview | null>(null);
  const anchorElRef = useRef<HTMLElement | null>(null);
  const intentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const cardRef = useRef<HTMLDivElement | null>(null);

  openRef.current = open;

  const clearIntent = useCallback(() => {
    if (intentTimerRef.current !== null) {
      clearTimeout(intentTimerRef.current);
      intentTimerRef.current = null;
    }
  }, []);

  const clearClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearIntent();
    clearClose();
    requestRef.current += 1;
    anchorElRef.current = null;
    setOpen(null);
  }, [clearClose, clearIntent]);

  const show = useCallback((target: TabPreviewTarget, element: HTMLElement) => {
    const anchor = element.getBoundingClientRect();
    const request = requestRef.current + 1;
    requestRef.current = request;
    anchorElRef.current = element;
    setOpen({ phase: "loading", target, anchor });
    void loadTabPreview(target).then(
      (content) => {
        if (requestRef.current !== request) return;
        setOpen(
          content
            ? { phase: "ready", target, anchor, content }
            : { phase: "error", target, anchor }
        );
      },
      () => {
        if (requestRef.current !== request) return;
        setOpen({ phase: "error", target, anchor });
      }
    );
  }, []);

  const startIntent = useCallback(
    (target: TabPreviewTarget, element: HTMLElement) => {
      clearIntent();
      const current = openRef.current;
      // Switching between two tabs that are already previewing is instant;
      // only the first open waits for intent.
      if (current) {
        if (current.target.key !== target.key) show(target, element);
        return;
      }
      intentTimerRef.current = setTimeout(() => {
        intentTimerRef.current = null;
        // The click that activates a tab also focuses it; never preview it.
        if (!element.isConnected || element.classList.contains("active")) return;
        show(target, element);
      }, INTENT_DELAY_MS);
    },
    [clearIntent, show]
  );

  const scheduleClose = useCallback(() => {
    clearIntent();
    if (openRef.current === null) return;
    clearClose();
    closeTimerRef.current = setTimeout(close, LEAVE_GRACE_MS);
  }, [clearClose, clearIntent, close]);

  // Dismissal shared by every open card: Escape, scroll, resize, outside click.
  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [isOpen, close]);

  // A pane can close while its card is open; the tab unmounting ends the card.
  useEffect(() => {
    const anchor = anchorElRef.current;
    if (open !== null && anchor && !anchor.isConnected) close();
  });

  useEffect(() => () => {
    clearIntent();
    clearClose();
  }, [clearClose, clearIntent]);

  const bind = useCallback(
    (target: TabPreviewTarget | null): TabPreviewBindings => {
      if (!target) return EMPTY_BINDINGS;
      return {
        onPointerEnter: (event) => {
          clearClose();
          startIntent(target, event.currentTarget);
        },
        onPointerLeave: () => {
          scheduleClose();
        },
        onFocus: (event) => {
          clearClose();
          startIntent(target, event.currentTarget);
        },
        onBlur: (event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          scheduleClose();
        }
      };
    },
    [clearClose, scheduleClose, startIntent]
  );

  const card =
    open === null
      ? null
      : <TabPreviewCard
          key={open.target.key}
          state={open}
          cardRef={cardRef}
          onPointerEnter={clearClose}
          onPointerLeave={scheduleClose}
        />;

  return { bind, card };
}
