/**
 * Task accent colors — one palette key or image-derived color per task
 * template, one shade per task.
 *
 * The palette is fixed (8 hue keys) so light and dark themes can map each key
 * to a hand-tuned pair of color ramps; a free color picker cannot guarantee
 * contrast in both themes. Image-derived custom colors respect the same
 * guarantee by contributing *hue only*: the shade is derived from the note id,
 * never stored, and the saturation/lightness formulas in styles.css stay the
 * hand-tuned ones, so every task of the same template lands on a stable
 * lightness step — the property that makes multi-window comparisons readable
 * at a glance.
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

/** An image-derived accent color as `#rrggbb`. */
export type TaskCustomColor = string;

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function isCustomHexColor(value: unknown): value is TaskCustomColor {
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

/** Normalize to lowercase `#rrggbb`; returns undefined for anything else. */
export function normalizeCustomHexColor(value: unknown): TaskCustomColor | undefined {
  return isCustomHexColor(value) ? value.toLowerCase() : undefined;
}

/** Same-template tasks spread across this many lightness steps. */
export const TASK_COLOR_SHADES = 4;

/** A task's resolved accent: the template's palette key or custom color plus its shade step. */
export type TaskAccent = {
  colorKey?: TaskColorKey;
  customColor?: TaskCustomColor;
  shade: number;
};

/** An accent source as stored on a template: exactly one of the two forms. */
export type TaskAccentSource = {
  colorKey?: TaskColorKey;
  customColor?: TaskCustomColor;
};

/** HSL triple with hue in degrees [0, 360) and saturation/lightness in [0, 1]. */
export type Hsl = { h: number; s: number; l: number };

/** Convert `#rrggbb` to HSL. Input must already be a validated hex color. */
export function hslFromHex(hex: TaskCustomColor): Hsl {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  return { h: (h + 360) % 360, s, l };
}

/** The accent hue for a custom color, rounded to an integer CSS degree. */
export function hueFromHex(hex: TaskCustomColor): number {
  return Math.round(hslFromHex(hex).h);
}

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

export function taskAccent(source: TaskAccentSource, noteId: string): TaskAccent {
  return {
    ...(source.colorKey ? { colorKey: source.colorKey } : {}),
    ...(source.customColor ? { customColor: source.customColor } : {}),
    shade: taskShade(noteId)
  };
}
