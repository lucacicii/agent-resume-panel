/**
 * Pure helpers for Git upstream tracking (ahead/behind).
 * Kept free of Electron imports so renderer/unit tests can import them.
 */

export interface GitRepoTracking {
  repoRoot: string;
  branch: string | null;
  /** e.g. origin/main; null when no upstream is configured. */
  upstream: string | null;
  ahead: number;
  behind: number;
}

/** Parse `git rev-list --left-right --count A...B` stdout (`ahead\\tbehind`). */
export function parseLeftRightCount(stdout: string): { ahead: number; behind: number } {
  const match = String(stdout).trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) return { ahead: 0, behind: 0 };
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}
