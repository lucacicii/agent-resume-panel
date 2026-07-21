/**
 * Unit tests for schedule due-time helpers (compile-free reimplementation of the pure rules).
 * Source of truth: apps/desktop/src/main/scheduler.ts → computeDueScheduleJobs
 *
 * Run: node apps/desktop/scripts/scheduler-due.test.mjs
 */
import assert from "node:assert/strict";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatLocalDay(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function clampHour(value, fallback) {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(23, Math.floor(value)));
}

function isPastLocalHour(now, hour) {
  return now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= 0);
}

/** Minimal mirror of period helpers for assertions (local calendar). */
function startOfIsoWeekLocal(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function isoWeekYearAndNumber(monday) {
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const week = Math.floor(((thursday - yearStart) / 86400000 + yearStart.getDay() + 1) / 7);
  // Prefer simple label from Monday for tests we control
  return { year: thursday.getFullYear(), week };
}

function localWeekRange(now) {
  const monday = startOfIsoWeekLocal(now);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  // ISO week number: use date-fns-like Thursday rule
  const target = new Date(monday.valueOf());
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const week1 = new Date(target.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(
      ((target.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
    );
  const year = target.getFullYear();
  const label = `${year}-W${pad2(week)}`;
  return { startMs: monday.getTime(), endMs: nextMonday.getTime(), label, jobKey: `weekly:${label}` };
}

function previousCompleteWeekRange(now) {
  const thisWeek = localWeekRange(now);
  const prevMonday = new Date(thisWeek.startMs - 1);
  return localWeekRange(prevMonday);
}

function localMonthRange(d) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const label = `${y}-${pad2(m)}`;
  return { label, jobKey: `monthly:${label}` };
}

function previousCompleteMonthRange(now) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const prev = m === 0 ? new Date(y - 1, 11, 1) : new Date(y, m - 1, 1);
  return localMonthRange(prev);
}

function computeDue(now, hours) {
  const dailyHour = clampHour(hours.dailyHour, 22);
  const weeklyHour = clampHour(hours.weeklyHour, 9);
  const monthlyHour = clampHour(hours.monthlyHour, 9);
  const jobs = [];
  const seen = new Set();
  const push = (job) => {
    if (seen.has(job.periodKey)) return;
    seen.add(job.periodKey);
    jobs.push(job);
  };

  if (isPastLocalHour(now, dailyHour)) {
    const today = formatLocalDay(now);
    push({ level: "daily", periodKey: `daily:${today}`, periodLabel: today });
  }

  {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const yesterday = formatLocalDay(y);
    push({ level: "daily", periodKey: `daily:${yesterday}`, periodLabel: yesterday });
  }

  {
    const thisWeek = localWeekRange(now);
    const dueAt = new Date(thisWeek.startMs);
    dueAt.setHours(weeklyHour, 0, 0, 0);
    if (now.getTime() >= dueAt.getTime()) {
      const week = previousCompleteWeekRange(now);
      push({ level: "weekly", periodKey: week.jobKey, periodLabel: week.label });
    }
  }

  {
    const dueAt = new Date(now.getFullYear(), now.getMonth(), 1, monthlyHour, 0, 0, 0);
    if (now.getTime() >= dueAt.getTime()) {
      const month = previousCompleteMonthRange(now);
      push({ level: "monthly", periodKey: month.jobKey, periodLabel: month.label });
    }
  }

  return jobs;
}

// --- cases ---

// Before daily hour: only yesterday (+ weekly/monthly if due)
{
  const now = new Date(2026, 6, 21, 10, 30, 0); // Tue Jul 21 2026 10:30
  const jobs = computeDue(now, { dailyHour: 22, weeklyHour: 9, monthlyHour: 9 });
  const keys = jobs.map((j) => j.periodKey);
  assert.ok(keys.includes("daily:2026-07-20"), "yesterday catch-up");
  assert.ok(!keys.includes("daily:2026-07-21"), "today not before daily hour");
  assert.ok(keys.some((k) => k.startsWith("weekly:")), "weekly catch-up after Monday 9");
  assert.ok(keys.some((k) => k.startsWith("monthly:")), "monthly catch-up after day 1 9");
}

// After daily hour: today + yesterday
{
  const now = new Date(2026, 6, 21, 22, 0, 0);
  const jobs = computeDue(now, { dailyHour: 22, weeklyHour: 9, monthlyHour: 9 });
  const keys = jobs.map((j) => j.periodKey);
  assert.ok(keys.includes("daily:2026-07-21"));
  assert.ok(keys.includes("daily:2026-07-20"));
}

// Monday before weekly hour: no weekly yet
{
  const now = new Date(2026, 6, 20, 8, 0, 0); // Mon Jul 20 08:00
  const jobs = computeDue(now, { dailyHour: 22, weeklyHour: 9, monthlyHour: 9 });
  assert.ok(!jobs.some((j) => j.level === "weekly"), "weekly not before Monday 9");
}

// Monday at weekly hour: weekly due
{
  const now = new Date(2026, 6, 20, 9, 0, 0);
  const jobs = computeDue(now, { dailyHour: 22, weeklyHour: 9, monthlyHour: 9 });
  assert.ok(jobs.some((j) => j.level === "weekly"), "weekly at Monday 9");
}

// Day 1 before monthly hour
{
  const now = new Date(2026, 6, 1, 8, 0, 0); // Jul 1 08:00
  const jobs = computeDue(now, { dailyHour: 22, weeklyHour: 9, monthlyHour: 9 });
  assert.ok(!jobs.some((j) => j.level === "monthly"), "monthly not before day1 hour");
}

// Day 1 at monthly hour
{
  const now = new Date(2026, 6, 1, 9, 0, 0);
  const jobs = computeDue(now, { dailyHour: 22, weeklyHour: 9, monthlyHour: 9 });
  assert.ok(jobs.some((j) => j.level === "monthly" && j.periodLabel === "2026-06"));
}

console.log("scheduler-due tests passed");
