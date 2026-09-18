/**
 * Share identical, concurrent git queries between windows.
 *
 * Git status and the periodic fetch are polled per window, and several windows
 * commonly show the same repository — a shared file watch now fans one change
 * out to all of them at the same instant, so they ask for the same answer at the
 * same time. The query runs once and every waiter gets that result.
 *
 * Entries live only while the query is running, so nothing is ever served from a
 * cache: a request that arrives after the query settled starts its own, and a
 * mutation can never be masked by an older answer.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function shareGitQuery<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  let promise: Promise<T>;
  promise = run().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/** Only for tests: the map is process-wide state. */
export function resetSharedGitQueries(): void {
  inFlight.clear();
}
