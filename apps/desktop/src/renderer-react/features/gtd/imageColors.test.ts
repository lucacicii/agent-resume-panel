import { describe, expect, it } from "vitest";
import { extractDominantColors, type RgbaImageData } from "../../../shared/imageColors";

/** Build a solid RGBA image with per-pixel colors (hex strings). */
function imageFromPixels(width: number, height: number, pixelAt: (x: number, y: number) => string): RgbaImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const hex = pixelAt(x, y);
      const i = (y * width + x) * 4;
      data[i] = Number.parseInt(hex.slice(1, 3), 16);
      data[i + 1] = Number.parseInt(hex.slice(3, 5), 16);
      data[i + 2] = Number.parseInt(hex.slice(5, 7), 16);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("extractDominantColors", () => {
  it("returns the single vivid color of a flat image", () => {
    const image = imageFromPixels(8, 8, () => "#e04040");
    expect(extractDominantColors(image)).toEqual(["#e04040"]);
  });

  it("orders candidates by population and keeps both hues of a two-color image", () => {
    // Left half red, right quarter blue, top-right quarter green.
    const image = imageFromPixels(8, 8, (x, y) => {
      if (x < 4) return "#e04040";
      return y < 4 ? "#4060e0" : "#40c060";
    });
    const colors = extractDominantColors(image);
    expect(colors).toHaveLength(3);
    expect(colors[0]).toBe("#e04040"); // half the image
    expect(colors).toContain("#4060e0");
    expect(colors).toContain("#40c060");
  });

  it("returns nothing for grayscale, black, or white images", () => {
    expect(extractDominantColors(imageFromPixels(4, 4, () => "#808080"))).toEqual([]);
    expect(extractDominantColors(imageFromPixels(4, 4, () => "#0a0a0a"))).toEqual([]);
    expect(extractDominantColors(imageFromPixels(4, 4, () => "#f7f7f7"))).toEqual([]);
  });

  it("ignores transparent pixels", () => {
    const image = imageFromPixels(4, 4, () => "#e04040");
    for (let p = 0; p < image.width * image.height; p++) {
      image.data[p * 4 + 3] = 0;
    }
    expect(extractDominantColors(image)).toEqual([]);
  });

  it("keeps candidates at least 25 hue degrees apart", () => {
    // Twelve hues spaced 12° apart — all vivid, all densely populated.
    const hues = Array.from({ length: 12 }, (_, i) => 12 * i);
    const data = new Uint8ClampedArray(12 * 12 * 4);
    for (let p = 0; p < 12 * 12; p++) {
      const [r, g, b] = hslToRgbBytes(hues[p % 12], 0.8, 0.5);
      data[p * 4] = r;
      data[p * 4 + 1] = g;
      data[p * 4 + 2] = b;
      data[p * 4 + 3] = 255;
    }
    const colors = extractDominantColors({ width: 12, height: 12, data });
    expect(colors.length).toBeGreaterThan(1);
    expect(colors.length).toBeLessThanOrEqual(6);
    const huesOf = colors.map((hex) => hueOf(hex));
    for (let i = 0; i < huesOf.length; i++) {
      for (let j = i + 1; j < huesOf.length; j++) {
        const diff = Math.abs(huesOf[i] - huesOf[j]) % 360;
        const distance = Math.min(diff, 360 - diff);
        expect(distance).toBeGreaterThanOrEqual(25);
      }
    }
  });

  it("caps the result at maxColors", () => {
    const data = new Uint8ClampedArray(6 * 6 * 4);
    for (let p = 0; p < 6 * 6; p++) {
      const [r, g, b] = hslToRgbBytes(30 * (p % 6), 0.8, 0.5);
      data[p * 4] = r;
      data[p * 4 + 1] = g;
      data[p * 4 + 2] = b;
      data[p * 4 + 3] = 255;
    }
    expect(extractDominantColors({ width: 6, height: 6, data }, 3)).toHaveLength(3);
  });

  it("returns nothing for malformed dimensions or short buffers", () => {
    expect(extractDominantColors({ width: 0, height: 4, data: new Uint8ClampedArray(0) })).toEqual([]);
    expect(extractDominantColors({ width: 4, height: 4, data: new Uint8ClampedArray(8) })).toEqual([]);
  });
});

function hslToRgbBytes(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((rgb[0] + m) * 255), Math.round((rgb[1] + m) * 255), Math.round((rgb[2] + m) * 255)];
}

function hueOf(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}
