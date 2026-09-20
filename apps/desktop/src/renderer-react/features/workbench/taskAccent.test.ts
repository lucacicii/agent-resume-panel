import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isTaskColorKey,
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
    expect(taskAccent("teal", "abc")).toEqual({ colorKey: "teal", shade: taskShade("abc") });
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
