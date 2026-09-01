import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { expandHome } from "@agent-resume/core";
import {
  compareQuickAccessPathMatches,
  matchQuickAccessPath,
  normalizeQuickAccessQuery,
  type MatchedQuickAccessPath
} from "../shared/quickAccessPathMatch";
import { detectRipgrep, WORKBENCH_SKIP_DIR_NAMES } from "./workbenchSearch";

export interface WorkbenchIndexedFile {
  path: string;
  relativePath: string;
  kind: "file" | "directory";
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

export interface WorkbenchPathSearchOptions {
  rootPath: string;
  query: string;
  maxResults?: number;
  timeBudgetMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_TIME_BUDGET_MS = 2_000;
const DEFAULT_MAX_SEARCH_RESULTS = 500;
const DEFAULT_SEARCH_TIME_BUDGET_MS = 3_000;
const YIELD_EVERY_ENTRIES = 128;
let activeChild: ChildProcess | null = null;
let activeAbort: AbortController | null = null;
let activeSearchChild: ChildProcess | null = null;
let activeSearchAbort: AbortController | null = null;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, number));
}

function resolveRoot(raw: string): string {
  const root = path.resolve(expandHome(raw.trim()));
  try {
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) throw new Error(`工作目录不是文件夹: ${root}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`工作目录不存在: ${root}`);
    }
    throw error;
  }
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

function indexedEntry(
  root: string,
  relativePath: string,
  kind: WorkbenchIndexedFile["kind"]
): WorkbenchIndexedFile | null {
  const normalized = relativePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.includes("\0")) return null;
  const absolute = path.resolve(root, normalized);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return { path: absolute, relativePath: normalized, kind };
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
  let fileCount = 0;
  let directoryCount = 0;
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
        if (!WORKBENCH_SKIP_DIR_NAMES.has(entry.name)) {
          const indexed = indexedEntry(root, path.relative(root, absolute), "directory");
          if (indexed && directoryCount < maxFiles) {
            files.push(indexed);
            directoryCount += 1;
          } else if (indexed) {
            truncated = true;
          }
          stack.push(absolute);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const file = indexedEntry(root, path.relative(root, absolute), "file");
      if (file && fileCount < maxFiles) {
        files.push(file);
        fileCount += 1;
      } else if (file) {
        truncated = true;
      }
    }
    if (fileCount >= maxFiles && directoryCount >= maxFiles) break;
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: "base" }));
  return { files, truncated, engine: "node" };
}

async function listDirectoriesWithNode(
  root: string,
  maxEntries: number,
  timeBudgetMs: number,
  signal: AbortSignal
): Promise<{ entries: WorkbenchIndexedFile[]; truncated: boolean }> {
  const started = Date.now();
  const stack = [root];
  const entries: WorkbenchIndexedFile[] = [];
  let visited = 0;
  let truncated = false;

  while (stack.length) {
    throwIfAborted(signal);
    if (Date.now() - started >= timeBudgetMs) {
      truncated = true;
      break;
    }
    const directory = stack.pop()!;
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      visited += 1;
      if (visited % YIELD_EVERY_ENTRIES === 0) {
        await yieldEventLoop();
        throwIfAborted(signal);
      }
      if (Date.now() - started >= timeBudgetMs) {
        truncated = true;
        break;
      }
      if (!child.isDirectory() || WORKBENCH_SKIP_DIR_NAMES.has(child.name)) continue;
      const absolute = path.join(directory, child.name);
      const entry = indexedEntry(root, path.relative(root, absolute), "directory");
      if (entry) entries.push(entry);
      if (entries.length >= maxEntries) {
        truncated = true;
        break;
      }
      stack.push(absolute);
    }
    if (truncated) break;
  }

  return { entries, truncated };
}

class WorkbenchPathSearchCollector {
  private readonly matches = new Map<string, MatchedQuickAccessPath<WorkbenchIndexedFile>>();
  private limited = false;

  constructor(
    private readonly query: string,
    private readonly maxResults: number
  ) {}

  clear(): void {
    this.matches.clear();
    this.limited = false;
  }

  add(entry: WorkbenchIndexedFile): boolean {
    const match = matchQuickAccessPath(entry, this.query);
    if (!match) return false;
    const current = this.matches.get(entry.path);
    if (!current || match.score > current.score) this.matches.set(entry.path, match);
    if (this.matches.size > this.maxResults * 8) {
      this.limited = true;
      const retained = [...this.matches.values()]
        .sort(compareQuickAccessPathMatches)
        .slice(0, this.maxResults * 4);
      this.matches.clear();
      for (const candidate of retained) this.matches.set(candidate.path, candidate);
    }
    return true;
  }

  result(engine: WorkbenchFileIndexResult["engine"], truncated: boolean): WorkbenchFileIndexResult {
    const ranked = [...this.matches.values()].sort(compareQuickAccessPathMatches);
    return {
      files: ranked.slice(0, this.maxResults).map(({ score: _score, indices: _indices, ...entry }) => entry),
      truncated: truncated || this.limited || ranked.length > this.maxResults,
      engine
    };
  }
}

function addMatchingFileAndParents(
  root: string,
  relativePath: string,
  collector: WorkbenchPathSearchCollector
): void {
  const file = indexedEntry(root, relativePath, "file");
  if (!file || !collector.add(file)) return;
  let parent = path.posix.dirname(file.relativePath.replace(/\\/g, "/"));
  while (parent && parent !== ".") {
    const directory = indexedEntry(root, parent, "directory");
    if (directory) collector.add(directory);
    const next = path.posix.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
}

function searchFilesWithRipgrep(
  root: string,
  timeBudgetMs: number,
  signal: AbortSignal,
  collector: WorkbenchPathSearchCollector
): Promise<boolean> {
  const args = ["--files", "--hidden", "--no-require-git", "--no-messages", "--color", "never"];
  for (const directory of WORKBENCH_SKIP_DIR_NAMES) {
    args.push("--glob", `!${directory}`);
    args.push("--glob", `!**/${directory}/**`);
  }
  args.push(".");

  return new Promise((resolve, reject) => {
    let carry = "";
    let settled = false;
    let truncated = false;
    const child = spawn("rg", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    activeSearchChild = child;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (activeSearchChild === child) activeSearchChild = null;
      if (error) reject(error);
      else resolve(truncated);
    };
    const addLines = (text: string, flush = false) => {
      carry += text;
      const lines = carry.split(/\r?\n/);
      carry = flush ? "" : lines.pop() || "";
      for (const line of lines) addMatchingFileAndParents(root, line, collector);
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
      if (carry) addLines("\n", true);
      finish();
    });
  });
}

async function searchDirectoriesWithNode(
  root: string,
  timeBudgetMs: number,
  signal: AbortSignal,
  collector: WorkbenchPathSearchCollector
): Promise<boolean> {
  const started = Date.now();
  const stack = [root];
  let visited = 0;

  while (stack.length) {
    throwIfAborted(signal);
    if (Date.now() - started >= timeBudgetMs) return true;
    const directory = stack.pop()!;
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      visited += 1;
      if (visited % YIELD_EVERY_ENTRIES === 0) {
        await yieldEventLoop();
        throwIfAborted(signal);
      }
      if (Date.now() - started >= timeBudgetMs) return true;
      if (!child.isDirectory() || WORKBENCH_SKIP_DIR_NAMES.has(child.name)) continue;
      const absolute = path.join(directory, child.name);
      const entry = indexedEntry(root, path.relative(root, absolute), "directory");
      if (entry) collector.add(entry);
      stack.push(absolute);
    }
  }
  return false;
}

async function searchPathsWithNode(
  root: string,
  timeBudgetMs: number,
  signal: AbortSignal,
  collector: WorkbenchPathSearchCollector
): Promise<boolean> {
  const started = Date.now();
  const stack = [root];
  let visited = 0;

  while (stack.length) {
    throwIfAborted(signal);
    if (Date.now() - started >= timeBudgetMs) return true;
    const directory = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited % YIELD_EVERY_ENTRIES === 0) {
        await yieldEventLoop();
        throwIfAborted(signal);
      }
      if (Date.now() - started >= timeBudgetMs) return true;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (WORKBENCH_SKIP_DIR_NAMES.has(entry.name)) continue;
        const indexed = indexedEntry(root, path.relative(root, absolute), "directory");
        if (indexed) collector.add(indexed);
        stack.push(absolute);
      } else if (entry.isFile()) {
        addMatchingFileAndParents(root, path.relative(root, absolute), collector);
      }
    }
  }
  return false;
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
        const file = indexedEntry(root, line, "file");
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

export function cancelActiveWorkbenchPathSearch(): void {
  activeSearchAbort?.abort();
  activeSearchAbort = null;
  if (activeSearchChild && !activeSearchChild.killed) activeSearchChild.kill("SIGTERM");
  activeSearchChild = null;
}

export function resetWorkbenchFileIndexForTests(): void {
  cancelActiveWorkbenchFileList();
  cancelActiveWorkbenchPathSearch();
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
    const started = Date.now();
    if (await detectRipgrep()) {
      try {
        const fileResult = await listWithRipgrep(root, maxFiles, timeBudgetMs, controller.signal);
        const remainingTimeMs = Math.max(100, timeBudgetMs - (Date.now() - started));
        const directoryResult = await listDirectoriesWithNode(root, maxFiles, remainingTimeMs, controller.signal);
        const byPath = new Map<string, WorkbenchIndexedFile>();
        for (const entry of [...directoryResult.entries, ...fileResult.files]) byPath.set(entry.path, entry);
        const files = [...byPath.values()]
          .sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: "base" }));
        return {
          files,
          truncated: fileResult.truncated || directoryResult.truncated,
          engine: "rg"
        };
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

export async function searchWorkbenchPaths(options: WorkbenchPathSearchOptions): Promise<WorkbenchFileIndexResult> {
  cancelActiveWorkbenchPathSearch();
  const controller = new AbortController();
  activeSearchAbort = controller;
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (options.signal?.aborted) controller.abort();

  try {
    throwIfAborted(controller.signal);
    const root = resolveRoot(options.rootPath);
    const query = normalizeQuickAccessQuery(options.query);
    const maxResults = clampInt(options.maxResults, DEFAULT_MAX_SEARCH_RESULTS, 1, 2_000);
    const timeBudgetMs = clampInt(options.timeBudgetMs, DEFAULT_SEARCH_TIME_BUDGET_MS, 100, 10_000);
    const collector = new WorkbenchPathSearchCollector(query, maxResults);
    if (!query) return collector.result("node", false);
    const started = Date.now();

    if (await detectRipgrep()) {
      try {
        let truncated = await searchFilesWithRipgrep(
          root,
          timeBudgetMs,
          controller.signal,
          collector
        );
        const remainingTimeMs = Math.max(100, timeBudgetMs - (Date.now() - started));
        truncated = await searchDirectoriesWithNode(
          root,
          remainingTimeMs,
          controller.signal,
          collector
        ) || truncated;
        return collector.result("rg", truncated);
      } catch (error) {
        if ((error as Error)?.name === "AbortError") throw error;
        collector.clear();
      }
    }

    const truncated = await searchPathsWithNode(root, timeBudgetMs, controller.signal, collector);
    return collector.result("node", truncated);
  } finally {
    options.signal?.removeEventListener("abort", onExternalAbort);
    if (activeSearchAbort === controller) activeSearchAbort = null;
  }
}
