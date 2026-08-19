import type { ReportEntry } from "@agent-resume/core";

export type ReportPeriodType = "day" | "week" | "month";

export interface PeriodRange {
  fromMs: number;
  toMs: number;
}

export interface CalendarCell {
  key: string;
  day: number;
  outside: boolean;
  week: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function dayKeyFromDate(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

export function dayKeyFromMs(value: number): string {
  return dayKeyFromDate(new Date(value));
}

export function isoWeekLabelFromDate(value: Date): string {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + 4 - day);
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getFullYear()}-W${pad2(week)}`;
}

export function viewMonthKey(year: number, monthIndex: number): string {
  return `${year}-${pad2(monthIndex + 1)}`;
}

export function parseDayRange(key: string): PeriodRange | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) return null;
  return { fromMs: start.getTime(), toMs: end.getTime() };
}

export function parseWeekRange(key: string): PeriodRange | null {
  const match = /^(\d{4})-W(\d{2})$/i.exec(key);
  if (!match) return null;
  const [year, week] = match.slice(1).map(Number);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(year, 0, 4, 12);
  const day = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() + 1 - day + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  const next = new Date(monday);
  next.setDate(monday.getDate() + 7);
  return { fromMs: monday.getTime(), toMs: next.getTime() };
}

export function parseMonthRange(key: string): PeriodRange | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [year, month] = match.slice(1).map(Number);
  if (month < 1 || month > 12) return null;
  return { fromMs: new Date(year, month - 1, 1).getTime(), toMs: new Date(year, month, 1).getTime() };
}

export function rangeForPeriod(type: ReportPeriodType, key: string): PeriodRange | null {
  if (type === "day") return parseDayRange(key);
  if (type === "week") return parseWeekRange(key);
  return parseMonthRange(key);
}

export function paddedMonthRange(year: number, monthIndex: number): PeriodRange {
  const start = new Date(year, monthIndex, 1);
  start.setDate(start.getDate() - 10);
  const end = new Date(year, monthIndex + 1, 1);
  end.setDate(end.getDate() + 14);
  return { fromMs: start.getTime(), toMs: end.getTime() };
}

export function calendarCells(year: number, monthIndex: number): CalendarCell[] {
  const first = new Date(year, monthIndex, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, monthIndex, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return {
      key: dayKeyFromDate(date),
      day: date.getDate(),
      outside: date.getMonth() !== monthIndex,
      week: isoWeekLabelFromDate(date)
    };
  });
}

export function periodKeyFromEntry(entry: Pick<ReportEntry, "id" | "level" | "periodStartMs">): string {
  const level = entry.level || "daily";
  const prefix = level === "daily" ? "daily:" : level === "weekly" ? "weekly:" : level === "monthly" ? "monthly:" : "";
  const fromId = prefix && entry.id.startsWith(prefix) ? entry.id.slice(prefix.length) : "";
  if (level === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(fromId)) return fromId;
  if (level === "weekly" && /^\d{4}-W\d{2}$/i.test(fromId)) return fromId;
  if (level === "monthly" && /^\d{4}-\d{2}$/.test(fromId)) return fromId;
  const date = new Date(entry.periodStartMs);
  if (!Number.isFinite(date.getTime())) return "";
  if (level === "weekly") return isoWeekLabelFromDate(date);
  if (level === "monthly") return dayKeyFromDate(date).slice(0, 7);
  return dayKeyFromDate(date);
}

export function digestIndex(entries: ReportEntry[]): Map<string, ReportEntry> {
  const index = new Map<string, ReportEntry>();
  for (const entry of entries) {
    const key = periodKeyFromEntry(entry);
    if (key && (entry.level === "daily" || entry.level === "weekly" || entry.level === "monthly")) {
      const indexKey = `${entry.level}:${key}`;
      const existing = index.get(indexKey);
      if (!existing || entry.createdAtMs >= existing.createdAtMs) {
        index.set(indexKey, entry);
      }
    }
  }
  return index;
}
