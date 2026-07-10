import { DigestProgressCallback } from "./progress";
import { formatSessionForDigest } from "./prompts";
import { MemoryEntry, MemoryLevel } from "./schema";
import { listMemoryEntriesInRange } from "./store";

export interface BuildSourceContextOptions {
  dbPath: string;
  startMs: number;
  endMs: number;
  onProgress?: DigestProgressCallback;
  progressLevel?: "daily" | "weekly" | "monthly";
  progressPeriodLabel?: string;
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
  const { dbPath, startMs, endMs, onProgress, progressLevel, progressPeriodLabel } = options;

  const dailies = await listMemoryEntriesInRange(dbPath, {
    level: "daily",
    startMs,
    endMs,
    limit: 14
  });

  if (dailies.length) {
    onProgress?.({
      phase: "ensure_summaries",
      level: progressLevel || "weekly",
      periodLabel: progressPeriodLabel || "",
      message: `使用 ${dailies.length} 篇日报聚合周报`
    });
    const lines = dailies.map(
      (e, i) => `Daily ${i + 1}: ${e.title || e.id}\n${truncate(e.content, 4000)}`
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
    message: "本周无可用日报（将生成占位周报）"
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
  const { dbPath, startMs, endMs, onProgress, progressLevel, progressPeriodLabel } = options;

  // Month can have up to 31 dailies
  const dailies = await listMemoryEntriesInRange(dbPath, {
    level: "daily",
    startMs,
    endMs,
    limit: 40
  });

  if (dailies.length) {
    onProgress?.({
      phase: "ensure_summaries",
      level: progressLevel || "monthly",
      periodLabel: progressPeriodLabel || "",
      message: `使用本月 ${dailies.length} 篇日报聚合月报`
    });
    const lines = dailies.map(
      (e, i) => `Daily ${i + 1}: ${e.title || e.id}\n${truncate(e.content, 2500)}`
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
    message: "本月无可用日报（将生成占位月报）"
  });
  return {
    lines: ["(No daily digests available for this month.)"],
    sourceCount: 0,
    usedWeeklies: 0,
    usedDailies: 0
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[...truncated...]`;
}

export { formatSessionForDigest };
export type { MemoryEntry, MemoryLevel };
