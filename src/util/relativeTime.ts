import { t } from "../i18n";

export function relativeTime(timestamp: number): string {
  if (!timestamp) {
    return t("tree.relativeTimeUnknown");
  }

  const diffMs = Date.now() - timestamp;
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) {
    return t("tree.relativeTimeMinutes", 1);
  }
  if (absMs < hour) {
    return t("tree.relativeTimeMinutes", Math.max(1, Math.round(absMs / minute)));
  }
  if (absMs < day) {
    return t("tree.relativeTimeHours", Math.round(absMs / hour));
  }
  return t("tree.relativeTimeDays", Math.round(absMs / day));
}

export function acpRelativeTime(timestamp: number): string {
  if (!timestamp) {
    return t("tree.relativeTimeUnknown");
  }

  const diffMs = Date.now() - timestamp;
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) {
    return t("tree.acp.relativeTimeJustNow");
  }
  if (absMs < hour) {
    return t("tree.acp.relativeTimeMinutesAgo", Math.max(1, Math.round(absMs / minute)));
  }
  if (absMs < day) {
    return t("tree.acp.relativeTimeHoursAgo", Math.round(absMs / hour));
  }
  return t("tree.acp.relativeTimeDaysAgo", Math.round(absMs / day));
}