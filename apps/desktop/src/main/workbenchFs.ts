import { shell } from "electron";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { expandHome } from "@agent-resume/core";
import { safeHandle } from "./ipcUtils";

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_DIRECTORY_ENTRIES = 2000;
const DEFAULT_NESTED_SCAN_MAX_DEPTH = 6;
const DEFAULT_NESTED_SCAN_MAX_REPOS = 32;
const HARD_NESTED_SCAN_MAX_DEPTH = 10;

const DEFAULT_NESTED_SCAN_IGNORE_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "vendor",
  "coverage",
  ".next",
  ".cache",
  "__pycache__",
  "target"
];

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

export interface NestedGitRepoInfo {
  root: string;
  displayPath: string;
}

export interface GitNestedScanOptions {
  maxDepth?: number;
  ignoreDirs?: string[];
  maxRepos?: number;
}

export interface GitStatusResult {
  isRepo: boolean;
  root: string | null;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  nestedRepos?: NestedGitRepoInfo[];
  nestedScanDepth?: number;
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

function normalizeNestedScanOptions(options?: GitNestedScanOptions): {
  maxDepth: number;
  ignoreDirs: Set<string>;
  maxRepos: number;
} {
  const maxDepth = Math.min(
    HARD_NESTED_SCAN_MAX_DEPTH,
    Math.max(1, Math.floor(options?.maxDepth ?? DEFAULT_NESTED_SCAN_MAX_DEPTH))
  );
  const customIgnore = options?.ignoreDirs?.map((d) => d.trim()).filter(Boolean) ?? [];
  const ignoreList = customIgnore.length ? customIgnore : DEFAULT_NESTED_SCAN_IGNORE_DIRS;
  const maxRepos = Math.max(1, Math.floor(options?.maxRepos ?? DEFAULT_NESTED_SCAN_MAX_REPOS));
  return { maxDepth, ignoreDirs: new Set(ignoreList), maxRepos };
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

async function queryGitRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      timeout: 3000,
      maxBuffer: 4096
    });
    const root = stdout.trim();
    return root || null;
  } catch {
    return null;
  }
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], {
      timeout: 3000,
      maxBuffer: 4096
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
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

async function discoverGitReposUnder(
  scanRoot: string,
  options?: GitNestedScanOptions
): Promise<NestedGitRepoInfo[]> {
  const { maxDepth, ignoreDirs, maxRepos } = normalizeNestedScanOptions(options);
  const found: NestedGitRepoInfo[] = [];
  const seenRoots = new Set<string>();

  /** @type {Array<{ dir: string, depth: number }>} */
  const queue = [{ dir: scanRoot, depth: 0 }];

  while (queue.length > 0 && found.length < maxRepos) {
    const current = queue.shift();
    if (!current) break;
    const { dir, depth } = current;

    if (await isGitRepo(dir)) {
      const toplevel = (await queryGitRoot(dir)) || dir;
      if (!seenRoots.has(toplevel)) {
        seenRoots.add(toplevel);
        const displayPath = toPosixPath(path.relative(scanRoot, toplevel));
        found.push({
          root: toplevel,
          displayPath: displayPath === "." ? "" : displayPath
        });
      }
      continue;
    }

    if (depth >= maxDepth) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (ignoreDirs.has(entry.name)) continue;
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }

  found.sort((a, b) => a.displayPath.localeCompare(b.displayPath, undefined, { sensitivity: "base" }));
  return found;
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
      return { isRepo: true, root, staged, unstaged };
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
      nestedScanDepth: scanOpts.maxDepth
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

  return {
    isRepo: true,
    root: null,
    staged,
    unstaged,
    nestedRepos,
    nestedScanDepth: scanOpts.maxDepth
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

export function registerWorkbenchFsIpc(): void {
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
}