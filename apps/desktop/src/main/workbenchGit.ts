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

async function gitExec(repoRoot: string, args: string[], timeout = 30000): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], {
    timeout,
    maxBuffer: 1024 * 1024
  });
  return String(stdout);
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
}