import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const ITEM_SELECTOR =
  '[role="menuitem"]:not([disabled]):not([aria-disabled="true"]),' +
  '[role="menuitemradio"]:not([disabled]):not([aria-disabled="true"]),' +
  '[role="menuitemcheckbox"]:not([disabled]):not([aria-disabled="true"])';

const VIEWPORT_MARGIN = 8;

function menuItems(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return [...container.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter(
    (item) => item.offsetParent !== null
  );
}

/**
 * Place a floating menu inside the window.
 *
 * Menus used to clamp with guessed constants (`window.innerWidth - 220`), which
 * is wrong for every menu that is not exactly that size: the menu could still
 * overflow, or be pushed away from its anchor. This measures the real box and
 * flips to the other side of the anchor when there is no room, the way a native
 * menu does. `visibility` stays hidden until the first measurement so the menu
 * never flashes at the wrong edge.
 */
export function useMenuPosition(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  point: { x: number; y: number }
): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const { width, height } = element.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    // Flip towards the roomier side of the anchor instead of clamping into it.
    const left = point.x + width + VIEWPORT_MARGIN > window.innerWidth
      ? Math.max(VIEWPORT_MARGIN, point.x - width)
      : point.x;
    const top = point.y + height + VIEWPORT_MARGIN > window.innerHeight
      ? Math.max(VIEWPORT_MARGIN, point.y - height)
      : point.y;
    element.style.left = `${Math.min(Math.max(VIEWPORT_MARGIN, left), maxLeft)}px`;
    element.style.top = `${Math.min(Math.max(VIEWPORT_MARGIN, top), maxTop)}px`;
    element.style.visibility = "visible";
  }, [open, point.x, point.y, ref]);
}

/**
 * Make a menu behave like a macOS menu.
 *
 * The native menus the app now uses get this from the system; the DOM menus that
 * remain (tag grids, agent pickers) must provide it themselves: focus moves into
 * the menu on open, arrow keys and Home/End walk the items, typing jumps to an
 * item, Tab closes, Escape closes and returns focus to whatever opened the menu.
 */
export function useMenuKeyboard(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  close: () => void
): void {
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const container = ref.current;
    if (!container) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = menuItems(container);
    if (!items.length) return;
    // Focus the first item so the menu owns the keyboard immediately.
    items[0]?.focus();

    let typed = "";
    let typedTimer = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      const current = menuItems(container);
      if (!current.length) return;
      const index = current.indexOf(document.activeElement as HTMLElement);
      const move = (next: number) => {
        event.preventDefault();
        event.stopPropagation();
        current[(next + current.length) % current.length]?.focus();
      };
      switch (event.key) {
        case "ArrowDown":
          return move(index + 1);
        case "ArrowUp":
          return move(index - 1);
        case "Home":
          return move(0);
        case "End":
          return move(current.length - 1);
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          restoreFocusRef.current?.focus();
          return close();
        case "Tab":
          event.preventDefault();
          restoreFocusRef.current?.focus();
          return close();
        default:
          break;
      }
      if (!/^[\w ]$/.test(event.key)) return;
      typed += event.key.toLowerCase();
      window.clearTimeout(typedTimer);
      typedTimer = window.setTimeout(() => {
        typed = "";
      }, 600);
      const start = Math.max(0, index);
      const ordered = [...current.slice(start + 1), ...current.slice(0, start + 1)];
      const match = ordered.find((item) => (item.textContent || "").trim().toLowerCase().startsWith(typed));
      if (match) {
        event.preventDefault();
        match.focus();
      }
    };
    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(typedTimer);
    };
  }, [close, open, ref]);
}

/** Convenience: both behaviors for one menu. */
export function useMenuBehavior(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  point: { x: number; y: number },
  close: () => void
): void {
  useMenuPosition(open, ref, point);
  useMenuKeyboard(open, ref, close);
}

/** `visibility: hidden` until `useMenuPosition` has measured the menu. */
export function hiddenUntilMeasured(): { visibility: "hidden" } {
  return { visibility: "hidden" };
}

/** Stable callback for `<div onMouseDown={stopMenuPropagation}>`. */
export function useMenuSurface(): { stopPropagation: (event: { stopPropagation: () => void }) => void } {
  const stopPropagation = useCallback((event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  }, []);
  return { stopPropagation };
}
