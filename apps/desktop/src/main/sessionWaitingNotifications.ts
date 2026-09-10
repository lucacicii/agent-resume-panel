import type { WorkbenchActiveSessionDot } from "../shared/workbenchSelection";

/** Stable identity for notification deduplication across renderer updates. */
export function waitingNotificationKey(dot: WorkbenchActiveSessionDot): string {
  return dot.sessionKey || dot.paneKey;
}

/**
 * Update episode keys in place and return sessions whose confirmed waiting
 * episode has just started. Weak TUI "possible" states never start an episode.
 */
export function collectNewConfirmedWaitingSessions(
  dots: readonly WorkbenchActiveSessionDot[],
  notifiedWaitingKeys: Set<string>
): WorkbenchActiveSessionDot[] {
  const confirmedWaitingKeys = new Set<string>();
  for (const dot of dots) {
    if (dot.status === "awaiting_user" && dot.awaitingConfidence === "confirmed") {
      confirmedWaitingKeys.add(waitingNotificationKey(dot));
    }
  }

  for (const key of notifiedWaitingKeys) {
    if (!confirmedWaitingKeys.has(key)) notifiedWaitingKeys.delete(key);
  }

  const newlyWaiting: WorkbenchActiveSessionDot[] = [];
  for (const dot of dots) {
    if (dot.status !== "awaiting_user" || dot.awaitingConfidence !== "confirmed") continue;
    const key = waitingNotificationKey(dot);
    if (notifiedWaitingKeys.has(key)) continue;
    notifiedWaitingKeys.add(key);
    newlyWaiting.push(dot);
  }
  return newlyWaiting;
}
