/**
 * Dominant-color extraction for task template images.
 *
 * Pure RGBA quantization with no platform dependencies: the renderer feeds it
 * canvas `ImageData` (always RGBA), so no Electron pixel-format assumptions
 * are involved. The result feeds the template's custom accent — only the hue
 * of the chosen color reaches the window tint (see taskColors.ts), so this
 * module optimizes for finding *distinct vivid hues* rather than exact color
 * fidelity: near-neutral, near-black, and near-white pixels are skipped, hues
 * are clustered into 10° bins scored by population × chroma, and selected
 * candidates are kept at least 25° apart so the palette reads as different
 * colors, not shades of one.
 */

export type RgbaImageData = {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
};

const HUE_BINS = 36;
const BIN_DEGREES = 360 / HUE_BINS;
const MIN_SATURATION = 0.18;
const MIN_LIGHTNESS = 0.1;
const MAX_LIGHTNESS = 0.92;
const MIN_HUE_DISTANCE_DEGREES = 25;
const DEFAULT_MAX_COLORS = 6;

interface HueBin {
  count: number;
  sumR: number;
  sumG: number;
  sumB: number;
  sumS: number;
}

/** RGB [0..255] → HSL with hue in degrees [0, 360) and s/l in [0, 1]. */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${((clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).padStart(6, "0")}`;
}

/** Smallest angle between two hues, in degrees. */
function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

/**
 * Extract up to `maxColors` dominant colors as `#rrggbb`, ordered by
 * (population × chroma) score — the first entry is the recommendation.
 * Returns an empty array when the image has no vivid enough color (grayscale,
 * near-black, near-white): a neutral hue would tint windows arbitrarily, so
 * callers treat that as "no usable colors".
 */
export function extractDominantColors(image: RgbaImageData, maxColors = DEFAULT_MAX_COLORS): string[] {
  const { width, height, data } = image;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  if (data.length < width * height * 4) return [];

  const bins: HueBin[] = Array.from({ length: HUE_BINS }, () => ({ count: 0, sumR: 0, sumG: 0, sumB: 0, sumS: 0 }));
  const pixelCount = width * height;
  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < MIN_SATURATION || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) continue;
    const bin = bins[Math.min(HUE_BINS - 1, Math.floor(h / BIN_DEGREES))];
    bin.count += 1;
    bin.sumR += r;
    bin.sumG += g;
    bin.sumB += b;
    bin.sumS += s;
  }

  const ranked = bins
    .filter((bin) => bin.count > 0)
    .map((bin) => ({
      score: bin.count * (0.25 + bin.sumS / bin.count),
      count: bin.count,
      r: bin.sumR / bin.count,
      g: bin.sumG / bin.count,
      b: bin.sumB / bin.count
    }))
    .sort((a, b) => b.score - a.score);

  const picked: Array<{ hex: string; h: number }> = [];
  for (const entry of ranked) {
    if (picked.length >= maxColors) break;
    const hex = toHex(entry.r, entry.g, entry.b);
    const { h } = rgbToHsl(entry.r, entry.g, entry.b);
    if (picked.some((existing) => hueDistance(existing.h, h) < MIN_HUE_DISTANCE_DEGREES)) continue;
    picked.push({ hex, h });
  }
  return picked.map((entry) => entry.hex);
}
