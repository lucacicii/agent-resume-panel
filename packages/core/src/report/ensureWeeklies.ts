import { listSessionsInRange } from "../catalog/query";
import { loadSettings } from "../settings/store";
import { localWeekRange, listWeekLabelsInRange } from "./period";
import { createReportProgressText } from "./progressI18n";
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
  systemLocale?: string;
}

/**
 * Ensure weekly digests exist for ISO weeks covering [startMs, endMs).
 * Each weekly run cascades to ensure its dailies first.
 */
export async function ensureWeekliesForPeriod(
  options: EnsureWeekliesOptions
): Promise<EnsureLevelStats> {
  const settings = await loadSettings(options.panelHome);
  const pt = createReportProgressText(settings, options.systemLocale);

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
      message: pt("desktop.report.weekliesCompleteMonth"),
      index: 0,
      total: 0
    });
    return stats;
  }

  options.onProgress?.({
    phase: "ensure_summaries",
    level: "monthly",
    periodLabel: parentLabel,
    message: pt("desktop.report.ensureWeekliesCheck", total),
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
      message: pt("desktop.report.backfillWeeklyProgress", i, total, week),
      index: i,
      total
    });
    try {
      await runWeeklyDigest({
        panelHome: options.panelHome,
        weekKey: week,
        skipEmbedding: options.skipEmbedding,
        forceResummarize: options.forceResummarize,
        systemLocale: options.systemLocale,
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