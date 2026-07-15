import {
  finishScheduleRun,
  getReportJobStatus,
  listLlmUsageEvents,
  loadSettings,
  localDayRange,
  previousCompleteMonthRange,
  previousCompleteWeekRange,
  runDailyDigest,
  runMonthlyDigest,
  runWeeklyDigest,
  startScheduleRun
} from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";

let timer: ReturnType<typeof setInterval> | null = null;
let lastFiredKey = "";

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
      console.error("[memory-scheduler]", err);
    });
  }, 60_000);
  void tick().catch((err) => console.error("[memory-scheduler]", err));
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

async function tick(): Promise<void> {
  const settings = await loadSettings();
  if (settings.report?.enabled !== true) {
    return;
  }

  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  if (minute > 2) {
    return;
  }

  const dailyHour = clampHour(settings.report?.scheduleDailyHour, 22);
  const weeklyHour = clampHour(settings.report?.scheduleWeeklyHour, 9);
  const monthlyHour = clampHour(settings.report?.scheduleMonthlyHour, 9);

  const paths = await loadPanelDbPaths(settings);
  const desktopDb = paths.desktopDb;

  if (hour === dailyHour) {
    const day = localDayRange();
    const fireKey = `auto:${day.jobKey}:${now.toDateString()}`;
    if (fireKey !== lastFiredKey) {
      const status = await getReportJobStatus(desktopDb, day.jobKey);
      if (status?.status !== "ok") {
        lastFiredKey = fireKey;
        await runLoggedSchedule(desktopDb, "daily", day.jobKey, async () => {
          await runDailyDigest({ date: day.dateLabel });
        });
      }
    }
  }

  if (now.getDay() === 1 && hour === weeklyHour) {
    const week = previousCompleteWeekRange(now);
    const fireKey = `auto:${week.jobKey}:${now.toDateString()}`;
    if (fireKey !== lastFiredKey) {
      const status = await getReportJobStatus(desktopDb, week.jobKey);
      if (status?.status !== "ok") {
        lastFiredKey = fireKey;
        await runLoggedSchedule(desktopDb, "weekly", week.jobKey, async () => {
          await runWeeklyDigest({ weekKey: week.label });
        });
      }
    }
  }

  if (now.getDate() === 1 && hour === monthlyHour) {
    const month = previousCompleteMonthRange(now);
    const fireKey = `auto:${month.jobKey}:${now.toDateString()}`;
    if (fireKey !== lastFiredKey) {
      const status = await getReportJobStatus(desktopDb, month.jobKey);
      if (status?.status !== "ok") {
        lastFiredKey = fireKey;
        await runLoggedSchedule(desktopDb, "monthly", month.jobKey, async () => {
          await runMonthlyDigest({ monthKey: month.label });
        });
      }
    }
  }
}

async function runLoggedSchedule(
  desktopDb: string,
  level: "daily" | "weekly" | "monthly",
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