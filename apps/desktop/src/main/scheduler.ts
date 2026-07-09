import {
  catalogDbFromSettings,
  getMemoryJobStatus,
  loadSettings,
  localDayRange,
  previousCompleteMonthRange,
  previousCompleteWeekRange,
  runDailyDigest,
  runMonthlyDigest,
  runWeeklyDigest
} from "@agent-resume/core";

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
  // Also evaluate shortly after start
  void tick().catch((err) => console.error("[memory-scheduler]", err));
}

export async function refreshMemorySchedulerFromSettings(): Promise<boolean> {
  const settings = await loadSettings();
  const enabled = settings.memory?.enabled === true;
  if (enabled) {
    startMemoryScheduler();
  } else {
    stopMemoryScheduler();
  }
  return enabled;
}

async function tick(): Promise<void> {
  const settings = await loadSettings();
  if (settings.memory?.enabled !== true) {
    return;
  }

  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  // Fire once in the target hour (first minute window)
  if (minute > 2) {
    return;
  }

  const dailyHour = clampHour(settings.memory?.scheduleDailyHour, 22);
  const weeklyHour = clampHour(settings.memory?.scheduleWeeklyHour, 9);
  const monthlyHour = clampHour(settings.memory?.scheduleMonthlyHour, 9);

  const dbPath = catalogDbFromSettings(settings);

  if (hour === dailyHour) {
    const day = localDayRange();
    const fireKey = `auto:${day.jobKey}:${now.toDateString()}`;
    if (fireKey !== lastFiredKey) {
      const status = await getMemoryJobStatus(dbPath, day.jobKey);
      if (status?.status !== "ok") {
        lastFiredKey = fireKey;
        console.log("[memory-scheduler] running daily", day.jobKey);
        await runDailyDigest({ date: day.dateLabel });
      }
    }
  }

  // Monday = 1
  if (now.getDay() === 1 && hour === weeklyHour) {
    const week = previousCompleteWeekRange(now);
    const fireKey = `auto:${week.jobKey}:${now.toDateString()}`;
    if (fireKey !== lastFiredKey) {
      const status = await getMemoryJobStatus(dbPath, week.jobKey);
      if (status?.status !== "ok") {
        lastFiredKey = fireKey;
        console.log("[memory-scheduler] running weekly", week.jobKey);
        await runWeeklyDigest({ weekKey: week.label });
      }
    }
  }

  if (now.getDate() === 1 && hour === monthlyHour) {
    const month = previousCompleteMonthRange(now);
    const fireKey = `auto:${month.jobKey}:${now.toDateString()}`;
    if (fireKey !== lastFiredKey) {
      const status = await getMemoryJobStatus(dbPath, month.jobKey);
      if (status?.status !== "ok") {
        lastFiredKey = fireKey;
        console.log("[memory-scheduler] running monthly", month.jobKey);
        await runMonthlyDigest({ monthKey: month.label });
      }
    }
  }
}

function clampHour(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(23, Math.floor(value)));
}
