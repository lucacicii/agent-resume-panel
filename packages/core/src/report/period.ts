export interface PeriodRange {
  startMs: number;
  endMs: number;
  label: string;
  jobKey: string;
  entryId: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar day [start, end). dateStr = YYYY-MM-DD optional. */
export function localDayRange(dateStr?: string): PeriodRange {
  const now = new Date();
  let y: number;
  let m: number;
  let d: number;

  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [ys, ms, ds] = dateStr.split("-").map(Number);
    y = ys;
    m = ms;
    d = ds;
  } else {
    y = now.getFullYear();
    m = now.getMonth() + 1;
    d = now.getDate();
  }

  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  const label = `${y}-${pad2(m)}-${pad2(d)}`;
  const jobKey = `daily:${label}`;

  return { startMs: start.getTime(), endMs: end.getTime(), label, jobKey, entryId: jobKey };
}

/**
 * ISO week helpers using local calendar days but ISO week numbering.
 * weekKey: `YYYY-Www` (e.g. 2026-W28) or Date / undefined = week containing today.
 * Range: Monday 00:00 local → next Monday 00:00 local.
 */
export function localWeekRange(weekKey?: string | Date): PeriodRange {
  const anchor = resolveWeekAnchor(weekKey);
  const monday = startOfIsoWeekLocal(anchor);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);

  const { year, week } = isoWeekYearAndNumber(monday);
  const label = `${year}-W${pad2(week)}`;
  const jobKey = `weekly:${label}`;

  return {
    startMs: monday.getTime(),
    endMs: nextMonday.getTime(),
    label,
    jobKey,
    entryId: jobKey
  };
}

/** monthKey: `YYYY-MM` or Date / undefined = current month. */
export function localMonthRange(monthKey?: string | Date): PeriodRange {
  let y: number;
  let m: number;

  if (typeof monthKey === "string" && /^\d{4}-\d{2}$/.test(monthKey)) {
    const [ys, ms] = monthKey.split("-").map(Number);
    y = ys;
    m = ms;
  } else {
    const d = monthKey instanceof Date ? monthKey : new Date();
    y = d.getFullYear();
    m = d.getMonth() + 1;
  }

  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 1, 0, 0, 0, 0);
  const label = `${y}-${pad2(m)}`;
  const jobKey = `monthly:${label}`;

  return { startMs: start.getTime(), endMs: end.getTime(), label, jobKey, entryId: jobKey };
}

/** Previous complete ISO week relative to now. */
export function previousCompleteWeekRange(now = new Date()): PeriodRange {
  const thisWeek = localWeekRange(now);
  const prevMonday = new Date(thisWeek.startMs - 1);
  return localWeekRange(prevMonday);
}

/** Previous calendar month relative to now. */
export function previousCompleteMonthRange(now = new Date()): PeriodRange {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based current
  const prev = m === 0 ? new Date(y - 1, 11, 1) : new Date(y, m - 1, 1);
  return localMonthRange(prev);
}

function resolveWeekAnchor(weekKey?: string | Date): Date {
  if (weekKey instanceof Date) {
    return weekKey;
  }
  if (typeof weekKey === "string" && /^\d{4}-W\d{2}$/i.test(weekKey)) {
    const match = /^(\d{4})-W(\d{2})$/i.exec(weekKey);
    if (match) {
      return dateFromIsoWeek(Number(match[1]), Number(match[2]));
    }
  }
  return new Date();
}

function startOfIsoWeekLocal(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const day = d.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday as start
  d.setDate(d.getDate() + diff);
  return d;
}

function isoWeekYearAndNumber(date: Date): { year: number; week: number } {
  // Use Thursday of this ISO week to determine year/week
  const thu = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = thu.getDay() || 7;
  thu.setDate(thu.getDate() + 4 - day);
  const yearStart = new Date(thu.getFullYear(), 0, 1);
  const week = Math.ceil(((thu.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: thu.getFullYear(), week };
}

function dateFromIsoWeek(isoYear: number, isoWeek: number): Date {
  // Jan 4 is always in week 1
  const jan4 = new Date(isoYear, 0, 4, 12, 0, 0, 0);
  const monday = startOfIsoWeekLocal(jan4);
  monday.setDate(monday.getDate() + (isoWeek - 1) * 7);
  return monday;
}

/** Local calendar day labels YYYY-MM-DD for each day in [startMs, endMs). */
export function listDayLabelsInRange(startMs: number, endMs: number): string[] {
  const labels: string[] = [];
  const d = new Date(startMs);
  d.setHours(0, 0, 0, 0);
  const end = Math.floor(endMs);
  while (d.getTime() < end) {
    labels.push(
      `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    );
    d.setDate(d.getDate() + 1);
  }
  return labels;
}

/** Distinct ISO week labels YYYY-Www covering [startMs, endMs). */
export function listWeekLabelsInRange(startMs: number, endMs: number): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const day of listDayLabelsInRange(startMs, endMs)) {
    const [y, m, d] = day.split("-").map(Number);
    const week = localWeekRange(new Date(y, m - 1, d, 12, 0, 0, 0));
    if (!seen.has(week.label)) {
      seen.add(week.label);
      labels.push(week.label);
    }
  }
  return labels;
}
