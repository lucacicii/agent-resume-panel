import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildHeuristicCommitMessage,
  ensureExtensionCatalogSchema,
  expandHome,
  llmConfigFromSettings,
  loadSettings,
  preparePanelDatabasesFromSettings,
  recordLlmUsage,
  suggestCommitMessageFromGitContext
} from "@agent-resume/core";
import * as fs from "node:fs";
import * as path from "node:path";
import { isGitRepo, queryGitRoot } from "./gitNestedScan";
import { buildGitGraphLayout, type GitGraphLayout } from "./gitGraphLayout";
import { safeHandle } from "./ipcUtils";
import { parseGitStatusPorcelainV1Z, stagedRepoPaths } from "./workbenchGitStatus";
import { resolveCanonicalWorkbenchPath } from "./workbenchFileIo";

export type { GitGraphLayout } from "./gitGraphLayout";

const execFileAsync = promisify(execFile);

const MAX_COMMIT_MESSAGE_BYTES = 8192;
const DEFAULT_GIT_LOG_LIMIT = 50;
const MAX_GIT_LOG_LIMIT = 200;
const GIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;

export interface GitCommitRefs {
  heads: string[];
  tags: string[];
  isHead: boolean;
  primaryLabel: string | null;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: number;
  subject: string;
  parents: string[];
  decorations: string;
  refs: GitCommitRefs;
}

export interface GitShowFileEntry {
  status: string;
  path: string;
}

export interface GitShowResult {
  hash: string;
  shortHash: string;
  author: string;
  date: number;
  subject: string;
  body: string;
  files: GitShowFileEntry[];
}

export interface GitCommitFileDiffSidesResult {
  oldLabel: string;
  newLabel: string;
  oldText: string;
  newText: string;
}

export interface GitFileLogResult {
  repoRoot: string;
  repoPath: string;
  commits: GitLogEntry[];
  layout: GitGraphLayout;
}

function formatExecError(error: unknown): string {
  const err = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
  const stderr = err.stderr ? String(err.stderr).trim() : "";
  if (stderr) return stderr;
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function isMissingUpstreamBranch(error: unknown): boolean {
  return /current branch .+ has no upstream branch/i.test(formatExecError(error));
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

function normalizeCommitMessage(raw: string): string {
  const message = raw.replace(/\0/g, "").trim();
  if (!message) {
    throw new Error("提交信息不能为空");
  }
  if (Buffer.byteLength(message, "utf8") > MAX_COMMIT_MESSAGE_BYTES) {
    throw new Error(`提交信息过长（超过 ${MAX_COMMIT_MESSAGE_BYTES} 字节）`);
  }
  return message;
}

/** Repo-relative paths only; reject absolute paths and parent traversal. */
function normalizeCommitPaths(raw?: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const normalized = String(item || "")
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "")
      .trim();
    if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) continue;
    if (normalized.split("/").some((part) => part === ".." || part === "")) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

async function resolveRepoRoot(raw: string): Promise<string> {
  const resolved = resolveCwd(raw);
  if (!(await isGitRepo(resolved))) {
    throw new Error("当前目录不是 Git 仓库");
  }
  return (await queryGitRoot(resolved)) || resolved;
}

async function gitExec(repoRoot: string, args: string[], timeout = 30000, maxBuffer = 1024 * 1024): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], {
    timeout,
    maxBuffer
  });
  return String(stdout);
}

function normalizeGitLogLimit(raw?: number): number {
  const limit = Math.floor(raw ?? DEFAULT_GIT_LOG_LIMIT);
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_GIT_LOG_LIMIT;
  return Math.min(MAX_GIT_LOG_LIMIT, limit);
}

function assertValidGitHash(hash: string): string {
  const trimmed = hash.trim();
  if (!GIT_HASH_PATTERN.test(trimmed)) {
    throw new Error(`无效的 commit hash: ${hash}`);
  }
  return trimmed;
}

function assertValidGitFilePath(filePath: string): string {
  const normalized = filePath.trim();
  if (!normalized || normalized.includes("\0")) {
    throw new Error("无效的文件路径");
  }
  return normalized;
}

function normalizeGitDecorations(raw: string): string {
  return raw.trim().replace(/^\(|\)$/g, "").trim();
}

function parseGitRefs(decorations: string): GitCommitRefs {
  const normalized = normalizeGitDecorations(decorations);
  if (!normalized) {
    return { heads: [], tags: [], isHead: false, primaryLabel: null };
  }

  const heads: string[] = [];
  const tags: string[] = [];
  const remotes: string[] = [];
  let isHead = false;

  for (const rawPart of normalized.split(/,\s*/)) {
    let part = rawPart.trim();
    if (!part) continue;

    if (/^HEAD\b/i.test(part)) {
      isHead = true;
      const arrowMatch = part.match(/^HEAD\s*->\s*(.+)$/i);
      if (arrowMatch) {
        part = arrowMatch[1].trim();
      } else {
        continue;
      }
    }

    if (/^tag:\s*/i.test(part)) {
      const tagName = part.replace(/^tag:\s*/i, "").trim();
      if (tagName && !tags.includes(tagName)) tags.push(tagName);
      continue;
    }

    if (/^[a-zA-Z0-9_.-]+\//.test(part)) {
      if (!remotes.includes(part)) remotes.push(part);
      continue;
    }

    if (!heads.includes(part)) heads.push(part);
  }

  let primaryLabel: string | null = null;
  if (heads.length > 0) {
    primaryLabel = heads[0];
  } else if (remotes.length > 0) {
    const remote = remotes[0];
    const slash = remote.indexOf("/");
    primaryLabel = slash >= 0 ? remote.slice(slash + 1) : remote;
  }

  return { heads, tags, isHead, primaryLabel };
}

function parseParentsField(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/).filter((hash) => GIT_HASH_PATTERN.test(hash));
}

function parseGitLogOutput(stdout: string): GitLogEntry[] {
  const entries: GitLogEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\x1f");
    if (parts.length < 7) continue;
    const [hash, shortHash, author, dateRaw, decorations, parentsRaw, ...subjectParts] = parts;
    const date = Number.parseInt(dateRaw, 10);
    if (!hash || !Number.isFinite(date)) continue;
    const normalizedDecorations = normalizeGitDecorations(decorations || "");
    entries.push({
      hash,
      shortHash: shortHash || hash.slice(0, 7),
      author: author || "",
      date,
      subject: subjectParts.join("\x1f") || "",
      parents: parseParentsField(parentsRaw || ""),
      decorations: normalizedDecorations,
      refs: parseGitRefs(normalizedDecorations)
    });
  }
  return entries;
}

function parseNameStatusOutput(stdout: string): GitShowFileEntry[] {
  const files: GitShowFileEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const status = line.slice(0, tab).trim();
    let filePath = line.slice(tab + 1).trim();
    const renameArrow = filePath.indexOf("\t");
    if (renameArrow >= 0) {
      filePath = filePath.slice(renameArrow + 1).trim() || filePath.slice(0, renameArrow).trim();
    }
    if (!filePath) continue;
    files.push({ status, path: filePath });
  }
  return files;
}

async function queryGitLog(repoRoot: string, limit?: number): Promise<GitLogEntry[]> {
  const n = normalizeGitLogLimit(limit);
  try {
    const stdout = await gitExec(
      repoRoot,
      [
        "log",
        "--all",
        "--topo-order",
        `-n${n}`,
        "--date=unix",
        "--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%d%x1f%P%x1f%s"
      ],
      30000,
      2 * 1024 * 1024
    );
    return parseGitLogOutput(stdout);
  } catch (error) {
    throw new Error(formatExecError(error));
  }
}

export async function queryGitFileLog(
  rawRootPath: string,
  rawFilePath: string,
  limit?: number
): Promise<GitFileLogResult> {
  const rootPath = resolveCwd(rawRootPath);
  const filePath = resolveCanonicalWorkbenchPath(rootPath, rawFilePath);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error("不是文件");
  }

  const repoRoot = await queryGitRoot(path.dirname(filePath));
  if (!repoRoot) {
    throw new Error("文件不在 Git 仓库中");
  }
  const relativePath = path.relative(repoRoot, filePath);
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(path.sep).includes("..")) {
    throw new Error("文件不在 Git 仓库中");
  }
  const repoPath = relativePath.split(path.sep).join("/");
  const n = normalizeGitLogLimit(limit);

  try {
    const stdout = await gitExec(
      repoRoot,
      [
        "log",
        "--branches",
        "--remotes",
        "--follow",
        "--topo-order",
        `-n${n}`,
        "--date=unix",
        "--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%d%x1f%P%x1f%s",
        "--",
        repoPath
      ],
      30000,
      2 * 1024 * 1024
    );
    const commits = parseGitLogOutput(stdout);
    const layout = buildGitGraphLayout(
      commits.map((commit) => ({
        hash: commit.hash,
        parents: commit.parents,
        decorations: commit.decorations,
        refs: commit.refs
      }))
    );
    return { repoRoot, repoPath, commits, layout };
  } catch (error) {
    throw new Error(formatExecError(error));
  }
}

async function queryGitShow(repoRoot: string, hash: string): Promise<GitShowResult> {
  const commit = assertValidGitHash(hash);
  try {
    const metaStdout = await gitExec(repoRoot, [
      "show",
      "-s",
      "--date=unix",
      "--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s%x1f%b",
      commit
    ]);
    const parts = metaStdout.trimEnd().split("\x1f");
    if (parts.length < 5) {
      throw new Error("无法解析 commit 详情");
    }
    const [fullHash, shortHash, author, dateRaw, subject, ...bodyParts] = parts;
    const date = Number.parseInt(dateRaw, 10);
    if (!fullHash || !Number.isFinite(date)) {
      throw new Error("无法解析 commit 详情");
    }
    const filesStdout = await gitExec(repoRoot, ["diff-tree", "--no-commit-id", "--name-status", "-r", commit]);
    return {
      hash: fullHash,
      shortHash: shortHash || fullHash.slice(0, 7),
      author: author || "",
      date,
      subject: subject || "",
      body: bodyParts.join("\x1f").trim(),
      files: parseNameStatusOutput(filesStdout)
    };
  } catch (error) {
    throw new Error(formatExecError(error));
  }
}

async function gitShowCommitFile(repoRoot: string, ref: string, filePath: string): Promise<string | null> {
  try {
    return await gitExec(repoRoot, ["show", `${ref}:${filePath}`], 10000, 512 * 1024 + 65536);
  } catch (error) {
    const message = formatExecError(error);
    if (/does not exist|exists on disk, but not in|invalid object name|unknown revision|bad object/i.test(message)) {
      return null;
    }
    throw new Error(message);
  }
}

async function queryGitCommitFileDiffSides(
  repoRoot: string,
  hash: string,
  filePath: string
): Promise<GitCommitFileDiffSidesResult> {
  const commit = assertValidGitHash(hash);
  const path = assertValidGitFilePath(filePath);
  const shortHash = commit.slice(0, 7);

  const [oldFile, newFile] = await Promise.all([
    gitShowCommitFile(repoRoot, `${commit}^`, path),
    gitShowCommitFile(repoRoot, commit, path)
  ]);

  return {
    oldLabel: oldFile === null ? "(empty)" : `${shortHash}^`,
    newLabel: newFile === null ? "(deleted)" : shortHash,
    oldText: oldFile ?? "",
    newText: newFile ?? ""
  };
}

async function collectGitCommitContext(repoRoot: string): Promise<{ statusText: string; diffText: string }> {
  const statusText = await gitExec(repoRoot, ["status", "--porcelain=v1"], 10000);
  let diffText = "";
  try {
    diffText = await gitExec(repoRoot, ["diff", "--cached"], 15000);
  } catch {
    diffText = "";
  }
  if (!diffText.trim()) {
    try {
      diffText = await gitExec(repoRoot, ["diff"], 15000);
    } catch {
      diffText = "";
    }
  }
  return { statusText, diffText };
}

async function suggestCommitMessage(
  repoRoot: string,
  systemLocale?: string
): Promise<{ message: string; source: "llm" | "heuristic"; fallbackReason?: "unconfigured" | "request-failed" }> {
  const { statusText, diffText } = await collectGitCommitContext(repoRoot);
  if (!statusText.trim()) {
    throw new Error(`当前仓库没有可提交的改动：${repoRoot}`);
  }

  const settings = await loadSettings();
  const commitPrompt = {
    style: settings.workbench?.gitCommitMessageStyle,
    customInstructions: settings.workbench?.gitCommitCustomInstructions
  };
  const llm = llmConfigFromSettings(settings, systemLocale);
  if (!llm) {
    return { message: buildHeuristicCommitMessage(statusText, commitPrompt), source: "heuristic", fallbackReason: "unconfigured" };
  }

  const paths = await preparePanelDatabasesFromSettings();
  await ensureExtensionCatalogSchema(paths.catalogDb);

  try {
    const result = await suggestCommitMessageFromGitContext(llm, statusText, diffText, commitPrompt);
    await recordLlmUsage(paths.desktopDb, {
      kind: "chat",
      source: "git-commit",
      jobKey: `git-commit:${repoRoot}`,
      model: result.model,
      usage: result.usage,
      durationMs: result.durationMs,
      ok: true
    });
    return { message: result.message, source: "llm" };
  } catch (error) {
    await recordLlmUsage(paths.desktopDb, {
      kind: "chat",
      source: "git-commit",
      jobKey: `git-commit:${repoRoot}`,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
    return { message: buildHeuristicCommitMessage(statusText, commitPrompt), source: "heuristic", fallbackReason: "request-failed" };
  }
}

export function registerWorkbenchGitIpc(getSystemLocale: () => string): void {
  safeHandle("terminal:gitSuggestCommit", async (_event, args: { repoRoot: string }) => {
    const repoRoot = await resolveRepoRoot(args.repoRoot);
    return suggestCommitMessage(repoRoot, getSystemLocale());
  });

  safeHandle("terminal:gitCommit", async (_event, args: { repoRoot: string; message: string; paths?: string[] }) => {
    const repoRoot = await resolveRepoRoot(args.repoRoot);
    const message = normalizeCommitMessage(args.message);
    const paths = normalizeCommitPaths(args.paths);
    if (!paths.length) {
      throw new Error("请选择要提交的文件");
    }
    const statusText = await gitExec(repoRoot, ["status", "--porcelain=v1", "-z"], 10000);
    if (!statusText) {
      throw new Error(`当前仓库没有可提交的改动：${repoRoot}`);
    }
    const previouslyStaged = stagedRepoPaths(parseGitStatusPorcelainV1Z(statusText));
    const selected = new Set(paths);
    const toUnstage = previouslyStaged.filter((path) => !selected.has(path));
    try {
      await execFileAsync("git", ["-C", repoRoot, "add", "--", ...paths], {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });
      if (toUnstage.length) {
        await execFileAsync("git", ["-C", repoRoot, "restore", "--staged", "--", ...toUnstage], {
          timeout: 30000,
          maxBuffer: 1024 * 1024
        });
      }
      await execFileAsync("git", ["-C", repoRoot, "commit", "-m", message], {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });
    } catch (error) {
      throw new Error(formatExecError(error));
    }
    return { ok: true };
  });

  safeHandle("terminal:gitPush", async (_event, args: { repoRoot: string }) => {
    const repoRoot = await resolveRepoRoot(args.repoRoot);
    try {
      await execFileAsync("git", ["-C", repoRoot, "push"], {
        timeout: 120000,
        maxBuffer: 1024 * 1024
      });
    } catch (error) {
      if (isMissingUpstreamBranch(error)) {
        try {
          const { stdout: branchOutput } = await execFileAsync(
            "git",
            ["-C", repoRoot, "symbolic-ref", "--quiet", "--short", "HEAD"],
            { timeout: 30000, maxBuffer: 1024 * 1024 }
          );
          const branch = String(branchOutput).trim();
          if (!branch) {
            throw new Error("当前处于分离 HEAD 状态，无法设置远程跟踪分支");
          }
          await execFileAsync("git", ["-C", repoRoot, "remote", "get-url", "origin"], {
            timeout: 30000,
            maxBuffer: 1024 * 1024
          });
          await execFileAsync("git", ["-C", repoRoot, "push", "--set-upstream", "origin", branch], {
            timeout: 120000,
            maxBuffer: 1024 * 1024
          });
        } catch (fallbackError) {
          throw new Error(formatExecError(fallbackError));
        }
      } else {
        throw new Error(formatExecError(error));
      }
    }
    return { ok: true };
  });

  safeHandle("terminal:gitPull", async (_event, args: { repoRoot: string }) => {
    const repoRoot = await resolveRepoRoot(args.repoRoot);
    try {
      await execFileAsync("git", ["-C", repoRoot, "pull"], {
        timeout: 120000,
        maxBuffer: 1024 * 1024
      });
    } catch (error) {
      throw new Error(formatExecError(error));
    }
    return { ok: true };
  });

  safeHandle("terminal:gitFetch", async (_event, args: { repoRoot: string }) => {
    const repoRoot = await resolveRepoRoot(args.repoRoot);
    try {
      await execFileAsync("git", ["-C", repoRoot, "fetch", "--prune"], {
        timeout: 60000,
        maxBuffer: 1024 * 1024
      });
    } catch (error) {
      throw new Error(formatExecError(error));
    }
    return { ok: true };
  });

  safeHandle("terminal:gitLog", async (_event, args: { repoRoot: string; limit?: number }) => {
    const repoRoot = await resolveRepoRoot(args.repoRoot);
    const commits = await queryGitLog(repoRoot, args.limit);
    const layout = buildGitGraphLayout(
      commits.map((commit) => ({
        hash: commit.hash,
        parents: commit.parents,
        decorations: commit.decorations,
        refs: commit.refs
      }))
    );
    return { commits, layout };
  });

  safeHandle(
    "workbench:gitFileLog",
    async (_event, args: { rootPath: string; filePath: string; limit?: number }) => {
      if (!args
        || typeof args.rootPath !== "string"
        || !args.rootPath.trim()
        || typeof args.filePath !== "string"
        || !args.filePath.trim()) {
        throw new Error("无效的文件历史请求");
      }
      return queryGitFileLog(args.rootPath, args.filePath, args.limit);
    }
  );

  safeHandle("terminal:gitShow", async (_event, args: { repoRoot: string; hash: string }) => {
    const repoRoot = await resolveRepoRoot(args.repoRoot);
    return queryGitShow(repoRoot, args.hash);
  });

  safeHandle(
    "terminal:gitShowFileDiffSides",
    async (_event, args: { repoRoot: string; hash: string; path: string }) => {
      const repoRoot = await resolveRepoRoot(args.repoRoot);
      return queryGitCommitFileDiffSides(repoRoot, args.hash, args.path);
    }
  );
}
