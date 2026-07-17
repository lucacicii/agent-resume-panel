import { listSessionsInRange } from "../catalog/query";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { loadSettings } from "../settings/store";
import type { DailyDigestRefreshCheck } from "./daily";
import { localDayRange, listDayLabelsInRange, localMonthRange, localWeekRange, PeriodRange } from "./period";
import { createReportProgressText, digestLevelLabelKey } from "./progressI18n";
import { getReportEntryById, listReportEntriesInRange } from "./store";

export type PeriodDigestRefreshCheck = DailyDigestRefreshCheck;

/**
 * Weekly / monthly: stale when sessions updated after digest, or underlying dailies changed.
 */
export async function needsPeriodDigestRefresh(
  period: PeriodRange,
  options: { panelHome?: string; level: "weekly" | "monthly"; systemLocale?: string }
): Promise<PeriodDigestRefreshCheck> {
  const settings = await loadSettings(options.panelHome);
  const pt = createReportProgressText(settings, options.systemLocale);
  const levelLabel = pt(digestLevelLabelKey(options.level));

  const paths = await preparePanelDatabasesFromSettings(options.panelHome);
  const catalogDb = paths.catalogDb;
  const desktopDb = paths.desktopDb;

  const sessions = await listSessionsInRange(catalogDb, period.startMs, period.endMs);
  const sessionCount = sessions.length;
  const entry = await getReportEntryById(desktopDb, period.entryId);

  if (!entry?.content?.trim()) {
    if (!sessionCount) {
      return {
        needed: false,
        reason: "no_sessions",
        sessionCount: 0,
        newSessionCount: 0,
        updatedSessionCount: 0,
        message: pt("desktop.report.periodNoSessions", levelLabel)
      };
    }
    return {
      needed: true,
      reason: "missing",
      sessionCount,
      newSessionCount: sessionCount,
      updatedSessionCount: 0,
      message: pt("desktop.report.periodMissing", levelLabel, sessionCount)
    };
  }

  let updatedSessionCount = 0;
  for (const s of sessions) {
    if (s.updatedAt > entry.createdAtMs) {
      updatedSessionCount += 1;
    }
  }

  const dailies = await listReportEntriesInRange(desktopDb, {
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
      catalogDb,
      dayPeriod.startMs,
      dayPeriod.endMs,
      50
    );
    if (!daySessions.length) continue;

    const dayEntry = await getReportEntryById(desktopDb, dayPeriod.entryId);
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
      message: pt("desktop.report.periodUpdatedSessions", levelLabel, updatedSessionCount)
    };
  }

  const underlyingChanges = newDailyCount + staleDailyCount;
  if (underlyingChanges > 0) {
    let message: string;
    if (newDailyCount > 0 && staleDailyCount > 0) {
      message = pt(
        "desktop.report.periodUnderlyingBoth",
        levelLabel,
        newDailyCount,
        staleDailyCount
      );
    } else if (newDailyCount > 0) {
      message = pt("desktop.report.periodUnderlyingNewOnly", levelLabel, newDailyCount);
    } else {
      message = pt("desktop.report.periodUnderlyingStaleOnly", levelLabel, staleDailyCount);
    }
    return {
      needed: true,
      reason: "new_sessions",
      sessionCount,
      newSessionCount: underlyingChanges,
      updatedSessionCount: 0,
      digestCreatedAtMs: entry.createdAtMs,
      message
    };
  }

  return {
    needed: false,
    reason: "up_to_date",
    sessionCount,
    newSessionCount: 0,
    updatedSessionCount: 0,
    digestCreatedAtMs: entry.createdAtMs,
    message: pt("desktop.report.periodUpToDate", levelLabel)
  };
}

export async function needsWeeklyDigestRefresh(
  options: { panelHome?: string; weekKey?: string; systemLocale?: string } = {}
): Promise<PeriodDigestRefreshCheck> {
  const period = localWeekRange(options.weekKey);
  return needsPeriodDigestRefresh(period, {
    panelHome: options.panelHome,
    level: "weekly",
    systemLocale: options.systemLocale
  });
}

export async function needsMonthlyDigestRefresh(
  options: { panelHome?: string; monthKey?: string; systemLocale?: string } = {}
): Promise<PeriodDigestRefreshCheck> {
  const period = localMonthRange(options.monthKey);
  return needsPeriodDigestRefresh(period, {
    panelHome: options.panelHome,
    level: "monthly",
    systemLocale: options.systemLocale
  });
}