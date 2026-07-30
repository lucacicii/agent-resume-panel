import { loadSettings } from "../settings/store";
import { evaluateDailyDigestRefresh } from "./daily";
import { needsWeeklyDigestRefresh } from "./digestRefresh";
import { runDailyDigest } from "./daily";
import { runWeeklyDigest } from "./weekly";
import { listDayLabelsInRange, listWeekLabelsInRange } from "./period";
import {
  createReportProgressText,
  freshDailiesRefreshKey,
  freshDailiesUpToDateKey,
  resolveReportScope
} from "./progressI18n";
import { DigestProgressCallback } from "./progress";
import type { EnsureLevelStats } from "./ensureDailies";
import type { DigestRunTrigger } from "./digestBudget";
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
  systemLocale?: string;
  allowOverBudget?: boolean;
  trigger?: DigestRunTrigger;
}

/**
 * Refresh missing or stale daily digests in [startMs, endMs) one by one.
 */
export async function ensureFreshDailiesForPeriod(
  options: EnsureFreshDigestsOptions
): Promise<EnsureLevelStats> {
  const settings = await loadSettings(options.panelHome);
  const pt = createReportProgressText(settings, options.systemLocale);
  const scope = resolveReportScope(options.progressLevel);

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

    const check = await evaluateDailyDigestRefresh({
      settings,
      catalogDb: options.catalogDb,
      desktopDb: options.desktopDb,
      date: day,
      systemLocale: options.systemLocale
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

  if (!total) {
    options.onProgress?.({
      phase: "ensure_summaries",
      level: parentLevel,
      periodLabel: parentLabel,
      message: pt(freshDailiesUpToDateKey(scope)),
      index: 0,
      total: 0
    });
    return stats;
  }

  options.onProgress?.({
    phase: "ensure_summaries",
    level: parentLevel,
    periodLabel: parentLabel,
    message: pt(freshDailiesRefreshKey(scope), total),
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
      message: pt("desktop.report.freshDailiesUpdateProgress", i, total, day),
      index: i,
      total
    });
    try {
      await runDailyDigest({
        panelHome: options.panelHome,
        date: day,
        skipEmbedding: options.skipEmbedding,
        forceResummarize: options.forceResummarize,
        systemLocale: options.systemLocale,
        allowOverBudget: options.allowOverBudget,
        trigger: options.trigger,
        onProgress: (ev) => {
          options.onProgress?.({
            ...ev,
            level: parentLevel,
            periodLabel: parentLabel,
            dayKey: day,
            message: ev.message
              ? pt("desktop.report.nestedDailyDetail", day, ev.message)
              : pt("desktop.report.nestedDailyLabel", day)
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
  const settings = await loadSettings(options.panelHome);
  const pt = createReportProgressText(settings, options.systemLocale);

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
      weekKey: week,
      systemLocale: options.systemLocale
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
      message: pt("desktop.report.freshWeekliesUpToDateMonth"),
      index: 0,
      total: 0
    });
    return stats;
  }

  options.onProgress?.({
    phase: "ensure_summaries",
    level: "monthly",
    periodLabel: parentLabel,
    message: pt("desktop.report.freshWeekliesRefreshMonth", total),
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
      message: pt("desktop.report.freshWeekliesUpdateProgress", i, total, week),
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
        systemLocale: options.systemLocale,
        allowOverBudget: options.allowOverBudget,
        trigger: options.trigger,
        onProgress: (ev) => {
          options.onProgress?.({
            ...ev,
            level: "monthly",
            periodLabel: parentLabel,
            message: ev.message
              ? pt("desktop.report.nestedWeeklyDetail", week, ev.message)
              : pt("desktop.report.nestedWeeklyLabel", week)
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