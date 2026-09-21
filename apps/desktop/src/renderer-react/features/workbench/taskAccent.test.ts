import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  hslFromHex,
  hueFromHex,
  isCustomHexColor,
  isTaskColorKey,
  normalizeCustomHexColor,
  TASK_COLOR_KEYS,
  TASK_COLOR_SHADES,
  taskAccent,
  taskShade
} from "../../../shared/taskColors";

const STYLES = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../renderer/styles.css"),
  "utf8"
);

describe("taskColors", () => {
  it("offers eight distinct palette keys", () => {
    expect(TASK_COLOR_KEYS).toHaveLength(8);
    expect(new Set(TASK_COLOR_KEYS).size).toBe(8);
  });

  it("guards palette keys against free-form colors", () => {
    expect(isTaskColorKey("blue")).toBe(true);
    expect(isTaskColorKey("BLUE")).toBe(false);
    expect(isTaskColorKey("#4678ff")).toBe(false);
    expect(isTaskColorKey("")).toBe(false);
    expect(isTaskColorKey(null)).toBe(false);
    expect(isTaskColorKey(7)).toBe(false);
  });

  it("accepts only well-formed custom hex colors", () => {
    expect(isCustomHexColor("#0a84ff")).toBe(true);
    expect(isCustomHexColor("#0A84FF")).toBe(true);
    expect(isCustomHexColor("0a84ff")).toBe(false);
    expect(isCustomHexColor("#0a84f")).toBe(false);
    expect(isCustomHexColor("#0a84fff")).toBe(false);
    expect(isCustomHexColor("blue")).toBe(false);
    expect(normalizeCustomHexColor("#0A84FF")).toBe("#0a84ff");
    expect(normalizeCustomHexColor("nope")).toBeUndefined();
  });

  it("converts hex to HSL and a hue degree", () => {
    // #ff0000 is pure red: hue 0, full saturation, half lightness.
    expect(hslFromHex("#ff0000")).toEqual({ h: 0, s: 1, l: 0.5 });
    // #0000ff is pure blue: hue 240.
    expect(hueFromHex("#0000ff")).toBe(240);
    // #00ff00 is pure green: hue 120.
    expect(hueFromHex("#00ff00")).toBe(120);
    // Grey has a defined (arbitrary) hue but zero saturation.
    expect(hslFromHex("#808080").s).toBe(0);
  });

  it("derives a stable shade within range for any note id", () => {
    expect(taskShade("n-1")).toBe(taskShade("n-1"));
    expect(taskShade("")).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 200; i++) {
      const shade = taskShade(`note-${i}`);
      expect(shade).toBeGreaterThanOrEqual(0);
      expect(shade).toBeLessThan(TASK_COLOR_SHADES);
    }
  });

  it("spreads shades across many ids instead of collapsing onto one", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(taskShade(`spread-${i}`));
    expect(seen.size).toBe(TASK_COLOR_SHADES);
  });

  it("pairs a color key with the task's derived shade", () => {
    expect(taskAccent({ colorKey: "teal" }, "abc")).toEqual({ colorKey: "teal", shade: taskShade("abc") });
  });

  it("pairs a custom image color with the task's derived shade", () => {
    expect(taskAccent({ customColor: "#4678ff" }, "abc")).toEqual({
      customColor: "#4678ff",
      shade: taskShade("abc")
    });
  });
});

describe("task accent skin (styles.css)", () => {
  it("defines hue/step anchors for every palette key and shade", () => {
    for (const key of TASK_COLOR_KEYS) {
      for (let shade = 0; shade < TASK_COLOR_SHADES; shade++) {
        expect(STYLES).toMatch(
          new RegExp(`\\[data-task-accent="${key}"\\]\\[data-task-shade="${shade}"\\]`)
        );
      }
    }
  });

  it("defines step anchors for custom accents without pinning a hue", () => {
    for (let shade = 0; shade < TASK_COLOR_SHADES; shade++) {
      const rule = STYLES.match(
        new RegExp(`\\[data-task-accent="custom"\\]\\[data-task-shade="${shade}"\\][^\\n]*`)
      );
      expect(rule, `missing custom shade ${shade}`).toBeTruthy();
      // The hue is injected inline by the renderer; the rule only carries the
      // lightness/saturation step so both themes keep their tuned formulas.
      expect(rule![0]).toContain("--task-dl:");
      expect(rule![0]).toContain("--task-ds:");
      expect(rule![0]).not.toContain("--task-h:");
    }
  });

  it("re-derives the background-family tokens on light and both dark paths", () => {
    const tokens = [
      "--color-window-bg:",
      "--color-sidebar-bg:",
      "--color-content-bg:",
      "--color-pane-bg:",
      "--color-card-bg:",
      "--color-separator:"
    ];
    const blocks = [
      "html[data-task-accent] {",
      'html[data-theme="dark"][data-task-accent] {',
      'html[data-task-accent]:not([data-theme="light"]) {'
    ];
    for (const block of blocks) {
      const start = STYLES.indexOf(block);
      expect(start, `missing block ${block}`).toBeGreaterThanOrEqual(0);
      const body = STYLES.slice(start, STYLES.indexOf("\n}", start));
      for (const token of tokens) expect(body, `${block} misses ${token}`).toContain(token);
    }
  });
});
