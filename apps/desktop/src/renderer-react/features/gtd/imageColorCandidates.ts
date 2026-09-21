import { extractDominantColors } from "../../../shared/imageColors";

/**
 * Extract dominant-color candidates from an image data URL in the renderer.
 *
 * Canvas gives deterministic RGBA pixels (unlike `nativeImage` raw bitmaps,
 * whose channel order is platform-specific), and the main process already
 * normalized the image to a ≤256px PNG, so this decode is small and fast.
 * Returns the candidate hexes ordered best-first; empty when the image has no
 * vivid color.
 */
export async function extractImageColorCandidates(dataUrl: string): Promise<string[]> {
  const image = new Image();
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    return [];
  }
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) return [];
  const scale = Math.min(1, 128 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  context.drawImage(image, 0, 0, w, h);
  const { data } = context.getImageData(0, 0, w, h);
  return extractDominantColors({ width: w, height: h, data });
}
