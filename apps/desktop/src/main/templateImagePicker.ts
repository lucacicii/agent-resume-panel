import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { dialog, nativeImage } from "electron";
import {
  ensureDesktopDbSchema,
  escapeSqlLiteral,
  loadSettings,
  runSqlite,
  runSqliteJson
} from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";

/**
 * Native image picker for task template accents: `dialog.showOpenDialog`
 * (never `<input type="file">`), then a normalized ≤256px PNG via
 * `nativeImage` so what is persisted — and what the renderer re-quantizes —
 * is small and format-stable. The last picked folder is remembered in
 * `desktop.db`, mirroring `directoryPicker.ts`.
 *
 * Decoding goes through Chromium (`nativeImage.createFromBuffer`, fed with
 * `fs.readFile` bytes so read errors surface their real errno). HEIC/HEIF —
 * the default iPhone photo format, frequently renamed to .png/.jpg — has no
 * Chromium decoder, so on macOS a failed decode falls back to one `sips`
 * conversion, the same system codec Preview uses.
 */

/** `catalog_meta` key holding the last directory the user picked an image in. */
const META_KEY = "desktop.lastPickTemplateImage";

/** Longest edge of the normalized PNG persisted per template. */
const MAX_EDGE = 256;

/** Extensions the picker offers; all are decodable directly or via `sips`. */
const IMAGE_FILTERS = [{ name: "Images", extensions: ["png", "jpg", "jpeg", "heic", "heif"] }];

const execFile = promisify(execFileCallback);

export type TemplateImagePick =
  | { ok: true; pngBase64: string }
  | { ok: false; canceled: true };

async function openDesktopDb(): Promise<string> {
  const paths = await loadPanelDbPaths(await loadSettings());
  await ensureDesktopDbSchema(paths.desktopDb);
  return paths.desktopDb;
}

async function readLastDirectory(dbPath: string): Promise<string | null> {
  try {
    const rows = await runSqliteJson<{ value: string }>(
      dbPath,
      `SELECT value FROM catalog_meta WHERE key = '${META_KEY}' LIMIT 1;`
    );
    return rows[0]?.value || null;
  } catch {
    return null;
  }
}

async function rememberDirectory(dbPath: string, dir: string): Promise<void> {
  try {
    await runSqlite(
      dbPath,
      `INSERT INTO catalog_meta (key, value) VALUES ('${META_KEY}', '${escapeSqlLiteral(dir)}')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`
    );
  } catch {
    /* remember for this session only rather than failing the pick */
  }
}

/** Resize keeping the aspect ratio so the longest edge is ≤ MAX_EDGE. */
function normalizedImage(image: Electron.NativeImage): Electron.NativeImage {
  const { width, height } = image.getSize();
  if (width <= MAX_EDGE && height <= MAX_EDGE) return image;
  const scale = MAX_EDGE / Math.max(width, height);
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  });
}

/**
 * One-shot `sips` conversion to PNG for formats Chromium cannot decode.
 * Returns an empty image when even the system codec rejects the file.
 */
async function decodeViaSips(filePath: string): Promise<Electron.NativeImage> {
  const converted = path.join(tmpdir(), `arp-template-image-${randomUUID()}.png`);
  try {
    await execFile("sips", ["-s", "format", "png", filePath, "--out", converted]);
    return nativeImage.createFromBuffer(await fs.readFile(converted));
  } catch {
    return nativeImage.createEmpty();
  } finally {
    await fs.rm(converted, { force: true }).catch(() => undefined);
  }
}

/** Decode a picked image file, falling back to the macOS system codec once. */
async function decodeImageFile(filePath: string): Promise<Electron.NativeImage> {
  // Read the bytes ourselves: an unreadable file (permissions, iCloud
  // placeholder, …) then fails with its real errno instead of an empty image.
  const bytes = await fs.readFile(filePath);
  let image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty() && process.platform === "darwin") {
    image = await decodeViaSips(filePath);
  }
  if (image.isEmpty()) {
    throw new Error(`Unsupported image format: ${path.basename(filePath)}`);
  }
  return image;
}

/**
 * Pick an image, remember the folder, and return a normalized PNG as base64.
 * `canceled` means the user dismissed the dialog; read/decode failures throw
 * so the renderer can explain them.
 */
export async function pickTemplateImage(options?: { title?: string }): Promise<TemplateImagePick> {
  const dbPath = await openDesktopDb();
  const last = await readLastDirectory(dbPath);
  const defaultPath = last && (await fs.stat(last).then((stat) => stat.isDirectory()).catch(() => false))
    ? last
    : undefined;
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: IMAGE_FILTERS,
    title: options?.title?.trim() || "Select image",
    ...(defaultPath ? { defaultPath } : {})
  });
  const chosen = result.canceled ? undefined : result.filePaths[0];
  if (!chosen) return { ok: false, canceled: true };

  await rememberDirectory(dbPath, path.dirname(chosen));
  const png = normalizedImage(await decodeImageFile(chosen)).toPNG();
  if (png.length === 0) {
    throw new Error(`Unsupported image format: ${path.basename(chosen)}`);
  }
  return { ok: true, pngBase64: png.toString("base64") };
}
