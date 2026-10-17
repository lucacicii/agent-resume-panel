import { realpathSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { effectivePanelHome, expandHome, getCatalogMeta, getNoteById, loadSettings, setCatalogMeta } from "@agent-resume/core";
import { isGitRepo, gitRefExists, queryGitBranch, queryGitRoot } from "./gitNestedScan";
import { shareGitQuery } from "./gitQueryShare";
import { safeHandle } from "./ipcUtils";
import { loadPanelDbPaths } from "./panelDatabases";
import { taskWorktreeRoot, worktreeOwnerNoteId, type TaskAddressWorktree } from "./taskWorkspace";
import { execGitWithRetry, gitStatusForRepo } from "./workbenchFs";
import { formatExecError, gitExec, isValidGitBranchName } from "./workbenchGit";
import {
  normalizeTaskWorktreeState,
  worktreeDirName,
  type TaskWorktreeInfo,
  type TaskWorktreeListing,
  type TaskWorktreeOrphanRepo,
  type TaskWorktreeOrphans,
  type TaskWorktreeRepo,
  type TaskWorktreeState,
  type WorktreeEntry,
  type WorktreeRiskReport
} from "../shared/worktreeTypes";

/** Long: a worktree of a large repository has to check out the whole tree. */
const WORKTREE_WRITE_TIMEOUT_MS = 60_000;
const GIT_READ_TIMEOUT_MS = 10_000;
const GIT_READ_BUFFER = 1024 * 1024;

const STATE_KEY_PREFIX = "desktop.worktree.task:";

/**
 * Git worktree support for the workbench.
 *
 * A worktree is a second checkout of a repository, and the panel treats it as
 * just another root path: every pane already derives what it shows from a list of
 * roots, so *discovering* a checkout is enough to make Explorer, Git, Search,
 * Scripts and the terminal able to look at it.
 *
 * Everything the panel creates lands inside the task's own workspace
 * (`taskWorktreeRoot`). That is what reduces discovery to a path-prefix match,
 * and what keeps the location stable when the task is renamed — the same reason
 * the workspace path itself is derived from the note id.
 *
 * The panel never deletes a checkout on its own initiative; `worktreeRemove` is
 * only ever reached from an explicit user action, and it refuses any path that
 * this repository has not registered as a worktree.
 */

// ---------------------------------------------------------------------------
// Parsing and path helpers
// ---------------------------------------------------------------------------

/**
 * `git worktree list --porcelain` emits one blank-line separated record per
 * checkout: `worktree <path>`, optionally `HEAD <sha>`, `branch refs/heads/<x>`
 * or `detached`, and the flags `bare` / `locked [reason]` / `prunable [reason]`.
 * The flag names moved across git versions (`pruned` became `prunable` in 2.31),
 * so unknown keys are ignored rather than treated as errors.
 */
export function parseWorktreePorcelain(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;
  const flush = (): void => {
    if (current) entries.push(current);
    current = null;
  };
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    const separator = line.indexOf(" ");
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).trim();
    if (key === "worktree") {
      flush();
      current = {
        path: value,
        branch: null,
        head: "",
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
        isMain: entries.length === 0
      };
      continue;
    }
    if (!current) continue;
    if (key === "HEAD") current.head = value;
    else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "detached") current.detached = true;
    else if (key === "bare") current.bare = true;
    else if (key === "locked") {
      current.locked = true;
      if (value) current.lockedReason = value;
    } else if (key === "prunable") {
      current.prunable = true;
      if (value) current.prunableReason = value;
    }
  }
  flush();
  return entries;
}

/**
 * Absolute path for comparisons.
 *
 * Every path the renderer sees has to be canonical, because it compares what it
 * stored against what git reports, and macOS makes those two disagree on their
 * own: git prints real paths, so `/var/…` (a symlink into `/private/var/…`) and
 * a user-picked path through a link would never match. A path that does not
 * exist yet — the worktree root before the first checkout, or the checkout being
 * created — is resolved by its deepest existing ancestor, so a nested root is
 * still recognised as nested rather than silently let through.
 */
function realPath(target: string): string {
  const resolved = path.resolve(expandHome(target));
  const missing: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      const base = realpathSync(current);
      return missing.length ? path.join(base, ...missing.reverse()) : base;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return resolved;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/** True when `candidate` is `parent` itself or sits underneath it. */
export function isPathWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function pathIsDirectory(target: string): Promise<boolean> {
  return fs
    .stat(target)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
}

async function resolveGitRepo(raw: string): Promise<string> {
  const resolved = expandHome(raw.trim());
  if (!(await isGitRepo(resolved))) throw new Error(`不是 Git 仓库: ${resolved}`);
  return (await queryGitRoot(resolved)) || resolved;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

async function listWorktreesForRepo(repoRoot: string): Promise<WorktreeEntry[]> {
  const stdout = await gitExec(repoRoot, ["worktree", "list", "--porcelain"], GIT_READ_TIMEOUT_MS, GIT_READ_BUFFER);
  return parseWorktreePorcelain(stdout);
}

async function isAncestor(repoRoot: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await gitExec(repoRoot, ["merge-base", "--is-ancestor", ancestor, descendant], 5_000, 4_096);
    return true;
  } catch {
    // Exit 1 means "not an ancestor"; 128 means a ref we cannot resolve. Neither
    // is a reason to fail the listing.
    return false;
  }
}

async function describeWorktree(entry: WorktreeEntry, repoRoot: string, baseBranch: string | null): Promise<TaskWorktreeInfo> {
  const stat = await fs.stat(entry.path).catch(() => null);
  // A checkout sitting on the base branch itself would trivially count as
  // "merged", which says nothing useful, so it is excluded.
  const comparable = Boolean(entry.head) && Boolean(baseBranch) && entry.branch !== baseBranch;
  return {
    ...entry,
    path: realPath(entry.path),
    missing: stat === null,
    merged: comparable ? await isAncestor(repoRoot, entry.head, baseBranch as string) : false,
    createdAtMs: stat ? stat.birthtimeMs || stat.ctimeMs : null
  };
}

/**
 * The checkouts this task can look at, across the repositories it references.
 *
 * Ownership needs no inference: a checkout is visible in the listing of exactly
 * the repository that registered it, so whatever `worktree list` reports for a
 * repo belongs to that repo. Two kinds of entry are kept: the checkouts under
 * the task's own root, which are the ones the panel and its agents share, and
 * each repository's own working tree — a pane has to be able to come back to it,
 * and it is the one checkout here that cannot be removed from under the panel.
 * Git prints it first, so it leads each repository's list.
 */
export async function worktreeListForTask(input: {
  panelHome: string;
  noteId: string;
  repos: ReadonlyArray<{ repoRoot: string; label: string }>;
}): Promise<TaskWorktreeListing> {
  const root = taskWorktreeRoot(input.panelHome, input.noteId);
  const realRoot = realPath(root);
  const repos = await Promise.all(
    input.repos.map(async (repo): Promise<TaskWorktreeRepo> => {
      const bare = { repoRoot: repo.repoRoot, label: repo.label };
      if (!(await pathIsDirectory(repo.repoRoot))) {
        return { ...bare, exists: false, isGitRepo: false, baseBranch: null, worktrees: [] };
      }
      const resolved = await queryGitRoot(repo.repoRoot);
      if (!resolved) {
        return { ...bare, exists: true, isGitRepo: false, baseBranch: null, worktrees: [] };
      }
      const repoRoot = realPath(resolved);
      let entries: WorktreeEntry[];
      try {
        entries = await shareGitQuery(`worktree-list:${repoRoot}`, () => listWorktreesForRepo(repoRoot));
      } catch (error) {
        return { ...bare, repoRoot, exists: true, isGitRepo: true, baseBranch: null, error: formatExecError(error), worktrees: [] };
      }
      const baseBranch = await queryGitBranch(repoRoot);
      const ours = entries.filter((entry) => {
        if (entry.isMain) return true;
        const checkout = realPath(entry.path);
        // The task's own `.worktrees/` folder is not a checkout of anything.
        return checkout !== realRoot && isPathWithin(checkout, realRoot);
      });
      const worktrees = await Promise.all(ours.map((entry) => describeWorktree(entry, repoRoot, baseBranch)));
      return { ...bare, repoRoot, exists: true, isGitRepo: true, baseBranch, worktrees };
    })
  );
  return { root, repos };
}

// ---------------------------------------------------------------------------
// Inspecting one checkout before it is deleted
// ---------------------------------------------------------------------------

async function countCommits(cwd: string, args: string[]): Promise<number> {
  try {
    const stdout = await gitExec(cwd, args, GIT_READ_TIMEOUT_MS, GIT_READ_BUFFER);
    return stdout.split("\n").filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

async function countAheadOfUpstream(cwd: string): Promise<number | null> {
  try {
    const stdout = await gitExec(cwd, ["rev-list", "--count", "@{upstream}..HEAD"], GIT_READ_TIMEOUT_MS, 4_096);
    const value = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    // No tracking branch, which is the normal case for a fresh worktree.
    return null;
  }
}

/**
 * Everything a person needs in order to decide whether a checkout is safe to
 * delete. Reads only — this never removes anything.
 */
export async function worktreeInspect(input: {
  repoRoot: string;
  targetPath: string;
  baseBranch?: string;
  /**
   * Open terminals inside the checkout. Injected rather than imported so this
   * module stays a pure git capability (`ptyHost` drags in Electron and the
   * native pty binding, which no test of this file should need).
   */
  liveSessionsInPath?: (target: string) => number;
}): Promise<WorktreeRiskReport> {
  const repo = await resolveGitRepo(input.repoRoot);
  const wanted = realPath(input.targetPath);
  const entry = (await listWorktreesForRepo(repo)).find((item) => realPath(item.path) === wanted);
  if (!entry) throw new Error("该路径不是此仓库已注册的 worktree");
  const baseBranch = input.baseBranch?.trim() || (await queryGitBranch(repo));
  const exists = await pathIsDirectory(entry.path);
  let stagedCount = 0;
  let unstagedCount = 0;
  let unmergedCommits = 0;
  let aheadOfUpstream: number | null = null;
  if (exists) {
    const status = await gitStatusForRepo(entry.path).catch(() => null);
    stagedCount = status?.staged.length ?? 0;
    unstagedCount = status?.unstaged.length ?? 0;
    const comparable = Boolean(entry.head) && Boolean(baseBranch) && entry.branch !== baseBranch;
    if (comparable) unmergedCommits = await countCommits(entry.path, ["log", "--oneline", `${baseBranch}..HEAD`]);
    aheadOfUpstream = await countAheadOfUpstream(entry.path);
  }
  const comparable = Boolean(entry.head) && Boolean(baseBranch) && entry.branch !== baseBranch;
  return {
    exists,
    dirty: stagedCount > 0 || unstagedCount > 0,
    stagedCount,
    unstagedCount,
    unmergedCommits,
    mergedIntoBase: comparable ? await isAncestor(repo, entry.head, baseBranch as string) : false,
    aheadOfUpstream,
    liveSessionsInPath: input.liveSessionsInPath?.(realPath(entry.path)) ?? 0,
    branch: entry.branch,
    baseBranch,
    detached: entry.detached,
    locked: entry.locked,
    lockedReason: entry.lockedReason,
    prunable: entry.prunable,
    isMain: entry.isMain
  };
}

/**
 * Checkouts of this task's repositories whose owning task no longer exists.
 *
 * Deleting a task removes its note but leaves its workspace, and a checkout that
 * keeps a directory also keeps its entry in the repository's admin area, where
 * nothing else will ever look at it again. Only the repositories this task
 * references can be scanned — the panel holds no index of repositories — and a
 * checkout is reported only when the task whose `.worktrees/` holds it is really
 * gone, so another task's work is never offered up here.
 */
export async function worktreeListOrphans(input: {
  panelHome: string;
  catalogDb: string;
  noteId: string;
  repos: ReadonlyArray<{ repoRoot: string; label: string }>;
}): Promise<TaskWorktreeOrphans> {
  const live = new Map<string, boolean>();
  const isLive = async (noteId: string): Promise<boolean> => {
    const cached = live.get(noteId);
    if (cached !== undefined) return cached;
    const found = await getNoteById(input.catalogDb, noteId).then(
      (note) => Boolean(note),
      () => true // Unreadable catalog: assume alive, i.e. do not offer anything.
    );
    live.set(noteId, found);
    return found;
  };

  const repos = await Promise.all(
    input.repos.map(async (repo): Promise<TaskWorktreeOrphanRepo | null> => {
      if (!(await pathIsDirectory(repo.repoRoot))) return null;
      const resolved = await queryGitRoot(repo.repoRoot);
      if (!resolved) return null;
      const repoRoot = realPath(resolved);
      let entries: WorktreeEntry[];
      try {
        entries = await shareGitQuery(`worktree-list:${repoRoot}`, () => listWorktreesForRepo(repoRoot));
      } catch {
        return null;
      }
      const orphans: WorktreeEntry[] = [];
      for (const entry of entries) {
        const checkout = realPath(entry.path);
        const owner = worktreeOwnerNoteId(input.panelHome, checkout);
        if (!owner || owner === input.noteId) continue;
        if (!(await isLive(owner))) orphans.push(entry);
      }
      if (!orphans.length) return null;
      const baseBranch = await queryGitBranch(repoRoot);
      return {
        repoRoot,
        label: repo.label,
        baseBranch,
        worktrees: await Promise.all(orphans.map((entry) => describeWorktree(entry, repoRoot, baseBranch)))
      };
    })
  );
  return { repos: repos.filter((repo): repo is TaskWorktreeOrphanRepo => repo !== null) };
}

// ---------------------------------------------------------------------------
// Creating and removing
// ---------------------------------------------------------------------------

/**
 * A checkout must not contain its own repository (nor the reverse): git would
 * happily create it, and the repository would then see every file of the
 * checkout as untracked.
 */
function assertRootOutsideRepo(root: string, repo: string): void {
  const realRoot = realPath(root);
  const realRepo = realPath(repo);
  if (isPathWithin(realRoot, realRepo) || isPathWithin(realRepo, realRoot)) {
    throw new Error(`worktree 落点与仓库互相嵌套，无法创建：${realRoot} / ${realRepo}`);
  }
}

async function uniqueTarget(candidate: string): Promise<string> {
  let next = candidate;
  let index = 2;
  while (await pathIsDirectory(next)) {
    next = `${candidate}-${index}`;
    index += 1;
  }
  return next;
}

export async function worktreeCreate(input: {
  panelHome: string;
  noteId: string;
  repoRoot: string;
  branch: string;
  baseBranch?: string;
}): Promise<{ path: string; branch: string; baseBranch: string; repoRoot: string }> {
  const repo = await resolveGitRepo(input.repoRoot);
  const branch = input.branch.trim();
  if (!isValidGitBranchName(branch)) throw new Error(`无效的分支名: ${branch}`);
  const root = taskWorktreeRoot(input.panelHome, input.noteId);
  assertRootOutsideRepo(root, repo);
  const target = await uniqueTarget(path.join(root, worktreeDirName(path.basename(repo), branch)));
  await fs.mkdir(root, { recursive: true });
  const reusesExisting = await gitRefExists(repo, `refs/heads/${branch}`);
  const baseBranch = reusesExisting ? branch : input.baseBranch?.trim() || (await queryGitBranch(repo)) || "HEAD";
  const args = reusesExisting
    ? ["worktree", "add", target, branch]
    : ["worktree", "add", "-b", branch, target, baseBranch];
  if (!reusesExisting && branch === baseBranch) throw new Error(`分支名与基础分支相同: ${branch}`);
  // A half-finished checkout is left behind on purpose: the error is the user's
  // to read, and the leftover shows up as `prunable`, which the UI can clear.
  await execGitWithRetry(["-C", repo, ...args], { timeout: WORKTREE_WRITE_TIMEOUT_MS, maxBuffer: GIT_READ_BUFFER });
  return { path: realPath(target), branch, baseBranch, repoRoot: repo };
}

export async function worktreePrune(repoRoot: string): Promise<void> {
  const repo = await resolveGitRepo(repoRoot);
  await execGitWithRetry(["-C", repo, "worktree", "prune"], { timeout: 30_000, maxBuffer: GIT_READ_BUFFER });
}

/**
 * Removes a checkout, never a plain directory: the path must still be one this
 * repository has registered. A dirty checkout makes `git worktree remove` fail,
 * which is the behaviour we want — the caller has to pass `force` explicitly,
 * after showing the user what would be lost. The branch is left alone; deleting
 * it is a separate decision.
 */
export async function worktreeRemove(input: {
  repoRoot: string;
  targetPath: string;
  force?: boolean;
}): Promise<{ pruned: boolean }> {
  const repo = await resolveGitRepo(input.repoRoot);
  const wanted = realPath(input.targetPath);
  const entry = (await listWorktreesForRepo(repo)).find((item) => realPath(item.path) === wanted);
  if (!entry) throw new Error("该路径不是此仓库已注册的 worktree，已拒绝删除");
  if (entry.isMain) throw new Error("主 checkout 不能删除");
  if (entry.prunable || !(await pathIsDirectory(entry.path))) {
    await worktreePrune(repo);
    return { pruned: true };
  }
  const args = ["worktree", "remove", entry.path];
  if (input.force) args.push("--force");
  await execGitWithRetry(["-C", repo, ...args], { timeout: WORKTREE_WRITE_TIMEOUT_MS, maxBuffer: GIT_READ_BUFFER });
  await worktreePrune(repo);
  return { pruned: false };
}

// ---------------------------------------------------------------------------
// What an agent is told
// ---------------------------------------------------------------------------

export type TaskWorktreeContext = {
  /** The task opted into the worktree convention. */
  enabled: boolean;
  root: string;
  /** Repository root → its checkouts, for the address table. */
  worktrees: Record<string, TaskAddressWorktree[]>;
  /**
   * Checkout directories that exist right now, for the sandbox's extra roots.
   * Never empty-by-preference: a checkout the panel cannot write to is broken
   * whatever the switch says.
   */
  dirs: string[];
};

/**
 * The checkouts of a task, in the shape the agent-facing texts need: the
 * location, the per-repository paths for the address table, and the directories
 * to grant a sandbox.
 */
export async function worktreeContextForTask(input: {
  panelHome: string;
  desktopDb: string;
  noteId: string;
  repos: ReadonlyArray<{ repoRoot: string; label: string }>;
}): Promise<TaskWorktreeContext> {
  const [state, listing] = await Promise.all([
    readTaskWorktreeState(input.desktopDb, input.noteId),
    worktreeListForTask({ panelHome: input.panelHome, noteId: input.noteId, repos: input.repos })
  ]);
  const worktrees: Record<string, TaskAddressWorktree[]> = {};
  const dirs: string[] = [];
  for (const [index, repo] of listing.repos.entries()) {
    const owned = repo.worktrees.filter((worktree) => !worktree.isMain);
    if (!owned.length) continue;
    // Keyed by the path the caller named the repository with — the one the task
    // and the panel both spell — not by the git root main resolved it to.
    const key = input.repos[index]?.repoRoot ?? repo.repoRoot;
    worktrees[key] = owned.map((worktree) => ({ branch: worktree.branch, path: worktree.path, missing: worktree.missing }));
    for (const worktree of owned) {
      if (!worktree.missing) dirs.push(worktree.path);
    }
  }
  return { enabled: state.enabled, root: listing.root, worktrees, dirs };
}

// ---------------------------------------------------------------------------
// Per-task settings
// ---------------------------------------------------------------------------

function stateKey(noteId: string): string {
  return `${STATE_KEY_PREFIX}${noteId}`;
}

export function defaultTaskWorktreeState(): TaskWorktreeState {
  return { enabled: false, baseBranch: {} };
}

export async function readTaskWorktreeState(desktopDb: string, noteId: string): Promise<TaskWorktreeState> {
  const raw = await getCatalogMeta(desktopDb, stateKey(noteId)).catch(() => undefined);
  if (!raw) return defaultTaskWorktreeState();
  try {
    return normalizeTaskWorktreeState(JSON.parse(raw));
  } catch {
    return defaultTaskWorktreeState();
  }
}

export async function patchTaskWorktreeState(
  desktopDb: string,
  noteId: string,
  patch: Partial<TaskWorktreeState>
): Promise<TaskWorktreeState> {
  const current = await readTaskWorktreeState(desktopDb, noteId);
  const next: TaskWorktreeState = {
    enabled: patch.enabled ?? current.enabled,
    baseBranch: patch.baseBranch ? { ...current.baseBranch, ...patch.baseBranch } : current.baseBranch,
    ...(patch.dismissed
      ? { dismissed: { ...current.dismissed, ...patch.dismissed } }
      : current.dismissed
        ? { dismissed: current.dismissed }
        : {})
  };
  await setCatalogMeta(desktopDb, stateKey(noteId), JSON.stringify(next));
  return next;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

async function panelContext(): Promise<{ panelHome: string; desktopDb: string; catalogDb: string }> {
  const settings = await loadSettings();
  const paths = await loadPanelDbPaths(settings);
  // `desktop.db` carries this machine's panel preferences; the notes that decide
  // whether a task still exists live in the shared catalog.
  return { panelHome: effectivePanelHome(settings), desktopDb: paths.desktopDb, catalogDb: paths.catalogDb };
}

function requireNoteId(raw: unknown): string {
  const noteId = String(raw ?? "").trim();
  if (!noteId) throw new Error("缺少任务 id");
  return noteId;
}

function normalizeRepos(raw: unknown): Array<{ repoRoot: string; label: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ repoRoot: string; label: string }> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const repoRoot = String((item as { repoRoot?: unknown })?.repoRoot ?? "").trim();
    if (!repoRoot) continue;
    const key = realPath(repoRoot);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = String((item as { label?: unknown })?.label ?? "").trim() || path.basename(repoRoot);
    out.push({ repoRoot, label });
  }
  return out;
}

export function registerWorktreeIpc(options?: {
  /** Live terminals inside a path; `main.ts` passes the pty host's count. */
  liveSessionsInPath?: (target: string) => number;
}): void {
  safeHandle("workbench:worktrees", async (_event, args: { noteId?: unknown; repos?: unknown }) => {
    const { panelHome } = await panelContext();
    return worktreeListForTask({ panelHome, noteId: requireNoteId(args?.noteId), repos: normalizeRepos(args?.repos) });
  });

  safeHandle("workbench:worktreeOrphans", async (_event, args: { noteId?: unknown; repos?: unknown }) => {
    const { panelHome, catalogDb } = await panelContext();
    return worktreeListOrphans({
      panelHome,
      // Liveness is a property of the note catalog, and this is the same
      // database the panel's own note list is read from.
      catalogDb,
      noteId: requireNoteId(args?.noteId),
      repos: normalizeRepos(args?.repos)
    });
  });

  safeHandle(
    "workbench:createWorktree",
    async (_event, args: { noteId?: unknown; repoRoot?: unknown; branch?: unknown; baseBranch?: unknown }) => {
      const { panelHome, desktopDb } = await panelContext();
      const noteId = requireNoteId(args?.noteId);
      const created = await worktreeCreate({
        panelHome,
        noteId,
        repoRoot: String(args?.repoRoot ?? ""),
        branch: String(args?.branch ?? ""),
        baseBranch: args?.baseBranch === undefined ? undefined : String(args.baseBranch)
      });
      // Remember the basis so the next worktree of this repository starts from
      // the same place instead of re-deriving it.
      await patchTaskWorktreeState(desktopDb, noteId, { baseBranch: { [realPath(created.repoRoot)]: created.baseBranch } });
      return created;
    }
  );

  safeHandle(
    "workbench:inspectWorktree",
    async (_event, args: { repoRoot?: unknown; path?: unknown; baseBranch?: unknown }) =>
      worktreeInspect({
        repoRoot: String(args?.repoRoot ?? ""),
        targetPath: String(args?.path ?? ""),
        baseBranch: args?.baseBranch === undefined ? undefined : String(args.baseBranch),
        liveSessionsInPath: options?.liveSessionsInPath
      })
  );

  safeHandle(
    "workbench:removeWorktree",
    async (_event, args: { repoRoot?: unknown; path?: unknown; force?: unknown }) =>
      worktreeRemove({
        repoRoot: String(args?.repoRoot ?? ""),
        targetPath: String(args?.path ?? ""),
        force: args?.force === true
      })
  );

  safeHandle("workbench:pruneWorktrees", async (_event, args: { repoRoot?: unknown }) => {
    await worktreePrune(String(args?.repoRoot ?? ""));
    return { ok: true };
  });

  safeHandle("notes:getWorktreeSettings", async (_event, args: { noteId?: unknown }) => {
    const { desktopDb } = await panelContext();
    return readTaskWorktreeState(desktopDb, requireNoteId(args?.noteId));
  });

  safeHandle(
    "notes:setWorktreeSettings",
    async (_event, args: { noteId?: unknown; patch?: Partial<TaskWorktreeState> }) => {
      const { desktopDb } = await panelContext();
      const patch = args?.patch ?? {};
      // Only the known keys are accepted: the value round-trips through JSON in a
      // plain KV table, so nothing here should widen without being intended.
      return patchTaskWorktreeState(desktopDb, requireNoteId(args?.noteId), {
        ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
        ...(patch.baseBranch && typeof patch.baseBranch === "object" ? { baseBranch: patch.baseBranch } : {}),
        ...(patch.dismissed && typeof patch.dismissed === "object" ? { dismissed: patch.dismissed } : {})
      });
    }
  );
}
