import { execFile, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { expandHome } from "@agent-resume/core";

export interface WorkbenchSearchMatch {
  path: string;
  relativePath: string;
  line: number;
  column: number;
  endColumn: number;
  preview: string;
}

export interface WorkbenchSearchOptions {
  rootPath: string;
  query: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  useRegex?: boolean;
  maxResults?: number;
  maxFileSizeBytes?: number;
  maxFilesScanned?: number;
  timeBudgetMs?: number;
  signal?: AbortSignal;
}

export interface WorkbenchSearchResult {
  matches: WorkbenchSearchMatch[];
  truncated: boolean;
  filesSearched: number;
  engine: "rg" | "node";
}

const DEFAULT_MAX_RESULTS = 2000;
const DEFAULT_MAX_FILE_SIZE = 512 * 1024;
const DEFAULT_MAX_FILES_SCANNED = 20_000;
const DEFAULT_TIME_BUDGET_MS = 10_000;
const DEFAULT_PREVIEW_LEN = 200;
const YIELD_EVERY_FILES = 32;
const RG_MAX_BUFFER = 12 * 1024 * 1024;

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "out",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  ".turbo",
  ".parcel-cache",
  "release",
  ".yarn",
  ".pnpm-store",
  "Pods",
  "DerivedData"
]);

const SKIP_FILE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".icns",
  ".bmp",
  ".svg",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".wav",
  ".zip",
  ".gz",
  ".tgz",
  ".bz2",
  ".7z",
  ".rar",
  ".tar",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".bin",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".class",
  ".jar",
  ".wasm",
  ".map",
  ".lock",
  ".pack",
  ".idx",
  ".dmg",
  ".pkg",
  ".app"
]);

let rgAvailableCache: boolean | null = null;
let activeChild: ChildProcess | null = null;
let activeAbort: AbortController | null = null;

function resolveCwd(raw?: string): string {
  const cwd = expandHome(raw?.trim() || process.cwd());
  const stat = fs.statSync(cwd);
  if (!stat.isDirectory()) {
    throw new Error(`工作目录不是文件夹: ${cwd}`);
  }
  return path.resolve(cwd);
}

function resolvePathWithinRoot(raw: string, rootPath: string): string {
  const root = path.resolve(expandHome(rootPath.trim()));
  const target = path.resolve(expandHome(raw.trim()));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("路径超出允许范围");
  }
  return target;
}

function toPosixRelative(root: string, absolute: string): string {
  const rel = path.relative(root, absolute);
  return rel.split(path.sep).join("/");
}

function truncatePreview(value: string, max = DEFAULT_PREVIEW_LEN): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Search cancelled");
    error.name = "AbortError";
    throw error;
  }
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function detectRipgrep(): Promise<boolean> {
  if (rgAvailableCache !== null) return rgAvailableCache;
  rgAvailableCache = await new Promise<boolean>((resolve) => {
    execFile("rg", ["--version"], { timeout: 2000 }, (error) => {
      resolve(!error);
    });
  });
  return rgAvailableCache;
}

/** Test helper: reset rg cache and kill active search. */
export function resetWorkbenchSearchStateForTests(): void {
  rgAvailableCache = null;
  cancelActiveWorkbenchSearch();
}

export function cancelActiveWorkbenchSearch(): void {
  if (activeChild && !activeChild.killed) {
    try {
      activeChild.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  activeChild = null;
  if (activeAbort && !activeAbort.signal.aborted) {
    activeAbort.abort();
  }
  activeAbort = null;
}

function buildSearchRegex(
  query: string,
  options: { matchCase: boolean; wholeWord: boolean; useRegex: boolean }
): RegExp {
  let source = options.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (options.wholeWord) {
    source = `\\b(?:${source})\\b`;
  }
  const flags = options.matchCase ? "g" : "gi";
  try {
    return new RegExp(source, flags);
  } catch {
    throw new Error("无效的正则表达式");
  }
}

function isSkippedFileName(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  if (SKIP_FILE_EXTENSIONS.has(ext)) return true;
  if (name.endsWith(".min.js") || name.endsWith(".min.css")) return true;
  return false;
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  return sample.includes(0);
}

function collectMatchesInText(
  text: string,
  absolutePath: string,
  root: string,
  regex: RegExp,
  maxResults: number,
  matches: WorkbenchSearchMatch[]
): boolean {
  const lines = text.split(/\r?\n/);
  const relativePath = toPosixRelative(root, absolutePath);
  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(lineText)) !== null) {
      const start = match.index;
      const length = match[0].length || 1;
      matches.push({
        path: absolutePath,
        relativePath,
        line: i + 1,
        column: start + 1,
        endColumn: start + length + 1,
        preview: truncatePreview(lineText)
      });
      if (matches.length >= maxResults) return true;
      if (match[0].length === 0) {
        regex.lastIndex = start + 1;
      }
    }
  }
  return false;
}

async function searchWithNodeWalk(
  root: string,
  options: {
    query: string;
    matchCase: boolean;
    wholeWord: boolean;
    useRegex: boolean;
    maxResults: number;
    maxFileSizeBytes: number;
    maxFilesScanned: number;
    timeBudgetMs: number;
    signal?: AbortSignal;
  }
): Promise<WorkbenchSearchResult> {
  const regex = buildSearchRegex(options.query, options);
  const matches: WorkbenchSearchMatch[] = [];
  let filesSearched = 0;
  let truncated = false;
  const started = Date.now();
  const stack: string[] = [root];

  while (stack.length) {
    throwIfAborted(options.signal);
    if (Date.now() - started > options.timeBudgetMs) {
      truncated = true;
      break;
    }
    if (filesSearched >= options.maxFilesScanned) {
      truncated = true;
      break;
    }
    if (matches.length >= options.maxResults) {
      truncated = true;
      break;
    }

    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    for (const entry of entries) {
      throwIfAborted(options.signal);
      if (Date.now() - started > options.timeBudgetMs) {
        truncated = true;
        break;
      }

      const name = entry.name;
      if (name === "." || name === "..") continue;
      const fullPath = path.join(dir, name);

      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(name)) continue;
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSkippedFileName(name)) continue;

      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size <= 0 || stat.size > options.maxFileSizeBytes) continue;

      let buffer: Buffer;
      try {
        buffer = fs.readFileSync(fullPath);
      } catch {
        continue;
      }
      filesSearched += 1;
      if (filesSearched % YIELD_EVERY_FILES === 0) {
        await yieldEventLoop();
        throwIfAborted(options.signal);
      }
      if (looksBinary(buffer)) continue;

      const text = buffer.toString("utf8");
      const hitCap = collectMatchesInText(text, fullPath, root, regex, options.maxResults, matches);
      if (hitCap) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }

  return { matches, truncated, filesSearched, engine: "node" };
}

interface RgJsonMatch {
  type?: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
    submatches?: Array<{
      start?: number;
      end?: number;
      match?: { text?: string };
    }>;
  };
}

async function searchWithRipgrep(
  root: string,
  options: {
    query: string;
    matchCase: boolean;
    wholeWord: boolean;
    useRegex: boolean;
    maxResults: number;
    maxFileSizeBytes: number;
    timeBudgetMs: number;
    signal?: AbortSignal;
  }
): Promise<WorkbenchSearchResult> {
  const args = [
    "--json",
    "--hidden",
    "--no-messages",
    "--color",
    "never",
    `--max-filesize=${Math.max(1, Math.floor(options.maxFileSizeBytes / 1024))}K`
  ];

  // Always exclude heavy build/deps dirs even if not in .gitignore
  for (const dir of SKIP_DIR_NAMES) {
    args.push("--glob", `!${dir}`);
    args.push("--glob", `!**/${dir}/**`);
  }

  if (!options.matchCase) args.push("-i");
  if (options.wholeWord) args.push("-w");
  if (!options.useRegex) args.push("-F");
  args.push("--", options.query, ".");

  throwIfAborted(options.signal);

  return new Promise<WorkbenchSearchResult>((resolve, reject) => {
    const child = execFile(
      "rg",
      args,
      {
        cwd: root,
        maxBuffer: RG_MAX_BUFFER,
        timeout: options.timeBudgetMs,
        encoding: "utf8"
      },
      (error, stdout) => {
        if (activeChild === child) activeChild = null;

        if (options.signal?.aborted) {
          const abortError = new Error("Search cancelled");
          abortError.name = "AbortError";
          reject(abortError);
          return;
        }

        const matches: WorkbenchSearchMatch[] = [];
        let truncated = false;
        let filesSearched = 0;
        const filesSeen = new Set<string>();

        // rg exits 1 when no matches — still parse stdout
        const execError = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: string; status?: number | null }) | null;
        const exitStatus = execError?.status ?? execError?.code;
        const noMatches = exitStatus === 1 || exitStatus === "1";
        const killedByTimeout =
          Boolean(error) &&
          (Boolean(execError?.killed) ||
            execError?.signal === "SIGTERM" ||
            execError?.code === "ETIMEDOUT");

        if (error && !stdout && !noMatches && !killedByTimeout) {
          // Missing rg or hard failure — let caller fall back
          reject(error);
          return;
        }

        const lines = String(stdout || "").split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed: RgJsonMatch;
          try {
            parsed = JSON.parse(line) as RgJsonMatch;
          } catch {
            continue;
          }
          if (parsed.type === "summary" && parsed.data) {
            // ignore
            continue;
          }
          if (parsed.type !== "match" || !parsed.data) continue;
          const rel = parsed.data.path?.text;
          const lineNumber = parsed.data.line_number;
          const previewRaw = parsed.data.lines?.text ?? "";
          if (!rel || !lineNumber) continue;

          const absolutePath = path.resolve(root, rel);
          try {
            resolvePathWithinRoot(absolutePath, root);
          } catch {
            continue;
          }

          if (!filesSeen.has(absolutePath)) {
            filesSeen.add(absolutePath);
            filesSearched += 1;
          }

          const submatches = parsed.data.submatches?.length
            ? parsed.data.submatches
            : [{ start: 0, end: Math.min(1, previewRaw.length) }];

          for (const sub of submatches) {
            const start = Math.max(0, sub.start ?? 0);
            const end = Math.max(start + 1, sub.end ?? start + 1);
            matches.push({
              path: absolutePath,
              relativePath: toPosixRelative(root, absolutePath),
              line: lineNumber,
              column: start + 1,
              endColumn: end + 1,
              preview: truncatePreview(previewRaw.replace(/\r?\n$/, ""))
            });
            if (matches.length >= options.maxResults) {
              truncated = true;
              break;
            }
          }
          if (truncated) break;
        }

        if (killedByTimeout) truncated = true;

        resolve({
          matches: matches.slice(0, options.maxResults),
          truncated: truncated || matches.length >= options.maxResults,
          filesSearched,
          engine: "rg"
        });
      }
    );

    activeChild = child;
    const onAbort = () => {
      if (!child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("exit", () => {
      options.signal?.removeEventListener("abort", onAbort);
    });
  });
}

/**
 * Search text under a project root. Prefer ripgrep when available; fall back to a
 * capped, yielding Node walk. Cancels any previous in-flight search in this process.
 */
export async function searchWorkbenchText(rawOptions: WorkbenchSearchOptions): Promise<WorkbenchSearchResult> {
  const query = typeof rawOptions.query === "string" ? rawOptions.query : "";
  if (!query) {
    return { matches: [], truncated: false, filesSearched: 0, engine: "node" };
  }

  cancelActiveWorkbenchSearch();
  const controller = new AbortController();
  activeAbort = controller;
  const external = rawOptions.signal;
  const onExternalAbort = () => controller.abort();
  if (external?.aborted) {
    controller.abort();
  } else {
    external?.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    throwIfAborted(controller.signal);
    const root = resolveCwd(rawOptions.rootPath);
    const matchCase = Boolean(rawOptions.matchCase);
    const wholeWord = Boolean(rawOptions.wholeWord);
    const useRegex = Boolean(rawOptions.useRegex);
    const maxResults = clampInt(rawOptions.maxResults, DEFAULT_MAX_RESULTS, 1, 10_000);
    const maxFileSizeBytes = clampInt(
      rawOptions.maxFileSizeBytes,
      DEFAULT_MAX_FILE_SIZE,
      1024,
      5 * 1024 * 1024
    );
    const maxFilesScanned = clampInt(
      rawOptions.maxFilesScanned,
      DEFAULT_MAX_FILES_SCANNED,
      100,
      100_000
    );
    const timeBudgetMs = clampInt(rawOptions.timeBudgetMs, DEFAULT_TIME_BUDGET_MS, 500, 60_000);

    if (await detectRipgrep()) {
      try {
        return await searchWithRipgrep(root, {
          query,
          matchCase,
          wholeWord,
          useRegex,
          maxResults,
          maxFileSizeBytes,
          timeBudgetMs,
          signal: controller.signal
        });
      } catch (error) {
        if ((error as Error)?.name === "AbortError") throw error;
        // Fall through to node walk on rg failure (e.g. not really available)
      }
    }

    return await searchWithNodeWalk(root, {
      query,
      matchCase,
      wholeWord,
      useRegex,
      maxResults,
      maxFileSizeBytes,
      maxFilesScanned,
      timeBudgetMs,
      signal: controller.signal
    });
  } finally {
    external?.removeEventListener("abort", onExternalAbort);
    if (activeAbort === controller) activeAbort = null;
  }
}
