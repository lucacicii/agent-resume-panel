/**
 * Deterministic verify tools for Link Graph discover (API client follow, URL, route).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  extractHttpPathsFromSource,
  findFieldInDtoScope,
  normalizeRoutePath
} from "../httpBridge";
import {
  findBindingForSymbol,
  parseImportsForFile,
  pathKey,
  resolveModuleSpecifier
} from "../importResolve";
import { relativeToAnyRoot } from "../searchRoots";
import type {
  LinkGraphBridgeKind,
  LinkGraphChainStep,
  LinkGraphOpenEnd
} from "../../../shared/linkGraphTypes";

export type DiscoverActionKind =
  | "follow_api_client"
  | "extract_url"
  | "search_route"
  | "open_import"
  | "stop";

export type DiscoverHypothesis = {
  kind: DiscoverActionKind;
  reason: string;
  confidence: "high" | "medium" | "low";
  args: {
    symbol?: string;
    method?: string;
    fromFile?: string;
    fromAbsolute?: string;
    query?: string;
    pathHint?: string;
    specifier?: string;
  };
  evidence?: string[];
};

export type ActionResult = {
  ok: boolean;
  steps: LinkGraphChainStep[];
  openEnds: LinkGraphOpenEnd[];
  pathKeys: Set<string>;
  /** URLs found for subsequent search_route */
  urls?: string[];
  /** Absolute files opened */
  files?: string[];
  message?: string;
  bridgeKind?: LinkGraphBridgeKind;
};

async function readSafe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

/** Find ajax_xxx.method( or obj.method( call sites in a source file. */
export function findApiClientCalls(
  source: string
): Array<{ client: string; method: string; line: number; preview: string }> {
  const lines = source.split(/\r?\n/);
  const out: Array<{ client: string; method: string; line: number; preview: string }> = [];
  // ajax_invoice.pageQuery(  |  api.user.list(
  const re = /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const client = m[1];
      const method = m[2];
      // skip common non-api
      if (
        /^(console|Math|JSON|Object|Array|Promise|window|document|this|props|state|formData|ref|reactive)$/.test(
          client
        )
      ) {
        continue;
      }
      if (/^(then|catch|map|filter|forEach|value|push|toString)$/.test(method)) continue;
      out.push({
        client,
        method,
        line: i + 1,
        preview: line.trim().slice(0, 200)
      });
      if (out.length >= 30) return out;
    }
  }
  return out;
}

/** Extract method body URL from api module source, e.g. pageQuery: (data) => $post('/path', data) */
export function findMethodUrlInApiModule(
  source: string,
  method: string
): { path: string; line: number; preview: string } | null {
  const lines = source.split(/\r?\n/);
  // Find method definition line
  let start = -1;
  const methodRe = new RegExp(
    `\\b${method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:(=]`
  );
  for (let i = 0; i < lines.length; i += 1) {
    if (methodRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    // whole file path extract fallback
    const paths = extractHttpPathsFromSource(source);
    return paths[0]
      ? { path: paths[0].path, line: paths[0].line, preview: paths[0].preview }
      : null;
  }
  // Scan method region (next ~15 lines or until next sibling method)
  const chunk = lines.slice(start, Math.min(lines.length, start + 20)).join("\n");
  const paths = extractHttpPathsFromSource(chunk);
  if (paths[0]) {
    return {
      path: paths[0].path,
      line: start + paths[0].line,
      preview: paths[0].preview
    };
  }
  // Also try $post/$get('...')
  const call = chunk.match(
    /\$(?:post|get|put|delete|patch|request)\s*\(\s*['"`]([^'"`]+)['"`]/i
  );
  if (call?.[1]?.startsWith("/")) {
    return {
      path: normalizeRoutePath(call[1]),
      line: start + 1,
      preview: lines[start].trim().slice(0, 200)
    };
  }
  return null;
}

export async function verifyFollowApiClient(args: {
  roots: string[];
  projectRoot: string;
  fromAbsolute: string;
  client: string;
  method: string;
  seedSymbol: string;
}): Promise<ActionResult> {
  const steps: LinkGraphChainStep[] = [];
  const openEnds: LinkGraphOpenEnd[] = [];
  const pathKeys = new Set<string>();
  const source = await readSafe(args.fromAbsolute);
  if (!source) {
    return { ok: false, steps, openEnds, pathKeys, message: "seed_file_unreadable" };
  }

  const bindings = parseImportsForFile(source, args.fromAbsolute);
  const binding = findBindingForSymbol(bindings, args.client);
  if (!binding) {
    openEnds.push({
      symbol: args.client,
      file: relativeToAnyRoot(args.roots, args.fromAbsolute),
      reason: "api_client_import_not_found"
    });
    return { ok: false, steps, openEnds, pathKeys, message: "import_not_found" };
  }

  const resolved = await resolveModuleSpecifier(args.projectRoot, args.fromAbsolute, binding.specifier);
  if (!resolved) {
    openEnds.push({
      symbol: args.client,
      reason: "unresolved_api_import",
      file: binding.specifier
    });
    return { ok: false, steps, openEnds, pathKeys, message: "unresolved_import" };
  }

  const fromRel = relativeToAnyRoot(args.roots, args.fromAbsolute);
  steps.push({
    id: `disc_api_import_${args.client}`,
    edgeKind: "imports",
    nodeKind: "api_client",
    role: "import",
    title: `API client ${args.client}`,
    narrative: binding.specifier,
    file: fromRel,
    path: args.fromAbsolute,
    line: binding.line,
    symbol: args.client,
    preview: `import ${args.client} from '${binding.specifier}'`,
    confidence: "high",
    importSpecifier: binding.specifier,
    bridgeKind: "api_client"
  });

  const apiSource = await readSafe(resolved.absolutePath);
  if (!apiSource) {
    return { ok: false, steps, openEnds, pathKeys, message: "api_file_unreadable" };
  }

  pathKeys.add(pathKey(args.projectRoot, resolved.absolutePath));
  const urlHit = findMethodUrlInApiModule(apiSource, args.method);
  const apiRel = relativeToAnyRoot(args.roots, resolved.absolutePath);

  steps.push({
    id: `disc_api_method_${args.method}`,
    edgeKind: "defines",
    nodeKind: "api_client",
    role: "call",
    title: `${args.client}.${args.method}`,
    narrative: urlHit ? urlHit.path : "method in API module",
    file: apiRel,
    path: resolved.absolutePath,
    line: urlHit?.line || 1,
    symbol: args.method,
    preview: urlHit?.preview || `${args.method}`,
    confidence: "high",
    bridgeKind: "api_client"
  });

  const urls = urlHit ? [urlHit.path] : extractHttpPathsFromSource(apiSource).map((p) => p.path);
  if (urlHit) {
    steps.push({
      id: `disc_url_${urlHit.line}`,
      edgeKind: "bridge",
      nodeKind: "bridge",
      role: "bridge",
      title: `URL ${urlHit.path}`,
      narrative: `${args.client}.${args.method} → ${urlHit.path}`,
      file: apiRel,
      path: resolved.absolutePath,
      line: urlHit.line,
      symbol: args.seedSymbol,
      preview: urlHit.preview,
      confidence: "high",
      bridgeKind: "api_client"
    });
  }

  return {
    ok: urls.length > 0,
    steps,
    openEnds,
    pathKeys,
    urls,
    files: [resolved.absolutePath],
    message: urls.length ? "ok" : "no_url_in_api_module",
    bridgeKind: "api_client"
  };
}

export async function verifySearchRoute(args: {
  roots: string[];
  projectRoot: string;
  fePath: string;
  seedSymbol: string;
  prunePathKeys: Set<string>;
  signal?: AbortSignal;
  useLlmMatch?: boolean;
  skipLlm?: boolean;
  systemLocale?: string;
  deadlineMs?: number;
  chainSummary?: string;
  onProgress?: (msg: string) => void;
}): Promise<ActionResult> {
  // Default: multi-root endpoint match + optional LLM 纵深 (excludes FE $post)
  if (args.useLlmMatch !== false) {
    const { runEndpointMatchLoop } = await import("./llmMatch");
    const matched = await runEndpointMatchLoop({
      roots: args.roots,
      projectRoot: args.projectRoot,
      fePath: args.fePath,
      seedSymbol: args.seedSymbol,
      chainSummary: args.chainSummary || "",
      prunePathKeys: args.prunePathKeys,
      skipLlm: args.skipLlm,
      systemLocale: args.systemLocale,
      signal: args.signal,
      deadlineMs: args.deadlineMs,
      onProgress: args.onProgress
    });
    return {
      ok: matched.bridgeStatus === "ok" || matched.bridgeStatus === "partial",
      steps: matched.steps,
      openEnds: matched.openEnds,
      pathKeys: matched.pathKeys,
      message: matched.bridgeStatus,
      bridgeKind: matched.bridgeStatus === "ok" ? "http_route" : "llm_discover"
    };
  }

  const { collectEndpointCandidates, pickDecisiveEndpoint } = await import("../endpointMatch");
  const steps: LinkGraphChainStep[] = [];
  const openEnds: LinkGraphOpenEnd[] = [];
  const pathKeys = new Set<string>();
  const candidates = await collectEndpointCandidates({
    roots: args.roots,
    fePath: args.fePath,
    signal: args.signal
  });
  const best = pickDecisiveEndpoint(candidates, args.fePath) || candidates[0];
  if (!best) {
    openEnds.push({ symbol: args.seedSymbol, reason: "no_be_route_match", file: args.fePath });
    return { ok: false, steps, openEnds, pathKeys, message: "no_match" };
  }
  const beKey = pathKey(best.root, best.absolutePath);
  if (args.prunePathKeys.has(beKey)) {
    openEnds.push({ symbol: args.seedSymbol, reason: "be_path_pruned", file: best.relativePath });
    return { ok: false, steps, openEnds, pathKeys, message: "pruned" };
  }
  steps.push({
    id: `disc_route_${best.line}`,
    edgeKind: "bridge",
    nodeKind: "be_controller",
    role: "bridge",
    title: `HTTP ${args.fePath}`,
    narrative: best.combinedPath
      ? `↔ ${best.combinedPath} @ ${best.relativePath}:${best.line}`
      : `↔ ${best.relativePath}:${best.line}`,
    file: best.relativePath,
    path: best.absolutePath,
    line: best.line,
    symbol: args.seedSymbol,
    preview: best.preview,
    confidence: "high",
    bridgeKind: "http_route"
  });
  pathKeys.add(beKey);
  return {
    ok: true,
    steps,
    openEnds,
    pathKeys,
    message: "route_matched",
    bridgeKind: "http_route"
  };
}

/**
 * Rule-based bootstrap: from seed file, pick API client calls and follow them.
 * No LLM required — covers ajax_invoice.pageQuery pattern.
 */
export async function ruleDiscoverApiFromSeed(args: {
  roots: string[];
  projectRoot: string;
  seedAbsolute: string;
  seedRelative: string;
  seedSymbol: string;
  prunePathKeys: Set<string>;
  signal?: AbortSignal;
  skipLlm?: boolean;
  systemLocale?: string;
  deadlineMs?: number;
  onProgress?: (msg: string) => void;
}): Promise<ActionResult> {
  const source = await readSafe(args.seedAbsolute);
  if (!source) {
    return { ok: false, steps: [], openEnds: [], pathKeys: new Set(), message: "unreadable" };
  }

  const calls = findApiClientCalls(source);
  // Prefer clients that look like ajax_/api_
  const ranked = [...calls].sort((a, b) => {
    const score = (c: string) =>
      (/^ajax_/i.test(c) ? 30 : 0) + (/^api/i.test(c) ? 20 : 0) + (c.length > 3 ? 5 : 0);
    return score(b.client) - score(a.client);
  });

  const allSteps: LinkGraphChainStep[] = [];
  const openEnds: LinkGraphOpenEnd[] = [];
  const pathKeys = new Set<string>();
  const urls: string[] = [];
  let anyOk = false;

  // Limit attempts
  const tried = new Set<string>();
  for (const call of ranked.slice(0, 8)) {
    if (args.signal?.aborted) break;
    const key = `${call.client}.${call.method}`;
    if (tried.has(key)) continue;
    tried.add(key);

    // Mention seed symbol near call? soft prefer lines near form / request
    const follow = await verifyFollowApiClient({
      roots: args.roots,
      projectRoot: args.projectRoot,
      fromAbsolute: args.seedAbsolute,
      client: call.client,
      method: call.method,
      seedSymbol: args.seedSymbol
    });
    if (!follow.ok && !follow.steps.length) continue;

    // Annotate call site step
    allSteps.push({
      id: `disc_call_${call.line}`,
      edgeKind: "refers",
      nodeKind: "api_client",
      role: "call",
      title: `Call ${call.client}.${call.method}`,
      narrative: call.preview,
      file: args.seedRelative,
      path: args.seedAbsolute,
      line: call.line,
      symbol: args.seedSymbol,
      preview: call.preview,
      confidence: "medium",
      bridgeKind: "api_client"
    });
    allSteps.push(...follow.steps);
    for (const k of follow.pathKeys) pathKeys.add(k);
    openEnds.push(...follow.openEnds);
    if (follow.urls?.length) {
      urls.push(...follow.urls);
      anyOk = true;
    }
  }

  // Endpoint match (rule + optional LLM 纵深) across all roots — excludes FE $post
  for (const url of [...new Set(urls)].slice(0, 4)) {
    if (args.signal?.aborted) break;
    args.onProgress?.(`Matching backend for ${url}…`);
    const route = await verifySearchRoute({
      roots: args.roots,
      projectRoot: args.projectRoot,
      fePath: url,
      seedSymbol: args.seedSymbol,
      prunePathKeys: args.prunePathKeys,
      signal: args.signal,
      useLlmMatch: true,
      skipLlm: args.skipLlm,
      systemLocale: args.systemLocale,
      deadlineMs: args.deadlineMs,
      chainSummary: allSteps.map((s) => `${s.file}:${s.line} ${s.title}`).join("\n"),
      onProgress: args.onProgress
    });
    allSteps.push(...route.steps);
    for (const k of route.pathKeys) pathKeys.add(k);
    openEnds.push(...route.openEnds);
    if (route.ok) {
      anyOk = true;
      // One solid BE match is enough for primary chain
      if (route.steps.some((s) => s.nodeKind === "be_controller" || s.nodeKind === "vo_field")) break;
    }
  }

  return {
    ok: anyOk || allSteps.some((s) => s.edgeKind === "bridge" || s.bridgeKind === "api_client"),
    steps: allSteps,
    openEnds,
    pathKeys,
    urls,
    message: anyOk ? "rule_discover_ok" : "rule_discover_partial",
    bridgeKind: anyOk ? "http_route" : "api_client"
  };
}
