import * as fs from "node:fs/promises";

export async function readJsonLines<T>(filePath: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const rows: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      // Ignore malformed rows. These files are append-only logs and a partial
      // trailing write should not break the whole panel.
    }
  }

  return rows;
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function appendJsonLine(filePath: string, row: unknown): Promise<void> {
  await fs.appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8");
}
