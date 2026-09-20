/**
 * Task accent colors — one palette key per task template, one shade per task.
 *
 * The palette is fixed (8 hue keys) so light and dark themes can map each key
 * to a hand-tuned pair of color ramps; a free color picker cannot guarantee
 * contrast in both themes. The shade is derived from the note id, never stored:
 * every task of the same template lands on a stable lightness step, so two
 * windows of the same template differ in overall lightness — the property that
 * makes multi-window comparisons readable at a glance.
 */

export type TaskColorKey =
  | "blue"
  | "teal"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "pink"
  | "purple";

export const TASK_COLOR_KEYS: readonly TaskColorKey[] = [
  "blue",
  "teal",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple"
];

export function isTaskColorKey(value: unknown): value is TaskColorKey {
  return typeof value === "string" && (TASK_COLOR_KEYS as readonly string[]).includes(value);
}

/** Same-template tasks spread across this many lightness steps. */
export const TASK_COLOR_SHADES = 4;

/** A task's resolved accent: the template's palette key plus its shade step. */
export type TaskAccent = {
  colorKey: TaskColorKey;
  shade: number;
};

/** FNV-1a: stable across processes and restarts. */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The shade step for a task, derived from its note id. */
export function taskShade(noteId: string): number {
  return stableHash(noteId) % TASK_COLOR_SHADES;
}

export function taskAccent(colorKey: TaskColorKey, noteId: string): TaskAccent {
  return { colorKey, shade: taskShade(noteId) };
}
