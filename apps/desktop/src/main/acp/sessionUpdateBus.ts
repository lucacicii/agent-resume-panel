import type { SessionUpdatePayload } from "./types";

type SessionUpdateListener = (payload: SessionUpdatePayload) => void;

const listenersBySession = new Map<string, Set<SessionUpdateListener>>();
const latestAvailableCommandsBySession = new Map<string, SessionUpdatePayload>();

export function subscribeSessionUpdates(sessionId: string, listener: SessionUpdateListener): () => void {
  const bucket = listenersBySession.get(sessionId) ?? new Set();
  bucket.add(listener);
  listenersBySession.set(sessionId, bucket);
  const availableCommands = latestAvailableCommandsBySession.get(sessionId);
  if (availableCommands) listener(availableCommands);
  return () => {
    bucket.delete(listener);
    if (!bucket.size) {
      listenersBySession.delete(sessionId);
    }
  };
}

export function publishSessionUpdate(payload: SessionUpdatePayload): void {
  if (payload.update.sessionUpdate === "available_commands_update") {
    latestAvailableCommandsBySession.set(payload.sessionId, payload);
  }
  const listeners = listenersBySession.get(payload.sessionId);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(payload);
  }
}

export function clearSessionUpdateListeners(sessionId: string): void {
  listenersBySession.delete(sessionId);
  latestAvailableCommandsBySession.delete(sessionId);
}

export function clearAllSessionUpdateListeners(): void {
  listenersBySession.clear();
  latestAvailableCommandsBySession.clear();
}
