import * as fs from "node:fs/promises";
import { dialog } from "electron";
import {
  ensureDesktopDbSchema,
  escapeSqlLiteral,
  loadSettings,
  runSqlite,
  runSqliteJson
} from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";

/** `catalog_meta` key holding the last directory the user picked. */
const META_KEY = "desktop.lastPickDirectory";

/** In-process cache so repeated picks do not touch the DB. */
let cachedLast: string | null | undefined;

async function isDirectory(value: string): Promise<boolean> {
  return fs.stat(value).then((stat) => stat.isDirectory()).catch(() => false);
}

async function readLastDirectory(): Promise<string | null> {
  if (cachedLast !== undefined) return cachedLast;
  try {
    const paths = await loadPanelDbPaths(await loadSettings());
    const rows = await runSqliteJson<{ value: string }>(
      paths.desktopDb,
      `SELECT value FROM catalog_meta WHERE key = '${META_KEY}' LIMIT 1;`
    );
    cachedLast = rows[0]?.value || null;
  } catch {
    cachedLast = null;
  }
  return cachedLast;
}

async function rememberDirectory(dir: string): Promise<void> {
  cachedLast = dir;
  try {
    const paths = await loadPanelDbPaths(await loadSettings());
    await ensureDesktopDbSchema(paths.desktopDb);
    await runSqlite(
      paths.desktopDb,
      `INSERT INTO catalog_meta (key, value) VALUES ('${META_KEY}', '${escapeSqlLiteral(dir)}')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`
    );
  } catch {
    /* remember for this session only rather than failing the pick */
  }
}

/**
 * Native directory picker that reopens at the last chosen folder. The selection
 * is stored in `desktop.db`, so it survives app restarts; a stale path (deleted
 * or moved) is ignored. Shared by task templates, project folders, and settings.
 */
export async function showDirectoryPicker(
  options?: { title?: string }
): Promise<{ ok: true; path: string } | { ok: false; canceled: true }> {
  const last = await readLastDirectory();
  const defaultPath = last && (await isDirectory(last)) ? last : undefined;
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: options?.title?.trim() || "Select folder",
    ...(defaultPath ? { defaultPath } : {})
  });
  const chosen = result.canceled ? undefined : result.filePaths[0];
  if (!chosen) {
    return { ok: false, canceled: true };
  }
  await rememberDirectory(chosen);
  return { ok: true, path: chosen };
}
