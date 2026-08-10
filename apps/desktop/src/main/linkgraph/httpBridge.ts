/**
 * FE↔BE bridge: OpenAPI (preferred) then HTTP route alignment + DTO-scoped name-family.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  searchWorkbenchText,
  type WorkbenchSearchMatch
} from "../workbenchSearch";
import { buildNameFamily, escapeRegExp, shouldExpandNameFamily } from "./nameFamily";
import { digDefinitionChain } from "./definitionDig";
import { pathKey } from "./importResolve";
import type {
  LinkGraphBridgeKind,
  LinkGraphBridgeStatus,
  LinkGraphChainStep,
  LinkGraphConfidence,
  LinkGraphOpenEnd
} from "../../shared/linkGraphTypes";

export type BridgeResult = {
  steps: LinkGraphChainStep[];
  openEnds: LinkGraphOpenEnd[];
  bridgeKind?: LinkGraphBridgeKind;
  confidence?: LinkGraphConfidence;
  pathKeys: Set<string>;
  status: LinkGraphBridgeStatus;
};

export function normalizeRoutePath(raw: string): string {
  let s = raw.trim().replace(/^['"`]|['"`]$/g, "");
  s = s.replace(/^https?:\/\/[^/]+/i, "");
  s = s.split("?")[0].split("#")[0];
  s = s.replace(/\$\{[^}]+\}/g, "{param}");
  s = s.replace(/:([A-Za-z_][\w]*)/g, "{$1}");
  s = s.replace(/\{[^}]+\}/g, "{param}");
  if (!s.startsWith("/")) s = `/${s}`;
  s = s.replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s.toLowerCase();
}

/**
 * Extract HTTP-like path string literals.
 * Accepts any absolute-looking path starting with `/` that has ≥2 segments
 * (covers /api/..., /manager/invoice/pageQuery, /v1/..., etc.).
 */
export function extractHttpPathsFromSource(source: string): Array<{ path: string; line: number; preview: string }> {
  const lines = source.split(/\r?\n/);
  const out: Array<{ path: string; line: number; preview: string }> = [];
  const seen = new Set<string>();
  // Prefer known app prefixes first, then any multi-segment absolute path
  const re =
    /['"`](\/(?:api|manager|admin|service|services|gateway|open|inner|v\d+)[A-Za-z0-9_./${}:-]{1,140}|\/[A-Za-z][A-Za-z0-9_./${}:-]{2,140})['"`]/g;

  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText)) !== null) {
      const raw = m[1];
      // skip pure template / single segment noise like "/a"
      if (!/[A-Za-z]/.test(raw.replace(/\$\{[^}]+\}/g, ""))) continue;
      const segments = raw.split("/").filter(Boolean);
      if (segments.length < 2) continue;
      // skip asset-like paths
      if (/\.(js|css|png|jpg|svg|ico|woff2?)(\?|$)/i.test(raw)) continue;
      const norm = normalizeRoutePath(raw);
      const key = `${norm}@${i + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ path: norm, line: i + 1, preview: lineText.trim().slice(0, 200) });
      if (out.length >= 32) return out;
    }
  }
  return out;
}

export function routesCompatible(a: string, b: string): boolean {
  const na = normalizeRoutePath(a);
  const nb = normalizeRoutePath(b);
  if (na === nb) return true;
  const sa = na.split("/").filter(Boolean);
  const sb = nb.split("/").filter(Boolean);
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] === "{param}" || sb[i] === "{param}") continue;
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

function toPosixRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

async function readSafe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

export async function findBackendMappingMatches(
  root: string,
  fePath: string,
  signal?: AbortSignal
): Promise<WorkbenchSearchMatch[]> {
  // Use multi-root-capable endpoint matcher (single root here); excludes FE $post false positives.
  const { collectEndpointCandidates } = await import("./endpointMatch");
  const candidates = await collectEndpointCandidates({
    roots: [root],
    fePath,
    signal,
    maxPerRoot: 50
  });
  return candidates.map((c) => ({
    path: c.absolutePath,
    relativePath: c.relativePath,
    line: c.line,
    column: 1,
    endColumn: 1,
    preview: c.preview
  }));
}

/** Find field of symbol/family inside a class/interface block that looks like a DTO. */
export function findFieldInDtoScope(
  source: string,
  symbol: string
): { line: number; preview: string; matched: string; className?: string } | null {
  const aliases = shouldExpandNameFamily(symbol) ? buildNameFamily(symbol) : [symbol];
  const lines = source.split(/\r?\n/);

  // Prefer hits inside class/interface/record bodies named *VO|*Dto|*Entity|*Model
  let inDto = false;
  let className: string | undefined;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const classMatch = line.match(/\b(class|interface|record|type|enum)\s+(\w*(?:VO|Dto|DTO|Entity|Model|Request|Response|Param)\w*)/i)
      || line.match(/\b(class|interface|record)\s+(\w+)/);
    if (classMatch) {
      className = classMatch[2];
      inDto = /VO|Dto|DTO|Entity|Model|Request|Response|Param/i.test(className)
        || looksLikeDtoFileHint(className);
      braceDepth = 0;
    }
    for (const ch of line) {
      if (ch === "{") braceDepth += 1;
      if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    }

    for (const alias of aliases) {
      let re: RegExp;
      try {
        re = new RegExp(`\\b${escapeRegExp(alias)}\\b`);
      } catch {
        continue;
      }
      if (!re.test(line)) continue;
      // Prefer when inside a type body
      if (inDto || braceDepth > 0 || /:\s*|private|public|protected/.test(line)) {
        return { line: i + 1, preview: line.trim().slice(0, 200), matched: alias, className };
      }
    }
  }

  // Fallback: any occurrence
  for (const alias of aliases) {
    let re: RegExp;
    try {
      re = new RegExp(`\\b${escapeRegExp(alias)}\\b`);
    } catch {
      continue;
    }
    for (let i = 0; i < lines.length; i += 1) {
      if (re.test(lines[i])) {
        return { line: i + 1, preview: lines[i].trim().slice(0, 200), matched: alias };
      }
    }
  }
  return null;
}

function looksLikeDtoFileHint(name: string): boolean {
  return name.length >= 3;
}

export function findFieldInSource(
  source: string,
  symbol: string
): { line: number; preview: string; matched: string } | null {
  const hit = findFieldInDtoScope(source, symbol);
  return hit ? { line: hit.line, preview: hit.preview, matched: hit.matched } : null;
}

/** Scan project for openapi/swagger files and match path + property. */
export async function tryOpenApiBridge(args: {
  root: string;
  symbol: string;
  fePaths: string[];
  signal?: AbortSignal;
}): Promise<{
  openapiFile: string;
  relativePath: string;
  line: number;
  preview: string;
  matchedPath: string;
  schemaHint?: string;
} | null> {
  if (!args.fePaths.length) return null;
  const nameQuery = "openapi";
  const search = await searchWorkbenchText({
    rootPath: args.root,
    query: nameQuery,
    matchCase: false,
    wholeWord: false,
    useRegex: false,
    maxResults: 40,
    timeBudgetMs: 5_000,
    signal: args.signal
  });

  // Also try common filenames via path fragments
  const pathHints = ["swagger", "openapi.yaml", "openapi.yml", "openapi.json", "api-docs"];
  const files = new Map<string, WorkbenchSearchMatch>();
  for (const m of search.matches) {
    if (/\.(ya?ml|json)$/i.test(m.relativePath) || /openapi|swagger|api-docs/i.test(m.relativePath)) {
      files.set(m.path, m);
    }
  }
  for (const hint of pathHints) {
    const r = await searchWorkbenchText({
      rootPath: args.root,
      query: hint,
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      maxResults: 20,
      timeBudgetMs: 3_000,
      signal: args.signal
    });
    for (const m of r.matches) {
      if (/\.(ya?ml|json)$/i.test(m.relativePath)) files.set(m.path, m);
    }
  }

  const aliases = shouldExpandNameFamily(args.symbol) ? buildNameFamily(args.symbol) : [args.symbol];

  for (const file of files.values()) {
    if (args.signal?.aborted) break;
    const source = await readSafe(file.path);
    if (!source || source.length > 2_000_000) continue;
    const lower = source.toLowerCase();
    if (!lower.includes("paths") && !lower.includes("openapi") && !lower.includes("swagger")) continue;

    for (const fe of args.fePaths) {
      // Match path segments in openapi
      const staticSeg = fe.split("/").filter((s) => s && s !== "{param}");
      if (!staticSeg.length) continue;
      const needle = staticSeg.join("/");
      if (!lower.includes(needle.toLowerCase()) && !lower.includes(fe)) continue;

      // Find property name near path
      let bestLine = 1;
      let bestPreview = file.relativePath;
      const lines = source.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].toLowerCase().includes(needle.toLowerCase()) || routesCompatible(fe, lines[i].replace(/['":]/g, " ").trim())) {
          bestLine = i + 1;
          bestPreview = lines[i].trim().slice(0, 200);
          break;
        }
      }

      // Prefer if schema property exists
      let schemaHint: string | undefined;
      for (const alias of aliases) {
        const propRe = new RegExp(`['"]${escapeRegExp(alias)}['"]\\s*:`);
        if (propRe.test(source)) {
          schemaHint = alias;
          for (let i = 0; i < lines.length; i += 1) {
            if (propRe.test(lines[i])) {
              bestLine = i + 1;
              bestPreview = lines[i].trim().slice(0, 200);
              break;
            }
          }
          break;
        }
      }

      return {
        openapiFile: file.path,
        relativePath: file.relativePath,
        line: bestLine,
        preview: bestPreview,
        matchedPath: fe,
        schemaHint
      };
    }
  }
  return null;
}

export async function tryHttpRouteBridge(args: {
  root: string;
  symbol: string;
  primarySteps: LinkGraphChainStep[];
  prunePathKeys: Set<string>;
  signal?: AbortSignal;
}): Promise<BridgeResult> {
  const openEnds: LinkGraphOpenEnd[] = [];
  const pathKeys = new Set<string>();
  const steps: LinkGraphChainStep[] = [];

  const fePaths: Array<{ path: string; line: number; preview: string; fromFile: string; fromAbs: string }> = [];
  const seenFiles = new Set<string>();

  for (const step of args.primarySteps) {
    if (seenFiles.has(step.path)) continue;
    seenFiles.add(step.path);
    const source = await readSafe(step.path);
    if (!source) continue;
    for (const p of extractHttpPathsFromSource(source)) {
      fePaths.push({ ...p, fromFile: step.file, fromAbs: step.path });
    }
  }

  fePaths.sort((a, b) => {
    const score = (f: string) => (/(^|\/)(api|apis|services?)\//i.test(f) ? 0 : 1);
    return score(a.fromFile) - score(b.fromFile);
  });

  if (!fePaths.length) {
    openEnds.push({ symbol: args.symbol, reason: "no_fe_http_path" });
    return { steps, openEnds, pathKeys, status: "failed" };
  }

  // —— OpenAPI first ——
  const oapi = await tryOpenApiBridge({
    root: args.root,
    symbol: args.symbol,
    fePaths: fePaths.map((p) => p.path),
    signal: args.signal
  });
  if (oapi) {
    steps.push({
      id: "bridge_openapi_1",
      edgeKind: "bridge",
      nodeKind: "bridge",
      role: "bridge",
      title: `OpenAPI ${oapi.matchedPath}`,
      narrative: oapi.schemaHint
        ? `schema property ${oapi.schemaHint} @ ${oapi.relativePath}`
        : `path matched in ${oapi.relativePath}`,
      file: oapi.relativePath,
      path: oapi.openapiFile,
      line: oapi.line,
      symbol: args.symbol,
      preview: oapi.preview,
      confidence: "high",
      bridgeKind: "openapi"
    });
    pathKeys.add(pathKey(args.root, oapi.openapiFile));
  }

  // —— HTTP route alignment ——
  let bridged = Boolean(oapi);
  for (const fe of fePaths.slice(0, 12)) {
    if (args.signal?.aborted) break;
    const beMatches = await findBackendMappingMatches(args.root, fe.path, args.signal);
    if (!beMatches.length) continue;

    const be = beMatches[0];
    const beAbs = be.path;
    const beRel = be.relativePath || toPosixRel(args.root, beAbs);
    const beKey = pathKey(args.root, beAbs);
    if (args.prunePathKeys.has(beKey)) continue;

    steps.push({
      id: `bridge_route_${steps.length + 1}`,
      edgeKind: "bridge",
      nodeKind: "bridge",
      role: "bridge",
      title: `HTTP ${fe.path}`,
      narrative: `FE ${fe.fromFile}:${fe.line} ↔ BE ${beRel}:${be.line}`,
      file: beRel,
      path: beAbs,
      line: be.line,
      symbol: args.symbol,
      preview: be.preview,
      confidence: "high",
      bridgeKind: "http_route"
    });
    pathKeys.add(beKey);
    bridged = true;

    const beSource = await readSafe(beAbs);
    if (beSource) {
      const field = findFieldInDtoScope(beSource, args.symbol);
      if (field) {
        steps.push({
          id: `bridge_field_${steps.length + 1}`,
          edgeKind: "defines",
          nodeKind: "be_controller",
          role: "definition",
          title: field.className ? `${field.className}.${field.matched}` : `BE field ${field.matched}`,
          narrative: field.preview,
          file: beRel,
          path: beAbs,
          line: field.line,
          symbol: field.matched,
          preview: field.preview,
          confidence: "medium",
          bridgeKind: "name_family"
        });
      }
    }

    const dig = await digDefinitionChain({
      root: args.root,
      startAbsolutePath: beAbs,
      startRelativePath: beRel,
      symbol: args.symbol,
      prunePathKeys: args.prunePathKeys,
      maxHops: 10,
      signal: args.signal,
      branchId: "be"
    });
    for (const s of dig.steps) {
      if (s.edgeKind === "refers" && s.file === beRel) continue;
      steps.push({ ...s, id: `be_${s.id}` });
    }
    for (const k of dig.pathKeys) pathKeys.add(k);
    openEnds.push(...dig.openEnds);

    if (!dig.reachedTerminal && !steps.some((s) => s.terminal)) {
      openEnds.push({
        symbol: args.symbol,
        file: beRel,
        line: be.line,
        reason: "bridge_incomplete_be_vo"
      });
      return {
        steps,
        openEnds,
        bridgeKind: oapi ? "openapi" : "http_route",
        confidence: "medium",
        pathKeys,
        status: "partial"
      };
    }

    return {
      steps,
      openEnds,
      bridgeKind: oapi ? "openapi" : "http_route",
      confidence: "high",
      pathKeys,
      status: "ok"
    };
  }

  if (oapi && !bridged) {
    // OpenAPI only, no BE controller
    openEnds.push({ symbol: args.symbol, reason: "openapi_only_no_be_controller" });
    return {
      steps,
      openEnds,
      bridgeKind: "openapi",
      confidence: "medium",
      pathKeys,
      status: "partial"
    };
  }

  if (!bridged) {
    openEnds.push({ symbol: args.symbol, reason: "no_be_route_match" });
    return { steps, openEnds, pathKeys, status: "failed" };
  }

  return {
    steps,
    openEnds,
    bridgeKind: oapi ? "openapi" : "http_route",
    confidence: "medium",
    pathKeys,
    status: steps.some((s) => s.terminal) ? "ok" : "partial"
  };
}
