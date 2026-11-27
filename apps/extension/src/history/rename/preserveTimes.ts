import * as fs from "node:fs/promises";

/** Return a non-negative integer timestamp from a session's updatedAt, or 0 if unset. */
export function preservedTimestampMs(updatedAt?: number): number {
  return typeof updatedAt === "number" && Number.isFinite(updatedAt) && updatedAt > 0
    ? Math.floor(updatedAt)
    : 0;
}

/** Write file contents while restoring its prior atime and mtime on disk. */
export async function writeFilePreservingMtime(filePath: string, content: string): Promise<void> {
  const stat = await fs.stat(filePath);
  await fs.writeFile(filePath, content, "utf8");
  await fs.utimes(filePath, stat.atime, stat.mtime);
}
