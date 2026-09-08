import { deflateSync } from "node:zlib";
import { nativeImage, nativeTheme, type NativeImage } from "electron";
import type { WorkbenchActiveSessionDot, WorkbenchSessionDotStatus } from "../shared/workbenchSelection";

export const TRAY_MAX_DOTS = 8;
export const TRAY_PAD_X = 7;
export const TRAY_GAP = 12;
export const TRAY_DOT_DIAMETER = 11;
export const TRAY_HEIGHT = 22;

const STATUS_COLORS_LIGHT: Record<WorkbenchSessionDotStatus, [number, number, number]> = {
  awaiting_user: [255, 149, 0],
  error: [255, 59, 48],
  running: [0, 122, 255],
  connecting: [142, 142, 147],
  open: [52, 199, 89]
};

const STATUS_COLORS_DARK: Record<WorkbenchSessionDotStatus, [number, number, number]> = {
  awaiting_user: [255, 159, 10],
  error: [255, 69, 58],
  running: [10, 132, 255],
  connecting: [174, 174, 178],
  open: [48, 209, 88]
};

const IDLE_COLOR_LIGHT: [number, number, number] = [174, 174, 178];
const IDLE_COLOR_DARK: [number, number, number] = [99, 99, 102];
const NOTE_COLOR_LIGHT: [number, number, number] = [0, 122, 255];
const NOTE_COLOR_DARK: [number, number, number] = [10, 132, 255];

export type TrayNoteItem = { kind: "note"; noteId: string; title: string };
export type TraySessionItem = {
  kind: "session";
  paneKey: string;
  projectPath: string;
  title: string;
  status: WorkbenchSessionDotStatus;
};
export type TrayItem = TrayNoteItem | TraySessionItem;
export type TrayDot = Pick<WorkbenchActiveSessionDot, "paneKey" | "projectPath" | "title" | "status">;

export function composeTrayItems(
  notes: ReadonlyArray<{ noteId: string; title: string }>,
  sessions: ReadonlyArray<TrayDot>
): TrayItem[] {
  const items: TrayItem[] = [];
  for (const note of notes) {
    items.push({ kind: "note", noteId: note.noteId, title: note.title });
  }
  for (const session of sessions) {
    items.push({
      kind: "session",
      paneKey: session.paneKey,
      projectPath: session.projectPath,
      title: session.title,
      status: session.status
    });
  }
  return items.slice(0, TRAY_MAX_DOTS);
}

export function visibleTrayDots(dots: readonly TrayDot[]): TrayDot[] {
  return dots.slice(0, TRAY_MAX_DOTS);
}

export function trayIconSize(dotCount: number): { width: number; height: number } {
  const visible = Math.max(1, Math.min(TRAY_MAX_DOTS, dotCount));
  return {
    width: TRAY_PAD_X * 2 + visible * TRAY_DOT_DIAMETER + (visible - 1) * TRAY_GAP,
    height: TRAY_HEIGHT
  };
}

export function trayDotCenterX(index: number): number {
  return TRAY_PAD_X + index * (TRAY_DOT_DIAMETER + TRAY_GAP) + TRAY_DOT_DIAMETER / 2;
}

/** Nearest visible-dot center in icon-local CSS pixels. */
export function hitTestTrayDot(localX: number, visibleCount: number): number | null {
  const count = Math.min(TRAY_MAX_DOTS, Math.max(0, visibleCount));
  if (count <= 0 || !Number.isFinite(localX)) return null;
  let best = 0;
  let bestDist = Math.abs(localX - trayDotCenterX(0));
  for (let i = 1; i < count; i += 1) {
    const dist = Math.abs(localX - trayDotCenterX(i));
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/** Convert a screen click into icon-local CSS pixels, then pick a visible-dot index. */
export function hitTestTrayDotFromScreen(
  screenX: number,
  trayBounds: { x: number; y: number; width: number; height: number } | undefined,
  visibleCount: number,
  clickPosition?: { x: number; y: number }
): number | null {
  const count = Math.min(TRAY_MAX_DOTS, Math.max(0, visibleCount));
  if (count <= 0) return null;
  if (typeof clickPosition?.x === "number" && Number.isFinite(clickPosition.x)) {
    return hitTestTrayDot(clickPosition.x, count);
  }
  if (!trayBounds || !Number.isFinite(trayBounds.x) || !Number.isFinite(trayBounds.width) || trayBounds.width <= 0) {
    return null;
  }
  return hitTestTrayDot(screenX - trayBounds.x, count);
}

export function trayTooltip(items: readonly TrayItem[], extra = 0): string {
  if (items.length === 0) return "No open sessions";
  const lines = items.map((item) => {
    if (item.kind === "note") return item.title.trim() || "Note";
    const title = item.title.trim() || "Session";
    return statusSuffix(item.status) ? `${title} · ${statusSuffix(item.status)}` : title;
  });
  if (extra > 0) lines.push(`+${extra} more`);
  return lines.join("\n");
}

function statusSuffix(status: WorkbenchSessionDotStatus): string {
  if (status === "awaiting_user") return "Waiting";
  if (status === "running") return "Running";
  if (status === "connecting") return "Connecting";
  if (status === "error") return "Error";
  return "";
}

export function renderSessionDotsTrayPng(
  items: readonly TrayItem[],
  options?: { dark?: boolean; scale?: number }
): Buffer {
  const dark = options?.dark === true;
  const scale = Math.max(1, Math.min(3, Math.round(options?.scale || 2)));
  const visible = items.slice(0, TRAY_MAX_DOTS);
  const logical = trayIconSize(visible.length);
  const width = logical.width * scale;
  const height = logical.height * scale;
  const rgba = Buffer.alloc(width * height * 4);
  const palette = dark ? STATUS_COLORS_DARK : STATUS_COLORS_LIGHT;
  const idle = dark ? IDLE_COLOR_DARK : IDLE_COLOR_LIGHT;
  const noteColor = dark ? NOTE_COLOR_DARK : NOTE_COLOR_LIGHT;
  const cy = (logical.height / 2) * scale;
  const radius = (TRAY_DOT_DIAMETER / 2) * scale;
  if (visible.length === 0) {
    blitCircle(rgba, width, height, trayDotCenterX(0) * scale, cy, radius, idle);
  } else {
    for (let i = 0; i < visible.length; i += 1) {
      const cx = trayDotCenterX(i) * scale;
      const item = visible[i];
      if (item.kind === "note") {
        blitRoundedSquare(rgba, width, height, cx, cy, radius, noteColor);
      } else {
        blitCircle(rgba, width, height, cx, cy, radius, palette[item.status] || palette.open);
      }
    }
  }
  return encodePng(width, height, rgba);
}

export function sessionDotsTrayImage(items: readonly TrayItem[]): NativeImage {
  const dark = nativeTheme.shouldUseDarkColors;
  const png = renderSessionDotsTrayPng(items, { dark, scale: 2 });
  const image = nativeImage.createFromBuffer(png, { scaleFactor: 2 });
  image.setTemplateImage(false);
  return image;
}

function blitRoundedSquare(
  rgba: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  half: number,
  rgb: [number, number, number]
): void {
  const corner = Math.max(1.4, half * 0.32);
  const inner = Math.max(0.5, half - corner);
  const minX = Math.max(0, Math.floor(cx - half - 1));
  const maxX = Math.min(width - 1, Math.ceil(cx + half + 1));
  const minY = Math.max(0, Math.floor(cy - half - 1));
  const maxY = Math.min(height - 1, Math.ceil(cy + half + 1));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = Math.abs(x + 0.5 - cx) - inner;
      const dy = Math.abs(y + 0.5 - cy) - inner;
      const ox = Math.max(dx, 0);
      const oy = Math.max(dy, 0);
      const dist = Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - corner;
      const coverage = Math.max(0, Math.min(1, 0.55 - dist));
      const glow = dist < 1.4 ? Math.max(0, 1 - (dist + corner) / (half + 1.4)) * 0.28 : 0;
      const alpha = Math.max(coverage, glow);
      if (alpha <= 0) continue;
      const i = (y * width + x) * 4;
      rgba[i] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
      rgba[i + 3] = Math.round(Math.min(255, alpha * 255));
    }
  }
}

function blitCircle(
  rgba: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  rgb: [number, number, number]
): void {
  const r2 = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius - 1));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius + 1));
  const minY = Math.max(0, Math.floor(cy - radius - 1));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius + 1));
  const ring = Math.max(1.1, radius * 0.22);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > (radius + 0.6) * (radius + 0.6)) continue;
      const dist = Math.sqrt(d2);
      const coverage = Math.max(0, Math.min(1, radius + 0.35 - dist));
      const glow = dist < radius + ring ? Math.max(0, 1 - dist / (radius + ring)) * 0.35 : 0;
      const alpha = Math.max(coverage, glow);
      if (alpha <= 0) continue;
      const i = (y * width + x) * 4;
      rgba[i] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
      rgba[i + 3] = Math.round(Math.min(255, alpha * 255));
    }
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const payload = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const dest = y * (width * 4 + 1);
    raw[dest] = 0;
    rgba.copy(raw, dest + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}
