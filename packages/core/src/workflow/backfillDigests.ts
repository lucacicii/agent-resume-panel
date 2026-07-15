import { ensureCatalogSchema } from "../catalog/db";
import { runDailyDigest } from "../report/daily";
import { runMonthlyDigest } from "../report/monthly";
import { localDayRange, localMonthRange, localWeekRange } from "../report/period";
import { getReportJobStatus } from "../report/store";
import { runWeeklyDigest } from "../report/weekly";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { runSqliteJson } from "../sqlite";

export interface BackfillReportDigestsOptions {
  panelHome?: string;
  /** Skip periods that already have job status ok. Default true. */
  skipExisting?: boolean;
  /** Skip embedding API on generate (faster / cheaper for bulk). Default true. */
  skipEmbedding?: boolean;
  /** Max number of calendar days to process (oldest truncated). Default 400. */
  maxDays?: number;
  /** Only days with at least this many sessions. Default 1. */
  minSessionsPerDay?: number;
}

export interface BackfillLevelStats {
  planned: string[];
  ok: string[];
  skipped: string[];
  failed: Array<{ key: string; error: string }>;
}

export interface BackfillReportDigestsResult {
  daily: BackfillLevelStats;
  weekly: BackfillLevelStats;
  monthly: BackfillLevelStats;
  sessionRowsScanned: number;
}

interface SessionTimeRow {
  updated_at_ms: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar date YYYY-MM-DD from epoch ms. */
export function localDateKeyFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Scan catalog sessions and collect unique local days / ISO weeks / months that have activity.
 */
export async function listActivityPeriods(
  dbPath: string,
  options?: { maxDays?: number; minSessionsPerDay?: number }
): Promise<{
  days: string[];
  weeks: string[];
  months: string[];
  sessionRowsScanned: number;
  daySessionCounts: Record<string, number>;
}> {
  const rows = await runSqliteJson<SessionTimeRow>(
    dbPath,
    `SELECT updated_at_ms FROM sessions WHERE hidden = 0 AND updated_at_ms > 0;`
  );

  const dayCounts: Record<string, number> = {};
  for (const row of rows) {
    const key = localDateKeyFromMs(row.updated_at_ms);
    dayCounts[key] = (dayCounts[key] || 0) + 1;
  }

  const minSessions = Math.max(1, options?.minSessionsPerDay ?? 1);
  let days = Object.keys(dayCounts)
    .filter((d) => dayCounts[d] >= minSessions)
    .sort(); // ascending chronological

  const maxDays = Math.max(1, Math.min(options?.maxDays ?? 400, 2000));
  if (days.length > maxDays) {
    // keep most recent maxDays
    days = days.slice(days.length - maxDays);
  }

  const weekSet = new Set<string>();
  const monthSet = new Set<string>();
  for (const day of days) {
    const [y, m, d] = day.split("-").map(Number);
    const date = new Date(y, m - 1, d, 12, 0, 0, 0);
    weekSet.add(localWeekRange(date).label);
    monthSet.add(localMonthRange(date).label);
  }

  return {
    days,
    weeks: [...weekSet].sort(),
    months: [...monthSet].sort(),
    sessionRowsScanned: rows.length,
    daySessionCounts: dayCounts
  };
}

async function shouldSkip(dbPath: string, jobKey: string, skipExisting: boolean): Promise<boolean> {
  if (!skipExisting) {
    return false;
  }
  const status = await getReportJobStatus(dbPath, jobKey);
  return status?.status === "ok";
}

function emptyStats(planned: string[]): BackfillLevelStats {
  return { planned, ok: [], skipped: [], failed: [] };
}

/**
 * Batch-generate daily → weekly → monthly digests for all (or recent) session activity days.
 * Order matters: weeklies prefer dailies; monthlies prefer weeklies.
 */
export async function backfillReportDigests(
  options: BackfillReportDigestsOptions = {}
): Promise<BackfillReportDigestsResult> {
  const settings = await loadSettings(options.panelHome);
  const panelHome = options.panelHome
    ? resolvePanelHome(options.panelHome)
    : effectivePanelHome(settings, options.panelHome);
  const dbPath = options.panelHome
    ? catalogDbPath(panelHome)
    : catalogDbFromSettings(settings, options.panelHome);

  await ensureCatalogSchema(dbPath);

  const skipExisting = options.skipExisting !== false;
  const skipEmbedding = options.skipEmbedding !== false;

  const activity = await listActivityPeriods(dbPath, {
    maxDays: options.maxDays,
    minSessionsPerDay: options.minSessionsPerDay
  });

  const daily = emptyStats(activity.days);
  const weekly = emptyStats(activity.weeks);
  const monthly = emptyStats(activity.months);

  // 1) Dailies chronological
  for (const day of activity.days) {
    const period = localDayRange(day);
    try {
      if (await shouldSkip(dbPath, period.jobKey, skipExisting)) {
        daily.skipped.push(day);
        continue;
      }
      await runDailyDigest({
        panelHome,
        date: day,
        skipEmbedding,
        includeTranscripts: false // bulk: title/summary only to control cost/time
      });
      daily.ok.push(day);
    } catch (error) {
      daily.failed.push({
        key: day,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // 2) Weeklies
  for (const week of activity.weeks) {
    const period = localWeekRange(week);
    try {
      if (await shouldSkip(dbPath, period.jobKey, skipExisting)) {
        weekly.skipped.push(week);
        continue;
      }
      await runWeeklyDigest({
        panelHome,
        weekKey: week,
        skipEmbedding
      });
      weekly.ok.push(week);
    } catch (error) {
      weekly.failed.push({
        key: week,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // 3) Monthlies
  for (const month of activity.months) {
    const period = localMonthRange(month);
    try {
      if (await shouldSkip(dbPath, period.jobKey, skipExisting)) {
        monthly.skipped.push(month);
        continue;
      }
      await runMonthlyDigest({
        panelHome,
        monthKey: month,
        skipEmbedding
      });
      monthly.ok.push(month);
    } catch (error) {
      monthly.failed.push({
        key: month,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    daily,
    weekly,
    monthly,
    sessionRowsScanned: activity.sessionRowsScanned
  };
}

/** Preview only: periods that would be processed. */
export async function previewBackfillReportDigests(
  options: BackfillReportDigestsOptions = {}
): Promise<{
  days: string[];
  weeks: string[];
  months: string[];
  sessionRowsScanned: number;
  estimatedLlmCalls: number;
}> {
  const settings = await loadSettings(options.panelHome);
  const panelHome = options.panelHome
    ? resolvePanelHome(options.panelHome)
    : effectivePanelHome(settings, options.panelHome);
  const dbPath = options.panelHome
    ? catalogDbPath(panelHome)
    : catalogDbFromSettings(settings, options.panelHome);

  await ensureCatalogSchema(dbPath);
  const activity = await listActivityPeriods(dbPath, {
    maxDays: options.maxDays,
    minSessionsPerDay: options.minSessionsPerDay
  });

  const skipExisting = options.skipExisting !== false;
  let dayCalls = 0;
  let weekCalls = 0;
  let monthCalls = 0;

  for (const day of activity.days) {
    if (!(await shouldSkip(dbPath, localDayRange(day).jobKey, skipExisting))) {
      dayCalls += 1;
    }
  }
  for (const week of activity.weeks) {
    if (!(await shouldSkip(dbPath, localWeekRange(week).jobKey, skipExisting))) {
      weekCalls += 1;
    }
  }
  for (const month of activity.months) {
    if (!(await shouldSkip(dbPath, localMonthRange(month).jobKey, skipExisting))) {
      monthCalls += 1;
    }
  }

  return {
    days: activity.days,
    weeks: activity.weeks,
    months: activity.months,
    sessionRowsScanned: activity.sessionRowsScanned,
    estimatedLlmCalls: dayCalls + weekCalls + monthCalls
  };
}
