import { ensureCatalogSchema } from "../catalog/db";
import { listSessionsInRange } from "../catalog/query";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import type { DailyDigestRefreshCheck } from "./daily";
import { localDayRange, listDayLabelsInRange, localMonthRange, localWeekRange, PeriodRange } from "./period";
import { getReportEntryById, listReportEntriesInRange } from "./store";

export type PeriodDigestRefreshCheck = DailyDigestRefreshCheck;

async function resolveDbPath(panelHome?: string): Promise<string> {
  const settings = await loadSettings(panelHome);
  return panelHome
    ? catalogDbPath(resolvePanelHome(panelHome))
    : catalogDbFromSettings(settings, panelHome);
}

/**
 * Weekly / monthly: stale when sessions updated after digest, or underlying dailies changed.
 */
export async function needsPeriodDigestRefresh(
  period: PeriodRange,
  options: { panelHome?: string; levelLabel: string }
): Promise<PeriodDigestRefreshCheck> {
  const dbPath = await resolveDbPath(options.panelHome);
  await ensureCatalogSchema(dbPath);

  const sessions = await listSessionsInRange(dbPath, period.startMs, period.endMs);
  const sessionCount = sessions.length;
  const entry = await getReportEntryById(dbPath, period.entryId);

  if (!entry?.content?.trim()) {
    if (!sessionCount) {
      return {
        needed: false,
        reason: "no_sessions",
        sessionCount: 0,
        newSessionCount: 0,
        updatedSessionCount: 0,
        message: `${options.levelLabel}：当期无 session`
      };
    }
    return {
      needed: true,
      reason: "missing",
      sessionCount,
      newSessionCount: sessionCount,
      updatedSessionCount: 0,
      message: `尚无${options.levelLabel} · ${sessionCount} sessions`
    };
  }

  let updatedSessionCount = 0;
  for (const s of sessions) {
    if (s.updatedAt > entry.createdAtMs) {
      updatedSessionCount += 1;
    }
  }

  const dailies = await listReportEntriesInRange(dbPath, {
    level: "daily",
    startMs: period.startMs,
    endMs: period.endMs,
    limit: 200
  });
  let newDailyCount = 0;
  for (const daily of dailies) {
    if (daily.createdAtMs > entry.createdAtMs) {
      newDailyCount += 1;
    }
  }

  let staleDailyCount = 0;
  for (const day of listDayLabelsInRange(period.startMs, period.endMs)) {
    const dayPeriod = localDayRange(day);
    const daySessions = await listSessionsInRange(
      dbPath,
      dayPeriod.startMs,
      dayPeriod.endMs,
      50
    );
    if (!daySessions.length) continue;

    const dayEntry = await getReportEntryById(dbPath, dayPeriod.entryId);
    if (!dayEntry?.content?.trim()) {
      staleDailyCount += 1;
      continue;
    }

    for (const s of daySessions) {
      if (s.updatedAt > dayEntry.createdAtMs) {
        staleDailyCount += 1;
        break;
      }
    }
  }

  if (updatedSessionCount > 0) {
    return {
      needed: true,
      reason: "updated_sessions",
      sessionCount,
      newSessionCount: 0,
      updatedSessionCount,
      digestCreatedAtMs: entry.createdAtMs,
      message: `${options.levelLabel}：${updatedSessionCount} 个 session 有更新`
    };
  }

  const underlyingChanges = newDailyCount + staleDailyCount;
  if (underlyingChanges > 0) {
    const parts: string[] = [];
    if (newDailyCount > 0) parts.push(`${newDailyCount} 篇新日报`);
    if (staleDailyCount > 0) parts.push(`${staleDailyCount} 天日报待更新`);
    return {
      needed: true,
      reason: "new_sessions",
      sessionCount,
      newSessionCount: underlyingChanges,
      updatedSessionCount: 0,
      digestCreatedAtMs: entry.createdAtMs,
      message: `${options.levelLabel}：底层日报有变化（${parts.join("、")}）`
    };
  }

  return {
    needed: false,
    reason: "up_to_date",
    sessionCount,
    newSessionCount: 0,
    updatedSessionCount: 0,
    digestCreatedAtMs: entry.createdAtMs,
    message: `${options.levelLabel}已是最新`
  };
}

export async function needsWeeklyDigestRefresh(
  options: { panelHome?: string; weekKey?: string } = {}
): Promise<PeriodDigestRefreshCheck> {
  const period = localWeekRange(options.weekKey);
  return needsPeriodDigestRefresh(period, { panelHome: options.panelHome, levelLabel: "周报" });
}

export async function needsMonthlyDigestRefresh(
  options: { panelHome?: string; monthKey?: string } = {}
): Promise<PeriodDigestRefreshCheck> {
  const period = localMonthRange(options.monthKey);
  return needsPeriodDigestRefresh(period, { panelHome: options.panelHome, levelLabel: "月报" });
}