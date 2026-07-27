import type { SessionUpdatePayload } from "./types";

type SessionUpdateListener = (payload: SessionUpdatePayload) => void;

const listenersBySession = new Map<string, Set<SessionUpdateListener>>();

export function subscribeSessionUpdates(sessionId: string, listener: SessionUpdateListener): () => void {
  const bucket = listenersBySession.get(sessionId) ?? new Set();
  bucket.add(listener);
  listenersBySession.set(sessionId, bucket);
  return () => {
    bucket.delete(listener);
    if (!bucket.size) {
      listenersBySession.delete(sessionId);
    }
  };
}

export function publishSessionUpdate(payload: SessionUpdatePayload): void {
  const listeners = listenersBySession.get(payload.sessionId);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(payload);
  }
}

export function clearSessionUpdateListeners(sessionId: string): void {
  listenersBySession.delete(sessionId);
}

export function clearAllSessionUpdateListeners(): void {
  listenersBySession.clear();
}
