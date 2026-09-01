import { shell } from "electron";
import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { expandHome } from "@agent-resume/core";
import {
  discoverGitReposUnder,
  isGitRepo,
  normalizeNestedScanOptions,
  queryGitRoot,
  type GitNestedScanOptions,
  type NestedGitRepoInfo
} from "./gitNestedScan";
import { parseLeftRightCount, type GitRepoTracking } from "./gitTracking";
import { safeHandle } from "./ipcUtils";
import { parseGitStatusPorcelainV1Z } from "./workbenchGitStatus";
import {
  findGitDiffHunk,
  findGitDiffLinePatch,
  toGitDiffHunkMetadata,
  type GitDiffHunk,
  type GitDiffHunkTarget,
  type GitDiffLineTarget
} from "./workbenchGitDiff";
import {
  createWorkbenchFile,
  inspectWorkbenchFile,
  resolveCanonicalWorkbenchPath,
  saveWorkbenchFile,
  type WorkbenchTextEncoding
} from "./workbenchFileIo";
import {
  cancelActiveWorkbenchSearch,
  searchWorkbenchText
} from "./workbenchSearch";
import {
  cancelActiveWorkbenchFileList,
  cancelActiveWorkbenchPathSearch,
  listWorkbenchFiles,
  searchWorkbenchPaths
} from "./workbenchFileIndex";
import {
  copyWorkbenchPathToClipboard,
  pasteMacClipboardIntoWorkbench,
  readMacPasteboardFilePaths
} from "./workbenchFileClipboard";

export type { GitRepoTracking } from "./gitTracking";
export { parseLeftRightCount } from "./gitTracking";

const execFileAsync = promisify(execFile);

async function execGitWithRetry(
  args: string[],
  options?: Parameters<typeof execFileAsync>[2],
  maxRetries = 3,
  initialDelayMs = 50
): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  let attempt = 0;
  while (true) {
    try {
      return await execFileAsync("git", args, options);
    } catch (error) {
      attempt++;
      const errStr = formatExecError(error);
      const isLockError = errStr.includes("index.lock") || errStr.includes("File exists");
      if (isLockError && attempt <= maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, initialDelayMs * Math.pow(2, attempt - 1)));
        continue;
      }
      throw error;
    }
  }
}

const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_DIRECTORY_ENTRIES = 2000;
const GIT_TRACKING_TIMEOUT_MS = 5000;

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface GitFileChange {
  path: string;
  repoPath: string;
  repoRoot: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
}

export type { GitNestedScanOptions, NestedGitRepoInfo } from "./gitNestedScan";

export interface GitStatusResult {
  isRepo: boolean;
  root: string | null;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  nestedRepos?: NestedGitRepoInfo[];
  nestedScanDepth?: number;
  /** Per-repo branch / upstream / ahead-behind (best-effort). */
  tracking?: GitRepoTracking[];
}

export interface GitDiffSidesResult {
  oldLabel: string;
  newLabel: string;
  oldText: string;
  newText: string;
  hunks: GitDiffHunk[];
}

function formatExecError(error: unknown): string {
  const err = error as NodeJS.ErrnoException & { stderr?: string | Buffer; stdout?: string | Buffer };
  const stderr = err.stderr ? String(err.stderr).trim() : "";
  if (stderr) return stderr;
  // Some git failures write their diagnostic to stdout and leave stderr empty
  // (e.g. "nothing to commit"). Surface the actionable summary instead of the
  // generic "Command failed: …" error message.
  const stdout = err.stdout ? String(err.stdout).trim() : "";
  if (stdout) {
    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines[lines.length - 1] ?? stdout;
  }
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function resolveCwd(raw?: string): string {
  const cwd = expandHome(raw?.trim() || process.cwd());
  try {
    const stat = fs.statSync(cwd);
    if (!stat.isDirectory()) {
      throw new Error(`工作目录不是文件夹: ${cwd}`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`工作目录不存在: ${cwd}`);
    }
    throw error;
  }
  return cwd;
}

function resolvePathWithinRoot(raw: string, rootPath: string): string {
  const root = path.resolve(expandHome(rootPath.trim()));
  const target = path.resolve(expandHome(raw.trim()));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("路径超出允许范围");
  }
  return target;
}

/** Git pathspecs accepted from the renderer must remain relative to the selected repository. */
function normalizeRepoRelativePath(raw: string): string {
  // Porcelain status represents an untracked directory with a trailing slash
  // (for example `.claude/`). Git pathspecs accept either form, but the empty
  // final segment must not be rejected as traversal input.
  const normalized = raw.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (
    !normalized
    || normalized.includes("\0")
    || normalized.startsWith("/")
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("无效的文件路径");
  }
  return normalized;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function buildDisplayPath(scanRoot: string, repoRoot: string, repoRelativePath: string): string {
  const prefix = path.relative(scanRoot, repoRoot);
  const rel = repoRelativePath.replace(/\\/g, "/");
  if (!prefix || prefix === ".") return rel;
  return `${toPosixPath(prefix)}/${rel}`.replace(/\/+/g, "/");
}

function parseGitStatusPorcelain(stdout: string): { staged: GitFileChange[]; unstaged: GitFileChange[] } {
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  const stagedPaths = new Set<string>();
  const unstagedPaths = new Set<string>();

  const makeChange = (
    filePath: string,
    status: string,
    flags: { staged: boolean; unstaged: boolean }
  ): GitFileChange => ({
    path: filePath,
    repoPath: filePath,
    repoRoot: "",
    status,
    staged: flags.staged,
    unstaged: flags.unstaged
  });

  for (const entry of parseGitStatusPorcelainV1Z(stdout)) {
    const { indexStatus, worktreeStatus, path: filePath } = entry;

    const isStaged = indexStatus !== " " && indexStatus !== "?";
    const isUnstaged = worktreeStatus !== " " || indexStatus === "?";

    if (isStaged && !stagedPaths.has(filePath)) {
      staged.push(
        makeChange(filePath, indexStatus, {
          staged: true,
          unstaged: isUnstaged
        })
      );
      stagedPaths.add(filePath);
    }
    if (isUnstaged && !unstagedPaths.has(filePath)) {
      unstaged.push(
        makeChange(filePath, worktreeStatus !== " " ? worktreeStatus : indexStatus, {
          staged: false,
          unstaged: true
        })
      );
      unstagedPaths.add(filePath);
    }
  }

  return { staged, unstaged };
}

function prefixGitChanges(
  changes: GitFileChange[],
  scanRoot: string,
  repoRoot: string
): GitFileChange[] {
  return changes.map((change) => ({
    ...change,
    repoRoot,
    repoPath: change.repoPath || change.path,
    path: buildDisplayPath(scanRoot, repoRoot, change.repoPath || change.path)
  }));
}

export async function gitStatusForRepo(repoRoot: string): Promise<{ staged: GitFileChange[]; unstaged: GitFileChange[] }> {
  // `--untracked-files=all` reports each file under an untracked (newly created)
  // directory individually instead of collapsing the directory to a single
  // `?? newdir/` entry, so the workbench git tree can show the files inside it.
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repoRoot, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    {
      timeout: 10000,
      maxBuffer: 1024 * 1024
    }
  );
  return parseGitStatusPorcelain(stdout);
}

async function queryGitTrackingForRepo(repoRoot: string): Promise<GitRepoTracking> {
  let branch: string | null = null;
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: GIT_TRACKING_TIMEOUT_MS,
      maxBuffer: 4096
    });
    const trimmed = String(stdout).trim();
    branch = trimmed && trimmed !== "HEAD" ? trimmed : trimmed || null;
  } catch {
    branch = null;
  }

  let upstream: string | null = null;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoRoot, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { timeout: GIT_TRACKING_TIMEOUT_MS, maxBuffer: 4096 }
    );
    const trimmed = String(stdout).trim();
    upstream = trimmed || null;
  } catch {
    upstream = null;
  }

  if (!upstream) {
    return { repoRoot, branch, upstream: null, ahead: 0, behind: 0 };
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoRoot, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      { timeout: GIT_TRACKING_TIMEOUT_MS, maxBuffer: 4096 }
    );
    const counts = parseLeftRightCount(String(stdout));
    return { repoRoot, branch, upstream, ahead: counts.ahead, behind: counts.behind };
  } catch {
    return { repoRoot, branch, upstream, ahead: 0, behind: 0 };
  }
}

async function queryTrackingForRoots(repoRoots: string[]): Promise<GitRepoTracking[]> {
  const tracking: GitRepoTracking[] = [];
  const seen = new Set<string>();
  for (const root of repoRoots) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    try {
      tracking.push(await queryGitTrackingForRepo(root));
    } catch {
      // skip roots that fail tracking query
    }
  }
  return tracking;
}

async function gitShowAtRef(cwd: string, ref: string, filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "show", `${ref}:${filePath}`], {
      timeout: 10000,
      maxBuffer: DEFAULT_MAX_BYTES + 65536,
      encoding: "buffer"
    });
    const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout));
    if (buf.byteLength > DEFAULT_MAX_BYTES) {
      throw new Error(`文件过大（超过 ${Math.round(DEFAULT_MAX_BYTES / 1024)}KB）`);
    }
    return buf.toString("utf8");
  } catch (error) {
    const execErr = error as { code?: number | string };
    if (execErr.code === 1 || /exists on disk|does not exist|exists on disk/.test(formatExecError(error))) {
      return "";
    }
    throw error;
  }
}

async function readWorkingFile(absPath: string, maxBytes = DEFAULT_MAX_BYTES): Promise<string> {
  const stat = await fs.promises.stat(absPath);
  if (!stat.isFile()) return "";
  if (stat.size > maxBytes) {
    throw new Error(`文件过大（超过 ${Math.round(maxBytes / 1024)}KB）`);
  }
  return fs.promises.readFile(absPath, "utf8");
}

async function listDirectoryEntries(rootPath: string, dirPath: string): Promise<DirectoryEntry[]> {
  const root = resolvePathWithinRoot(rootPath, rootPath);
  const dir = resolvePathWithinRoot(dirPath, rootPath);
  const stat = await fs.promises.stat(dir);
  if (!stat.isDirectory()) {
    throw new Error("不是文件夹");
  }

  const names = await fs.promises.readdir(dir, { withFileTypes: true });
  const entries: DirectoryEntry[] = [];
  for (const dirent of names) {
    if (entries.length >= MAX_DIRECTORY_ENTRIES) break;
    const name = dirent.name;
    const fullPath = path.join(dir, name);
    entries.push({
      name,
      path: fullPath,
      isDirectory: dirent.isDirectory()
    });
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return entries;
}

async function queryGitStatus(cwd: string, scanOptions?: GitNestedScanOptions): Promise<GitStatusResult> {
  const resolved = resolveCwd(cwd);
  const scanOpts = normalizeNestedScanOptions(scanOptions);

  if (await isGitRepo(resolved)) {
    const root = await queryGitRoot(resolved);
    const repoRoot = root || resolved;
    try {
      const parsed = await gitStatusForRepo(repoRoot);
      const staged = prefixGitChanges(parsed.staged, resolved, repoRoot);
      const unstaged = prefixGitChanges(parsed.unstaged, resolved, repoRoot);
      const tracking = await queryTrackingForRoots([repoRoot]);
      return { isRepo: true, root, staged, unstaged, tracking };
    } catch (error) {
      throw new Error(formatExecError(error));
    }
  }

  const nestedRepos = await discoverGitReposUnder(resolved, scanOptions);
  if (!nestedRepos.length) {
    return {
      isRepo: false,
      root: null,
      staged: [],
      unstaged: [],
      nestedRepos: [],
      nestedScanDepth: scanOpts.maxDepth,
      tracking: []
    };
  }

  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  for (const repo of nestedRepos) {
    try {
      const parsed = await gitStatusForRepo(repo.root);
      staged.push(...prefixGitChanges(parsed.staged, resolved, repo.root));
      unstaged.push(...prefixGitChanges(parsed.unstaged, resolved, repo.root));
    } catch {
      // skip repos that fail status query
    }
  }

  const tracking = await queryTrackingForRoots(nestedRepos.map((repo) => repo.root));
  return {
    isRepo: true,
    root: null,
    staged,
    unstaged,
    nestedRepos,
    nestedScanDepth: scanOpts.maxDepth,
    tracking
  };
}

async function queryGitDiffSides(
  cwd: string,
  filePath: string,
  staged: boolean
): Promise<GitDiffSidesResult> {
  const resolved = resolveCwd(cwd);
  const repo = await isGitRepo(resolved);
  if (!repo) {
    throw new Error("当前目录不是 Git 仓库");
  }
  const root = (await queryGitRoot(resolved)) || resolved;
  const relPath = filePath.trim();
  if (!relPath || relPath.includes("\0")) {
    throw new Error("无效的文件路径");
  }
  const absPath = path.resolve(root, relPath);
  resolvePathWithinRoot(absPath, root);
  // The patch and the HEAD/"staged" contents are independent git queries:
  // run them concurrently to cut open-diff latency by one subprocess round.
  const [patch, headText, stagedText] = await Promise.all([
    queryGitDiffPatch(root, relPath, staged),
    gitShowAtRef(root, "HEAD", relPath),
    // Staged content lives in the index; `git show :<path>` reads stage 0.
    // An empty ref yields exactly `:<path>` — never the invalid `::<path>`.
    staged ? gitShowAtRef(root, "", relPath) : Promise.resolve("")
  ]);
  let oldText = headText;
  let newText = "";
  let oldLabel = "HEAD";
  let newLabel = staged ? "Staged" : "Working Tree";

  if (staged) {
    newText = stagedText;
    if (oldText === "" && newText !== "") {
      oldLabel = "(empty)";
    }
    if (newText === "" && oldText !== "") {
      newLabel = "(deleted)";
    }
  } else {
    try {
      if (fs.existsSync(absPath)) {
        const stat = await fs.promises.stat(absPath);
        if (stat.isFile()) {
          newText = await readWorkingFile(absPath);
        }
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error(formatExecError(error));
    }
    if (oldText === "" && newText !== "") {
      oldLabel = "(empty)";
    }
    if (newText === "" && oldText !== "") {
      newLabel = "(deleted)";
    }
  }

  return { oldLabel, newLabel, oldText, newText, hunks: toGitDiffHunkMetadata(patch) };
}

async function queryGitDiffPatch(repoRoot: string, repoPath: string, staged: boolean): Promise<string> {
  const args = ["-C", repoRoot, "diff", "--no-ext-diff", "--no-color", "--unified=3"];
  if (staged) args.push("--cached");
  args.push("--", repoPath);
  try {
    const { stdout } = await execFileAsync("git", args, {
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024
    });
    return String(stdout);
  } catch (error) {
    throw new Error(formatExecError(error));
  }
}

async function repoHasHeadPath(repoRoot: string, repoPath: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", repoRoot, "cat-file", "-e", `HEAD:${repoPath}`], {
      timeout: 10000,
      maxBuffer: 4096
    });
    return true;
  } catch {
    return false;
  }
}

export async function discardGitChange(repoRootRaw: string, repoPathRaw: string): Promise<void> {
  const requestedRoot = resolveCwd(repoRootRaw);
  if (!(await isGitRepo(requestedRoot))) {
    throw new Error("当前目录不是 Git 仓库");
  }
  const repoRoot = (await queryGitRoot(requestedRoot)) || requestedRoot;
  const repoPath = normalizeRepoRelativePath(repoPathRaw);
  resolvePathWithinRoot(path.resolve(repoRoot, repoPath), repoRoot);

  const { stdout } = await execGitWithRetry(
    ["-C", repoRoot, "status", "--porcelain=v1", "--", repoPath],
    { timeout: 10000, maxBuffer: 64 * 1024 }
  );
  const status = String(stdout).trim();
  if (!status) {
    throw new Error("该文件没有可回退的 Git 改动");
  }

  try {
    if (status.startsWith("?? ")) {
      await execGitWithRetry(["-C", repoRoot, "clean", "-fd", "--", repoPath], {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });
      return;
    }

    if (await repoHasHeadPath(repoRoot, repoPath)) {
      await execGitWithRetry(["-C", repoRoot, "restore", "--source=HEAD", "--staged", "--worktree", "--", repoPath], {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });
      return;
    }

    // A newly added index entry has no HEAD version. Remove it from the index, then clean its worktree path.
    await execGitWithRetry(["-C", repoRoot, "restore", "--staged", "--", repoPath], {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
    await execGitWithRetry(["-C", repoRoot, "clean", "-fd", "--", repoPath], {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    throw new Error(formatExecError(error));
  }
}

type ApplyGitPatchOptions = {
  reverse: boolean;
  cached: boolean;
};

function applyGitPatchOnce(repoRoot: string, patch: string, options: ApplyGitPatchOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["-C", repoRoot, "apply", "--whitespace=nowarn"];
    if (options.reverse) args.push("--reverse");
    if (options.cached) args.push("--cached");
    const child = spawn("git", args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error); else resolve();
    };
    child.stderr.on("data", (chunk: Buffer | string) => { stderr += String(chunk); });
    child.once("error", (error) => finish(new Error(formatExecError(error))));
    child.once("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(stderr.trim() || `git apply 失败（退出码 ${code ?? "unknown"}）`));
    });
    timeout = setTimeout(() => {
      child.kill();
      finish(new Error("应用 Git hunk 超时"));
    }, 30000);
    child.stdin.end(patch);
  });
}

async function applyGitPatch(repoRoot: string, patch: string, options: ApplyGitPatchOptions, maxRetries = 3, initialDelayMs = 50): Promise<void> {
  let attempt = 0;
  while (true) {
    try {
      await applyGitPatchOnce(repoRoot, patch, options);
      return;
    } catch (error) {
      attempt++;
      const errStr = error instanceof Error ? error.message : String(error);
      const isLockError = errStr.includes("index.lock") || errStr.includes("File exists");
      if (isLockError && attempt <= maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, initialDelayMs * Math.pow(2, attempt - 1)));
        continue;
      }
      throw error;
    }
  }
}

function assertGitHunkTarget(target: GitDiffHunkTarget): void {
  if (!target || ![target.oldStart, target.oldLines, target.newStart, target.newLines].every(Number.isInteger)) {
    throw new Error("无效的 Git hunk");
  }
  if (target.oldStart < 0 || target.oldLines < 0 || target.newStart < 0 || target.newLines < 0) {
    throw new Error("无效的 Git hunk");
  }
}

function assertGitLineTarget(target: GitDiffLineTarget): void {
  if (!target || !Number.isInteger(target.lineNumber) || target.lineNumber < 1) {
    throw new Error("无效的 Git 行号");
  }
  if (target.side !== "additions" && target.side !== "deletions") {
    throw new Error("无效的 Git diff 侧");
  }
}

async function resolveRepoPath(repoRootRaw: string, repoPathRaw: string): Promise<{ repoRoot: string; repoPath: string }> {
  const requestedRoot = resolveCwd(repoRootRaw);
  if (!(await isGitRepo(requestedRoot))) {
    throw new Error("当前目录不是 Git 仓库");
  }
  const repoRoot = (await queryGitRoot(requestedRoot)) || requestedRoot;
  const repoPath = normalizeRepoRelativePath(repoPathRaw);
  resolvePathWithinRoot(path.resolve(repoRoot, repoPath), repoRoot);
  return { repoRoot, repoPath };
}

async function applyGitHunkPatch(
  repoRootRaw: string,
  repoPathRaw: string,
  staged: boolean,
  target: GitDiffHunkTarget,
  options: ApplyGitPatchOptions,
  missingMessage: string
): Promise<void> {
  assertGitHunkTarget(target);
  const { repoRoot, repoPath } = await resolveRepoPath(repoRootRaw, repoPathRaw);
  const patch = await queryGitDiffPatch(repoRoot, repoPath, staged);
  const hunk = findGitDiffHunk(patch, target);
  if (!hunk) {
    throw new Error(missingMessage);
  }
  await applyGitPatch(repoRoot, hunk.patch, options);
}

async function applyGitLinePatch(
  repoRootRaw: string,
  repoPathRaw: string,
  staged: boolean,
  target: GitDiffLineTarget,
  options: ApplyGitPatchOptions,
  missingMessage: string
): Promise<void> {
  assertGitLineTarget(target);
  const { repoRoot, repoPath } = await resolveRepoPath(repoRootRaw, repoPathRaw);
  const patch = await queryGitDiffPatch(repoRoot, repoPath, staged);
  const linePatch = findGitDiffLinePatch(patch, target);
  if (!linePatch) {
    throw new Error(missingMessage);
  }
  await applyGitPatch(repoRoot, linePatch, options);
}

export async function discardGitHunk(
  repoRootRaw: string,
  repoPathRaw: string,
  staged: boolean,
  target: GitDiffHunkTarget
): Promise<void> {
  await applyGitHunkPatch(
    repoRootRaw,
    repoPathRaw,
    staged,
    target,
    { reverse: true, cached: staged },
    "文件内容已变化，请重新打开 diff 后再试"
  );
}

export async function discardGitLine(
  repoRootRaw: string,
  repoPathRaw: string,
  staged: boolean,
  target: GitDiffLineTarget
): Promise<void> {
  await applyGitLinePatch(
    repoRootRaw,
    repoPathRaw,
    staged,
    target,
    { reverse: true, cached: staged },
    "该行已不是可回退的 Git 改动，请重新打开 diff 后再试"
  );
}

/** Stage a working-tree hunk into the index without changing the worktree. */
export async function stageGitHunk(
  repoRootRaw: string,
  repoPathRaw: string,
  target: GitDiffHunkTarget
): Promise<void> {
  await applyGitHunkPatch(
    repoRootRaw,
    repoPathRaw,
    false,
    target,
    { reverse: false, cached: true },
    "文件内容已变化，请重新打开 diff 后再试"
  );
}

/** Unstage a staged hunk from the index without changing the worktree. */
export async function unstageGitHunk(
  repoRootRaw: string,
  repoPathRaw: string,
  target: GitDiffHunkTarget
): Promise<void> {
  await applyGitHunkPatch(
    repoRootRaw,
    repoPathRaw,
    true,
    target,
    { reverse: true, cached: true },
    "文件内容已变化，请重新打开 diff 后再试"
  );
}

/** Stage a working-tree change block into the index without changing the worktree. */
export async function stageGitLine(
  repoRootRaw: string,
  repoPathRaw: string,
  target: GitDiffLineTarget
): Promise<void> {
  await applyGitLinePatch(
    repoRootRaw,
    repoPathRaw,
    false,
    target,
    { reverse: false, cached: true },
    "该行已不是可暂存的 Git 改动，请重新打开 diff 后再试"
  );
}

/** Unstage a staged change block from the index without changing the worktree. */
export async function unstageGitLine(
  repoRootRaw: string,
  repoPathRaw: string,
  target: GitDiffLineTarget
): Promise<void> {
  await applyGitLinePatch(
    repoRootRaw,
    repoPathRaw,
    true,
    target,
    { reverse: true, cached: true },
    "该行已不是可取消暂存的 Git 改动，请重新打开 diff 后再试"
  );
}

export function registerWorkbenchFsIpc(): void {
  safeHandle(
    "workbench:listFiles",
    async (_event, args: { rootPath: string }) => {
      if (!args || typeof args.rootPath !== "string" || !args.rootPath.trim()) {
        throw new Error("无效的项目路径");
      }
      return listWorkbenchFiles({ rootPath: args.rootPath });
    }
  );

  safeHandle("workbench:listFilesCancel", async () => {
    cancelActiveWorkbenchFileList();
    return { ok: true };
  });

  safeHandle(
    "workbench:searchPaths",
    async (_event, args: { rootPath: string; query: string }) => {
      if (!args || typeof args.rootPath !== "string" || !args.rootPath.trim()) {
        throw new Error("无效的项目路径");
      }
      if (typeof args.query !== "string") throw new Error("无效的路径查询");
      return searchWorkbenchPaths({ rootPath: args.rootPath, query: args.query });
    }
  );

  safeHandle("workbench:searchPathsCancel", async () => {
    cancelActiveWorkbenchPathSearch();
    return { ok: true };
  });

  safeHandle(
    "workbench:copyPath",
    async (_event, args: { rootPath: string; sourcePath: string }) => {
      const rootPath = resolveCwd(args.rootPath);
      if (typeof args?.sourcePath !== "string" || !args.sourcePath.trim()) {
        throw new Error("无效的源文件路径");
      }
      await copyWorkbenchPathToClipboard(rootPath, args.sourcePath);
      return { ok: true };
    }
  );

  safeHandle("workbench:clipboardHasFiles", async () => ({
    hasFiles: (await readMacPasteboardFilePaths()).length > 0
  }));

  safeHandle(
    "workbench:pastePaths",
    async (_event, args: { rootPath: string; targetDirectory: string }) => {
      const rootPath = resolveCwd(args.rootPath);
      if (typeof args?.targetDirectory !== "string" || !args.targetDirectory.trim()) {
        throw new Error("无效的粘贴目标");
      }
      return pasteMacClipboardIntoWorkbench(rootPath, args.targetDirectory);
    }
  );

  safeHandle(
    "workbench:listDirectory",
    async (_event, args: { rootPath: string; dirPath: string }) => {
      const rootPath = resolveCwd(args.rootPath);
      const dirPath = args.dirPath?.trim() ? resolvePathWithinRoot(args.dirPath, rootPath) : rootPath;
      const entries = await listDirectoryEntries(rootPath, dirPath);
      return { entries };
    }
  );

  safeHandle(
    "workbench:readFileText",
    async (_event, args: { rootPath: string; filePath: string; maxBytes?: number }) => {
      const rootPath = resolveCwd(args.rootPath);
      const filePath = resolvePathWithinRoot(args.filePath, rootPath);
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        throw new Error("不是文件");
      }
      const maxBytes = Math.min(
        Math.max(1024, Math.floor(args.maxBytes || DEFAULT_MAX_BYTES)),
        DEFAULT_MAX_BYTES
      );
      if (stat.size > maxBytes) {
        throw new Error(`文件过大（超过 ${Math.round(maxBytes / 1024)}KB）`);
      }
      const content = await fs.promises.readFile(filePath, "utf8");
      return { content, truncated: false };
    }
  );

  safeHandle(
    "workbench:inspectFile",
    async (_event, args: { rootPath: string; filePath: string }) => {
      const rootPath = resolveCwd(args.rootPath);
      return inspectWorkbenchFile(rootPath, args.filePath);
    }
  );

  safeHandle(
    "workbench:saveFileText",
    async (
      _event,
      args: {
        rootPath: string;
        filePath: string;
        content: string;
        encoding: WorkbenchTextEncoding;
        expectedVersion: string;
        force?: boolean;
      }
    ) => {
      const rootPath = resolveCwd(args.rootPath);
      if (typeof args.content !== "string" || typeof args.expectedVersion !== "string") {
        throw new Error("无效的保存参数");
      }
      if (!["utf8", "utf8-bom", "utf16le", "utf16be"].includes(args.encoding)) {
        throw new Error("不支持的文件编码");
      }
      return saveWorkbenchFile(
        rootPath,
        args.filePath,
        args.content,
        args.encoding,
        args.expectedVersion,
        Boolean(args.force)
      );
    }
  );

  safeHandle(
    "workbench:createFileText",
    async (
      _event,
      args: {
        rootPath: string;
        filePath: string;
        content: string;
        encoding: WorkbenchTextEncoding;
      }
    ) => {
      const rootPath = resolveCwd(args.rootPath);
      if (typeof args.content !== "string") throw new Error("无效的保存参数");
      if (!["utf8", "utf8-bom", "utf16le", "utf16be"].includes(args.encoding)) {
        throw new Error("不支持的文件编码");
      }
      return createWorkbenchFile(rootPath, args.filePath, args.content, args.encoding);
    }
  );

  safeHandle("workbench:openPath", async (_event, args: { rootPath: string; filePath: string }) => {
    const rootPath = resolveCwd(args.rootPath);
    const filePath = resolveCanonicalWorkbenchPath(rootPath, args.filePath);
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
    return { ok: true };
  });

  safeHandle("workbench:revealPath", async (_event, args: { rootPath: string; targetPath: string }) => {
    const rootPath = resolveCwd(args.rootPath);
    const targetPath = resolvePathWithinRoot(args.targetPath, rootPath);
    if (!fs.existsSync(targetPath)) {
      throw new Error("路径不存在");
    }
    shell.showItemInFolder(targetPath);
    return { ok: true };
  });

  safeHandle(
    "workbench:searchText",
    async (
      _event,
      args: {
        rootPath: string;
        query: string;
        matchCase?: boolean;
        wholeWord?: boolean;
        useRegex?: boolean;
        maxResults?: number;
        maxFileSizeBytes?: number;
      }
    ) => {
      if (typeof args?.query !== "string") {
        throw new Error("无效的搜索参数");
      }
      if (typeof args?.rootPath !== "string" || !args.rootPath.trim()) {
        throw new Error("无效的项目路径");
      }
      return searchWorkbenchText({
        rootPath: args.rootPath,
        query: args.query,
        matchCase: Boolean(args.matchCase),
        wholeWord: Boolean(args.wholeWord),
        useRegex: Boolean(args.useRegex),
        maxResults: args.maxResults,
        maxFileSizeBytes: args.maxFileSizeBytes
      });
    }
  );

  safeHandle("workbench:searchTextCancel", async () => {
    cancelActiveWorkbenchSearch();
    return { ok: true };
  });

  safeHandle(
    "terminal:gitStatus",
    async (_event, args: { cwd: string; nestedScan?: GitNestedScanOptions }) => {
      return queryGitStatus(args.cwd, args.nestedScan);
    }
  );

  safeHandle(
    "terminal:gitDiffSides",
    async (_event, args: { cwd: string; path: string; staged?: boolean }) => {
      return queryGitDiffSides(args.cwd, args.path, Boolean(args.staged));
    }
  );

  safeHandle(
    "terminal:gitDiscardChange",
    async (_event, args: { repoRoot: string; path: string }) => {
      await discardGitChange(args.repoRoot, args.path);
      return { ok: true };
    }
  );

  safeHandle(
    "terminal:gitDiscardHunk",
    async (_event, args: { repoRoot: string; path: string; staged?: boolean; target: GitDiffHunkTarget }) => {
      await discardGitHunk(args.repoRoot, args.path, Boolean(args.staged), args.target);
      return { ok: true };
    }
  );

  safeHandle(
    "terminal:gitDiscardLine",
    async (_event, args: { repoRoot: string; path: string; staged?: boolean; target: GitDiffLineTarget }) => {
      await discardGitLine(args.repoRoot, args.path, Boolean(args.staged), args.target);
      return { ok: true };
    }
  );

  safeHandle(
    "terminal:gitStageHunk",
    async (_event, args: { repoRoot: string; path: string; target: GitDiffHunkTarget }) => {
      await stageGitHunk(args.repoRoot, args.path, args.target);
      return { ok: true };
    }
  );

  safeHandle(
    "terminal:gitUnstageHunk",
    async (_event, args: { repoRoot: string; path: string; target: GitDiffHunkTarget }) => {
      await unstageGitHunk(args.repoRoot, args.path, args.target);
      return { ok: true };
    }
  );

  safeHandle(
    "terminal:gitStageLine",
    async (_event, args: { repoRoot: string; path: string; target: GitDiffLineTarget }) => {
      await stageGitLine(args.repoRoot, args.path, args.target);
      return { ok: true };
    }
  );

  safeHandle(
    "terminal:gitUnstageLine",
    async (_event, args: { repoRoot: string; path: string; target: GitDiffLineTarget }) => {
      await unstageGitLine(args.repoRoot, args.path, args.target);
      return { ok: true };
    }
  );
}
