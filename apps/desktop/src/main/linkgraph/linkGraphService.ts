import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  chatCompletion,
  expandHome,
  llmConfigFromSettings,
  loadSettings,
  resolveEffectiveOutputLanguage
} from "@agent-resume/core";
import {
  searchWorkbenchText,
  type WorkbenchSearchMatch
} from "../workbenchSearch";
import type {
  LinkGraphAnalysis,
  LinkGraphAnalyzeArgs,
  LinkGraphAnalyzeResult,
  LinkGraphConfidence,
  LinkGraphFrontierItem,
  LinkGraphHit,
  LinkGraphHop,
  LinkGraphHopRole,
  LinkGraphProgressEvent,
  LinkGraphStopReason
} from "../../shared/linkGraphTypes";

const DEFAULT_MAX_HITS = 80;
const DEFAULT_MAX_FILES = 30;
const DEFAULT_MAX_SYMBOLS = 40;
const DEFAULT_TIME_BUDGET_MS = 12_000;
const DEFAULT_SAFETY_MAX_DEPTH = 16;
/** Extra allowance when user clicks Continue (added on top of current counts). */
const CONTINUE_HIT_BUDGET = 50;
const CONTINUE_FILE_BUDGET = 20;
const CONTINUE_SYMBOL_BUDGET = 25;
const ABSOLUTE_MAX_HITS = 400;
const ABSOLUTE_MAX_FILES = 150;
const ABSOLUTE_MAX_SYMBOLS = 200;
/** Soft cap so frontier cannot grow without bound across many Continue rounds. */
const ABSOLUTE_MAX_FRONTIER = 500;
const WINDOW_RADIUS = 22;
const MAX_PACK_CHARS = 90_000;
const MAX_PACK_BLOCKS = 40;
const MAX_SELECTION_LEN = 80;

const STOPWORDS = new Set([
  "id",
  "ids",
  "get",
  "set",
  "put",
  "post",
  "data",
  "value",
  "values",
  "item",
  "items",
  "key",
  "keys",
  "type",
  "types",
  "name",
  "names",
  "index",
  "count",
  "size",
  "length",
  "list",
  "map",
  "result",
  "results",
  "error",
  "err",
  "ok",
  "true",
  "false",
  "null",
  "undefined",
  "this",
  "self",
  "that",
  "ret",
  "tmp",
  "temp",
  "obj",
  "fn",
  "cb",
  "i",
  "j",
  "k",
  "n",
  "x",
  "y",
  "z"
]);

type ProgressEmitter = (event: Omit<LinkGraphProgressEvent, "requestId"> & { requestId?: string }) => void;

type SessionState = {
  requestId: string;
  projectPath: string;
  seed: LinkGraphAnalyzeResult["seed"];
  hits: LinkGraphHit[];
  frontier: LinkGraphFrontierItem[];
  visitedHitKeys: Set<string>;
  expandedSymbols: Set<string>;
  reachedDepth: number;
  engine: LinkGraphAnalyzeResult["engine"];
};

const sessions = new Map<string, SessionState>();
let activeAbort: AbortController | null = null;
let activeRequestId: string | null = null;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function resolveRoot(raw: string): string {
  const root = path.resolve(expandHome(raw.trim()));
  return root;
}

function resolveWithinRoot(raw: string, rootPath: string): string {
  const root = path.resolve(expandHome(rootPath.trim()));
  const target = path.resolve(expandHome(raw.trim()));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("路径超出允许范围");
  }
  return target;
}

function toPosixRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function hitKey(relativePath: string, line: number, symbol: string): string {
  return `${relativePath}:${line}:${symbol}`;
}

function newRequestId(): string {
  return `lg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalize user selection into a search symbol. Exported for tests. */
export function normalizeLinkGraphSymbol(selection: string): { symbol: string; wholeWord: boolean } | null {
  const trimmed = selection.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > MAX_SELECTION_LEN) return null;

  // Prefer last segment of member access: foo.bar.baz → baz
  const member = trimmed.match(/^(?:[\w$]+\.)+([\w$]+)$/);
  if (member?.[1]) {
    return { symbol: member[1], wholeWord: true };
  }

  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    return { symbol: trimmed, wholeWord: true };
  }

  // Multi-token / phrase: use as literal phrase (no deep expand)
  if (trimmed.length >= 2 && !trimmed.includes("\n")) {
    return { symbol: trimmed, wholeWord: false };
  }

  return null;
}

export function isStopwordSymbol(symbol: string): boolean {
  if (symbol.length <= 1) return true;
  if (symbol.length <= 2 && !/[A-Z]/.test(symbol)) return true;
  return STOPWORDS.has(symbol.toLowerCase());
}

/** Score how specific an identifier looks (higher = better expand target). */
export function symbolSpecificity(symbol: string): number {
  if (isStopwordSymbol(symbol)) return 0;
  let score = Math.min(40, symbol.length * 3);
  if (/[A-Z]/.test(symbol) && /[a-z]/.test(symbol)) score += 12;
  if (symbol.includes("_") && symbol.length > 4) score += 6;
  if (/^\d/.test(symbol)) score -= 20;
  return Math.max(0, score);
}

function scoreHit(args: {
  relativePath: string;
  seedRelativePath: string;
  depth: number;
  symbol: string;
  preview: string;
}): number {
  let score = symbolSpecificity(args.symbol);
  score += Math.max(0, 24 - args.depth * 2);

  const seedDir = path.posix.dirname(args.seedRelativePath);
  const hitDir = path.posix.dirname(args.relativePath);
  if (args.relativePath === args.seedRelativePath) score += 40;
  else if (hitDir === seedDir) score += 22;
  else if (hitDir.startsWith(`${seedDir}/`) || seedDir.startsWith(`${hitDir}/`)) score += 12;

  if (/\b(import|export|from|require)\b/.test(args.preview)) score += 8;
  if (/\b(function|class|const|let|var|def|fn|type|interface)\b/.test(args.preview)) score += 6;
  return score;
}

function extractCandidateSymbols(preview: string, currentSymbol: string): string[] {
  const tokens = preview.match(/[A-Za-z_$][\w$]{2,}/g) || [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token === currentSymbol) continue;
    if (isStopwordSymbol(token)) continue;
    if (symbolSpecificity(token) < 10) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length >= 4) break;
  }
  return out;
}

async function searchSymbolInFile(
  root: string,
  absolutePath: string,
  symbol: string,
  wholeWord: boolean
): Promise<WorkbenchSearchMatch[]> {
  let text: string;
  try {
    text = await fs.readFile(absolutePath, "utf8");
  } catch {
    return [];
  }
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = wholeWord ? `\\b(?:${escaped})\\b` : escaped;
  let regex: RegExp;
  try {
    regex = new RegExp(source, "g");
  } catch {
    return [];
  }

  const relativePath = toPosixRelative(root, absolutePath);
  const matches: WorkbenchSearchMatch[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(lineText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      matches.push({
        path: absolutePath,
        relativePath,
        line: i + 1,
        column: start + 1,
        endColumn: end + 1,
        preview: lineText.trim().slice(0, 200)
      });
      if (matches.length >= 40) return matches;
      if (match[0].length === 0) regex.lastIndex += 1;
    }
  }
  return matches;
}

async function searchSymbolInProject(
  root: string,
  symbol: string,
  wholeWord: boolean,
  maxResults: number,
  signal?: AbortSignal
): Promise<{ matches: WorkbenchSearchMatch[]; engine: "rg" | "node"; truncated: boolean }> {
  const result = await searchWorkbenchText({
    rootPath: root,
    query: symbol,
    matchCase: true,
    wholeWord,
    useRegex: false,
    maxResults,
    timeBudgetMs: 8_000,
    signal
  });
  return {
    matches: result.matches,
    engine: result.engine,
    truncated: result.truncated
  };
}

type QueueItem = {
  symbol: string;
  depth: number;
  score: number;
  fromRelativePath?: string;
  wholeWord: boolean;
};

function pushFrontier(
  frontier: LinkGraphFrontierItem[],
  item: LinkGraphFrontierItem,
  seen: Set<string>
): void {
  const key = `${item.symbol}@${item.depth}`;
  if (seen.has(key)) return;
  seen.add(key);
  frontier.push(item);
}

async function expandGraph(args: {
  root: string;
  seedRelativePath: string;
  seedAbsolutePath: string;
  seedSymbol: string;
  wholeWord: boolean;
  maxHits: number;
  maxFiles: number;
  maxSymbols: number;
  timeBudgetMs: number;
  safetyMaxDepth: number;
  signal: AbortSignal;
  existing?: SessionState;
  onProgress: ProgressEmitter;
  requestId: string;
}): Promise<{
  hits: LinkGraphHit[];
  frontier: LinkGraphFrontierItem[];
  reachedDepth: number;
  stopReason: LinkGraphStopReason;
  engine: LinkGraphAnalyzeResult["engine"];
  visitedHitKeys: Set<string>;
  expandedSymbols: Set<string>;
}> {
  const started = Date.now();
  const hits: LinkGraphHit[] = args.existing ? [...args.existing.hits] : [];
  const visitedHitKeys = args.existing ? new Set(args.existing.visitedHitKeys) : new Set<string>();
  const expandedSymbols = args.existing ? new Set(args.existing.expandedSymbols) : new Set<string>();
  let reachedDepth = args.existing?.reachedDepth ?? 0;
  let engine: LinkGraphAnalyzeResult["engine"] = args.existing?.engine ?? "none";
  let stopReason: LinkGraphStopReason = "complete";

  const queue: QueueItem[] = [];
  const frontierSeen = new Set<string>();

  if (args.existing?.frontier.length) {
    for (const item of args.existing.frontier) {
      queue.push({
        symbol: item.symbol,
        depth: item.depth,
        score: item.score,
        fromRelativePath: item.fromRelativePath,
        wholeWord: true
      });
    }
  } else {
    queue.push({
      symbol: args.seedSymbol,
      depth: 0,
      score: 1000,
      fromRelativePath: args.seedRelativePath,
      wholeWord: args.wholeWord
    });
  }

  const takeBest = (): QueueItem | undefined => {
    if (!queue.length) return undefined;
    let bestIndex = 0;
    for (let i = 1; i < queue.length; i += 1) {
      if (queue[i].score > queue[bestIndex].score) bestIndex = i;
    }
    return queue.splice(bestIndex, 1)[0];
  };

  const files = new Set(hits.map((h) => h.relativePath));
  // Symbols already expanded this session — allow frontier items that were only queued.
  // On continue, do NOT treat "at previous cap" as stop until the new raised caps are hit.

  while (queue.length) {
    if (args.signal.aborted) {
      stopReason = "cancelled";
      break;
    }
    if (Date.now() - started >= args.timeBudgetMs) {
      stopReason = "time_budget";
      break;
    }
    if (hits.length >= args.maxHits) {
      stopReason = "max_hits";
      break;
    }
    if (files.size >= args.maxFiles) {
      stopReason = "max_files";
      break;
    }
    // Only stop on symbol cap when we still have work AND we've used the raised budget.
    // Count symbols we will expand this run via expandedSymbols growth from baseline.
    if (expandedSymbols.size >= args.maxSymbols) {
      stopReason = "max_symbols";
      break;
    }

    const item = takeBest();
    if (!item) break;
    if (item.depth > args.safetyMaxDepth) {
      // Keep looking at other queue items; do not hard-stop the whole expansion.
      continue;
    }
    if (item.depth > 0 && isStopwordSymbol(item.symbol)) continue;
    if (item.depth > 0 && !item.wholeWord) continue;

    const expandKey = `${item.symbol.toLowerCase()}@${item.depth > 0 ? "g" : "s"}`;
    // Already fully searched this symbol in the project — skip without consuming budget.
    if (expandedSymbols.has(expandKey) && item.depth > 0) continue;
    expandedSymbols.add(expandKey);

    args.onProgress({
      requestId: args.requestId,
      phase: "searching",
      message: `Searching ${item.symbol} (depth ${item.depth})`,
      hitCount: hits.length,
      reachedDepth
    });

    let matches: WorkbenchSearchMatch[] = [];
    if (item.depth === 0) {
      matches = await searchSymbolInFile(args.root, args.seedAbsolutePath, item.symbol, item.wholeWord);
      if (!matches.length) {
        const project = await searchSymbolInProject(
          args.root,
          item.symbol,
          item.wholeWord,
          Math.min(40, args.maxHits - hits.length),
          args.signal
        );
        matches = project.matches;
        engine = engine === "none" ? project.engine : engine === project.engine ? project.engine : "mixed";
      } else {
        engine = engine === "none" ? "node" : engine;
      }
    } else {
      const project = await searchSymbolInProject(
        args.root,
        item.symbol,
        item.wholeWord,
        Math.min(50, args.maxHits - hits.length + 10),
        args.signal
      );
      matches = project.matches;
      engine = engine === "none" ? project.engine : engine === project.engine ? project.engine : "mixed";
    }

    for (const match of matches) {
      if (hits.length >= args.maxHits) {
        stopReason = "max_hits";
        break;
      }
      const key = hitKey(match.relativePath, match.line, item.symbol);
      if (visitedHitKeys.has(key)) continue;
      visitedHitKeys.add(key);
      files.add(match.relativePath);

      const score = scoreHit({
        relativePath: match.relativePath,
        seedRelativePath: args.seedRelativePath,
        depth: item.depth,
        symbol: item.symbol,
        preview: match.preview
      });

      const hit: LinkGraphHit = {
        path: match.path,
        relativePath: match.relativePath,
        line: match.line,
        column: match.column,
        endColumn: match.endColumn,
        preview: match.preview,
        depth: item.depth,
        symbol: item.symbol,
        reason: item.depth === 0 ? "seed" : item.fromRelativePath ? `via:${item.fromRelativePath}` : "expand",
        score
      };
      hits.push(hit);
      reachedDepth = Math.max(reachedDepth, item.depth);

      if (item.depth >= args.safetyMaxDepth) continue;
      if (!item.wholeWord) continue;

      const children = extractCandidateSymbols(match.preview, item.symbol);
      for (const child of children) {
        const childScore =
          scoreHit({
            relativePath: match.relativePath,
            seedRelativePath: args.seedRelativePath,
            depth: item.depth + 1,
            symbol: child,
            preview: match.preview
          }) - 4;
        if (childScore < 8) continue;
        const expandChildKey = `${child.toLowerCase()}@g`;
        if (expandedSymbols.has(expandChildKey)) continue;
        queue.push({
          symbol: child,
          depth: item.depth + 1,
          score: childScore,
          fromRelativePath: match.relativePath,
          wholeWord: true
        });
      }

      // Always queue the same symbol one depth deeper into project (reference chase)
      if (item.depth === 0 && item.wholeWord) {
        queue.push({
          symbol: item.symbol,
          depth: 1,
          score: symbolSpecificity(item.symbol) + 30,
          fromRelativePath: match.relativePath,
          wholeWord: true
        });
      }
    }

    if (stopReason === "max_hits") break;
  }

  // Remaining queue becomes frontier for Continue
  const frontier: LinkGraphFrontierItem[] = [];
  for (const left of queue) {
    if (left.depth > 0 && isStopwordSymbol(left.symbol)) continue;
    pushFrontier(
      frontier,
      {
        symbol: left.symbol,
        depth: left.depth,
        fromRelativePath: left.fromRelativePath,
        score: left.score
      },
      frontierSeen
    );
  }
  frontier.sort((a, b) => b.score - a.score);

  if (stopReason === "complete" && frontier.length === 0 && hits.length === 0) {
    stopReason = "empty_seed";
  }

  // Queue drained under a budget stop → treat as complete (nothing left to Continue).
  const drained = frontier.length === 0;
  if (drained && stopReason !== "cancelled" && stopReason !== "empty_seed") {
    stopReason = "complete";
  } else if (!drained && stopReason === "complete") {
    // Should not happen often: leftover queue without a budget reason.
    stopReason = "max_symbols";
  }

  // Keep full frontier for Continue (do not slice to 40 — that made UI always show "pending 40"
  // and dropped candidates permanently from the session).
  const fullFrontier = drained ? [] : frontier.slice(0, ABSOLUTE_MAX_FRONTIER);

  return {
    hits: hits.sort((a, b) => b.score - a.score || a.depth - b.depth || a.relativePath.localeCompare(b.relativePath)),
    frontier: fullFrontier,
    reachedDepth,
    stopReason,
    engine,
    visitedHitKeys,
    expandedSymbols
  };
}

function asConfidence(value: unknown): LinkGraphConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function asRole(value: unknown): LinkGraphHopRole {
  if (
    value === "definition" ||
    value === "write" ||
    value === "read" ||
    value === "call" ||
    value === "transform" ||
    value === "other"
  ) {
    return value;
  }
  return "other";
}

function asPositiveInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return 0;
}

function normalizeRelativeFile(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Extract plausible JSON object strings from messy model output. */
export function collectJsonObjectCandidates(raw: string): string[] {
  const out: string[] = [];
  let text = String(raw || "").trim();
  if (!text) return out;

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    text = fence[1].trim();
    out.push(text);
  }
  out.push(text);

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    const slice = extractBalancedJson(text, i);
    if (slice) out.push(slice);
  }
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

function extractBalancedJson(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Truncated object: close open braces best-effort for partial recovery
  if (depth > 0) {
    let partial = text.slice(start);
    // drop trailing incomplete key/value
    partial = partial.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");
    partial = partial.replace(/,\s*$/, "");
    return `${partial}${"}".repeat(depth)}`;
  }
  return null;
}

export function repairCommonJsonIssues(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    // bare newlines inside strings are rare; strip BOM
    .replace(/^\uFEFF/, "");
}

function mapAnalysisObject(
  parsed: Record<string, unknown>,
  hits: LinkGraphHit[],
  incomplete: boolean
): LinkGraphAnalysis {
  const hitKeys = new Set(hits.map((h) => `${h.relativePath}:${h.line}`));
  const relativeFiles = new Set(hits.map((h) => h.relativePath));
  const hopsRaw = Array.isArray(parsed.hops) ? parsed.hops : [];
  const hops: LinkGraphHop[] = [];

  for (const [index, hop] of hopsRaw.entries()) {
    if (!hop || typeof hop !== "object") continue;
    const record = hop as Record<string, unknown>;
    const fileRaw = typeof record.file === "string" ? record.file : "";
    const file = normalizeRelativeFile(fileRaw);
    const line = asPositiveInt(record.line);
    if (!file || line < 1) continue;

    const exact = hitKeys.has(`${file}:${line}`);
    const fileHit =
      relativeFiles.has(file)
      || hits.some((h) => h.relativePath.endsWith(`/${file}`) || h.relativePath === file);
    // Soft-match line within ±2 of any hit in the same file
    const nearHit = hits.find(
      (h) =>
        (h.relativePath === file || h.relativePath.endsWith(`/${file}`))
        && Math.abs(h.line - line) <= 2
    );
    if (!exact && !fileHit && !nearHit) continue;

    const resolvedFile = nearHit?.relativePath || (relativeFiles.has(file) ? file : hits.find((h) => h.relativePath.endsWith(`/${file}`))?.relativePath) || file;
    const resolvedLine = exact ? line : nearHit?.line || line;

    hops.push({
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `hop_${index + 1}`,
      role: asRole(record.role),
      title: typeof record.title === "string" ? record.title.slice(0, 120) : `${resolvedFile}:${resolvedLine}`,
      narrative: typeof record.narrative === "string" ? record.narrative.slice(0, 400) : "",
      file: resolvedFile,
      line: resolvedLine,
      confidence: asConfidence(record.confidence)
    });
  }

  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 800)
      : hops.map((h) => h.title).join(" → ").slice(0, 400) || `Found ${hits.length} references.`;

  return {
    summary,
    complete: incomplete ? false : Boolean(parsed.complete),
    openEnds: Array.isArray(parsed.openEnds)
      ? parsed.openEnds
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => ({
            symbol: typeof item.symbol === "string" ? item.symbol : "",
            file: typeof item.file === "string" ? normalizeRelativeFile(item.file) : undefined,
            line: asPositiveInt(item.line) || undefined,
            reason: typeof item.reason === "string" ? item.reason : "open"
          }))
          .filter((item) => item.symbol)
          .slice(0, 12)
      : undefined,
    hops: hops.slice(0, 30),
    edges: Array.isArray(parsed.edges)
      ? parsed.edges
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => ({
            from: String(item.from || ""),
            to: String(item.to || ""),
            label: typeof item.label === "string" ? item.label : undefined
          }))
          .filter((item) => item.from && item.to)
          .slice(0, 40)
      : undefined,
    discardedHits: Array.isArray(parsed.discardedHits)
      ? parsed.discardedHits.filter((item): item is string => typeof item === "string").slice(0, 20)
      : undefined,
    confidence: asConfidence(parsed.confidence)
  };
}

export function parseLinkGraphAnalysis(
  raw: string,
  hits: LinkGraphHit[],
  incomplete: boolean
): LinkGraphAnalysis | null {
  const candidates = collectJsonObjectCandidates(raw);
  for (const candidate of candidates) {
    for (const variant of [candidate, repairCommonJsonIssues(candidate)]) {
      try {
        const parsed = JSON.parse(variant) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        return mapAnalysisObject(parsed as Record<string, unknown>, hits, incomplete);
      } catch {
        // try next
      }
    }
  }
  return null;
}

function fallbackAnalysis(
  hits: LinkGraphHit[],
  incomplete: boolean,
  frontier: LinkGraphFrontierItem[],
  catalogLanguage = "English"
): LinkGraphAnalysis {
  const ordered = [...hits].sort((a, b) => a.depth - b.depth || b.score - a.score).slice(0, 16);
  const hops: LinkGraphHop[] = ordered.map((hit, index) => ({
    id: `hit_${index + 1}`,
    role: hit.depth === 0 ? "definition" : "read",
    title: `${hit.symbol} · ${hit.relativePath}:${hit.line}`,
    narrative: hit.preview,
    file: hit.relativePath,
    line: hit.line,
    confidence: hit.score >= 40 ? "high" : hit.score >= 20 ? "medium" : "low"
  }));
  const files = new Set(hits.map((h) => h.relativePath)).size;
  const isZh = /chinese|zh/i.test(catalogLanguage);
  const isJa = /japanese|ja/i.test(catalogLanguage);
  const summary = incomplete
    ? isZh
      ? `在 ${files} 个文件中找到 ${hits.length} 处引用（未穷尽，仍有待扩展节点）。`
      : isJa
        ? `${files} ファイルで ${hits.length} 件の参照が見つかりました（未完了・frontier 残りあり）。`
        : `Found ${hits.length} references across ${files} files (incomplete — frontier remains).`
    : isZh
      ? `在 ${files} 个文件中找到 ${hits.length} 处引用。`
      : isJa
        ? `${files} ファイルで ${hits.length} 件の参照が見つかりました。`
        : `Found ${hits.length} references across ${files} files.`;
  return {
    summary,
    complete: !incomplete,
    openEnds: frontier.slice(0, 8).map((item) => ({
      symbol: item.symbol,
      file: item.fromRelativePath,
      reason: "budget_or_queue"
    })),
    hops,
    confidence: incomplete ? "medium" : "high"
  };
}

function resolveLinkGraphCatalogLanguage(
  settings: Awaited<ReturnType<typeof loadSettings>>,
  preference: string | undefined,
  systemLocale?: string
): string {
  return resolveEffectiveOutputLanguage({
    outputPreference: preference && preference !== "auto" ? preference : settings.llm?.outputLanguage,
    uiPreference: settings.uiLanguage,
    systemLocale
  }).catalogLanguage;
}

function buildLinkGraphLlmPrompt(args: {
  seedSymbol: string;
  seedRelativePath: string;
  startLine: number;
  hits: LinkGraphHit[];
  frontier: LinkGraphFrontierItem[];
  incomplete: boolean;
  outputLanguage: string;
  evidenceBlocks: Array<{ file: string; line: number; text: string }>;
  compact: boolean;
}): { system: string; user: string } {
  const topHits = args.hits
    .slice()
    .sort((a, b) => a.depth - b.depth || b.score - a.score)
    .slice(0, args.compact ? 24 : 40);

  const hitSummary = topHits
    .map((h) => `- d${h.depth} ${h.relativePath}:${h.line} [${h.symbol}] ${h.preview.slice(0, 120)}`)
    .join("\n");

  const system = [
    "You analyze code reference chains for a developer side panel (Link Graph).",
    "Use ONLY the provided evidence. Never invent files or line numbers not listed in Hits.",
    `Write summary and hop narratives in ${args.outputLanguage}.`,
    "CRITICAL: Respond with ONE JSON object only. No markdown fences, no prose before/after.",
    'Required shape: {"summary":"string","complete":false,"hops":[{"id":"h1","role":"definition","title":"string","narrative":"string","file":"relative/path.ts","line":12,"confidence":"high"}],"confidence":"medium"}',
    "hops: 4–12 items max, ordered main chain. role one of definition|write|read|call|transform|other.",
    "file must be a relativePath exactly as in Hits. line must be integer from Hits.",
    args.incomplete
      ? "Evidence is INCOMPLETE. Set complete=false. Optionally openEnds:[{symbol,file?,line?,reason}]."
      : "Set complete=true only if the chain looks closed in evidence."
  ].join("\n");

  const userParts = [
    `Seed symbol: ${args.seedSymbol}`,
    `Seed location: ${args.seedRelativePath}:${args.startLine}`,
    `Incomplete: ${args.incomplete}`,
    `Frontier sample: ${args.frontier
      .slice(0, 8)
      .map((f) => f.symbol)
      .join(", ") || "(none)"}`,
    "",
    "Hits (use only these file:line values):",
    hitSummary || "(none)"
  ];
  if (!args.compact && args.evidenceBlocks.length) {
    userParts.push(
      "",
      "Code windows:",
      args.evidenceBlocks
        .slice(0, 16)
        .map((b) => b.text.slice(0, 1800))
        .join("\n\n")
    );
  }
  userParts.push("", "Return JSON now.");
  return { system, user: userParts.join("\n") };
}

async function runLlmAnalysis(args: {
  seedSymbol: string;
  seedRelativePath: string;
  startLine: number;
  hits: LinkGraphHit[];
  frontier: LinkGraphFrontierItem[];
  incomplete: boolean;
  /** Explicit catalog language e.g. Chinese / English / Japanese */
  catalogLanguage?: string;
  outputLanguagePreference?: string;
  systemLocale?: string;
  signal: AbortSignal;
}): Promise<{ analysis: LinkGraphAnalysis | null; status: LinkGraphAnalyzeResult["llmStatus"]; error?: string }> {
  if (args.signal.aborted) {
    return { analysis: null, status: "skipped" };
  }
  const settings = await loadSettings();
  const llm = llmConfigFromSettings(settings, args.systemLocale);
  if (!llm) {
    return { analysis: null, status: "unconfigured" };
  }

  const outputLanguage =
    args.catalogLanguage
    || resolveLinkGraphCatalogLanguage(settings, args.outputLanguagePreference, args.systemLocale);

  // Prefer high-score hits for packing; keep payload small enough that models finish JSON.
  const packHits = args.hits
    .slice()
    .sort((a, b) => b.score - a.score || a.depth - b.depth)
    .slice(0, 28);
  const evidence = await packEvidenceFromHits(packHits);

  const attempts: Array<{ compact: boolean; maxTokens: number; label: string }> = [
    { compact: false, maxTokens: 2800, label: "full" },
    { compact: true, maxTokens: 1600, label: "retry-compact" }
  ];

  let lastError = "Invalid LLM JSON";
  let lastRawPreview = "";

  for (const attempt of attempts) {
    if (args.signal.aborted) {
      return { analysis: null, status: "skipped" };
    }
    const prompt = buildLinkGraphLlmPrompt({
      seedSymbol: args.seedSymbol,
      seedRelativePath: args.seedRelativePath,
      startLine: args.startLine,
      hits: args.hits,
      frontier: args.frontier,
      incomplete: args.incomplete,
      outputLanguage,
      evidenceBlocks: evidence,
      compact: attempt.compact
    });

    try {
      const content = await chatCompletion(
        llm,
        [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        attempt.maxTokens
      );
      lastRawPreview = String(content || "").replace(/\s+/g, " ").trim().slice(0, 160);
      const analysis = parseLinkGraphAnalysis(content, args.hits, args.incomplete);
      if (analysis && (analysis.summary || analysis.hops.length)) {
        analysis.complete = args.incomplete ? false : analysis.complete;
        return { analysis, status: "ok" };
      }
      lastError = `Invalid LLM JSON (${attempt.label})${lastRawPreview ? ` · raw≈ ${lastRawPreview}` : ""}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // empty-response / timeout: try compact once more
      if (attempt.compact) {
        return { analysis: null, status: "failed", error: lastError };
      }
    }
  }

  return { analysis: null, status: "failed", error: lastError };
}

async function packEvidenceFromHits(
  hits: LinkGraphHit[]
): Promise<Array<{ file: string; line: number; text: string }>> {
  const blocks: Array<{ file: string; line: number; text: string }> = [];
  let chars = 0;
  const seen = new Set<string>();
  const ordered = [...hits].sort((a, b) => b.score - a.score);

  for (const hit of ordered) {
    if (blocks.length >= MAX_PACK_BLOCKS || chars >= MAX_PACK_CHARS) break;
    const bucket = `${hit.relativePath}:${Math.floor(hit.line / 12)}`;
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    let text: string;
    try {
      text = await fs.readFile(hit.path, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const start = Math.max(1, hit.line - WINDOW_RADIUS);
    const end = Math.min(lines.length, hit.line + WINDOW_RADIUS);
    const slice = lines
      .slice(start - 1, end)
      .map((line, index) => `${String(start + index).padStart(4, " ")}| ${line}`)
      .join("\n");
    const block = `// ${hit.relativePath}:${hit.line} (${hit.symbol}, depth ${hit.depth})\n${slice}`;
    chars += block.length;
    blocks.push({ file: hit.relativePath, line: hit.line, text: block });
  }
  return blocks;
}

export function cancelLinkGraphAnalyze(): { ok: boolean } {
  if (activeAbort && !activeAbort.signal.aborted) {
    activeAbort.abort();
  }
  activeAbort = null;
  activeRequestId = null;
  return { ok: true };
}

export async function analyzeLinkGraph(
  raw: LinkGraphAnalyzeArgs,
  options?: { systemLocale?: string; onProgress?: ProgressEmitter }
): Promise<LinkGraphAnalyzeResult> {
  cancelLinkGraphAnalyze();
  const controller = new AbortController();
  activeAbort = controller;
  const onProgress = options?.onProgress || (() => undefined);

  const projectPath = resolveRoot(raw.projectPath);
  const filePath = resolveWithinRoot(raw.filePath, projectPath);
  const relativePath = toPosixRelative(projectPath, filePath);
  const normalized = normalizeLinkGraphSymbol(raw.selection || "");

  if (!normalized) {
    const requestId = newRequestId();
    return {
      requestId,
      seed: {
        selection: raw.selection || "",
        symbol: "",
        filePath,
        relativePath,
        startLine: raw.startLine || 1,
        endLine: raw.endLine || raw.startLine || 1
      },
      hits: [],
      frontier: [],
      frontierCount: 0,
      analysis: null,
      reachedDepth: 0,
      stopReason: "invalid_seed",
      truncated: false,
      complete: true,
      engine: "none",
      llmStatus: "skipped"
    };
  }

  const continueId = typeof raw.continueFromRequestId === "string" ? raw.continueFromRequestId.trim() : "";
  let existing = continueId ? sessions.get(continueId) : undefined;
  if (existing && existing.projectPath !== projectPath) {
    sessions.delete(continueId);
    existing = undefined;
  }
  // Continue with no in-memory session (e.g. after reload): cannot extend frontier.
  if (continueId && !existing) {
    const requestId = newRequestId();
    return {
      requestId,
      seed: {
        selection: raw.selection.trim(),
        symbol: normalized.symbol,
        filePath,
        relativePath,
        startLine: Math.max(1, Math.floor(raw.startLine || 1)),
        endLine: Math.max(1, Math.floor(raw.endLine || raw.startLine || 1))
      },
      hits: [],
      frontier: [],
      frontierCount: 0,
      analysis: null,
      reachedDepth: 0,
      stopReason: "empty_seed",
      truncated: false,
      complete: true,
      engine: "none",
      llmStatus: "skipped",
      llmError: "Link Graph session expired — run analysis again"
    };
  }

  const requestId = existing?.requestId || newRequestId();
  activeRequestId = requestId;

  const settingsForLang = await loadSettings();
  const catalogLanguage = resolveLinkGraphCatalogLanguage(
    settingsForLang,
    typeof raw.outputLanguage === "string" ? raw.outputLanguage : undefined,
    options?.systemLocale
  );

  // Base budgets for a fresh run. Continue adds room on top of what is already collected
  // so we never no-op when hits/symbols are already at the previous cap.
  const baseHits = clampInt(raw.maxHits, DEFAULT_MAX_HITS, 10, ABSOLUTE_MAX_HITS);
  const baseFiles = clampInt(raw.maxFiles, DEFAULT_MAX_FILES, 5, ABSOLUTE_MAX_FILES);
  const baseSymbols = clampInt(raw.maxSymbols, DEFAULT_MAX_SYMBOLS, 5, ABSOLUTE_MAX_SYMBOLS);
  const timeBudgetMs = clampInt(raw.timeBudgetMs, DEFAULT_TIME_BUDGET_MS, 2_000, 60_000);
  const safetyMaxDepth = clampInt(raw.safetyMaxDepth, DEFAULT_SAFETY_MAX_DEPTH, 2, 32);

  const maxHits = existing
    ? Math.min(ABSOLUTE_MAX_HITS, existing.hits.length + Math.max(CONTINUE_HIT_BUDGET, Math.floor(baseHits / 2)))
    : baseHits;
  const maxFiles = existing
    ? Math.min(
      ABSOLUTE_MAX_FILES,
      new Set(existing.hits.map((h) => h.relativePath)).size + Math.max(CONTINUE_FILE_BUDGET, Math.floor(baseFiles / 2))
    )
    : baseFiles;
  const maxSymbols = existing
    ? Math.min(
      ABSOLUTE_MAX_SYMBOLS,
      existing.expandedSymbols.size + Math.max(CONTINUE_SYMBOL_BUDGET, Math.floor(baseSymbols / 2))
    )
    : baseSymbols;

  const seed = existing?.seed || {
    selection: raw.selection.trim(),
    symbol: normalized.symbol,
    filePath,
    relativePath,
    startLine: Math.max(1, Math.floor(raw.startLine || 1)),
    endLine: Math.max(1, Math.floor(raw.endLine || raw.startLine || 1))
  };

  const reanalyzeExisting = async (
    session: SessionState,
    incomplete: boolean
  ): Promise<LinkGraphAnalyzeResult> => {
    onProgress({
      requestId,
      phase: "analyzing",
      message: `Analyzing chain (${catalogLanguage})…`,
      hitCount: session.hits.length,
      reachedDepth: session.reachedDepth
    });
    let analysis = fallbackAnalysis(session.hits, incomplete, session.frontier, catalogLanguage);
    let llmStatus: LinkGraphAnalyzeResult["llmStatus"] = "skipped";
    let llmError: string | undefined;
    if (!raw.skipLlm && session.hits.length > 0) {
      const llmResult = await runLlmAnalysis({
        seedSymbol: seed.symbol,
        seedRelativePath: seed.relativePath,
        startLine: seed.startLine,
        hits: session.hits,
        frontier: session.frontier,
        incomplete,
        catalogLanguage,
        outputLanguagePreference: typeof raw.outputLanguage === "string" ? raw.outputLanguage : undefined,
        systemLocale: options?.systemLocale,
        signal: controller.signal
      });
      llmStatus = llmResult.status;
      llmError = llmResult.error;
      if (llmResult.analysis) analysis = llmResult.analysis;
    }
    onProgress({
      requestId,
      phase: "done",
      message: incomplete ? "Incomplete" : "Complete",
      hitCount: session.hits.length,
      reachedDepth: session.reachedDepth
    });
    return {
      requestId,
      seed,
      hits: session.hits,
      frontier: session.frontier,
      frontierCount: session.frontier.length,
      analysis,
      reachedDepth: session.reachedDepth,
      stopReason: incomplete ? (session.frontier.length ? "max_symbols" : "complete") : "complete",
      truncated: incomplete,
      complete: !incomplete,
      engine: session.engine,
      llmStatus,
      llmError
    };
  };

  // Language change / re-summarize: reuse hits, only re-run LLM.
  if (raw.reanalyzeOnly && existing) {
    const incomplete = existing.frontier.length > 0;
    return reanalyzeExisting(existing, incomplete);
  }

  if (existing && existing.frontier.length === 0 && !raw.reanalyzeOnly && continueId) {
    // Nothing left to expand — re-run LLM only (keeps language preference).
    return reanalyzeExisting(existing, false);
  }

  onProgress({
    requestId,
    phase: "searching",
    message: existing
      ? `Continuing expansion… (+${maxHits - existing.hits.length} hits budget, frontier ${existing.frontier.length})`
      : `Searching references for ${seed.symbol}`,
    hitCount: existing?.hits.length || 0,
    reachedDepth: existing?.reachedDepth || 0
  });

  try {
    const expanded = await expandGraph({
      root: projectPath,
      seedRelativePath: seed.relativePath,
      seedAbsolutePath: seed.filePath,
      seedSymbol: seed.symbol,
      wholeWord: normalized.wholeWord,
      maxHits,
      maxFiles,
      maxSymbols,
      timeBudgetMs,
      safetyMaxDepth,
      signal: controller.signal,
      existing: existing && existing.projectPath === projectPath ? existing : undefined,
      onProgress,
      requestId
    });

    // Incomplete only when there is still work left (or user cancelled mid-run).
    // Hitting max_hits with an empty queue is complete — not a stuck "Continue".
    const incomplete =
      expanded.stopReason === "cancelled"
      || expanded.frontier.length > 0;
    const complete = !incomplete;

    const session: SessionState = {
      requestId,
      projectPath,
      seed,
      hits: expanded.hits,
      frontier: expanded.frontier,
      visitedHitKeys: expanded.visitedHitKeys,
      expandedSymbols: expanded.expandedSymbols,
      reachedDepth: expanded.reachedDepth,
      engine: expanded.engine
    };
    sessions.set(requestId, session);
    // Keep only a few sessions
    if (sessions.size > 8) {
      const oldest = sessions.keys().next().value;
      if (oldest && oldest !== requestId) sessions.delete(oldest);
    }

    let analysis: LinkGraphAnalysis | null = null;
    let llmStatus: LinkGraphAnalyzeResult["llmStatus"] = "skipped";
    let llmError: string | undefined;

    if (!raw.skipLlm && expanded.hits.length > 0 && !controller.signal.aborted) {
      onProgress({
        requestId,
        phase: "analyzing",
        message: `Analyzing chain (${catalogLanguage})…`,
        hitCount: expanded.hits.length,
        reachedDepth: expanded.reachedDepth
      });
      const llmResult = await runLlmAnalysis({
        seedSymbol: seed.symbol,
        seedRelativePath: seed.relativePath,
        startLine: seed.startLine,
        hits: expanded.hits,
        frontier: expanded.frontier,
        incomplete,
        catalogLanguage,
        outputLanguagePreference: typeof raw.outputLanguage === "string" ? raw.outputLanguage : undefined,
        systemLocale: options?.systemLocale,
        signal: controller.signal
      });
      llmStatus = llmResult.status;
      llmError = llmResult.error;
      analysis = llmResult.analysis;
    }

    if (!analysis && expanded.hits.length > 0) {
      analysis = fallbackAnalysis(expanded.hits, incomplete, expanded.frontier, catalogLanguage);
    }

    onProgress({
      requestId,
      phase: "done",
      message: complete
        ? "Complete"
        : `Incomplete (${expanded.stopReason}, frontier ${expanded.frontier.length})`,
      hitCount: expanded.hits.length,
      reachedDepth: expanded.reachedDepth
    });

    return {
      requestId,
      seed,
      hits: expanded.hits,
      frontier: expanded.frontier,
      frontierCount: expanded.frontier.length,
      analysis,
      reachedDepth: expanded.reachedDepth,
      stopReason: complete && expanded.stopReason !== "cancelled" ? "complete" : expanded.stopReason,
      truncated: incomplete,
      complete,
      engine: expanded.engine,
      llmStatus,
      llmError
    };
  } catch (error) {
    onProgress({
      requestId,
      phase: "error",
      message: error instanceof Error ? error.message : String(error),
      hitCount: 0,
      reachedDepth: 0
    });
    throw error;
  } finally {
    if (activeAbort === controller) {
      activeAbort = null;
    }
    if (activeRequestId === requestId) {
      activeRequestId = null;
    }
  }
}

/** Test helper */
export function clearLinkGraphSessionsForTests(): void {
  sessions.clear();
  cancelLinkGraphAnalyze();
}
