import { listSessionsInRange } from "../catalog/query";
import { loadSettings } from "../settings/store";
import { runDailyDigest } from "./daily";
import { localDayRange, listDayLabelsInRange } from "./period";
import {
  createReportProgressText,
  dailiesCompleteKey,
  ensureDailiesCheckKey,
  resolveReportScope
} from "./progressI18n";
import { DigestProgressCallback } from "./progress";
import { getReportEntryById } from "./store";

export interface EnsureLevelStats {
  planned: string[];
  ok: string[];
  skipped: string[];
  failed: Array<{ key: string; error: string }>;
}

export interface EnsureDailiesOptions {
  catalogDb: string;
  desktopDb: string;
  startMs: number;
  endMs: number;
  panelHome?: string;
  skipExisting?: boolean;
  skipEmbedding?: boolean;
  forceResummarize?: boolean;
  /** Only days with at least one catalog session. Default true. */
  onlyWithSessions?: boolean;
  onProgress?: DigestProgressCallback;
  progressLevel?: "daily" | "weekly" | "monthly";
  progressPeriodLabel?: string;
  systemLocale?: string;
}

/**
 * Ensure daily digests exist for days in [startMs, endMs).
 * Used before weekly aggregation. Existing entries are skipped by default.
 */
export async function ensureDailiesForPeriod(
  options: EnsureDailiesOptions
): Promise<EnsureLevelStats> {
  const settings = await loadSettings(options.panelHome);
  const pt = createReportProgressText(settings, options.systemLocale);
  const scope = resolveReportScope(options.progressLevel);

  const skipExisting = options.skipExisting !== false;
  const onlyWithSessions = options.onlyWithSessions !== false;
  const days = listDayLabelsInRange(options.startMs, options.endMs);
  const stats: EnsureLevelStats = {
    planned: [],
    ok: [],
    skipped: [],
    failed: []
  };

  const candidates: string[] = [];
  for (const day of days) {
    const range = localDayRange(day);
    if (onlyWithSessions) {
      const sessions = await listSessionsInRange(
        options.catalogDb,
        range.startMs,
        range.endMs,
        1
      );
      if (!sessions.length) {
        stats.skipped.push(day);
        continue;
      }
    }

    if (skipExisting) {
      const existing = await getReportEntryById(options.desktopDb, range.entryId);
      if (existing?.content?.trim()) {
        stats.skipped.push(day);
        continue;
      }
    }

    candidates.push(day);
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
      message: pt(dailiesCompleteKey(scope)),
      index: 0,
      total: 0
    });
    return stats;
  }

  options.onProgress?.({
    phase: "ensure_summaries",
    level: parentLevel,
    periodLabel: parentLabel,
    message: pt(ensureDailiesCheckKey(scope), total),
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
      message: pt("desktop.report.backfillDailyProgress", i, total, day),
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
        onProgress: (ev) => {
          options.onProgress?.({
            ...ev,
            level: parentLevel,
            periodLabel: parentLabel,
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