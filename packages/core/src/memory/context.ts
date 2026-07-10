import { listSessionsInRange } from "../catalog/query";
import { ensureSummariesForSessions } from "../session/ensureSummaries";
import { PanelSettings } from "../settings/types";
import { DigestProgressCallback } from "./progress";
import { formatSessionForDigest } from "./prompts";
import { MemoryEntry, MemoryLevel } from "./schema";
import { listMemoryEntriesInRange } from "./store";

export interface BuildSourceContextOptions {
  dbPath: string;
  settings: PanelSettings;
  startMs: number;
  endMs: number;
  maxSessions?: number;
  panelHome?: string;
  forceResummarize?: boolean;
  jobKeyPrefix?: string;
  onProgress?: DigestProgressCallback;
  progressLevel?: "daily" | "weekly" | "monthly";
  progressPeriodLabel?: string;
}

export interface WeeklySourceLinesResult {
  lines: string[];
  sourceCount: number;
  usedDailies: number;
  summarizedCount: number;
  summarySkippedCount: number;
  summaryFailed: Array<{ key: string; error: string }>;
}

export interface MonthlySourceLinesResult {
  lines: string[];
  sourceCount: number;
  usedWeeklies: number;
  usedDailies: number;
  summarizedCount: number;
  summarySkippedCount: number;
  summaryFailed: Array<{ key: string; error: string }>;
}

export async function buildWeeklySourceLines(
  options: BuildSourceContextOptions
): Promise<WeeklySourceLinesResult> {
  const {
    dbPath,
    settings,
    startMs,
    endMs,
    maxSessions = 40,
    panelHome,
    forceResummarize,
    jobKeyPrefix,
    onProgress,
    progressLevel,
    progressPeriodLabel
  } = options;

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
      message: `使用已有 ${dailies.length} 篇日报聚合（无需 re-summarize sessions）`
    });
    const lines = dailies.map(
      (e, i) => `Daily ${i + 1}: ${e.title || e.id}\n${truncate(e.content, 4000)}`
    );
    return {
      lines,
      sourceCount: dailies.length,
      usedDailies: dailies.length,
      summarizedCount: 0,
      summarySkippedCount: 0,
      summaryFailed: []
    };
  }

  const rawSessions = await listSessionsInRange(dbPath, startMs, endMs, maxSessions);
  const ensure = await ensureSummariesForSessions({
    dbPath,
    sessions: rawSessions,
    settings,
    panelHome,
    force: forceResummarize,
    jobKeyPrefix: jobKeyPrefix || "summarize:weekly",
    onProgress,
    progressLevel: progressLevel || "weekly",
    progressPeriodLabel
  });

  const lines = ensure.sessions.map((s) =>
    formatSessionForDigest({
      provider: s.provider,
      title: s.title,
      projectPath: s.projectPath,
      summary: s.sessionSummary,
      updatedAt: s.updatedAt
    })
  );
  return {
    lines,
    sourceCount: ensure.sessions.length,
    usedDailies: 0,
    summarizedCount: ensure.summarized,
    summarySkippedCount: ensure.skipped,
    summaryFailed: ensure.failed
  };
}

export async function buildMonthlySourceLines(
  options: BuildSourceContextOptions
): Promise<MonthlySourceLinesResult> {
  const {
    dbPath,
    settings,
    startMs,
    endMs,
    maxSessions = 40,
    panelHome,
    forceResummarize,
    jobKeyPrefix,
    onProgress,
    progressLevel,
    progressPeriodLabel
  } = options;

  const weeklies = await listMemoryEntriesInRange(dbPath, {
    level: "weekly",
    startMs,
    endMs,
    limit: 8
  });

  if (weeklies.length) {
    onProgress?.({
      phase: "ensure_summaries",
      level: progressLevel || "monthly",
      periodLabel: progressPeriodLabel || "",
      message: `使用已有 ${weeklies.length} 篇周报聚合`
    });
    const lines = weeklies.map(
      (e, i) => `Weekly ${i + 1}: ${e.title || e.id}\n${truncate(e.content, 5000)}`
    );
    return {
      lines,
      sourceCount: weeklies.length,
      usedWeeklies: weeklies.length,
      usedDailies: 0,
      summarizedCount: 0,
      summarySkippedCount: 0,
      summaryFailed: []
    };
  }

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
      message: `使用已有 ${dailies.length} 篇日报聚合`
    });
    const lines = dailies.map(
      (e, i) => `Daily ${i + 1}: ${e.title || e.id}\n${truncate(e.content, 2500)}`
    );
    return {
      lines,
      sourceCount: dailies.length,
      usedWeeklies: 0,
      usedDailies: dailies.length,
      summarizedCount: 0,
      summarySkippedCount: 0,
      summaryFailed: []
    };
  }

  const rawSessions = await listSessionsInRange(dbPath, startMs, endMs, maxSessions);
  const ensure = await ensureSummariesForSessions({
    dbPath,
    sessions: rawSessions,
    settings,
    panelHome,
    force: forceResummarize,
    jobKeyPrefix: jobKeyPrefix || "summarize:monthly",
    onProgress,
    progressLevel: progressLevel || "monthly",
    progressPeriodLabel
  });

  const lines = ensure.sessions.map((s) =>
    formatSessionForDigest({
      provider: s.provider,
      title: s.title,
      projectPath: s.projectPath,
      summary: s.sessionSummary,
      updatedAt: s.updatedAt
    })
  );
  return {
    lines,
    sourceCount: ensure.sessions.length,
    usedWeeklies: 0,
    usedDailies: 0,
    summarizedCount: ensure.summarized,
    summarySkippedCount: ensure.skipped,
    summaryFailed: ensure.failed
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[...truncated...]`;
}

export type { MemoryEntry, MemoryLevel };
