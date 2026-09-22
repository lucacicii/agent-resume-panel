import { describe, expect, it } from "vitest";
import {
  computeNextRun,
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  updateSchedule
} from "./thunderScheduler";

describe("thunderScheduler computeNextRun", () => {
  const baseTime = new Date("2025-01-01T10:00:00.000Z").getTime();

  it("returns undefined for manual trigger", () => {
    expect(computeNextRun("manual", "", baseTime)).toBeUndefined();
  });

  it("computes next interval correctly", () => {
    expect(computeNextRun("interval", "15m", baseTime)).toBe(baseTime + 15 * 60_000);
    expect(computeNextRun("interval", "1h", baseTime)).toBe(baseTime + 60 * 60_000);
    expect(computeNextRun("interval", "2h", baseTime)).toBe(baseTime + 120 * 60_000);
    expect(computeNextRun("interval", "30", baseTime)).toBe(baseTime + 30 * 60_000);
  });

  it("computes next daily run correctly", () => {
    // Current time: 10:00
    // Target 11:00 should be today
    const nextToday = computeNextRun("daily", "11:00", new Date(2025, 0, 1, 10, 0, 0).getTime());
    expect(new Date(nextToday!).getHours()).toBe(11);
    expect(new Date(nextToday!).getDate()).toBe(1);

    // Target 09:00 has already passed today, so should be tomorrow
    const nextTomorrow = computeNextRun("daily", "09:00", new Date(2025, 0, 1, 10, 0, 0).getTime());
    expect(new Date(nextTomorrow!).getHours()).toBe(9);
    expect(new Date(nextTomorrow!).getDate()).toBe(2);
  });

  it("creates, updates, and deletes schedule in database without SQLite syntax error", async () => {
    const created = await createSchedule({
      name: "Test Schedule 4b10",
      prompt: "Perform git check and generate report",
      workspaceDir: "/tmp/project",
      model: "openai/gpt-4o",
      triggerType: "interval",
      triggerValue: "30m",
      enabled: true
    });

    expect(created.id).toMatch(/^sched_/);
    expect(created.name).toBe("Test Schedule 4b10");
    expect(created.lastStatus).toBe("idle");

    const fetched = await getSchedule(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("Test Schedule 4b10");

    const updated = await updateSchedule(created.id, {
      name: "Updated Schedule 4b10"
    });
    expect(updated.name).toBe("Updated Schedule 4b10");

    const deleted = await deleteSchedule(created.id);
    expect(deleted).toBe(true);

    const afterDelete = await getSchedule(created.id);
    expect(afterDelete).toBeNull();
  });
});

