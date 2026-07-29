import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { expandHome } from "@agent-resume/core";
import { detectRipgrep, WORKBENCH_SKIP_DIR_NAMES } from "./workbenchSearch";

export interface WorkbenchIndexedFile {
  path: string;
  relativePath: string;
}

export interface WorkbenchFileIndexResult {
  files: WorkbenchIndexedFile[];
  truncated: boolean;
  engine: "rg" | "node";
}

export interface WorkbenchFileIndexOptions {
  rootPath: string;
  maxFiles?: number;
  timeBudgetMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_TIME_BUDGET_MS = 2_000;
const YIELD_EVERY_ENTRIES = 128;
let activeChild: ChildProcess | null = null;
let activeAbort: AbortController | null = null;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, number));
}

function resolveRoot(raw: string): string {
  const root = path.resolve(expandHome(raw.trim()));
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error(`工作目录不是文件夹: ${root}`);
  return root;
}

function abortError(): Error {
  const error = new Error("File listing cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function indexedFile(root: string, relativePath: string): WorkbenchIndexedFile | null {
  const normalized = relativePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.includes("\0")) return null;
  const absolute = path.resolve(root, normalized);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return { path: absolute, relativePath: normalized };
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function listWithNode(
  root: string,
  maxFiles: number,
  timeBudgetMs: number,
  signal: AbortSignal
): Promise<WorkbenchFileIndexResult> {
  const started = Date.now();
  const stack = [root];
  const files: WorkbenchIndexedFile[] = [];
  let visited = 0;
  let truncated = false;

  while (stack.length) {
    throwIfAborted(signal);
    if (Date.now() - started >= timeBudgetMs) {
      truncated = true;
      break;
    }
    const directory = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      visited += 1;
      if (visited % YIELD_EVERY_ENTRIES === 0) {
        await yieldEventLoop();
        throwIfAborted(signal);
      }
      if (Date.now() - started >= timeBudgetMs) {
        truncated = true;
        break;
      }
      if (entry.name === "." || entry.name === "..") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!WORKBENCH_SKIP_DIR_NAMES.has(entry.name)) stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const file = indexedFile(root, path.relative(root, absolute));
      if (file) files.push(file);
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: "base" }));
  return { files, truncated, engine: "node" };
}

function listWithRipgrep(
  root: string,
  maxFiles: number,
  timeBudgetMs: number,
  signal: AbortSignal
): Promise<WorkbenchFileIndexResult> {
  const args = ["--files", "--hidden", "--no-require-git", "--no-messages", "--color", "never"];
  for (const directory of WORKBENCH_SKIP_DIR_NAMES) {
    args.push("--glob", `!${directory}`);
    args.push("--glob", `!**/${directory}/**`);
  }
  args.push(".");

  return new Promise((resolve, reject) => {
    const files: WorkbenchIndexedFile[] = [];
    let carry = "";
    let settled = false;
    let truncated = false;
    const child = spawn("rg", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    activeChild = child;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (activeChild === child) activeChild = null;
      if (error) reject(error);
      else resolve({ files, truncated, engine: "rg" });
    };
    const addLines = (text: string, flush = false) => {
      carry += text;
      const lines = carry.split(/\r?\n/);
      carry = flush ? "" : lines.pop() || "";
      for (const line of lines) {
        const file = indexedFile(root, line);
        if (file) files.push(file);
        if (files.length >= maxFiles) {
          truncated = true;
          child.kill("SIGTERM");
          break;
        }
      }
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(abortError());
    };
    const timer = setTimeout(() => {
      truncated = true;
      child.kill("SIGTERM");
    }, timeBudgetMs);

    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => addLines(chunk));
    child.on("error", (error) => finish(error));
    child.on("exit", () => {
      if (signal.aborted) return finish(abortError());
      if (carry && files.length < maxFiles) addLines("\n", true);
      files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: "base" }));
      finish();
    });
  });
}

export function cancelActiveWorkbenchFileList(): void {
  activeAbort?.abort();
  activeAbort = null;
  if (activeChild && !activeChild.killed) activeChild.kill("SIGTERM");
  activeChild = null;
}

export function resetWorkbenchFileIndexForTests(): void {
  cancelActiveWorkbenchFileList();
}

export async function listWorkbenchFiles(options: WorkbenchFileIndexOptions): Promise<WorkbenchFileIndexResult> {
  cancelActiveWorkbenchFileList();
  const controller = new AbortController();
  activeAbort = controller;
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (options.signal?.aborted) controller.abort();

  try {
    throwIfAborted(controller.signal);
    const root = resolveRoot(options.rootPath);
    const maxFiles = clampInt(options.maxFiles, DEFAULT_MAX_FILES, 1, DEFAULT_MAX_FILES);
    const timeBudgetMs = clampInt(options.timeBudgetMs, DEFAULT_TIME_BUDGET_MS, 100, 10_000);
    if (await detectRipgrep()) {
      try {
        return await listWithRipgrep(root, maxFiles, timeBudgetMs, controller.signal);
      } catch (error) {
        if ((error as Error)?.name === "AbortError") throw error;
      }
    }
    return await listWithNode(root, maxFiles, timeBudgetMs, controller.signal);
  } finally {
    options.signal?.removeEventListener("abort", onExternalAbort);
    if (activeAbort === controller) activeAbort = null;
  }
}
