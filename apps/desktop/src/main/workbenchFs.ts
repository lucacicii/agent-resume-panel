import { shell } from "electron";
import { execFile } from "node:child_process";
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
  listWorkbenchFiles
} from "./workbenchFileIndex";

export type { GitRepoTracking } from "./gitTracking";
export { parseLeftRightCount } from "./gitTracking";

const execFileAsync = promisify(execFile);

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
}

function formatExecError(error: unknown): string {
  const err = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
  const stderr = err.stderr ? String(err.stderr).trim() : "";
  if (stderr) return stderr;
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
  const normalized = raw.trim().replace(/\\/g, "/");
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

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let filePath = "";

    if (line.startsWith("?? ")) {
      filePath = line.slice(3).trim();
      if (!filePath) continue;
      unstaged.push(makeChange(filePath, "?", { staged: false, unstaged: true }));
      unstagedPaths.add(filePath);
      continue;
    }

    if (line.length < 4) continue;
    const indexStatus = line[0];
    const worktreeStatus = line[1];
    filePath = line.slice(3).trim();
    if (!filePath) continue;

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

async function gitStatusForRepo(repoRoot: string): Promise<{ staged: GitFileChange[]; unstaged: GitFileChange[] }> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, "status", "--porcelain=v1"], {
    timeout: 10000,
    maxBuffer: 1024 * 1024
  });
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

function readWorkingFile(absPath: string, maxBytes = DEFAULT_MAX_BYTES): string {
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) return "";
  if (stat.size > maxBytes) {
    throw new Error(`文件过大（超过 ${Math.round(maxBytes / 1024)}KB）`);
  }
  return fs.readFileSync(absPath, "utf8");
}

async function listDirectoryEntries(rootPath: string, dirPath: string): Promise<DirectoryEntry[]> {
  const root = resolvePathWithinRoot(rootPath, rootPath);
  const dir = resolvePathWithinRoot(dirPath, rootPath);
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    throw new Error("不是文件夹");
  }

  const names = fs.readdirSync(dir, { withFileTypes: true });
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

  const headText = await gitShowAtRef(root, "HEAD", relPath);
  let oldText = headText;
  let newText = "";
  let oldLabel = "HEAD";
  let newLabel = staged ? "Staged" : "Working Tree";

  if (staged) {
    newText = await gitShowAtRef(root, ":", relPath);
    if (oldText === "" && newText !== "") {
      oldLabel = "(empty)";
    }
    if (newText === "" && oldText !== "") {
      newLabel = "(deleted)";
    }
  } else {
    try {
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        newText = readWorkingFile(absPath);
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

  return { oldLabel, newLabel, oldText, newText };
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

  const { stdout } = await execFileAsync(
    "git",
    ["-C", repoRoot, "status", "--porcelain=v1", "--", repoPath],
    { timeout: 10000, maxBuffer: 64 * 1024 }
  );
  const status = String(stdout).trim();
  if (!status) {
    throw new Error("该文件没有可回退的 Git 改动");
  }

  try {
    if (status.startsWith("?? ")) {
      await execFileAsync("git", ["-C", repoRoot, "clean", "-fd", "--", repoPath], {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });
      return;
    }

    if (await repoHasHeadPath(repoRoot, repoPath)) {
      await execFileAsync("git", ["-C", repoRoot, "restore", "--source=HEAD", "--staged", "--worktree", "--", repoPath], {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });
      return;
    }

    // A newly added index entry has no HEAD version. Remove it from the index, then clean its worktree path.
    await execFileAsync("git", ["-C", repoRoot, "restore", "--staged", "--", repoPath], {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
    await execFileAsync("git", ["-C", repoRoot, "clean", "-fd", "--", repoPath], {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    throw new Error(formatExecError(error));
  }
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
      const stat = fs.statSync(filePath);
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
      return { content: fs.readFileSync(filePath, "utf8"), truncated: false };
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
}
