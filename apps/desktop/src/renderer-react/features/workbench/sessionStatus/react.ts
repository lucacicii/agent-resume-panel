/**
 * React binding for the session status store.
 *
 * Keeps the store out of component state: the component declares which panes
 * are open and whether it is foreground, then reads a snapshot. Everything
 * else — timers, hysteresis, screen reads — lives in the store.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { SessionStatusStore, type SessionStatusPane, type SessionStatusSnapshot } from "./store";

export type UseSessionStatusResult = {
  /** Stable store handle. Feed it PTY / ACP events from your subscriptions. */
  store: SessionStatusStore;
  snapshot: SessionStatusSnapshot;
};

/**
 * Create (once) and drive a status store.
 *
 * @param panes     Open session panes. Must be a stable-identity array across
 *                  renders that did not change, e.g. memoized upstream.
 * @param foreground Whether the Workbench tab is visible (affects cadence only).
 */
export function useSessionStatus(panes: readonly SessionStatusPane[], foreground: boolean): UseSessionStatusResult {
  const storeRef = useRef<SessionStatusStore | null>(null);
  if (!storeRef.current) storeRef.current = new SessionStatusStore();
  const store = storeRef.current;

  useEffect(() => {
    store.start();
    return () => store.dispose();
  }, [store]);

  useEffect(() => {
    store.setPanes(panes);
  }, [store, panes]);

  useEffect(() => {
    store.setForeground(foreground);
  }, [store, foreground]);

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return useMemo(() => ({ store, snapshot }), [store, snapshot]);
}
