export interface GitPorcelainStatusEntry {
  indexStatus: string;
  worktreeStatus: string;
  path: string;
  originalPath?: string;
}

/**
 * Parse `git status --porcelain=v1 -z` output.
 *
 * The NUL-delimited form leaves paths unquoted, so Unicode and other characters
 * are preserved exactly. Rename/copy records contain the destination path in
 * the status record followed by the source path as a second NUL field.
 */
export function parseGitStatusPorcelainV1Z(stdout: string): GitPorcelainStatusEntry[] {
  const fields = stdout.split("\0");
  const entries: GitPorcelainStatusEntry[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") continue;

    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const filePath = record.slice(3);
    if (!filePath) continue;

    const entry: GitPorcelainStatusEntry = {
      indexStatus,
      worktreeStatus,
      path: filePath
    };

    if (indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") {
      const originalPath = fields[index + 1];
      if (originalPath) entry.originalPath = originalPath;
      index += 1;
    }

    entries.push(entry);
  }

  return entries;
}

export function stagedRepoPaths(entries: GitPorcelainStatusEntry[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.indexStatus === " " || entry.indexStatus === "?") continue;
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    paths.push(entry.path);
  }
  return paths;
}
