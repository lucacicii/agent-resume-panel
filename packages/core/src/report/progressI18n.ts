import { createUiText, UiText } from "../i18n/uiText";
import { PanelSettings } from "../settings/types";

export type ReportProgressText = UiText;

export function createReportProgressText(
  settings: PanelSettings,
  systemLocale?: string
): ReportProgressText {
  return createUiText(settings, systemLocale);
}

export type ReportScope = "week" | "month" | "period";

export function resolveReportScope(parentLevel?: string): ReportScope {
  if (parentLevel === "monthly") return "month";
  if (parentLevel === "weekly") return "week";
  return "period";
}

const FRESH_DAILIES_UP_TO_DATE: Record<ReportScope, string> = {
  week: "desktop.report.freshDailiesUpToDateWeek",
  month: "desktop.report.freshDailiesUpToDateMonth",
  period: "desktop.report.freshDailiesUpToDatePeriod"
};

const FRESH_DAILIES_REFRESH: Record<ReportScope, string> = {
  week: "desktop.report.freshDailiesRefreshWeek",
  month: "desktop.report.freshDailiesRefreshMonth",
  period: "desktop.report.freshDailiesRefreshPeriod"
};

const DAILIES_COMPLETE: Record<ReportScope, string> = {
  week: "desktop.report.dailiesCompleteWeek",
  month: "desktop.report.dailiesCompleteMonth",
  period: "desktop.report.dailiesCompletePeriod"
};

const ENSURE_DAILIES_CHECK: Record<ReportScope, string> = {
  week: "desktop.report.ensureDailiesCheckWeek",
  month: "desktop.report.ensureDailiesCheckMonth",
  period: "desktop.report.ensureDailiesCheckPeriod"
};

export function freshDailiesUpToDateKey(scope: ReportScope): string {
  return FRESH_DAILIES_UP_TO_DATE[scope];
}

export function freshDailiesRefreshKey(scope: ReportScope): string {
  return FRESH_DAILIES_REFRESH[scope];
}

export function dailiesCompleteKey(scope: ReportScope): string {
  return DAILIES_COMPLETE[scope];
}

export function ensureDailiesCheckKey(scope: ReportScope): string {
  return ENSURE_DAILIES_CHECK[scope];
}

export function digestLevelLabelKey(level: "daily" | "weekly" | "monthly"): string {
  if (level === "weekly") return "desktop.report.digestWeekly";
  if (level === "monthly") return "desktop.report.digestMonthly";
  return "desktop.report.digestDaily";
}