import { listAllSessionsInRange } from "../catalog/query";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { loadSettings } from "../settings/store";
import {
  evaluateDailyDigestRefresh,
  type DailyDigestRefreshCheck
} from "./daily";
import {
  localMonthRange,
  localWeekRange,
  listDayLabelsInRange,
  type PeriodRange
} from "./period";
import { dayKeyFromMs, digestIndex } from "./calendar";
import { createReportProgressText, digestLevelLabelKey } from "./progressI18n";
import { listReportEntriesInRange } from "./store";

export type PeriodDigestRefreshCheck = DailyDigestRefreshCheck;

/** Weekly/monthly freshness follows the exact daily sources used by aggregation. */
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
  const sessions = await listAllSessionsInRange(catalogDb, period.startMs, period.endMs);
  const sessionCount = sessions.length;
  const periodEntries = await listReportEntriesInRange(desktopDb, {
    level: options.level,
    startMs: period.startMs,
    endMs: period.endMs,
    limit: 20
  });
  const entry = periodEntries.sort((a, b) => b.createdAtMs - a.createdAtMs)[0];

  if (!entry?.content?.trim()) {
    if (!sessionCount) {
      return {
        needed: false,
        reason: "no_sessions",
        sessionCount: 0,
        linkedSessionCount: 0,
        newSessionCount: 0,
        updatedSessionCount: 0,
        omittedSessionCount: 0,
        message: pt("desktop.report.periodNoSessions", levelLabel)
      };
    }
    return {
      needed: true,
      reason: "missing",
      sessionCount,
      linkedSessionCount: 0,
      newSessionCount: sessionCount,
      updatedSessionCount: 0,
      omittedSessionCount: 0,
      message: pt("desktop.report.periodMissing", levelLabel, sessionCount)
    };
  }

  const updatedSessionCount = sessions.reduce(
    (count, session) => count + (session.updatedAt > entry.createdAtMs ? 1 : 0),
    0
  );
  const dailies = await listReportEntriesInRange(desktopDb, {
    level: "daily",
    startMs: period.startMs,
    endMs: period.endMs,
    limit: 500
  });
  const newerDailyKeys = new Set(
    [...digestIndex(dailies).values()]
      .filter((daily) => daily.createdAtMs > entry.createdAtMs)
      .map((daily) => daily.id.startsWith("daily:")
        ? daily.id.slice("daily:".length)
        : dayKeyFromMs(daily.periodStartMs))
  );
  const staleDailyKeys = new Set<string>();

  for (const day of listDayLabelsInRange(period.startMs, period.endMs)) {
    const check = await evaluateDailyDigestRefresh({
      settings,
      catalogDb,
      desktopDb,
      date: day,
      systemLocale: options.systemLocale
    });
    if (check.needed) staleDailyKeys.add(day);
  }

  if (updatedSessionCount > 0) {
    return {
      needed: true,
      reason: "updated_sessions",
      sessionCount,
      linkedSessionCount: sessionCount,
      newSessionCount: 0,
      updatedSessionCount,
      omittedSessionCount: 0,
      digestCreatedAtMs: entry.createdAtMs,
      message: pt("desktop.report.periodUpdatedSessions", levelLabel, updatedSessionCount)
    };
  }

  const changedDailyKeys = new Set([...newerDailyKeys, ...staleDailyKeys]);
  if (changedDailyKeys.size > 0) {
    const newerCount = newerDailyKeys.size;
    const staleOnlyCount = [...staleDailyKeys].filter((key) => !newerDailyKeys.has(key)).length;
    const message = newerCount > 0 && staleOnlyCount > 0
      ? pt("desktop.report.periodUnderlyingBoth", levelLabel, newerCount, staleOnlyCount)
      : newerCount > 0
        ? pt("desktop.report.periodUnderlyingNewOnly", levelLabel, newerCount)
        : pt("desktop.report.periodUnderlyingStaleOnly", levelLabel, staleOnlyCount);
    return {
      needed: true,
      reason: "new_sessions",
      sessionCount,
      linkedSessionCount: sessionCount,
      newSessionCount: changedDailyKeys.size,
      updatedSessionCount: 0,
      omittedSessionCount: 0,
      digestCreatedAtMs: entry.createdAtMs,
      message
    };
  }


  return {
    needed: false,
    reason: "up_to_date",
    sessionCount,
    linkedSessionCount: sessionCount,
    newSessionCount: 0,
    updatedSessionCount: 0,
    omittedSessionCount: 0,
    digestCreatedAtMs: entry.createdAtMs,
    message: pt("desktop.report.periodUpToDate", levelLabel)
  };
}

export async function needsWeeklyDigestRefresh(
  options: { panelHome?: string; weekKey?: string; systemLocale?: string } = {}
): Promise<PeriodDigestRefreshCheck> {
  return needsPeriodDigestRefresh(localWeekRange(options.weekKey), {
    panelHome: options.panelHome,
    level: "weekly",
    systemLocale: options.systemLocale
  });
}

export async function needsMonthlyDigestRefresh(
  options: { panelHome?: string; monthKey?: string; systemLocale?: string } = {}
): Promise<PeriodDigestRefreshCheck> {
  return needsPeriodDigestRefresh(localMonthRange(options.monthKey), {
    panelHome: options.panelHome,
    level: "monthly",
    systemLocale: options.systemLocale
  });
}
