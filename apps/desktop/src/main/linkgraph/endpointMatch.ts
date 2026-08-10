/**
 * Language-agnostic FE→BE endpoint matching.
 * Excludes frontend client calls ($post/axios) that previously stole the bridge.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { searchWorkbenchText, type WorkbenchSearchMatch } from "../workbenchSearch";
import { normalizeRoutePath, routesCompatible } from "./httpBridge";
import { relativeToAnyRoot } from "./searchRoots";

export type EndpointCandidate = {
  id: string;
  root: string;
  absolutePath: string;
  relativePath: string;
  line: number;
  preview: string;
  score: number;
  combinedPath?: string;
  snippet: string;
  kindHint: "java" | "node" | "go" | "python" | "unknown";
};

const SERVER_ANNOTATION =
  /@(?:RestController|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|Get|Post|Put|Delete|Patch)\b/;

/** True when this hit is clearly a frontend HTTP client call, not a server handler. */
export function isFrontendClientHit(relativePath: string, preview: string): boolean {
  const rel = relativePath.replaceAll("\\", "/");
  if (/\.(vue|tsx|jsx|svelte)$/i.test(rel)) return true;

  // Explicit client wrappers — even if path string matches
  if (
    /\$post\s*\(|\$get\s*\(|\$put\s*\(|\$delete\s*\(|\$patch\s*\(|\$request\s*\(/i.test(preview)
  ) {
    return true;
  }
  if (/\baxios\s*\.|\baxios\s*\(|\bfetch\s*\(\s*['"]|\buni\.request\b/i.test(preview)) {
    return true;
  }
  // FE api modules: export const ajax_* = { pageQuery: () => $post(
  if (
    /\.(ts|js|mjs|cjs)$/i.test(rel)
    && /ajax_|api[A-Z]|\bexport\s+const\s+\w+\s*=\s*\{/.test(preview + rel)
    && !SERVER_ANNOTATION.test(preview)
    && !/\b(router|app|controller)\.(get|post|put|delete)\b/i.test(preview)
  ) {
    // path under src/api or similar without server markers
    if (/(^|\/)(api|apis|services)\/[^/]+\.(ts|js)$/i.test(rel) || /ajax_/i.test(preview)) {
      return true;
    }
  }
  return false;
}

export function detectKindHint(relativePath: string, preview: string): EndpointCandidate["kindHint"] {
  if (/\.java$/i.test(relativePath) || /@RestController|@RequestMapping/.test(preview)) return "java";
  if (/\.go$/i.test(relativePath) || /\bgin\.|chi\.|echo\./i.test(preview)) return "go";
  if (/\.py$/i.test(relativePath) || /@app\.(get|post)|APIRouter|fastapi/i.test(preview)) return "python";
  if (
    /\.(ts|js)$/i.test(relativePath)
    && (/@Controller|@Get\(|@Post\(|NestFactory|express\(\)|router\.(get|post)/i.test(preview)
      || /Controller\.ts$/i.test(relativePath))
  ) {
    return "node";
  }
  return "unknown";
}

export async function combinedRouteFromFile(absolutePath: string): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(absolutePath, "utf8");
  } catch {
    return null;
  }
  // Spring-style class + method
  const classMap = text.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
  const methodMaps = [
    ...text.matchAll(/@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g)
  ];
  if (classMap && methodMaps.length) {
    // Prefer pageQuery-like last segment match later; return first combo for listing
    const prefix = classMap[1].replace(/\/$/, "");
    return normalizeRoutePath(`${prefix}/${methodMaps[0][1].replace(/^\//, "")}`);
  }
  // Nest: @Controller('manager/invoice') @Post('pageQuery')
  const nestCtrl = text.match(/@Controller\s*\(\s*["']([^"']+)["']/);
  const nestMethod = text.match(/@(?:Get|Post|Put|Delete|Patch)\s*\(\s*["']([^"']+)["']/);
  if (nestCtrl && nestMethod) {
    return normalizeRoutePath(`/${nestCtrl[1].replace(/^\//, "")}/${nestMethod[1].replace(/^\//, "")}`);
  }
  return null;
}

function scoreCandidate(
  m: WorkbenchSearchMatch,
  fePath: string,
  combinedPath: string | null
): number {
  if (isFrontendClientHit(m.relativePath, m.preview || "")) return -1;

  const preview = m.preview || "";
  const feNorm = normalizeRoutePath(fePath);
  const segments = fePath.split("/").filter((s) => s && s !== "{param}");
  const feTail = segments.length ? `/${segments[segments.length - 1]}` : "";
  const feResource = segments.length >= 2 ? segments[segments.length - 2] : "";

  let score = 0;

  // Real server markers
  if (SERVER_ANNOTATION.test(preview)) score += 40;
  if (/Controller\.(java|ts|go|py)$/i.test(m.relativePath)) score += 25;
  if (/\.java$/i.test(m.relativePath)) score += 10;

  // Path evidence on this line
  const pathLiterals = [...preview.matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]);
  for (const lit of pathLiterals) {
    if (!lit.includes("/") && !lit.startsWith("/")) continue;
    const full = lit.startsWith("/") ? lit : `/${lit}`;
    if (routesCompatible(feNorm, full)) score += 50;
    if (normalizeRoutePath(full) === normalizeRoutePath(feTail)) score += 15;
  }

  if (combinedPath && routesCompatible(feNorm, combinedPath)) score += 60;

  if (
    feResource
    && (m.relativePath.toLowerCase().includes(feResource.toLowerCase())
      || preview.toLowerCase().includes(feResource.toLowerCase()))
  ) {
    score += 15;
  }

  // Method name as last segment
  const last = segments[segments.length - 1];
  if (last && new RegExp(`\\b${last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`).test(preview)) {
    score += 12;
  }

  // Penalize pure FE dirs even if somehow passed
  if (/(^|\/)(views|pages|components|composables)\//i.test(m.relativePath)) score -= 50;

  return score;
}

/**
 * Collect endpoint candidates across all roots; FE client hits excluded; sorted by score.
 */
export async function collectEndpointCandidates(args: {
  roots: string[];
  fePath: string;
  signal?: AbortSignal;
  maxPerRoot?: number;
}): Promise<EndpointCandidate[]> {
  const segments = args.fePath.split("/").filter((s) => s && s !== "{param}" && s !== "api" && !/^v\d+$/.test(s));
  const queries: string[] = [];
  if (segments.length >= 2) {
    queries.push(segments.slice(-2).join("/"));
    queries.push(segments[segments.length - 2]);
  }
  if (segments.length) queries.push(segments[segments.length - 1]);
  // also search path prefix for Spring class mapping
  if (segments.length >= 2) {
    queries.push(segments.slice(0, -1).join("/")); // manager/invoice
  }
  const uniqueQueries = [...new Set(queries.filter((q) => q && q.length >= 2))];

  const raw: Array<WorkbenchSearchMatch & { root: string }> = [];
  const seen = new Set<string>();

  for (const root of args.roots) {
    if (args.signal?.aborted) break;
    for (const query of uniqueQueries.slice(0, 4)) {
      if (args.signal?.aborted) break;
      const result = await searchWorkbenchText({
        rootPath: root,
        query,
        matchCase: false,
        wholeWord: false,
        useRegex: false,
        maxResults: args.maxPerRoot ?? 50,
        timeBudgetMs: 5_000,
        signal: args.signal
      });
      for (const m of result.matches) {
        const key = `${m.path}:${m.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        raw.push({ ...m, root });
      }
    }
  }

  const out: EndpointCandidate[] = [];
  let id = 0;
  // Cache combined path per file
  const combinedCache = new Map<string, string | null>();

  for (const m of raw) {
    if (isFrontendClientHit(m.relativePath, m.preview || "")) continue;

    let combined = combinedCache.get(m.path);
    if (combined === undefined) {
      combined = await combinedRouteFromFile(m.path);
      combinedCache.set(m.path, combined);
    }

    const score = scoreCandidate(m, args.fePath, combined);
    if (score < 20) continue;

    let snippet = m.preview || "";
    try {
      const text = await fs.readFile(m.path, "utf8");
      const lines = text.split(/\r?\n/);
      const start = Math.max(0, m.line - 8);
      const end = Math.min(lines.length, m.line + 12);
      snippet = lines
        .slice(start, end)
        .map((line, i) => `${start + i + 1}| ${line}`)
        .join("\n")
        .slice(0, 1800);
    } catch {
      /* keep preview */
    }

    id += 1;
    out.push({
      id: `c${id}`,
      root: m.root,
      absolutePath: m.path,
      relativePath: relativeToAnyRoot(args.roots, m.path) || m.relativePath,
      line: m.line,
      preview: (m.preview || "").slice(0, 200),
      score,
      combinedPath: combined || undefined,
      snippet,
      kindHint: detectKindHint(m.relativePath, m.preview || "")
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 24);
}

/** Best rule-only endpoint if score is decisive. */
export function pickDecisiveEndpoint(
  candidates: EndpointCandidate[],
  fePath: string
): EndpointCandidate | null {
  if (!candidates.length) return null;
  const top = candidates[0];
  if (top.score < 45) return null;
  if (candidates.length > 1 && candidates[1].score >= top.score - 5) {
    // ambiguous — prefer one whose combinedPath matches
    const feNorm = normalizeRoutePath(fePath);
    const exact = candidates.find((c) => c.combinedPath && routesCompatible(feNorm, c.combinedPath));
    if (exact && exact.score >= 45) return exact;
    return null; // let LLM choose
  }
  return top;
}

export function formatCandidatesForLlm(candidates: EndpointCandidate[]): string {
  return candidates
    .slice(0, 12)
    .map(
      (c) =>
        `[${c.id}] score=${c.score} kind=${c.kindHint} ${c.relativePath}:${c.line}`
        + (c.combinedPath ? ` route≈${c.combinedPath}` : "")
        + `\n${c.snippet}\n`
    )
    .join("\n---\n");
}
