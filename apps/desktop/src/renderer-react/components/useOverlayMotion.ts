import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Exit motion for conditionally rendered overlays.
 *
 * Overlays are rendered as `{state ? <Overlay/> : null}`, so clearing the state
 * unmounts them on the same frame and the reverse animation can never run. Both
 * hooks keep the overlay mounted for `OVERLAY_EXIT_MS` while reporting `closing`,
 * which the caller turns into the `.is-closing` class that drives the `*-out`
 * keyframes in `renderer/styles.css`.
 */

/** `--duration-normal` (220ms) plus one frame of slack for the unmount. */
export const OVERLAY_EXIT_MS = 240;

/**
 * Presence for overlays driven by a boolean (`open` prop or a plain flag). While
 * `closing` is true the overlay must still render, with `.is-closing` applied.
 */
export function useOverlayPresence(open: boolean): { mounted: boolean; closing: boolean } {
  const [wasOpen, setWasOpen] = useState(open);
  const [closing, setClosing] = useState(false);

  // Derive the transition during render so the closing render already keeps the
  // overlay mounted. Deferring this to an effect would unmount it for one commit
  // and then remount a fresh node with `.is-closing`, which reads as a flash
  // rather than an exit (and remounts children wherever a parent gates the portal
  // on `mounted`). Adjusting state while rendering is what React documents for
  // "adjusting state when a prop changes"; it re-renders before committing.
  if (wasOpen !== open) {
    setWasOpen(open);
    setClosing(!open);
  }

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), OVERLAY_EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  return { mounted: open || closing, closing };
}

/**
 * Drop-in replacement for `useState<T | null>()` for overlays whose state holds
 * the data they render. The setter keeps the `useState` behaviours used across
 * the app — `setValue(null)`, `setValue(next)`, `setValue((current) => ...)` —
 * but applies `null` only after the exit animation, so callers keep reading the
 * last value while `closing` is true.
 */
export function useOverlayState<T>(): [T | null, Dispatch<SetStateAction<T | null>>, boolean] {
  const [value, setValue] = useState<T | null>(null);
  const [closing, setClosing] = useState(false);
  const valueRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelExit = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => cancelExit, [cancelExit]);

  const setOverlayValue = useCallback<Dispatch<SetStateAction<T | null>>>((next) => {
    const current = valueRef.current;
    const resolved = typeof next === "function" ? (next as (current: T | null) => T | null)(current) : next;
    if (resolved === null) {
      // A pending timer means an exit is already running; ignore repeats so a
      // second dismissal cannot restart, and visibly re-trigger, the animation.
      if (current === null || timerRef.current !== null) return;
      setClosing(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        valueRef.current = null;
        setClosing(false);
        setValue(null);
      }, OVERLAY_EXIT_MS);
      return;
    }
    cancelExit();
    valueRef.current = resolved;
    setClosing(false);
    setValue(resolved);
  }, [cancelExit]);

  return [value, setOverlayValue, closing];
}

/**
 * A ref that is true while the component is mounted.
 *
 * Async work that resumes after an `await` — a native context menu, a native
 * alert, a bridge call — must not touch state or call back into the app once the
 * window or pane is gone. Guard those continuations with this.
 */
export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  return mounted;
}
