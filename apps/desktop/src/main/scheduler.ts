import {
  finishScheduleRun,
  estimateDigestRun,
  getReportJobStatus,
  listLlmUsageEvents,
  loadSettings,
  localDayRange,
  localWeekRange,
  previousCompleteMonthRange,
  previousCompleteWeekRange,
  runDailyDigest,
  runMonthlyDigest,
  runWeeklyDigest,
  startScheduleRun,
  upsertReportJob
} from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";
import { recordAppError } from "./appErrorLog";

/** Space retries after a failed or interrupted schedule attempt. */
const RETRY_INTERVAL_MS = 30 * 60_000;
const BUDGET_DEFER_INTERVAL_MS = 24 * 60 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
/** periodKey → last attempt start (ms). Process-local retry throttle. */
const lastAttemptAt = new Map<string, number>();

export function stopMemoryScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function startMemoryScheduler(): void {
  stopMemoryScheduler();
  timer = setInterval(() => {
    void tick().catch((err) => {
      void recordAppError({ source: "memory-scheduler", error: err });
    });
  }, 60_000);
  void tick().catch((err) => {
    void recordAppError({ source: "memory-scheduler", error: err });
  });
}

export async function refreshMemorySchedulerFromSettings(): Promise<boolean> {
  const settings = await loadSettings();
  const enabled = settings.report?.enabled === true;
  if (enabled) {
    startMemoryScheduler();
  } else {
    stopMemoryScheduler();
  }
  return enabled;
}

export type ScheduleLevel = "daily" | "weekly" | "monthly";

export interface DueScheduleJob {
  level: ScheduleLevel;
  periodKey: string;
  /** Stable label passed to digest runners (day / week / month key). */
  periodLabel: string;
}

/**
 * Pure due-time logic (injectable clock for tests).
 * Catch-up: once the local scheduled hour has passed, keep jobs due until status is ok
 * (caller enforces status + retry throttle). Also retries yesterday's daily if still not ok.
 */
export function computeDueScheduleJobs(
  now: Date,
  hours: { dailyHour: number; weeklyHour: number; monthlyHour: number }
): DueScheduleJob[] {
  const dailyHour = clampHour(hours.dailyHour, 22);
  const weeklyHour = clampHour(hours.weeklyHour, 9);
  const monthlyHour = clampHour(hours.monthlyHour, 9);
  const jobs: DueScheduleJob[] = [];
  const seen = new Set<string>();

  const push = (job: DueScheduleJob) => {
    if (seen.has(job.periodKey)) return;
    seen.add(job.periodKey);
    jobs.push(job);
  };

  // Today’s daily after the configured hour.
  if (isPastLocalHour(now, dailyHour)) {
    const today = formatLocalDay(now);
    const todayRange = localDayRange(today);
    push({ level: "daily", periodKey: todayRange.jobKey, periodLabel: todayRange.dateLabel });
  }

  // Yesterday catch-up (failed overnight / app was closed at fire time).
  {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const yesterday = formatLocalDay(y);
    const yRange = localDayRange(yesterday);
    // Yesterday's slot is always in the past after local midnight following that day.
    // Before today's daily hour we still want yesterday; after it we want both.
    push({ level: "daily", periodKey: yRange.jobKey, periodLabel: yRange.dateLabel });
  }

  // Previous ISO week: due from Monday weeklyHour of the current week onward.
  {
    const thisWeek = localWeekRange(now);
    const dueAt = new Date(thisWeek.startMs);
    dueAt.setHours(weeklyHour, 0, 0, 0);
    if (now.getTime() >= dueAt.getTime()) {
      const week = previousCompleteWeekRange(now);
      push({ level: "weekly", periodKey: week.jobKey, periodLabel: week.label });
    }
  }

  // Previous calendar month: due from day-1 monthlyHour of the current month onward.
  {
    const dueAt = new Date(now.getFullYear(), now.getMonth(), 1, monthlyHour, 0, 0, 0);
    if (now.getTime() >= dueAt.getTime()) {
      const month = previousCompleteMonthRange(now);
      push({ level: "monthly", periodKey: month.jobKey, periodLabel: month.label });
    }
  }

  return jobs;
}

async function tick(): Promise<void> {
  if (running) {
    return;
  }

  const settings = await loadSettings();
  if (settings.report?.enabled !== true) {
    return;
  }

  const now = new Date();
  const due = computeDueScheduleJobs(now, {
    dailyHour: settings.report?.scheduleDailyHour ?? 22,
    weeklyHour: settings.report?.scheduleWeeklyHour ?? 9,
    monthlyHour: settings.report?.scheduleMonthlyHour ?? 9
  });
  if (due.length === 0) {
    return;
  }

  const paths = await loadPanelDbPaths(settings);
  const desktopDb = paths.desktopDb;
  const nowMs = Date.now();

  running = true;
  let skipOk = 0;
  let skipRetry = 0;
  let attempted = 0;
  try {
    for (const job of due) {
      const status = await getReportJobStatus(desktopDb, job.periodKey);
      if (status?.status === "ok") {
        skipOk += 1;
        continue;
      }
      if (status?.status === "deferred_budget" && nowMs - status.updatedAtMs < BUDGET_DEFER_INTERVAL_MS) {
        skipRetry += 1;
        continue;
      }
      const last = lastAttemptAt.get(job.periodKey) ?? 0;
      const waitMs = RETRY_INTERVAL_MS - (nowMs - last);
      if (waitMs > 0) {
        skipRetry += 1;
        console.log(
          "[memory-scheduler] skip retry wait",
          job.level,
          job.periodKey,
          `in ${Math.ceil(waitMs / 1000)}s`,
          status?.status ? `status=${status.status}` : "status=missing"
        );
        continue;
      }
      lastAttemptAt.set(job.periodKey, nowMs);
      const estimate = await estimateDigestRun({ level: job.level, periodKey: job.periodLabel });
      if (estimate.overBudget) {
        const message = `Estimated LLM calls ${estimate.estimatedLlmCalls} exceed budget ${estimate.callBudget}.`;
        await upsertReportJob(desktopDb, job.periodKey, "deferred_budget", message);
        const runId = await startScheduleRun(desktopDb, { level: job.level, periodKey: job.periodKey, trigger: "schedule" });
        await finishScheduleRun(desktopDb, runId, { status: "skipped", error: message });
        skipRetry += 1;
        continue;
      }
      attempted += 1;
      try {
        await runLoggedSchedule(desktopDb, job.level, job.periodKey, async () => {
          if (job.level === "daily") {
            await runDailyDigest({ date: job.periodLabel, trigger: "schedule" });
          } else if (job.level === "weekly") {
            await runWeeklyDigest({ weekKey: job.periodLabel, trigger: "schedule" });
          } else {
            await runMonthlyDigest({ monthKey: job.periodLabel, trigger: "schedule" });
          }
        });
      } catch (error) {
        // Also stored in schedule_run_logs; keep going for other due jobs.
        void recordAppError({
          source: "memory-scheduler",
          message: `job failed ${job.level} ${job.periodKey}`,
          error
        });
      }
    }
    if (attempted > 0 || skipRetry > 0) {
      console.log(
        `[memory-scheduler] tick due=${due.length} attempted=${attempted} skipOk=${skipOk} skipRetry=${skipRetry}`
      );
    } else if (skipOk === due.length) {
      // All due periods already successful — quiet unless debugging.
    }
  } finally {
    running = false;
  }
}

async function runLoggedSchedule(
  desktopDb: string,
  level: ScheduleLevel,
  periodKey: string,
  fn: () => Promise<void>
): Promise<void> {
  const started = Date.now();
  const runId = await startScheduleRun(desktopDb, {
    level,
    periodKey,
    trigger: "schedule"
  });
  console.log("[memory-scheduler] running", level, periodKey);
  try {
    await fn();
    const events = await listLlmUsageEvents(desktopDb, { fromMs: started, limit: 50 });
    const related = events.filter(
      (e) => e.jobKey === periodKey || e.source === level || e.source === "schedule"
    );
    let prompt = 0;
    let completion = 0;
    let total = 0;
    for (const e of related) {
      prompt += e.promptTokens || 0;
      completion += e.completionTokens || 0;
      total += e.totalTokens || 0;
    }
    await finishScheduleRun(desktopDb, runId, {
      status: "ok",
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishScheduleRun(desktopDb, runId, {
      status: "error",
      error: message
    });
    throw error;
  }
}

function clampHour(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(23, Math.floor(value)));
}

function isPastLocalHour(now: Date, hour: number): boolean {
  return now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= 0);
}

function formatLocalDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Test helper: clear in-process retry throttle. */
export function resetSchedulerRetryStateForTests(): void {
  lastAttemptAt.clear();
  running = false;
}
