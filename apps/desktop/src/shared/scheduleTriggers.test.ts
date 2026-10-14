import { describe, expect, it } from "vitest";
import {
  computeNextRun,
  enumerateMissedRuns,
  selectCatchUpRuns,
  validateCron
} from "./scheduleTriggers";

describe("validateCron", () => {
  it("accepts real expressions", () => {
    expect(validateCron("0 9 * * 1-5").ok).toBe(true);
    expect(validateCron("*/15 * * * *").ok).toBe(true);
    expect(validateCron("0 0 1 * *").ok).toBe(true);
  });

  it("rejects malformed and empty expressions", () => {
    expect(validateCron("").ok).toBe(false);
    expect(validateCron("   ").ok).toBe(false);
    expect(validateCron("not a cron").ok).toBe(false);
    expect(validateCron("0 9 * *").ok).toBe(false);
  });

  it("rejects an expression that can never fire", () => {
    // Feb 30 does not exist; a schedule built on it would be silently dead.
    const result = validateCron("0 0 30 2 *");
    expect(result.ok).toBe(false);
  });
});

describe("computeNextRun", () => {
  it("returns undefined for manual", () => {
    expect(computeNextRun("manual", "", 1_000)).toBeUndefined();
  });

  it("adds the interval for interval triggers", () => {
    const base = 1_000_000;
    expect(computeNextRun("interval", "15m", base)).toBe(base + 15 * 60_000);
    expect(computeNextRun("interval", "1h", base)).toBe(base + 60 * 60_000);
    expect(computeNextRun("interval", "2h", base)).toBe(base + 120 * 60_000);
    expect(computeNextRun("interval", "30", base)).toBe(base + 30 * 60_000);
    expect(computeNextRun("interval", "1d", base)).toBe(base + 1440 * 60_000);
  });

  it("computes the next daily occurrence in local time", () => {
    const at1000 = new Date(2025, 0, 1, 10, 0, 0).getTime();

    const nextToday = computeNextRun("daily", "11:00", at1000)!;
    expect(new Date(nextToday).getHours()).toBe(11);
    expect(new Date(nextToday).getDate()).toBe(1);

    const nextTomorrow = computeNextRun("daily", "09:00", at1000)!;
    expect(new Date(nextTomorrow).getHours()).toBe(9);
    expect(new Date(nextTomorrow).getDate()).toBe(2);
  });

  // The regression this whole module exists for: cron used to return `now + 1h`
  // regardless of the expression, so `0 9 * * 1-5` fired hourly.
  it("honours a real cron expression instead of falling back to hourly", () => {
    // Wednesday 2026-10-14 10:00 local.
    const wed = new Date(2026, 9, 14, 10, 0, 0).getTime();
    const next = computeNextRun("cron", "0 9 * * 1-5", wed)!;

    const d = new Date(next);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
    // Next weekday 09:00 after Wed 10:00 is Thursday.
    expect(d.getDate()).toBe(15);

    // And it is emphatically not "one hour later".
    expect(next).not.toBe(wed + 60 * 60_000);
  });

  it("walks past the weekend for a weekday-only cron", () => {
    // Friday 2026-10-16 10:00 → next is Monday 2026-10-19 09:00.
    const fri = new Date(2026, 9, 16, 10, 0, 0).getTime();
    const d = new Date(computeNextRun("cron", "0 9 * * 1-5", fri)!);
    expect(d.getDay()).toBe(1); // Monday
    expect(d.getDate()).toBe(19);
    expect(d.getHours()).toBe(9);
  });

  it("returns undefined for an unparseable cron rather than guessing", () => {
    expect(computeNextRun("cron", "totally bogus")).toBeUndefined();
    expect(computeNextRun("cron", "")).toBeUndefined();
  });

  it("handles sub-hourly cron", () => {
    const wed = new Date(2026, 9, 14, 10, 0, 0).getTime();
    const next = computeNextRun("cron", "*/15 * * * *", wed)!;
    expect(new Date(next).getMinutes()).toBe(15);
    expect(new Date(next).getHours()).toBe(10);
  });
});

describe("enumerateMissedRuns", () => {
  it("returns nothing for an empty or inverted window", () => {
    expect(enumerateMissedRuns("interval", "1h", 1_000, 1_000)).toEqual([]);
    expect(enumerateMissedRuns("interval", "1h", 2_000, 1_000)).toEqual([]);
  });

  it("counts every interval point in the window", () => {
    const step = 60 * 60_000;
    const start = 1_000_000;
    const missed = enumerateMissedRuns("interval", "1h", start, start + 3 * step);
    expect(missed).toEqual([start + step, start + 2 * step, start + 3 * step]);
  });

  it("counts cron points across a multi-day outage", () => {
    // Last ran Wed 2026-10-14 09:00; restarted Mon 2026-10-19 10:00.
    const last = new Date(2026, 9, 14, 9, 0, 0).getTime();
    const now = new Date(2026, 9, 19, 10, 0, 0).getTime();
    const missed = enumerateMissedRuns("cron", "0 9 * * 1-5", last, now);

    // Thu 15, Fri 16, Mon 19 → three weekday firings.
    expect(missed.length).toBe(3);
    expect(missed.every((ms) => new Date(ms).getHours() === 9)).toBe(true);
    expect(missed.every((ms) => [1, 2, 3, 4, 5].includes(new Date(ms).getDay()))).toBe(true);
  });

  it("counts daily points", () => {
    const last = new Date(2026, 9, 14, 9, 0, 0).getTime();
    const now = new Date(2026, 9, 17, 10, 0, 0).getTime();
    const missed = enumerateMissedRuns("daily", "09:00", last, now);
    expect(missed.length).toBe(3);
  });

  it("caps the walk so a chatty schedule cannot allocate unboundedly", () => {
    const start = 1_000_000;
    const missed = enumerateMissedRuns("interval", "1m", start, start + 1_000 * 60_000, 10);
    expect(missed.length).toBe(10);
  });

  it("returns nothing for an unparseable cron", () => {
    expect(enumerateMissedRuns("cron", "nonsense", 0, 1e12)).toEqual([]);
  });

  it("returns nothing for manual", () => {
    expect(enumerateMissedRuns("manual", "", 0, 1e12)).toEqual([]);
  });
});

describe("selectCatchUpRuns", () => {
  const missed = [1, 2, 3];

  it("skip runs nothing", () => {
    expect(selectCatchUpRuns(missed, "skip")).toEqual([]);
  });

  it("once runs only the most recent point", () => {
    expect(selectCatchUpRuns(missed, "once")).toEqual([3]);
  });

  it("all runs every point in order", () => {
    expect(selectCatchUpRuns(missed, "all")).toEqual([1, 2, 3]);
  });

  it("handles an empty window for every policy", () => {
    for (const policy of ["skip", "once", "all"] as const) {
      expect(selectCatchUpRuns([], policy)).toEqual([]);
    }
  });
});
