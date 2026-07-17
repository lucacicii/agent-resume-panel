import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { expandHome } from "@agent-resume/core";

const execFileAsync = promisify(execFile);

export const DEFAULT_NESTED_SCAN_MAX_DEPTH = 6;
export const DEFAULT_NESTED_SCAN_MAX_REPOS = 32;
export const HARD_NESTED_SCAN_MAX_DEPTH = 10;

export const DEFAULT_NESTED_SCAN_IGNORE_DIRS = [
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

export interface GitNestedScanOptions {
  maxDepth?: number;
  ignoreDirs?: string[];
  maxRepos?: number;
}

export interface NestedGitRepoInfo {
  root: string;
  displayPath: string;
}

export interface NestedGitRepoWithBranch extends NestedGitRepoInfo {
  branch: string | null;
}

export type TerminalGitMode = "none" | "direct" | "nested";

export interface TerminalGitInfoResult {
  mode: TerminalGitMode;
  isRepo: boolean;
  branch: string | null;
  repoRoot: string | null;
  nestedRepos: NestedGitRepoWithBranch[];
}

export interface TerminalGitBranchesRepoResult {
  root: string;
  displayPath: string;
  current: string | null;
  branches: string[];
}

export interface TerminalGitBranchesResult {
  mode: TerminalGitMode;
  current?: string | null;
  branches?: string[];
  repoRoot?: string | null;
  repos?: TerminalGitBranchesRepoResult[];
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

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function normalizeNestedScanOptions(options?: GitNestedScanOptions): {
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

export async function isGitRepo(cwd: string): Promise<boolean> {
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

export async function queryGitRoot(cwd: string): Promise<string | null> {
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

export async function discoverGitReposUnder(
  scanRoot: string,
  options?: GitNestedScanOptions
): Promise<NestedGitRepoInfo[]> {
  const { maxDepth, ignoreDirs, maxRepos } = normalizeNestedScanOptions(options);
  const found: NestedGitRepoInfo[] = [];
  const seenRoots = new Set<string>();

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

function isValidGitBranchRef(branch: string): boolean {
  const trimmed = branch.trim();
  if (!trimmed || trimmed.startsWith("-")) return false;
  if (/[\0\r\n]/.test(trimmed)) return false;
  return true;
}

async function queryGitBranch(repoRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: 3000,
      maxBuffer: 4096
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function queryGitInfoWithNested(
  rawCwd: string,
  nestedScan?: GitNestedScanOptions
): Promise<TerminalGitInfoResult> {
  const cwd = resolveCwd(rawCwd);

  if (await isGitRepo(cwd)) {
    const repoRoot = (await queryGitRoot(cwd)) || cwd;
    const branch = await queryGitBranch(repoRoot);
    return {
      mode: "direct",
      isRepo: true,
      branch,
      repoRoot,
      nestedRepos: []
    };
  }

  const nestedRepos = await discoverGitReposUnder(cwd, nestedScan);
  if (!nestedRepos.length) {
    return {
      mode: "none",
      isRepo: false,
      branch: null,
      repoRoot: null,
      nestedRepos: []
    };
  }

  const nestedWithBranches: NestedGitRepoWithBranch[] = [];
  for (const repo of nestedRepos) {
    nestedWithBranches.push({
      ...repo,
      branch: await queryGitBranch(repo.root)
    });
  }

  return {
    mode: "nested",
    isRepo: true,
    branch: null,
    repoRoot: null,
    nestedRepos: nestedWithBranches
  };
}

async function listGitBranchesForRepo(
  repoRoot: string
): Promise<{ current: string | null; branches: string[] }> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, "branch", "--list"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
    const branches: string[] = [];
    let current: string | null = null;
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("* ")) {
        current = trimmed.slice(2).trim();
        branches.push(current);
      } else {
        branches.push(trimmed);
      }
    }
    return { current, branches };
  } catch (error) {
    throw new Error(formatExecError(error));
  }
}

export async function listGitBranchesWithNested(
  rawCwd: string,
  nestedScan?: GitNestedScanOptions
): Promise<TerminalGitBranchesResult> {
  const info = await queryGitInfoWithNested(rawCwd, nestedScan);

  if (info.mode === "none") {
    return { mode: "none", current: null, branches: [], repoRoot: null, repos: [] };
  }

  if (info.mode === "direct" && info.repoRoot) {
    const listed = await listGitBranchesForRepo(info.repoRoot);
    return {
      mode: "direct",
      current: listed.current,
      branches: listed.branches,
      repoRoot: info.repoRoot
    };
  }

  const repos: TerminalGitBranchesRepoResult[] = [];
  for (const repo of info.nestedRepos) {
    try {
      const listed = await listGitBranchesForRepo(repo.root);
      repos.push({
        root: repo.root,
        displayPath: repo.displayPath,
        current: listed.current,
        branches: listed.branches
      });
    } catch {
      repos.push({
        root: repo.root,
        displayPath: repo.displayPath,
        current: repo.branch,
        branches: []
      });
    }
  }

  return { mode: "nested", repos };
}

export async function checkoutGitBranch(repoRoot: string, branch: string): Promise<void> {
  if (!isValidGitBranchRef(branch)) {
    throw new Error(`无效的分支名: ${branch}`);
  }
  try {
    await execFileAsync("git", ["-C", repoRoot, "checkout", branch.trim()], {
      timeout: 15000,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    throw new Error(formatExecError(error));
  }
}