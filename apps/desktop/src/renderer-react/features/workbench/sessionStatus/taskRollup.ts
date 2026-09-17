/**
 * Task live-status rollup — the layer above session dots.
 *
 * Pure functions only: no React, no hooks. Consumers import this file by path;
 * it is not re-exported from `sessionStatus/index.ts`.
 *
 * `rank()` packs live urgency and recency into one number:
 *   (dot ? LIVE_RANK[dot.status] : 0) * 1e15 + updatedAtMs
 * so a descending numeric sort equals (live rank desc, updatedAtMs desc).
 *
 * The `1e15` factor assumes `updatedAtMs` is a millisecond timestamp strictly
 * less than `1e15`. Under that premise, rank always dominates recency and the
 * packed value stays a precise integer.
 */

import type { ActiveSessionDot } from "../activeSessionDots";
import type { SessionDotStatus } from "./types";

/** Urgency order for a task's rolled-up live status. */
export const LIVE_RANK: Record<SessionDotStatus, number> = {
  awaiting_user: 4,
  error: 3,
  connecting: 2,
  running: 1,
  open: 0
};

type RollupItem = {
  work: { sessions?: readonly string[] };
};

type RankItem = RollupItem & { updatedAtMs: number };

/** Highest-urgency live dot among a task's bound sessions. */
export function rollupDot(
  item: RollupItem,
  byKey: ReadonlyMap<string, ActiveSessionDot>
): ActiveSessionDot | undefined {
  let best: ActiveSessionDot | undefined;
  for (const key of item.work.sessions ?? []) {
    const dot = byKey.get(key);
    if (dot && (!best || LIVE_RANK[dot.status] > LIVE_RANK[best.status])) best = dot;
  }
  return best;
}

/**
 * Packed sort key: live rank in the `1e15` place, `updatedAtMs` in the low
 * places. `updatedAtMs` must be milliseconds and `< 1e15`.
 */
export function rank(item: RankItem, byKey: ReadonlyMap<string, ActiveSessionDot>): number {
  const dot = rollupDot(item, byKey);
  return (dot ? LIVE_RANK[dot.status] : 0) * 1e15 + item.updatedAtMs;
}

/** `needs_you` — the task has a live session waiting on the user. */
export function needsYou(dot: ActiveSessionDot | undefined): boolean {
  return dot?.status === "awaiting_user";
}
