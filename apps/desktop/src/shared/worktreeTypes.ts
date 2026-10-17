/**
 * Shared worktree vocabulary for the workbench.
 *
 * A *repository* is the identity (a path the task references); a *checkout* is
 * one working tree of it, and the main checkout is just one of them. Every pane
 * asks for the roots it should show, so making a checkout selectable is a matter
 * of putting its path in that list — nothing downstream needs to know that a
 * worktree is involved.
 *
 * These types cross the main → preload → renderer boundary, so they live here
 * rather than in either side. `worktreeDirName` is shared for the same reason:
 * the create sheet previews a directory before the main process builds it, and
 * the two must agree exactly.
 */

export type WorktreeEntry = {
  path: string;
  branch: string | null;
  head: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockedReason?: string;
  /**
   * Git still holds an admin entry for a checkout whose directory is gone. Only
   * `git worktree prune` clears it, and only a person may ask for that.
   */
  prunable: boolean;
  prunableReason?: string;
  /** Git prints the main working tree first: the checkout the repository lives in. */
  isMain: boolean;
};

export type TaskWorktreeInfo = WorktreeEntry & {
  /** The checkout directory is gone from disk. */
  missing: boolean;
  /** HEAD is contained in the repository's base branch, so the work is already in. */
  merged: boolean;
  createdAtMs: number | null;
};

export type TaskWorktreeRepo = {
  repoRoot: string;
  label: string;
  exists: boolean;
  isGitRepo: boolean;
  /** The branch a worktree of this repository is expected to land back in. */
  baseBranch: string | null;
  error?: string;
  worktrees: TaskWorktreeInfo[];
};

export type TaskWorktreeListing = {
  /** Where this task's worktrees live, derived from the note id. */
  root: string;
  repos: TaskWorktreeRepo[];
};

/**
 * Per-task worktree settings, kept in `desktop.db` beside the panel's other
 * desktop-only preferences — the extension has no notion of a workbench.
 *
 * `enabled` governs the convention handed to agents and the create affordances,
 * never what the UI is allowed to show: a checkout that exists on disk stays
 * visible even while the convention is off, because hiding real work behind a
 * boolean reads as a broken feature.
 */
export type TaskWorktreeState = {
  enabled: boolean;
  /** Normalized repo root → the base branch chosen for it. */
  baseBranch: Record<string, string>;
  /** Worktree path → when the user asked not to be reminded about it again. */
  dismissed?: Record<string, number>;
};

/**
 * Read a stored or transported value back into a state, defaulting anything
 * unrecognised. Both sides go through this: the value is opaque JSON in a plain
 * KV table on the way out, and an older or failed caller's answer on the way in.
 */
export function normalizeTaskWorktreeState(value: unknown): TaskWorktreeState {
  const raw = (value ?? {}) as Partial<TaskWorktreeState>;
  return {
    enabled: raw.enabled === true,
    baseBranch: raw.baseBranch && typeof raw.baseBranch === "object" ? { ...raw.baseBranch } : {},
    ...(raw.dismissed && typeof raw.dismissed === "object" ? { dismissed: { ...raw.dismissed } } : {})
  };
}

/**
 * Checkouts of this task's repositories that belong to no task any more.
 *
 * Deleting a task removes its note, not its workspace, so a checkout it left
 * behind keeps both its directory and its slot in the repository's admin area.
 * Only the repositories a task references can be scanned for them.
 */
export type TaskWorktreeOrphanRepo = {
  repoRoot: string;
  label: string;
  /** The branch a checkout of this repository lands back in, for the risk report. */
  baseBranch: string | null;
  worktrees: TaskWorktreeInfo[];
};

export type TaskWorktreeOrphans = { repos: TaskWorktreeOrphanRepo[] };

export type WorktreeRiskReport = {
  exists: boolean;
  dirty: boolean;
  stagedCount: number;
  unstagedCount: number;
  unmergedCommits: number;
  /** HEAD is contained in the base branch. */
  mergedIntoBase: boolean;
  /** Commits not pushed to the tracking branch, or null when there is none. */
  aheadOfUpstream: number | null;
  /**
   * Open terminals whose working directory is inside the checkout. The cwd is
   * the one a pane was started with, so this is a floor rather than a census —
   * and a floor is the right direction for a warning.
   */
  liveSessionsInPath: number;
  branch: string | null;
  baseBranch: string | null;
  detached: boolean;
  locked: boolean;
  lockedReason?: string;
  prunable: boolean;
  isMain: boolean;
};

/**
 * A path-safe, human-readable fragment. Unicode letters and digits survive, so a
 * repository or branch named in Chinese still yields a directory someone
 * recognises instead of collapsing to `repo`.
 */
function slugify(value: string, maxLength: number): string {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-._]+/, "")
    .replace(/[-._]+$/, "")
    .slice(0, maxLength);
}

/**
 * Directory name for a checkout: repository then branch. The branch is why the
 * worktree exists and what a person recognises, and because the same rule is
 * handed to agents, the checkouts they create land in the same shape without any
 * bookkeeping.
 */
export function worktreeDirName(repoName: string, branch: string): string {
  const repo = slugify(repoName, 32) || "repo";
  const checkout = slugify(branch, 48) || "worktree";
  return `${repo}-${checkout}`;
}
