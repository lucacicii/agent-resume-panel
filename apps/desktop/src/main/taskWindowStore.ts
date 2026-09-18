import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * The workbench windows that were open, so the next launch can put them back.
 *
 * Ephemeral UI state rather than configuration: it lives next to the desktop
 * database and is rewritten whenever the window set changes.
 */
export type StoredTaskWindow = {
  workbenchId: string;
  noteId: string;
  title?: string;
};

const FILE_NAME = "task-windows.json";
/** A little above the open-window cap so a stale entry can be skipped safely. */
const MAX_STORED = 8;
const MAX_TITLE_CHARS = 120;

export function taskWindowStatePath(desktopDb: string): string {
  return path.join(path.dirname(desktopDb), FILE_NAME);
}

/** Stored entries are untrusted: they come from a file on disk. */
export function readStoredTaskWindows(value: unknown): StoredTaskWindow[] {
  if (!Array.isArray(value)) return [];
  const windows: StoredTaskWindow[] = [];
  for (const entry of value.slice(0, MAX_STORED)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const workbenchId = typeof record.workbenchId === "string" ? record.workbenchId.trim() : "";
    const noteId = typeof record.noteId === "string" ? record.noteId.trim() : "";
    if (!workbenchId || !noteId) continue;
    const title = typeof record.title === "string" ? record.title.trim().slice(0, MAX_TITLE_CHARS) : "";
    windows.push({ workbenchId, noteId, ...(title ? { title } : {}) });
  }
  return windows;
}

export async function loadStoredTaskWindows(file: string): Promise<StoredTaskWindow[]> {
  try {
    return readStoredTaskWindows(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    // Missing or unreadable: the app just starts with no windows.
    return [];
  }
}

export async function saveStoredTaskWindows(file: string, windows: readonly StoredTaskWindow[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(windows.slice(0, MAX_STORED), null, 2)}\n`, "utf8");
    await fs.rename(temp, file);
  } catch {
    /* window state is best-effort */
  }
}
