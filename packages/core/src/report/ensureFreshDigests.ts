import { needsDailyDigestRefresh } from "./daily";
import { needsWeeklyDigestRefresh } from "./digestRefresh";
import { runDailyDigest } from "./daily";
import { runWeeklyDigest } from "./weekly";
import { listDayLabelsInRange, listWeekLabelsInRange } from "./period";
import { DigestProgressCallback } from "./progress";
import type { EnsureLevelStats } from "./ensureDailies";
import { listSessionsInRange } from "../catalog/query";
import { localDayRange } from "./period";

function emptyStats(): EnsureLevelStats {
  return { planned: [], ok: [], skipped: [], failed: [] };
}

function digestNeedsRefresh(check: {
  needed: boolean;
  reason: string;
}): boolean {
  return check.needed && check.reason !== "no_sessions";
}

export interface EnsureFreshDigestsOptions {
  catalogDb: string;
  desktopDb: string;
  startMs: number;
  endMs: number;
  panelHome?: string;
  skipEmbedding?: boolean;
  forceResummarize?: boolean;
  /** Regenerate all session days in range, not only stale/missing. */
  forceRefresh?: boolean;
  onProgress?: DigestProgressCallback;
  progressLevel?: "daily" | "weekly" | "monthly";
  progressPeriodLabel?: string;
}

/**
 * Refresh missing or stale daily digests in [startMs, endMs) one by one.
 */
export async function ensureFreshDailiesForPeriod(
  options: EnsureFreshDigestsOptions
): Promise<EnsureLevelStats> {
  const stats = emptyStats();
  const days = listDayLabelsInRange(options.startMs, options.endMs);
  const candidates: string[] = [];

  for (const day of days) {
    if (options.forceRefresh) {
      const range = localDayRange(day);
      const sessions = await listSessionsInRange(
        options.catalogDb,
        range.startMs,
        range.endMs,
        1
      );
      if (sessions.length) {
        candidates.push(day);
      } else {
        stats.skipped.push(day);
      }
      continue;
    }

    const check = await needsDailyDigestRefresh({
      panelHome: options.panelHome,
      date: day
    });
    if (digestNeedsRefresh(check)) {
      candidates.push(day);
    } else {
      stats.skipped.push(day);
    }
  }

  stats.planned = [...candidates];
  const total = candidates.length;
  const parentLevel = options.progressLevel || "weekly";
  const parentLabel = options.progressPeriodLabel || "";
  const scopeHint =
    parentLevel === "monthly" ? "本月" : parentLevel === "weekly" ? "本周" : "本期";

  if (!total) {
    options.onProgress?.({
      phase: "ensure_summaries",
      level: parentLevel,
      periodLabel: parentLabel,
      message: `${scopeHint}日报已是最新`,
      index: 0,
      total: 0
    });
    return stats;
  }

  options.onProgress?.({
    phase: "ensure_summaries",
    level: parentLevel,
    periodLabel: parentLabel,
    message: `先更新${scopeHint}待刷新日报 · 共 ${total} 天…`,
    index: 0,
    total
  });

  let i = 0;
  for (const day of candidates) {
    i += 1;
    options.onProgress?.({
      phase: "ensure_summaries",
      level: parentLevel,
      periodLabel: parentLabel,
      dayKey: day,
      message: `更新日报 ${i}/${total} · ${day}`,
      index: i,
      total
    });
    try {
      await runDailyDigest({
        panelHome: options.panelHome,
        date: day,
        skipEmbedding: options.skipEmbedding,
        forceResummarize: options.forceResummarize,
        onProgress: (ev) => {
          options.onProgress?.({
            ...ev,
            level: parentLevel,
            periodLabel: parentLabel,
            dayKey: day,
            message: ev.message ? `日报 ${day} · ${ev.message}` : `日报 ${day}`
          });
        }
      });
      stats.ok.push(day);
    } catch (error) {
      stats.failed.push({
        key: day,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return stats;
}

/**
 * Refresh stale weekly digests overlapping [startMs, endMs) before monthly aggregation.
 * Each weekly run will refresh its own stale dailies first.
 */
export async function ensureFreshWeekliesForPeriod(
  options: EnsureFreshDigestsOptions
): Promise<EnsureLevelStats> {
  const stats = emptyStats();
  const weeks = listWeekLabelsInRange(options.startMs, options.endMs);
  const candidates: string[] = [];

  for (const week of weeks) {
    if (options.forceRefresh) {
      candidates.push(week);
      continue;
    }
    const check = await needsWeeklyDigestRefresh({
      panelHome: options.panelHome,
      weekKey: week
    });
    if (digestNeedsRefresh(check)) {
      candidates.push(week);
    } else {
      stats.skipped.push(week);
    }
  }

  stats.planned = [...candidates];
  const total = candidates.length;
  const parentLabel = options.progressPeriodLabel || "";

  if (!total) {
    options.onProgress?.({
      phase: "ensure_summaries",
      level: "monthly",
      periodLabel: parentLabel,
      message: "本月周报已是最新",
      index: 0,
      total: 0
    });
    return stats;
  }

  options.onProgress?.({
    phase: "ensure_summaries",
    level: "monthly",
    periodLabel: parentLabel,
    message: `先更新本月待刷新周报 · 共 ${total} 周…`,
    index: 0,
    total
  });

  let i = 0;
  for (const week of candidates) {
    i += 1;
    options.onProgress?.({
      phase: "ensure_summaries",
      level: "monthly",
      periodLabel: parentLabel,
      message: `更新周报 ${i}/${total} · ${week}`,
      index: i,
      total
    });
    try {
      await runWeeklyDigest({
        panelHome: options.panelHome,
        weekKey: week,
        skipEmbedding: options.skipEmbedding,
        forceResummarize: options.forceResummarize,
        forceEnsureLower: options.forceRefresh,
        onProgress: (ev) => {
          options.onProgress?.({
            ...ev,
            level: "monthly",
            periodLabel: parentLabel,
            message: ev.message ? `周报 ${week} · ${ev.message}` : `周报 ${week}`
          });
        }
      });
      stats.ok.push(week);
    } catch (error) {
      stats.failed.push({
        key: week,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return stats;
}