/**
 * ACP chat status.
 *
 * ACP chats are not PTY panes: they live in this process, carry a structured
 * lifecycle, and cannot outlive the app — so there is nothing for the daemon to
 * learn. They are tracked here and merged with the daemon's answer for
 * terminal panes when the dots are assembled.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { SessionDotRuntime, SessionDotStatus } from "./types";

/** Minimal shape of the ACP stream events this hook cares about. */
export type AcpStatusEvent = {
  type?: string;
  chatId?: string;
  requestId?: string;
  status?: string;
  isRunning?: boolean;
  isConnecting?: boolean;
  init?: { status?: string; isRunning?: boolean; isConnecting?: boolean };
};

type AcpFlags = { isRunning: boolean; isConnecting: boolean; status: string };

/** Pending permission / question requests outrank every other ACP signal. */
export function acpStatusFor(flags: AcpFlags, pendingRequestCount: number): SessionDotStatus {
  if (pendingRequestCount > 0) return "awaiting_user";
  if (flags.status === "error") return "error";
  if (flags.isConnecting || flags.status === "connecting") return "connecting";
  if (flags.isRunning || flags.status === "running" || flags.status === "thinking") return "running";
  return "open";
}

export function useAcpStatus(): {
  ingest: (event: AcpStatusEvent) => void;
  byChatId: ReadonlyMap<string, SessionDotRuntime>;
} {
  const flags = useRef(new Map<string, AcpFlags>());
  const pending = useRef(new Map<string, Set<string>>());
  const [version, setVersion] = useState(0);

  const ingest = useCallback((event: AcpStatusEvent) => {
    const chatId = typeof event.chatId === "string" ? event.chatId : "";
    if (!chatId) return;

    switch (event.type) {
      case "status":
        flags.current.set(chatId, {
          isRunning: Boolean(event.isRunning),
          isConnecting: Boolean(event.isConnecting),
          status: event.status || "ready"
        });
        break;
      case "init":
        if (!event.init) return;
        flags.current.set(chatId, {
          isRunning: Boolean(event.init.isRunning),
          isConnecting: Boolean(event.init.isConnecting),
          status: event.init.status || "ready"
        });
        break;
      case "permissionRequest":
      case "userQuestion":
        if (!event.requestId) return;
        pendingFor(pending.current, chatId).add(event.requestId);
        break;
      case "permissionResolved":
      case "userQuestionResolved":
        if (!event.requestId) return;
        pendingFor(pending.current, chatId).delete(event.requestId);
        break;
      // History replay and streamed tokens cannot change live status.
      default:
        return;
    }
    setVersion((current) => current + 1);
  }, []);

  const byChatId = useMemo(() => {
    const map = new Map<string, SessionDotRuntime>();
    for (const [chatId, entry] of flags.current) {
      map.set(chatId, {
        status: acpStatusFor(entry, pending.current.get(chatId)?.size ?? 0)
      });
    }
    return map;
    // `version` is the change signal for the refs above.
  }, [version]);

  return { ingest, byChatId };
}

function pendingFor(store: Map<string, Set<string>>, chatId: string): Set<string> {
  let set = store.get(chatId);
  if (!set) {
    set = new Set();
    store.set(chatId, set);
  }
  return set;
}
