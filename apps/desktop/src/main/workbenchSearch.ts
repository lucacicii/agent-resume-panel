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
  /** Comma / newline separated VS Code style globs limiting which files are searched. */
  filesToInclude?: string;
  /** Comma / newline separated VS Code style globs excluding files from the search. */
  filesToExclude?: string;
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

export const WORKBENCH_SKIP_DIR_NAMES = new Set([
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

/**
 * Skip dirs kept even when the user narrows the search with "files to include"
 * globs. Build/dependency output dirs are dropped in that case so patterns such
 * as `dist/**` can match; repository metadata stays out of results.
 */
const WORKBENCH_HARD_SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".yarn",
  ".pnpm-store"
]);

/** VS Code style glob matcher for the Node fallback engine (see compileGlobPattern). */
type CompiledGlob = { file: RegExp; dir: RegExp };

/** Split a "files to include/exclude" text field into trimmed glob patterns. */
export function splitGlobList(raw: string | undefined): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of String(raw || "")) {
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth = Math.max(0, depth - 1);
    // Commas and newlines separate patterns, but never inside {a,b} / [abc] groups.
    if ((char === "," || char === "\n") && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = "";
      continue;
    }
    current += char;
  }
  const trailing = current.trim();
  if (trailing) parts.push(trailing);
  return parts;
}

function globToRegexSource(pattern: string): string | null {
  let out = "";
  let index = 0;
  const length = pattern.length;
  const pushEscaped = (value: string) => {
    out += value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };
  while (index < length) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        // "**" crosses directory separators
        if (pattern[index + 2] === "/") {
          out += "(?:.*/)?";
          index += 3;
        } else {
          out += ".*";
          index += 2;
        }
      } else {
        out += "[^/]*";
        index += 1;
      }
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      index += 1;
      continue;
    }
    if (char === "{") {
      const closing = pattern.indexOf("}", index + 1);
      if (closing > index + 1) {
        const body = pattern.slice(index + 1, closing);
        if (!body.includes("{") && !body.includes("}")) {
          const alternatives = body.split(",");
          if (alternatives.length > 1) {
            const parts: string[] = [];
            let valid = true;
            for (const alternative of alternatives) {
              const source = globToRegexSource(alternative);
              if (source === null) {
                valid = false;
                break;
              }
              parts.push(source);
            }
            if (valid) {
              out += `(?:${parts.join("|")})`;
              index = closing + 1;
              continue;
            }
          }
        }
      }
      pushEscaped(char);
      index += 1;
      continue;
    }
    if (char === "[") {
      const closing = pattern.indexOf("]", index + 1);
      if (closing > index + 1) {
        let content = pattern.slice(index + 1, closing);
        if (content.startsWith("!")) content = `^${content.slice(1)}`;
        // Keep the class as-is; invalid classes fall back to a literal via try/catch below.
        out += `[${content}]`;
        index = closing + 1;
        continue;
      }
      pushEscaped(char);
      index += 1;
      continue;
    }
    pushEscaped(char);
    index += 1;
  }
  return out;
}

/**
 * Compile one user glob into anchored matchers used against POSIX relative paths.
 * Patterns without a slash match a basename at any depth (gitignore style); the
 * `dir` regex additionally matches the directory that a trailing slash-star-star
 * glob covers, so excluding `dist` also excludes every file under it.
 */
export function compileGlobPattern(rawPattern: string): CompiledGlob | null {
  const pattern = String(rawPattern || "").trim();
  if (!pattern) return null;
  const anchored = pattern.includes("/");
  const dirPattern = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
  const build = (source: string, prefix: string): RegExp | null => {
    try {
      return new RegExp(`${prefix}${source}$`);
    } catch {
      return null;
    }
  };
  const fileSource = globToRegexSource(pattern);
  if (fileSource === null) return null;
  const dirSource = globToRegexSource(dirPattern);
  if (dirSource === null) return null;
  const prefix = anchored ? "^" : "^(?:.*/)?";
  const file = build(fileSource, prefix);
  const dir = build(dirSource, prefix);
  if (file === null || dir === null) return null;
  return { file, dir };
}

function matchesGlobList(
  relativePath: string,
  globs: CompiledGlob[]
): boolean {
  if (!globs.length) return false;
  // A glob matches when it matches the path itself or a parent directory
  // (e.g. "dist" or "**/dist/**" covers every file under dist).
  let current = relativePath;
  while (true) {
    for (const glob of globs) {
      if (glob.dir.test(current)) return true;
    }
    const slash = current.lastIndexOf("/");
    if (slash <= 0) break;
    current = current.slice(0, slash);
  }
  for (const glob of globs) {
    if (glob.file.test(relativePath)) return true;
  }
  return false;
}

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

export function buildSearchRegex(
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

/**
 * Visit every match of `regex` in `text`, scanning line by line (a match can
 * never cross a line break, mirroring ripgrep without `-U`). The callback
 * receives the 0-based line index, the match span inside that line, the line
 * text and the exec groups (`groups[0]` is the full match) and may return true
 * to stop early. Zero-length matches advance by one code unit so the loop
 * always terminates.
 */
export function scanLineMatches(
  text: string,
  regex: RegExp,
  visit: (
    lineIndex: number,
    start: number,
    end: number,
    lineText: string,
    groups: string[]
  ) => boolean | void
): void {
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex];
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(lineText)) !== null) {
      const start = match.index;
      const length = match[0].length;
      const end = start + length;
      const groups: string[] = [];
      for (let i = 0; i < match.length; i += 1) {
        groups.push(match[i] ?? "");
      }
      if (visit(lineIndex, start, end, lineText, groups)) return;
      if (length === 0) {
        regex.lastIndex = start + 1;
      }
    }
  }
}

function collectMatchesInText(
  text: string,
  absolutePath: string,
  root: string,
  regex: RegExp,
  maxResults: number,
  matches: WorkbenchSearchMatch[]
): boolean {
  const relativePath = toPosixRelative(root, absolutePath);
  let hitCap = false;
  scanLineMatches(text, regex, (lineIndex, start, end, lineText) => {
    matches.push({
      path: absolutePath,
      relativePath,
      line: lineIndex + 1,
      column: start + 1,
      endColumn: end + 1,
      preview: truncatePreview(lineText)
    });
    if (matches.length >= maxResults) {
      hitCap = true;
      return true;
    }
    return false;
  });
  return hitCap;
}

async function searchWithNodeWalk(
  root: string,
  options: {
    query: string;
    matchCase: boolean;
    wholeWord: boolean;
    useRegex: boolean;
    includeGlobs: CompiledGlob[];
    excludeGlobs: CompiledGlob[];
    skipDirNames: Set<string>;
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
  const hasInclude = options.includeGlobs.length > 0;

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
        if (options.skipDirNames.has(name)) continue;
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSkippedFileName(name)) continue;

      const relativePath = toPosixRelative(root, fullPath);
      if (hasInclude && !matchesGlobList(relativePath, options.includeGlobs)) continue;
      if (matchesGlobList(relativePath, options.excludeGlobs)) continue;

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
    includeGlobs: string[];
    excludeGlobs: string[];
    skipDirNames: Set<string>;
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
  for (const dir of options.skipDirNames) {
    args.push("--glob", `!${dir}`);
    args.push("--glob", `!**/${dir}/**`);
  }
  // User "files to include" globs constrain the search; ripgrep unions them.
  for (const pattern of options.includeGlobs) {
    args.push("--glob", pattern);
  }
  // User "files to exclude" globs win over includes (gitignore negation style).
  for (const pattern of options.excludeGlobs) {
    args.push("--glob", `!${pattern}`);
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
    const includeRaw = splitGlobList(rawOptions.filesToInclude);
    const excludeRaw = splitGlobList(rawOptions.filesToExclude);
    // Build output / dependency dirs are only searched when the user narrows the
    // search with explicit include globs (e.g. `dist/**`); VCS metadata and
    // package stores always stay out.
    const skipDirNames = includeRaw.length
      ? WORKBENCH_HARD_SKIP_DIR_NAMES
      : WORKBENCH_SKIP_DIR_NAMES;
    const includeGlobs: CompiledGlob[] = [];
    const excludeGlobs: CompiledGlob[] = [];
    for (const pattern of includeRaw) {
      const compiled = compileGlobPattern(pattern);
      if (compiled) includeGlobs.push(compiled);
    }
    for (const pattern of excludeRaw) {
      const compiled = compileGlobPattern(pattern);
      if (compiled) excludeGlobs.push(compiled);
    }
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
          includeGlobs: includeRaw,
          excludeGlobs: excludeRaw,
          skipDirNames,
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
      includeGlobs,
      excludeGlobs,
      skipDirNames,
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
