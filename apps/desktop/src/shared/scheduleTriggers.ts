/**
 * Trigger arithmetic for Thunder schedules.
 *
 * Kept pure and Electron-free so it can be unit-tested without a database, a
 * panel, or a daemon — the same reason `daemonResolver.ts` is a pure function.
 *
 * `cron` is parsed by `croner` rather than approximated. Before this module the
 * cron branch returned `now + 1h` unconditionally (with a comment admitting it),
 * so a schedule the user wrote as `0 9 * * 1-5` silently fired hourly. A cron
 * field that only *looks* honoured is worse than no cron field, so the parse
 * either produces a real instant or an explicit error the caller can surface.
 */

import { Cron } from "croner";
import type { ScheduleTriggerType } from "@agent-resume/core";

/** How the scheduler behaves about trigger points it was not awake for. */
export type CatchUpPolicy = "skip" | "once" | "all";

export interface CronParseResult {
  ok: boolean;
  /** Present when `ok` is false: a message meant for the schedule editor. */
  error?: string;
}

/**
 * Validate a cron expression without running it.
 *
 * `croner` throws on malformed patterns; we convert that into a value so the
 * editor can show the error inline instead of the scheduler discovering it 30
 * seconds later at firing time.
 */
export function validateCron(expression: string): CronParseResult {
  const trimmed = (expression ?? "").trim();
  if (!trimmed) return { ok: false, error: "Cron expression is empty" };
  try {
    // `paused` keeps it from scheduling anything — this is a parse check only.
    const job = new Cron(trimmed, { paused: true });
    // A pattern that parses but can never fire (e.g. `0 0 30 2 *`) yields no
    // next run; treating that as valid would create a schedule that is silently
    // dead forever.
    const next = job.nextRun(new Date());
    if (!next) {
      return { ok: false, error: "Cron expression never matches a future time" };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

function intervalMs(triggerValue: string): number {
  // Value can be bare minutes ("15", "30", "60") or suffixed ("15m", "1h", "1d").
  const val = (triggerValue ?? "").trim().toLowerCase();
  let minutes: number;
  if (val.endsWith("m")) minutes = parseInt(val, 10) || 60;
  else if (val.endsWith("h")) minutes = (parseInt(val, 10) || 1) * 60;
  else if (val.endsWith("d")) minutes = (parseInt(val, 10) || 1) * 1440;
  else minutes = parseInt(val, 10) || 60;

  if (!Number.isFinite(minutes) || minutes < 1) minutes = 1;
  return minutes * 60_000;
}

function nextDaily(triggerValue: string, fromTimeMs: number): number {
  const parts = (triggerValue ?? "").split(":");
  const hour = Math.min(23, Math.max(0, parseInt(parts[0] || "9", 10) || 0));
  const min = Math.min(59, Math.max(0, parseInt(parts[1] || "0", 10) || 0));

  const target = new Date(fromTimeMs);
  target.setHours(hour, min, 0, 0);
  if (target.getTime() <= fromTimeMs) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

function nextCron(triggerValue: string, fromTimeMs: number): number | undefined {
  const trimmed = (triggerValue ?? "").trim();
  if (!trimmed) return undefined;
  try {
    const job = new Cron(trimmed, { paused: true });
    const next = job.nextRun(new Date(fromTimeMs));
    return next ? next.getTime() : undefined;
  } catch {
    // An unparseable expression has no next run. Callers surface this through
    // `validateCron` at save time; here we simply refuse to invent one.
    return undefined;
  }
}

/**
 * Calculate the next run timestamp based on trigger type and value.
 *
 * Returns `undefined` when there is no next run — a manual schedule, or a cron
 * expression that does not parse. It never guesses an interval.
 */
export function computeNextRun(
  triggerType: ScheduleTriggerType,
  triggerValue: string,
  fromTimeMs = Date.now()
): number | undefined {
  switch (triggerType) {
    case "manual":
      return undefined;
    case "interval":
      return fromTimeMs + intervalMs(triggerValue);
    case "daily":
      return nextDaily(triggerValue, fromTimeMs);
    case "cron":
      return nextCron(triggerValue, fromTimeMs);
    default:
      return undefined;
  }
}

/**
 * Every trigger point in `(afterMs, untilMs]`, oldest first.
 *
 * This is what a catch-up decision needs: "while the panel was closed, how many
 * times did this schedule come due?" `computeNextRun` cannot answer it, because
 * it only walks forward from *now* and so silently forgives every missed point.
 *
 * Bounded by `limit` so a `* * * * *` schedule that slept for a month cannot
 * allocate a million timestamps; the caller decides what to do when the window
 * is truncated.
 */
export function enumerateMissedRuns(
  triggerType: ScheduleTriggerType,
  triggerValue: string,
  afterMs: number,
  untilMs: number,
  limit = 100
): number[] {
  if (untilMs <= afterMs) return [];
  const results: number[] = [];

  if (triggerType === "interval") {
    const step = intervalMs(triggerValue);
    // The first trigger strictly after `afterMs`. `computeNextRun` was called
    // with `afterMs` when the schedule last advanced, so this restores the
    // exact chain of points that would have fired.
    let t = afterMs + step;
    while (t <= untilMs && results.length < limit) {
      results.push(t);
      t += step;
    }
    return results;
  }

  if (triggerType === "cron") {
    const trimmed = (triggerValue ?? "").trim();
    if (!trimmed) return [];
    let job: Cron;
    try {
      job = new Cron(trimmed, { paused: true });
    } catch {
      return [];
    }
    let cursor = afterMs;
    while (results.length < limit) {
      const next = job.nextRun(new Date(cursor));
      if (!next) break;
      const ms = next.getTime();
      if (ms > untilMs) break;
      // Guard against a parser that returns a non-advancing instant, which
      // would spin forever instead of terminating the walk.
      if (ms <= cursor) break;
      results.push(ms);
      cursor = ms;
    }
    return results;
  }

  if (triggerType === "daily") {
    let t = nextDaily(triggerValue, afterMs);
    while (t <= untilMs && results.length < limit) {
      results.push(t);
      const d = new Date(t);
      d.setDate(d.getDate() + 1);
      t = d.getTime();
    }
    return results;
  }

  return [];
}

/**
 * Reduce the missed trigger points to the ones that should actually run.
 *
 * - `skip` — none: an overdue inspection is stale, not pending.
 * - `once` — only the most recent, so "one per period" schedules stay honest
 *   without replaying a week of history.
 * - `all`  — every point, for idempotent work.
 */
export function selectCatchUpRuns(missed: number[], policy: CatchUpPolicy): number[] {
  if (missed.length === 0) return [];
  switch (policy) {
    case "skip":
      return [];
    case "once":
      return [missed[missed.length - 1]];
    case "all":
      return missed;
    default:
      return [];
  }
}
