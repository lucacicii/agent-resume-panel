import { listSessionsInRange } from "../catalog/query";
import { localWeekRange, listWeekLabelsInRange } from "./period";
import { DigestProgressCallback } from "./progress";
import { getReportEntryById } from "./store";
import { runWeeklyDigest } from "./weekly";
import { EnsureLevelStats } from "./ensureDailies";

export interface EnsureWeekliesOptions {
  catalogDb: string;
  desktopDb: string;
  startMs: number;
  endMs: number;
  panelHome?: string;
  skipExisting?: boolean;
  skipEmbedding?: boolean;
  forceResummarize?: boolean;
  /** Only weeks with at least one catalog session. Default true. */
  onlyWithSessions?: boolean;
  onProgress?: DigestProgressCallback;
  progressPeriodLabel?: string;
}

/**
 * Ensure weekly digests exist for ISO weeks covering [startMs, endMs).
 * Each weekly run cascades to ensure its dailies first.
 */
export async function ensureWeekliesForPeriod(
  options: EnsureWeekliesOptions
): Promise<EnsureLevelStats> {
  const skipExisting = options.skipExisting !== false;
  const onlyWithSessions = options.onlyWithSessions !== false;
  const weeks = listWeekLabelsInRange(options.startMs, options.endMs);
  const stats: EnsureLevelStats = {
    planned: [],
    ok: [],
    skipped: [],
    failed: []
  };

  const candidates: string[] = [];
  for (const week of weeks) {
    const range = localWeekRange(week);
    if (onlyWithSessions) {
      const sessions = await listSessionsInRange(
        options.catalogDb,
        range.startMs,
        range.endMs,
        1
      );
      if (!sessions.length) {
        stats.skipped.push(week);
        continue;
      }
    }

    if (skipExisting) {
      const existing = await getReportEntryById(options.desktopDb, range.entryId);
      if (existing?.content?.trim()) {
        stats.skipped.push(week);
        continue;
      }
    }

    candidates.push(week);
  }

  stats.planned = [...candidates];
  const total = candidates.length;
  const parentLabel = options.progressPeriodLabel || "";

  if (!total) {
    options.onProgress?.({
      phase: "ensure_summaries",
      level: "monthly",
      periodLabel: parentLabel,
      message: "本月周报已齐全（或无 session 活动周）",
      index: 0,
      total: 0
    });
    return stats;
  }

  options.onProgress?.({
    phase: "ensure_summaries",
    level: "monthly",
    periodLabel: parentLabel,
    message: `检查并补全周报 · 需生成 ${total} 周…`,
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
      message: `补全周报 ${i}/${total} · ${week}`,
      index: i,
      total
    });
    try {
      await runWeeklyDigest({
        panelHome: options.panelHome,
        weekKey: week,
        skipEmbedding: options.skipEmbedding,
        forceResummarize: options.forceResummarize,
        onProgress: (ev) => {
          options.onProgress?.({
            ...ev,
            level: "monthly",
            periodLabel: parentLabel,
            message: ev.message
              ? `周报 ${week} · ${ev.message}`
              : `周报 ${week}`
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
