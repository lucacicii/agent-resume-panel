import { digestIndex } from "./calendar";
import { DigestProgressCallback } from "./progress";
import { ReportProgressText } from "./progressI18n";
import { formatSessionForDigest } from "./prompts";
import { ReportEntry, ReportLevel } from "./schema";
import { listReportEntriesInRange } from "./store";

export interface BuildSourceContextOptions {
  dbPath: string;
  startMs: number;
  endMs: number;
  onProgress?: DigestProgressCallback;
  progressLevel?: "daily" | "weekly" | "monthly";
  progressPeriodLabel?: string;
  progressText?: ReportProgressText;
}

export interface WeeklySourceLinesResult {
  lines: string[];
  sourceCount: number;
  usedDailies: number;
}

export interface MonthlySourceLinesResult {
  lines: string[];
  sourceCount: number;
  usedWeeklies: number;
  usedDailies: number;
}

/** Aggregate weekly digest sources from daily digests only (after ensureDailies). */
export async function buildWeeklySourceLines(
  options: BuildSourceContextOptions
): Promise<WeeklySourceLinesResult> {
  const { dbPath, startMs, endMs, onProgress, progressLevel, progressPeriodLabel, progressText } =
    options;
  const pt = progressText ?? ((key: string) => key);

  const dailyRows = await listReportEntriesInRange(dbPath, {
    level: "daily",
    startMs,
    endMs,
    limit: 500
  });
  const dailies = [...digestIndex(dailyRows).values()];

  if (dailies.length) {
    onProgress?.({
      phase: "ensure_summaries",
      level: progressLevel || "weekly",
      periodLabel: progressPeriodLabel || "",
      message: pt("desktop.report.aggregateWeeklyFromDailies", dailies.length)
    });
    const lines = dailies.map(
      (e, i) => `Daily ${i + 1}: ${e.title || e.id}\n${e.content}`
    );
    return {
      lines,
      sourceCount: dailies.length,
      usedDailies: dailies.length
    };
  }

  onProgress?.({
    phase: "ensure_summaries",
    level: progressLevel || "weekly",
    periodLabel: progressPeriodLabel || "",
    message: pt("desktop.report.aggregateWeeklyPlaceholder")
  });
  return {
    lines: ["(No daily digests available for this week.)"],
    sourceCount: 0,
    usedDailies: 0
  };
}

/**
 * Aggregate monthly digest from **this month's daily digests only**.
 * Avoids ISO weeks that span two months (weeklies are not used).
 */
export async function buildMonthlySourceLines(
  options: BuildSourceContextOptions
): Promise<MonthlySourceLinesResult> {
  const { dbPath, startMs, endMs, onProgress, progressLevel, progressPeriodLabel, progressText } =
    options;
  const pt = progressText ?? ((key: string) => key);

  // Month can have up to 31 dailies
  const dailyRows = await listReportEntriesInRange(dbPath, {
    level: "daily",
    startMs,
    endMs,
    limit: 500
  });
  const dailies = [...digestIndex(dailyRows).values()];

  if (dailies.length) {
    onProgress?.({
      phase: "ensure_summaries",
      level: progressLevel || "monthly",
      periodLabel: progressPeriodLabel || "",
      message: pt("desktop.report.aggregateMonthlyFromDailies", dailies.length)
    });
    const lines = dailies.map(
      (e, i) => `Daily ${i + 1}: ${e.title || e.id}\n${e.content}`
    );
    return {
      lines,
      sourceCount: dailies.length,
      usedWeeklies: 0,
      usedDailies: dailies.length
    };
  }

  onProgress?.({
    phase: "ensure_summaries",
    level: progressLevel || "monthly",
    periodLabel: progressPeriodLabel || "",
    message: pt("desktop.report.aggregateMonthlyPlaceholder")
  });
  return {
    lines: ["(No daily digests available for this month.)"],
    sourceCount: 0,
    usedWeeklies: 0,
    usedDailies: 0
  };
}


export { formatSessionForDigest };
export type { ReportEntry, ReportLevel };