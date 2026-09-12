import { describe, expect, it } from "vitest";
import { REGIONS, isRegionName, resolveRegion } from "./region";

const SCREEN = [
  "header line",
  "",
  "  ⏺ Working…",
  "────────────────────",
  "Do you want to proceed?",
  "❯ 1. Yes",
  "  2. No",
  ""
].join("\n");

const input = { screenText: SCREEN, oscTitle: "⠂ claude", oscProgress: "4;0" };

describe("isRegionName", () => {
  it("accepts every documented region and its parameter form", () => {
    const parameterized: Record<string, string> = {
      bottom_non_empty_lines: "bottom_non_empty_lines(12)",
      top_non_empty_lines: "top_non_empty_lines(5)"
    };
    for (const region of REGIONS) {
      expect(isRegionName(parameterized[region] ?? region), region).toBe(true);
    }
  });

  it("rejects an unknown region or a missing parameter", () => {
    expect(isRegionName("nowhere")).toBe(false);
    expect(isRegionName("bottom_non_empty_lines")).toBe(false);
    expect(isRegionName("bottom_non_empty_lines(0)")).toBe(false);
  });
});

describe("resolveRegion", () => {
  it("returns the whole snapshot for whole_recent", () => {
    expect(resolveRegion(input, "whole_recent")?.text).toBe(SCREEN);
  });

  it("takes the last non-empty lines", () => {
    expect(resolveRegion(input, "bottom_non_empty_lines(2)")?.text).toBe("❯ 1. Yes\n  2. No");
  });

  it("takes the first non-empty lines", () => {
    expect(resolveRegion(input, "top_non_empty_lines(3)")?.text).toBe(
      "header line\n  ⏺ Working…\n────────────────────"
    );
  });

  it("starts after the last horizontal rule", () => {
    expect(resolveRegion(input, "after_last_horizontal_rule")?.text).toBe(
      "Do you want to proceed?\n❯ 1. Yes\n  2. No\n"
    );
  });

  it("returns an empty region when no rule is on screen", () => {
    const text = "just a prompt\n❯ ";
    expect(resolveRegion({ screenText: text, oscTitle: "", oscProgress: "" }, "after_last_horizontal_rule")?.text)
      .toBe("");
  });

  it("reads OSC-derived regions from their own fields", () => {
    expect(resolveRegion(input, "osc_title")?.text).toBe("⠂ claude");
    expect(resolveRegion(input, "osc_progress")?.text).toBe("4;0");
  });

  it("returns null for an unusable region", () => {
    expect(resolveRegion(input, "nowhere")).toBeNull();
    expect(resolveRegion(input, "bottom_non_empty_lines")).toBeNull();
  });

  it("treats missing telemetry as an empty screen", () => {
    expect(resolveRegion(undefined, "whole_recent")?.text).toBe("");
    expect(resolveRegion(undefined, "osc_title")?.text).toBe("");
  });
});
