import { describe, expect, it } from "vitest";
import type { ReportEntry } from "@agent-resume/core";
import { calendarCells, digestIndex, isoWeekLabelFromDate, parseDayRange, parseMonthRange, parseWeekRange, periodKeyFromEntry } from "./model";

const entry = (level: string, id: string, periodStartMs: number): ReportEntry => ({ id, level, periodStartMs, periodEndMs: periodStartMs + 1, title: null, content: "", embeddingJson: null, createdAtMs: periodStartMs });

describe("report model", () => {
  it("uses Monday-based ISO week labels across the year boundary", () => {
    expect(isoWeekLabelFromDate(new Date(2024, 0, 1))).toBe("2024-W01");
    expect(isoWeekLabelFromDate(new Date(2023, 11, 31))).toBe("2023-W52");
  });

  it("returns validated local ranges for every calendar period", () => {
    const day = parseDayRange("2024-02-29");
    const week = parseWeekRange("2024-W01");
    expect(day).not.toBeNull();
    expect(week).not.toBeNull();
    expect(day!.toMs - day!.fromMs).toBe(86_400_000);
    expect(parseDayRange("2024-02-30")).toBeNull();
    expect(week!.toMs - week!.fromMs).toBe(7 * 86_400_000);
    expect(parseMonthRange("2024-13")).toBeNull();
  });

  it("builds a stable six-row calendar and indexes generated digests", () => {
    const cells = calendarCells(2024, 1);
    expect(cells).toHaveLength(42);
    expect(cells[0]?.key).toBe("2024-01-29");
    expect(cells.at(-1)?.key).toBe("2024-03-10");

    const index = digestIndex([
      entry("daily", "daily:2024-02-01", Date.UTC(2024, 1, 1)),
      entry("weekly", "weekly:2024-W05", Date.UTC(2024, 1, 1)),
      entry("monthly", "monthly:2024-02", Date.UTC(2024, 1, 1))
    ]);
    expect(index.get("daily:2024-02-01")?.id).toBe("daily:2024-02-01");
    expect(periodKeyFromEntry(entry("monthly", "other", Date.UTC(2024, 1, 1)))).toBe("2024-02");
  });

  it("chooses the newest digest when legacy and canonical entries share a period", () => {
    const period = new Date(2026, 6, 9).getTime();
    const older = { ...entry("daily", "legacy-uuid", period), createdAtMs: period + 1 };
    const newer = { ...entry("daily", "daily:2026-07-09", period), createdAtMs: period + 2 };
    expect(digestIndex([newer, older]).get("daily:2026-07-09")?.id).toBe("daily:2026-07-09");
    expect(digestIndex([older, newer]).get("daily:2026-07-09")?.id).toBe("daily:2026-07-09");
  });

});
