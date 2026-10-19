import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "@agent-resume/core";

/**
 * The window that was in front when the app was last left, so a relaunch can put
 * the user back where they were instead of on the board.
 *
 * Ephemeral UI state rather than configuration, like `task-windows.json`: it
 * lives beside the desktop database and is rewritten on every window focus
 * change. Only the board and workbench windows are remembered — the other
 * window kinds are not restored on launch, so naming one here would just make
 * the startup fall back to the board anyway.
 */
export type StoredActiveWindow =
  | { kind: "board" }
  | { kind: "task"; workbenchId: string };

const FILE_NAME = "last-active-window.json";

export function lastActiveWindowStatePath(desktopDb: string): string {
  return path.join(path.dirname(desktopDb), FILE_NAME);
}

/** Stored state is untrusted: it comes from a file on disk. */
export function readStoredActiveWindow(value: unknown): StoredActiveWindow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "board") return { kind: "board" };
  if (record.kind !== "task") return null;
  const workbenchId = typeof record.workbenchId === "string" ? record.workbenchId.trim() : "";
  return workbenchId ? { kind: "task", workbenchId } : null;
}

export async function loadStoredActiveWindow(file: string): Promise<StoredActiveWindow | null> {
  try {
    return readStoredActiveWindow(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    // Missing or unreadable: startup just falls back to the board.
    return null;
  }
}

export async function saveStoredActiveWindow(file: string, target: StoredActiveWindow): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteFile(file, `${JSON.stringify(target, null, 2)}\n`);
  } catch {
    /* window state is best-effort */
  }
}
