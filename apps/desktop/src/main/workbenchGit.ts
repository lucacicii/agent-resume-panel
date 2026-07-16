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
import { isGitRepo, queryGitRoot } from "./gitNestedScan";
import { safeHandle } from "./ipcUtils";

const execFileAsync = promisify(execFile);

const MAX_COMMIT_MESSAGE_BYTES = 8192;
const DEFAULT_GIT_LOG_LIMIT = 50;
const MAX_GIT_LOG_LIMIT = 200;
const GIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: number;
  subject: string;
  graphPrefix: string;
  decorations: string;
  isConnectorOnly?: boolean;
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

const GIT_LOG_HASH_FIELD_RE = /[0-9a-f]{40}\x1f/i;

function normalizeGitDecorations(raw: string): string {
  return raw.trim().replace(/^\(|\)$/g, "").trim();
}

function parseGitGraphLogOutput(stdout: string): GitLogEntry[] {
  const entries: GitLogEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const hashFieldMatch = line.match(GIT_LOG_HASH_FIELD_RE);
    if (!hashFieldMatch || hashFieldMatch.index == null) {
      entries.push({
        hash: "",
        shortHash: "",
        author: "",
        date: 0,
        subject: "",
        graphPrefix: line.trimEnd(),
        decorations: "",
        isConnectorOnly: true
      });
      continue;
    }

    const graphPrefix = line.slice(0, hashFieldMatch.index).trimEnd();
    const payload = line.slice(hashFieldMatch.index);
    const parts = payload.split("\x1f");
    if (parts.length < 6) continue;
    const [hash, shortHash, author, dateRaw, decorations, ...subjectParts] = parts;
    const date = Number.parseInt(dateRaw, 10);
    if (!hash || !Number.isFinite(date)) continue;
    entries.push({
      hash,
      shortHash: shortHash || hash.slice(0, 7),
      author: author || "",
      date,
      subject: subjectParts.join("\x1f") || "",
      graphPrefix,
      decorations: normalizeGitDecorations(decorations || "")
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
        "--graph",
        "--all",
        "--topo-order",
        `-n${n}`,
        "--date=unix",
        "--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%d%x1f%s"
      ],
      30000,
      2 * 1024 * 1024
    );
    return parseGitGraphLogOutput(stdout);
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
): Promise<{ message: string; source: "llm" | "heuristic" }> {
  const { statusText, diffText } = await collectGitCommitContext(repoRoot);
  if (!statusText.trim()) {
    throw new Error("没有可提交的改动");
  }

  const settings = await loadSettings();
  const llm = llmConfigFromSettings(settings, systemLocale);
  if (!llm) {
    return { message: buildHeuristicCommitMessage(statusText), source: "heuristic" };
  }

  const paths = await preparePanelDatabasesFromSettings();
  await ensureExtensionCatalogSchema(paths.catalogDb);

  try {
    const result = await suggestCommitMessageFromGitContext(llm, statusText, diffText);
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
    return { message: buildHeuristicCommitMessage(statusText), source: "heuristic" };
  }
}

export function registerWorkbenchGitIpc(getSystemLocale: () => string): void {
  safeHandle("terminal:gitSuggestCommit", async (_event, args: { repoRoot: string }) => {
    const repoRoot = await resolveRepoRoot(args.repoRoot);
    return suggestCommitMessage(repoRoot, getSystemLocale());
  });

  safeHandle("terminal:gitCommit", async (_event, args: { repoRoot: string; message: string }) => {
    const repoRoot = await resolveRepoRoot(args.repoRoot);
    const message = normalizeCommitMessage(args.message);
    const { statusText } = await collectGitCommitContext(repoRoot);
    if (!statusText.trim()) {
      throw new Error("没有可提交的改动");
    }
    try {
      await execFileAsync("git", ["-C", repoRoot, "add", "-A"], {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });
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
      throw new Error(formatExecError(error));
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

  safeHandle("terminal:gitLog", async (_event, args: { repoRoot: string; limit?: number }) => {
    const repoRoot = await resolveRepoRoot(args.repoRoot);
    const commits = await queryGitLog(repoRoot, args.limit);
    return { commits };
  });

  safeHandle("terminal:gitShow", async (_event, args: { repoRoot: string; hash: string }) => {
    const repoRoot = await resolveRepoRoot(args.repoRoot);
    return queryGitShow(repoRoot, args.hash);
  });
}