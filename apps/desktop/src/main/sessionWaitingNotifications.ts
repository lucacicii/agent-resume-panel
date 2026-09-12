import type { WorkbenchActiveSessionDot } from "../shared/workbenchSelection";

/** Stable identity for notification deduplication across renderer updates. */
export function waitingNotificationKey(dot: WorkbenchActiveSessionDot): string {
  return dot.sessionKey || dot.paneKey;
}

/**
 * Update episode keys in place and return sessions that have just started
 * waiting for the user.
 *
 * The daemon only reports `blocked` on evidence it trusts, so every
 * `awaiting_user` dot is worth an episode — there is no weak tier left to
 * filter out.
 */
export function collectNewConfirmedWaitingSessions(
  dots: readonly WorkbenchActiveSessionDot[],
  notifiedWaitingKeys: Set<string>
): WorkbenchActiveSessionDot[] {
  const waitingKeys = new Set<string>();
  for (const dot of dots) {
    if (dot.status === "awaiting_user") waitingKeys.add(waitingNotificationKey(dot));
  }

  for (const key of notifiedWaitingKeys) {
    if (!waitingKeys.has(key)) notifiedWaitingKeys.delete(key);
  }

  const newlyWaiting: WorkbenchActiveSessionDot[] = [];
  for (const dot of dots) {
    if (dot.status !== "awaiting_user") continue;
    const key = waitingNotificationKey(dot);
    if (notifiedWaitingKeys.has(key)) continue;
    notifiedWaitingKeys.add(key);
    newlyWaiting.push(dot);
  }
  return newlyWaiting;
}
