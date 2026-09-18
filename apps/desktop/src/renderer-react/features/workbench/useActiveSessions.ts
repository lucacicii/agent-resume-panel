import { useEffect, useState } from "react";
import { desktopApi } from "../../bridge";
import type { WorkbenchActiveSessionDot } from "../../../shared/workbenchSelection";

/**
 * The app-wide live session dots.
 *
 * Main merges every workbench window's report (plus daemon-only panes) into one
 * list and broadcasts it, so the board, the selection menu, and any other
 * consumer read exactly the same input. This hook is the only renderer-side
 * subscription to that stream.
 */
export function useActiveSessions(): WorkbenchActiveSessionDot[] {
  const [sessions, setSessions] = useState<WorkbenchActiveSessionDot[]>([]);
  useEffect(() => {
    const api = desktopApi();
    let cancelled = false;
    if (typeof api.getWorkbenchActiveSessions === "function") {
      void api.getWorkbenchActiveSessions().then((next) => {
        if (!cancelled && Array.isArray(next)) setSessions(next);
      }).catch(() => undefined);
    }
    const stop = typeof api.onWorkbenchActiveSessions === "function"
      ? api.onWorkbenchActiveSessions((next) => {
          if (!cancelled && Array.isArray(next)) setSessions(next);
        })
      : undefined;
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return sessions;
}
