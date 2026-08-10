/**
 * Link Graph: one-shot import dig + global branches + FE↔BE bridge.
 * LLM only narrates summary (does not invent edges).
 */

import * as path from "node:path";
import {
  chatCompletion,
  expandHome,
  llmConfigFromSettings,
  loadSettings,
  resolveEffectiveOutputLanguage
} from "@agent-resume/core";
import { digDefinitionChain } from "./definitionDig";
import { runDiscoverLoop } from "./discover/loop";
import { expandGlobalDefinitionBranches } from "./globalDefs";
import { tryHttpRouteBridge } from "./httpBridge";
import {
  isStopwordSymbol,
  normalizeLinkGraphSymbol,
  symbolSpecificity
} from "./nameFamily";
import { resolveLinkGraphSearchRoots } from "./searchRoots";
import type {
  LinkGraphAnalysis,
  LinkGraphAnalyzeArgs,
  LinkGraphAnalyzeResult,
  LinkGraphBranch,
  LinkGraphBridgeStatus,
  LinkGraphChainStep,
  LinkGraphHit,
  LinkGraphHop,
  LinkGraphOpenEnd,
  LinkGraphProgressEvent,
  LinkGraphStopReason
} from "../../shared/linkGraphTypes";

export {
  isStopwordSymbol,
  normalizeLinkGraphSymbol,
  symbolSpecificity
} from "./nameFamily";

const DEFAULT_TIME_BUDGET_MS = 45_000;
const DEFAULT_MAX_HOPS = 12;
const DEFAULT_MAX_BRANCHES = 80;
const ABSOLUTE_MAX_HITS = 400;

type ProgressEmitter = (event: Omit<LinkGraphProgressEvent, "requestId"> & { requestId?: string }) => void;

type SessionState = {
  requestId: string;
  projectPath: string;
  seed: LinkGraphAnalyzeResult["seed"];
  hits: LinkGraphHit[];
  primaryChain: LinkGraphChainStep[];
  branches: LinkGraphBranch[];
  openEnds: LinkGraphOpenEnd[];
  discardedCount: number;
  truncatedBranchCount: number;
  reachedDepth: number;
  engine: LinkGraphAnalyzeResult["engine"];
  primaryPathKeys: string[];
  bridgeStatus: LinkGraphBridgeStatus;
  stopReason: LinkGraphStopReason;
  truncated: boolean;
};

const sessions = new Map<string, SessionState>();
let activeAbort: AbortController | null = null;
let activeRequestId: string | null = null;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function resolveRoot(raw: string): string {
  return path.resolve(expandHome(raw.trim()));
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

function newRequestId(): string {
  return `lg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function stepsToHits(steps: LinkGraphChainStep[], branchId?: string): LinkGraphHit[] {
  const hits: LinkGraphHit[] = [];
  for (const [index, step] of steps.entries()) {
    hits.push({
      path: step.path,
      relativePath: step.file,
      line: step.line,
      column: step.column || 1,
      endColumn: step.endColumn || (step.column || 1) + step.symbol.length,
      preview: step.preview,
      depth: index,
      symbol: step.symbol,
      reason: step.bridgeKind ? `bridge:${step.bridgeKind}` : step.edgeKind,
      score: step.confidence === "high" ? 80 : step.confidence === "medium" ? 50 : 25,
      edgeKind: step.edgeKind,
      nodeKind: step.nodeKind,
      bridgeKind: step.bridgeKind,
      confidence: step.confidence,
      branchId
    });
    for (const ref of step.pageRefs || []) {
      hits.push({
        path: step.path,
        relativePath: step.file,
        line: ref.line,
        column: ref.column,
        endColumn: ref.endColumn,
        preview: ref.preview,
        depth: index,
        symbol: step.symbol,
        reason: "page_ref",
        score: 40,
        edgeKind: "refers",
        nodeKind: "reference",
        branchId
      });
    }
  }
  return hits;
}

function chainToHops(steps: LinkGraphChainStep[]): LinkGraphHop[] {
  return steps.map((step) => ({
    id: step.id,
    role: step.role,
    title: step.title,
    narrative: step.narrative || step.preview,
    file: step.file,
    line: step.line,
    confidence: step.confidence,
    bridgeKind: step.bridgeKind
  }));
}

function dedupeOpenEnds(items: LinkGraphOpenEnd[]): LinkGraphOpenEnd[] {
  const seen = new Set<string>();
  const out: LinkGraphOpenEnd[] = [];
  for (const item of items) {
    const key = `${item.reason}|${item.file || ""}|${item.line || ""}|${item.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 24);
}

/** Structural facts derived from primary chain — used to scrub stale openEnds and ground summary LLM. */
export function chainEvidenceFacts(primary: LinkGraphChainStep[]): {
  hasFeApiClient: boolean;
  hasHttpPath: boolean;
  hasBackendHandler: boolean;
  hasVoField: boolean;
} {
  const textOf = (s: LinkGraphChainStep) =>
    `${s.title} ${s.narrative || ""} ${s.preview || ""} ${s.file}`;

  // FE API module / ajax client: explicit markers OR api/* file on the chain (URL encapsulation)
  const hasFeApiClient = primary.some((s) => {
    const t = textOf(s);
    if (s.bridgeKind === "api_client" || s.nodeKind === "api_client") return true;
    if (/ajax_[\w$]*|API client|Call \w+\.\w+/i.test(t)) return true;
    if (s.edgeKind === "imports" && /(^|\/)api\//i.test(s.file)) return true;
    // invoice.ts / src/api/xxx.ts used as path step implies client encapsulation was found
    if (/(^|\/)api\/[^/]+\.(ts|js|tsx|jsx)$/i.test(s.file)) return true;
    if (/\$post\s*\(|\$get\s*\(|\$put\s*\(|\$delete\s*\(/i.test(t)) return true;
    return false;
  });

  const hasHttpPath = primary.some((s) => {
    const t = textOf(s);
    if (s.edgeKind === "bridge") return true;
    if (s.bridgeKind === "http_route" || s.bridgeKind === "openapi" || s.bridgeKind === "api_client") {
      return true;
    }
    // Absolute app path with ≥2 segments
    if (/\/[a-z][a-z0-9_-]*(?:\/[a-z0-9_.${}-]+)+/i.test(t)) return true;
    if (/\bURL\b|\bHTTP\b/i.test(t)) return true;
    return false;
  });

  const hasBackendHandler = primary.some((s) => {
    if (s.nodeKind === "be_controller") return true;
    if (/\.java$/i.test(s.file) || /Controller\.(java|ts|go)$/i.test(s.file)) return true;
    if (
      s.edgeKind === "bridge"
      && s.bridgeKind !== "api_client"
      && !/\.(ts|js|vue|tsx|jsx)$/i.test(s.file)
    ) {
      return true;
    }
    return false;
  });

  const hasVoField = primary.some(
    (s) => s.nodeKind === "vo_field" || s.terminal === true
  );

  // If we already have HTTP path, FE encapsulation is effectively resolved for summary purposes
  // (URL came from FE client module even if import step title is missing).
  return {
    hasFeApiClient: hasFeApiClient || hasHttpPath,
    hasHttpPath,
    hasBackendHandler,
    hasVoField
  };
}

/**
 * Drop open-end reasons that are contradicted by proven chain steps
 * (e.g. early no_fe_http_path after discover already found the URL).
 */
export function reconcileOpenEnds(
  primary: LinkGraphChainStep[],
  openEnds: LinkGraphOpenEnd[]
): LinkGraphOpenEnd[] {
  const facts = chainEvidenceFacts(primary);
  return openEnds.filter((o) => {
    const r = `${o.reason || ""} ${o.symbol || ""} ${o.file || ""}`;
    if (
      facts.hasHttpPath
      && /no_fe_http_path|no_be_route_match|no_be_endpoint|endpoint_match_empty|openapi_only|api_client|import_not_found|unresolved_api|客户端|HTTP 路径|http path/i.test(
        r
      )
    ) {
      return false;
    }
    if (
      facts.hasFeApiClient
      && /api_client|unresolved_api|import_not_found|客户端|ajax_/i.test(r)
    ) {
      return false;
    }
    if (
      facts.hasBackendHandler
      && /no_be_endpoint|no_be_route_match|endpoint_match_empty|be_path_pruned|Controller/i.test(r)
    ) {
      // keep only if clearly a different symbol gap
      if (/no_be_endpoint|no_be_route_match|endpoint_match_empty|be_path_pruned/i.test(o.reason || "")) {
        return false;
      }
    }
    if (facts.hasVoField && /field_not_on_type|definition_not_vo|type_not_found/i.test(o.reason || "")) {
      return false;
    }
    if (
      primary.length >= 3
      && /no_local_definition_or_import|symbol_not_found_in_file|definition_not_vo/i.test(o.reason || "")
    ) {
      return false;
    }
    return true;
  });
}

/** Strip summary sentences that contradict proven Facts (LLM sometimes ignores instructions). */
export function sanitizeLinkGraphSummary(
  summary: string,
  facts: ReturnType<typeof chainEvidenceFacts>
): string {
  let text = String(summary || "").trim();
  if (!text) return text;

  const dropPatterns: RegExp[] = [];
  if (facts.hasFeApiClient || facts.hasHttpPath) {
    dropPatterns.push(
      /[^。.!?\n]*(?:API\s*客户端|api\s*client|ajax_)[^。.!?\n]*(?:未找到|缺失|缺少|missing|not found|未解析)[^。.!?\n]*[。.!?]?/gi
    );
    dropPatterns.push(
      /[^。.!?\n]*(?:未找到|缺失|缺少|missing|not found)[^。.!?\n]*(?:API\s*客户端|api\s*client|前端调用|导入)[^。.!?\n]*[。.!?]?/gi
    );
  }
  if (facts.hasHttpPath) {
    dropPatterns.push(
      /[^。.!?\n]*(?:HTTP\s*路径|http path|接口路径|前端路径)[^。.!?\n]*(?:未找到|缺失|缺少|missing|not found)[^。.!?\n]*[。.!?]?/gi
    );
    dropPatterns.push(
      /[^。.!?\n]*(?:未找到|缺失|缺少|missing|not found)[^。.!?\n]*(?:HTTP|路径|路由|route)[^。.!?\n]*[。.!?]?/gi
    );
  }
  if (facts.hasBackendHandler) {
    dropPatterns.push(
      /[^。.!?\n]*(?:后端|handler|Controller)[^。.!?\n]*(?:未找到|缺失|缺少|未对接)[^。.!?\n]*[。.!?]?/gi
    );
  }
  if (facts.hasVoField) {
    dropPatterns.push(
      /[^。.!?\n]*(?:VO|DTO|查询对象)[^。.!?\n]*(?:未映射|未找到|缺少)[^。.!?\n]*[。.!?]?/gi
    );
  }

  for (const re of dropPatterns) {
    text = text.replace(re, "");
  }
  text = text
    .replace(/\s{2,}/g, " ")
    .replace(/[，,]\s*[，,]/g, "，")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*[，,。.]\s*/g, "")
    .trim();
  return text;
}

function fallbackFromChain(
  primary: LinkGraphChainStep[],
  branches: LinkGraphBranch[],
  openEnds: LinkGraphOpenEnd[],
  catalogLanguage: string,
  bridgeStatus: LinkGraphBridgeStatus,
  truncatedBranchCount: number
): LinkGraphAnalysis {
  const hops = chainToHops(primary);
  const isZh = /chinese|zh/i.test(catalogLanguage);
  const isJa = /japanese|ja/i.test(catalogLanguage);
  const branchLive = branches.filter((b) => !b.pruned).length;
  const facts = chainEvidenceFacts(primary);
  const reconciled = reconcileOpenEnds(primary, openEnds);
  const pathTitles = primary.map((s) => s.title).join(" → ");

  let summary: string;
  if (isZh) {
    summary = primary.length
      ? `主链 ${primary.length} 步：${pathTitles.slice(0, 280)}。旁支定义 ${branchLive} 条。`
      : "未找到可沿 import 深挖的定义链。";
    if (facts.hasFeApiClient) summary += " 已含前端 API 客户端。";
    if (facts.hasHttpPath) summary += " 已含 HTTP 路径。";
    if (facts.hasBackendHandler) summary += " 已对接后端 handler。";
    if (facts.hasVoField) summary += " 已定位 VO/DTO 字段。";
    if (!facts.hasHttpPath && bridgeStatus === "failed") summary += " 前后端桥接未成功。";
    else if (bridgeStatus === "partial" && !facts.hasVoField) summary += " 桥接部分完成。";
    if (reconciled.length) summary += ` 未闭合：${reconciled.slice(0, 4).map((o) => o.reason).join("、")}。`;
    if (truncatedBranchCount > 0) summary += ` 另有 ${truncatedBranchCount} 个全局定义因时间未挖。`;
  } else if (isJa) {
    summary = primary.length
      ? `主チェーン ${primary.length} 段。他定義 ${branchLive}。`
      : "定義チェーンなし。";
  } else {
    summary = primary.length
      ? `Primary chain ${primary.length} steps: ${pathTitles.slice(0, 280)}. ${branchLive} other definition branch(es).`
      : "No import-followable definition chain found.";
    if (facts.hasFeApiClient) summary += " FE API client present.";
    if (facts.hasHttpPath) summary += " HTTP path present.";
    if (facts.hasBackendHandler) summary += " Backend handler linked.";
    if (facts.hasVoField) summary += " VO/DTO field located.";
    if (!facts.hasHttpPath && bridgeStatus === "failed") summary += " FE↔BE bridge failed.";
    else if (bridgeStatus === "partial" && !facts.hasVoField) summary += " Bridge partial.";
    if (reconciled.length) summary += ` Open ends: ${reconciled.slice(0, 4).map((o) => o.reason).join(", ")}.`;
    if (truncatedBranchCount > 0) summary += ` ${truncatedBranchCount} global def(s) skipped by time budget.`;
  }

  return {
    summary: sanitizeLinkGraphSummary(summary, facts),
    complete: reconciled.length === 0 && truncatedBranchCount === 0,
    openEnds: reconciled.slice(0, 12),
    hops,
    confidence: primary.some((s) => s.terminal) ? "high" : "medium"
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

/** LLM: summary only — hops always structural; must respect Facts flags. */
async function runLlmSummaryOnly(args: {
  seedSymbol: string;
  seedRelativePath: string;
  primary: LinkGraphChainStep[];
  branches: LinkGraphBranch[];
  openEnds: LinkGraphOpenEnd[];
  catalogLanguage: string;
  bridgeStatus: LinkGraphBridgeStatus;
  systemLocale?: string;
  signal: AbortSignal;
}): Promise<{ summary: string | null; status: LinkGraphAnalyzeResult["llmStatus"]; error?: string }> {
  if (args.signal.aborted) return { summary: null, status: "skipped" };
  const settings = await loadSettings();
  const llm = llmConfigFromSettings(settings, args.systemLocale);
  if (!llm) return { summary: null, status: "unconfigured" };

  const facts = chainEvidenceFacts(args.primary);
  const openEnds = reconcileOpenEnds(args.primary, args.openEnds);

  const chainLines = args.primary
    .map((s) => {
      const bits = [
        s.edgeKind,
        s.bridgeKind || "",
        s.nodeKind || "",
        `${s.file}:${s.line}`,
        s.title
      ];
      const narr = (s.narrative || s.preview || "").replace(/\s+/g, " ").trim().slice(0, 120);
      return `- [${bits.filter(Boolean).join("|")}] ${narr}`;
    })
    .join("\n");

  const system = [
    "You write a short developer summary for a code Link Graph.",
    "Use ONLY Facts + Primary chain + remaining Open ends. Never invent files or lines.",
    "CRITICAL: If Facts.hasHttpPath is true, do NOT say HTTP path / route is missing.",
    "CRITICAL: If Facts.hasFeApiClient is true, do NOT say API client import is missing.",
    "CRITICAL: If Facts.hasBackendHandler is true, do NOT say backend handler was not found.",
    "CRITICAL: If Facts.hasVoField is true, do NOT say VO/DTO field was not mapped.",
    "Only mention gaps listed in remaining Open ends. Prefer describing what IS present.",
    `Write in ${args.catalogLanguage}.`,
    'Respond with ONE JSON object only: {"summary":"2-4 sentences"}'
  ].join("\n");

  const user = [
    `Seed: ${args.seedSymbol} @ ${args.seedRelativePath}`,
    `Facts: hasFeApiClient=${facts.hasFeApiClient} hasHttpPath=${facts.hasHttpPath} hasBackendHandler=${facts.hasBackendHandler} hasVoField=${facts.hasVoField} bridgeStatus=${args.bridgeStatus}`,
    "",
    "Primary chain (confirmed steps):",
    chainLines || "(empty)",
    "",
    `Other definition branches: ${args.branches.filter((b) => !b.pruned).length}`,
    `Remaining open ends (only these may be described as gaps): ${openEnds.map((o) => o.reason).join(", ") || "(none)"}`,
    "",
    "Return JSON now."
  ].join("\n");

  try {
    const content = await chatCompletion(
      llm,
      [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      800
    );
    const text = String(content || "");
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]) as { summary?: string };
        if (typeof parsed.summary === "string" && parsed.summary.trim()) {
          const cleaned = sanitizeLinkGraphSummary(parsed.summary.trim(), facts).slice(0, 800);
          return { summary: cleaned || parsed.summary.trim().slice(0, 800), status: "ok" };
        }
      } catch {
        /* fall through */
      }
    }
    const plain = text.replace(/```[\s\S]*?```/g, "").trim().slice(0, 800);
    if (plain) {
      const cleaned = sanitizeLinkGraphSummary(plain, facts);
      return { summary: cleaned || plain, status: "ok" };
    }
    return { summary: null, status: "failed", error: "Empty LLM summary" };
  } catch (error) {
    return {
      summary: null,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function cancelLinkGraphAnalyze(): { ok: boolean } {
  if (activeAbort && !activeAbort.signal.aborted) activeAbort.abort();
  activeAbort = null;
  activeRequestId = null;
  return { ok: true };
}

export function clearLinkGraphSessionsForTests(): void {
  sessions.clear();
  cancelLinkGraphAnalyze();
}

/** Kept for tests that parse analysis JSON with hops. */
export function repairCommonJsonIssues(text: string): string {
  return text
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^\uFEFF/, "");
}

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
  return [...new Set(out)];
}

export function parseLinkGraphAnalysis(
  raw: string,
  hits: LinkGraphHit[],
  incomplete: boolean
): LinkGraphAnalysis | null {
  // Minimal parser for tests / legacy — structural hops preferred in product path
  for (const candidate of collectJsonObjectCandidates(raw)) {
    for (const variant of [candidate, repairCommonJsonIssues(candidate)]) {
      try {
        const parsed = JSON.parse(variant) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") continue;
        const summary = typeof parsed.summary === "string" ? parsed.summary : "";
        const hopsRaw = Array.isArray(parsed.hops) ? parsed.hops : [];
        const hitKeys = new Set(hits.map((h) => `${h.relativePath}:${h.line}`));
        const hops: LinkGraphHop[] = [];
        for (const [i, hop] of hopsRaw.entries()) {
          if (!hop || typeof hop !== "object") continue;
          const r = hop as Record<string, unknown>;
          const file = typeof r.file === "string" ? r.file.replaceAll("\\", "/") : "";
          const line = typeof r.line === "number" ? r.line : Number(r.line);
          if (!file || !Number.isFinite(line)) continue;
          if (!hitKeys.has(`${file}:${line}`) && !hits.some((h) => h.relativePath.endsWith(file))) continue;
          hops.push({
            id: typeof r.id === "string" ? r.id : `h${i}`,
            role: "definition",
            title: typeof r.title === "string" ? r.title : file,
            narrative: typeof r.narrative === "string" ? r.narrative : "",
            file,
            line: Math.floor(line),
            confidence: "medium"
          });
        }
        return {
          summary: summary || hops.map((h) => h.title).join(" → "),
          complete: incomplete ? false : Boolean(parsed.complete),
          hops,
          confidence: "medium"
        };
      } catch {
        /* next */
      }
    }
  }
  return null;
}

async function runPipeline(args: {
  root: string;
  seed: LinkGraphAnalyzeResult["seed"];
  symbol: string;
  requestId: string;
  timeBudgetMs: number;
  maxHops: number;
  maxBranches: number;
  backendRoots?: string[];
  discoverMode?: "off" | "on_gap" | "always";
  skipLlm?: boolean;
  systemLocale?: string;
  signal: AbortSignal;
  onProgress: ProgressEmitter;
}): Promise<Omit<SessionState, "requestId" | "projectPath" | "seed">> {
  const started = Date.now();
  const openEnds: LinkGraphOpenEnd[] = [];
  let primaryChain: LinkGraphChainStep[] = [];
  let branches: LinkGraphBranch[] = [];
  let discardedCount = 0;
  let truncatedBranchCount = 0;
  let engine: LinkGraphAnalyzeResult["engine"] = "rg";
  let bridgeStatus: LinkGraphBridgeStatus = "skipped";
  const primaryPathKeys = new Set<string>();
  const primaryRelativePaths = new Set<string>();

  const searchRoots = await resolveLinkGraphSearchRoots(args.root, args.backendRoots);

  args.onProgress({
    requestId: args.requestId,
    phase: "searching",
    message: `Digging definition chain for ${args.symbol}`,
    hitCount: 0,
    reachedDepth: 0
  });

  const dig = await digDefinitionChain({
    root: args.root,
    startAbsolutePath: args.seed.filePath,
    startRelativePath: args.seed.relativePath,
    symbol: args.symbol,
    maxHops: args.maxHops,
    signal: args.signal
  });
  primaryChain = dig.steps;
  for (const k of dig.pathKeys) primaryPathKeys.add(k);
  for (const k of dig.importPathKeys) primaryPathKeys.add(k);
  for (const s of dig.steps) primaryRelativePaths.add(s.file);
  openEnds.push(...dig.openEnds);

  if (!args.signal.aborted && Date.now() - started < args.timeBudgetMs) {
    args.onProgress({
      requestId: args.requestId,
      phase: "searching",
      message: "Bridging FE ↔ BE…",
      hitCount: primaryChain.length,
      reachedDepth: primaryChain.length
    });
    // Try each root (FE first, then sibling BE)
    let bestBridge = await tryHttpRouteBridge({
      root: args.root,
      symbol: args.symbol,
      primarySteps: primaryChain,
      prunePathKeys: primaryPathKeys,
      signal: args.signal
    });
    for (const extraRoot of searchRoots.slice(1)) {
      if (args.signal.aborted || bestBridge.status === "ok") break;
      if (Date.now() - started >= args.timeBudgetMs) break;
      const attempt = await tryHttpRouteBridge({
        root: extraRoot,
        symbol: args.symbol,
        primarySteps: primaryChain,
        prunePathKeys: primaryPathKeys,
        signal: args.signal
      });
      if (
        attempt.status === "ok"
        || (attempt.status === "partial" && bestBridge.status !== "partial")
        || (attempt.steps.length > bestBridge.steps.length && attempt.status !== "failed")
      ) {
        bestBridge = attempt;
      }
    }
    bridgeStatus = bestBridge.status;
    if (bestBridge.steps.length) {
      primaryChain = [...primaryChain, ...bestBridge.steps];
      for (const k of bestBridge.pathKeys) primaryPathKeys.add(k);
      for (const s of bestBridge.steps) primaryRelativePaths.add(s.file);
    }
    openEnds.push(...bestBridge.openEnds);
  }

  // —— Discover: rule API follow + LLM propose/verify (on_gap / always) ——
  if (!args.signal.aborted && Date.now() - started < args.timeBudgetMs) {
    const discoverMode = args.discoverMode || "on_gap";
    args.onProgress({
      requestId: args.requestId,
      phase: "searching",
      message: "Smart discover (API / routes)…",
      hitCount: primaryChain.length,
      reachedDepth: primaryChain.length
    });
    const discovered = await runDiscoverLoop({
      roots: searchRoots,
      projectRoot: args.root,
      seedAbsolute: args.seed.filePath,
      seedRelative: args.seed.relativePath,
      seedSymbol: args.symbol,
      primarySteps: primaryChain,
      openEnds,
      prunePathKeys: primaryPathKeys,
      priorBridgeStatus: bridgeStatus,
      discoverMode,
      skipLlm: args.skipLlm,
      systemLocale: args.systemLocale,
      signal: args.signal,
      deadlineMs: started + args.timeBudgetMs,
      onProgress: (message) => {
        args.onProgress({
          requestId: args.requestId,
          phase: "searching",
          message,
          hitCount: primaryChain.length,
          reachedDepth: primaryChain.length
        });
      }
    });
    if (discovered.steps.length) {
      primaryChain = [...primaryChain, ...discovered.steps];
      for (const k of discovered.pathKeys) primaryPathKeys.add(k);
      for (const s of discovered.steps) primaryRelativePaths.add(s.file);
    }
    openEnds.push(...discovered.openEnds);
    if (discovered.bridgeStatus === "ok" || discovered.bridgeStatus === "partial") {
      bridgeStatus = discovered.bridgeStatus;
    } else if (bridgeStatus === "skipped" && discovered.steps.some((s) => s.bridgeKind === "api_client")) {
      bridgeStatus = "partial";
    }
  }

  if (!args.signal.aborted && Date.now() - started < args.timeBudgetMs) {
    args.onProgress({
      requestId: args.requestId,
      phase: "searching",
      message: `Scanning global definitions of ${args.symbol}`,
      hitCount: primaryChain.length,
      reachedDepth: primaryChain.length
    });

    // Global defs across all roots
    const allBranches: LinkGraphBranch[] = [];
    let disc = 0;
    let trunc = 0;
    for (const root of searchRoots) {
      if (args.signal.aborted || Date.now() - started >= args.timeBudgetMs) break;
      const global = await expandGlobalDefinitionBranches({
        root,
        symbol: args.symbol,
        primaryPathKeys,
        primaryRelativePaths,
        maxBranches: args.maxBranches,
        maxDigHops: args.maxHops,
        deadlineMs: started + args.timeBudgetMs,
        signal: args.signal,
        onBranchProgress: (current, total, file) => {
          args.onProgress({
            requestId: args.requestId,
            phase: "searching",
            message: `Digging branch ${current}/${total}: ${file}`,
            hitCount: primaryChain.length + current,
            reachedDepth: primaryChain.length
          });
        }
      });
      allBranches.push(...global.branches);
      disc += global.discardedCount;
      trunc += global.truncatedCount;
      openEnds.push(...global.openEnds);
      for (const b of global.branches) {
        for (const s of b.steps) primaryRelativePaths.add(s.file);
      }
    }
    branches = allBranches;
    discardedCount = disc;
    truncatedBranchCount = trunc;
    engine = "rg";
  }

  if (args.signal.aborted) {
    return {
      hits: stepsToHits(primaryChain).slice(0, ABSOLUTE_MAX_HITS),
      primaryChain,
      branches,
      openEnds: dedupeOpenEnds(openEnds),
      discardedCount,
      truncatedBranchCount,
      reachedDepth: Math.max(primaryChain.length - 1, 0),
      engine,
      primaryPathKeys: [...primaryPathKeys],
      bridgeStatus,
      stopReason: "cancelled",
      truncated: true
    };
  }

  const hits = [
    ...stepsToHits(primaryChain),
    ...branches.flatMap((b) => stepsToHits(b.steps, b.id))
  ].slice(0, ABSOLUTE_MAX_HITS);

  const truncated = truncatedBranchCount > 0;
  const stopReason: LinkGraphStopReason = truncated
    ? "time_budget"
    : primaryChain.length === 0
      ? "empty_seed"
      : bridgeStatus === "failed" && !primaryChain.some((s) => s.edgeKind === "bridge")
        ? "complete"
        : "complete";

  return {
    hits,
    primaryChain,
    branches,
    openEnds: dedupeOpenEnds(openEnds),
    discardedCount,
    truncatedBranchCount,
    reachedDepth: Math.max(primaryChain.length - 1, 0),
    engine,
    primaryPathKeys: [...primaryPathKeys],
    bridgeStatus,
    stopReason,
    truncated
  };
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

  const empty = (
    requestId: string,
    stopReason: LinkGraphStopReason,
    symbol: string,
    llmError?: string
  ): LinkGraphAnalyzeResult => ({
    requestId,
    seed: {
      selection: raw.selection || "",
      symbol,
      filePath,
      relativePath,
      startLine: Math.max(1, Math.floor(raw.startLine || 1)),
      endLine: Math.max(1, Math.floor(raw.endLine || raw.startLine || 1))
    },
    hits: [],
    primaryChain: [],
    branches: [],
    openEnds: [],
    analysis: null,
    reachedDepth: 0,
    stopReason,
    truncated: false,
    truncatedBranchCount: 0,
    complete: true,
    engine: "none",
    llmStatus: "skipped",
    llmError,
    bridgeStatus: "skipped"
  });

  if (!normalized) return empty(newRequestId(), "invalid_seed", "");

  const sessionId = typeof raw.sessionRequestId === "string" ? raw.sessionRequestId.trim() : "";
  let existing = sessionId ? sessions.get(sessionId) : undefined;
  if (existing && existing.projectPath !== projectPath) {
    sessions.delete(sessionId);
    existing = undefined;
  }

  if (raw.reanalyzeOnly) {
    if (!existing) {
      return empty(newRequestId(), "empty_seed", normalized.symbol, "Link Graph session expired — run analysis again");
    }
    const requestId = existing.requestId;
    activeRequestId = requestId;
    const settingsForLang = await loadSettings();
    const catalogLanguage = resolveLinkGraphCatalogLanguage(
      settingsForLang,
      typeof raw.outputLanguage === "string" ? raw.outputLanguage : undefined,
      options?.systemLocale
    );
    onProgress({
      requestId,
      phase: "analyzing",
      message: `Summarizing (${catalogLanguage})…`,
      hitCount: existing.hits.length,
      reachedDepth: existing.reachedDepth
    });
    const reconciledEnds = reconcileOpenEnds(existing.primaryChain, existing.openEnds);
    let analysis = fallbackFromChain(
      existing.primaryChain,
      existing.branches,
      reconciledEnds,
      catalogLanguage,
      existing.bridgeStatus,
      existing.truncatedBranchCount
    );
    let llmStatus: LinkGraphAnalyzeResult["llmStatus"] = "skipped";
    let llmError: string | undefined;
    if (!raw.skipLlm && existing.primaryChain.length) {
      const llm = await runLlmSummaryOnly({
        seedSymbol: existing.seed.symbol,
        seedRelativePath: existing.seed.relativePath,
        primary: existing.primaryChain,
        branches: existing.branches,
        openEnds: reconciledEnds,
        catalogLanguage,
        bridgeStatus: existing.bridgeStatus,
        systemLocale: options?.systemLocale,
        signal: controller.signal
      });
      llmStatus = llm.status;
      llmError = llm.error;
      if (llm.summary) analysis = { ...analysis, summary: llm.summary, openEnds: reconciledEnds };
    }
    onProgress({
      requestId,
      phase: "done",
      message: "Complete",
      hitCount: existing.hits.length,
      reachedDepth: existing.reachedDepth
    });
    activeAbort = null;
    activeRequestId = null;
    return {
      requestId,
      seed: existing.seed,
      hits: existing.hits,
      primaryChain: existing.primaryChain,
      branches: existing.branches,
      openEnds: reconciledEnds,
      analysis,
      reachedDepth: existing.reachedDepth,
      stopReason: existing.stopReason,
      truncated: existing.truncated,
      truncatedBranchCount: existing.truncatedBranchCount,
      complete: true,
      engine: existing.engine,
      llmStatus,
      llmError,
      discardedCount: existing.discardedCount,
      bridgeStatus: existing.bridgeStatus
    };
  }

  const requestId = newRequestId();
  activeRequestId = requestId;
  const settingsForLang = await loadSettings();
  const catalogLanguage = resolveLinkGraphCatalogLanguage(
    settingsForLang,
    typeof raw.outputLanguage === "string" ? raw.outputLanguage : undefined,
    options?.systemLocale
  );

  const timeBudgetMs = clampInt(raw.timeBudgetMs, DEFAULT_TIME_BUDGET_MS, 5_000, 120_000);
  const maxHops = clampInt(raw.maxHops, DEFAULT_MAX_HOPS, 3, 24);
  const maxBranches = clampInt(raw.maxBranches, DEFAULT_MAX_BRANCHES, 8, 120);
  const discoverMode =
    raw.discoverMode === "off" || raw.discoverMode === "always" ? raw.discoverMode : "on_gap";

  const seed = {
    selection: raw.selection.trim(),
    symbol: normalized.symbol,
    filePath,
    relativePath,
    startLine: Math.max(1, Math.floor(raw.startLine || 1)),
    endLine: Math.max(1, Math.floor(raw.endLine || raw.startLine || 1))
  };

  onProgress({
    requestId,
    phase: "searching",
    message: `Link graph: ${seed.symbol}`,
    hitCount: 0,
    reachedDepth: 0
  });

  try {
    const result = await runPipeline({
      root: projectPath,
      seed,
      symbol: seed.symbol,
      requestId,
      timeBudgetMs,
      maxHops,
      maxBranches,
      backendRoots: Array.isArray(raw.backendRoots) ? raw.backendRoots : undefined,
      discoverMode,
      skipLlm: raw.skipLlm,
      systemLocale: options?.systemLocale,
      signal: controller.signal,
      onProgress
    });

    const session: SessionState = {
      requestId,
      projectPath,
      seed,
      ...result
    };
    sessions.set(requestId, session);
    if (sessions.size > 8) {
      const oldest = sessions.keys().next().value;
      if (oldest && oldest !== requestId) sessions.delete(oldest);
    }

    onProgress({
      requestId,
      phase: "analyzing",
      message: `Summarizing (${catalogLanguage})…`,
      hitCount: session.hits.length,
      reachedDepth: session.reachedDepth
    });

    const reconciledEnds = reconcileOpenEnds(session.primaryChain, session.openEnds);
    let analysis = fallbackFromChain(
      session.primaryChain,
      session.branches,
      reconciledEnds,
      catalogLanguage,
      session.bridgeStatus,
      session.truncatedBranchCount
    );
    let llmStatus: LinkGraphAnalyzeResult["llmStatus"] = "skipped";
    let llmError: string | undefined;
    if (!raw.skipLlm && session.primaryChain.length > 0) {
      const llm = await runLlmSummaryOnly({
        seedSymbol: seed.symbol,
        seedRelativePath: seed.relativePath,
        primary: session.primaryChain,
        branches: session.branches,
        openEnds: reconciledEnds,
        catalogLanguage,
        bridgeStatus: session.bridgeStatus,
        systemLocale: options?.systemLocale,
        signal: controller.signal
      });
      llmStatus = llm.status;
      llmError = llm.error;
      if (llm.summary) analysis = { ...analysis, summary: llm.summary, openEnds: reconciledEnds };
    }

    onProgress({
      requestId,
      phase: "done",
      message: session.stopReason === "time_budget" ? "Timed out" : "Complete",
      hitCount: session.hits.length,
      reachedDepth: session.reachedDepth
    });

    return {
      requestId,
      seed,
      hits: session.hits,
      primaryChain: session.primaryChain,
      branches: session.branches,
      openEnds: reconciledEnds,
      analysis,
      reachedDepth: session.reachedDepth,
      stopReason: session.stopReason,
      truncated: session.truncated,
      truncatedBranchCount: session.truncatedBranchCount,
      complete: true,
      engine: session.engine,
      llmStatus,
      llmError,
      discardedCount: session.discardedCount,
      bridgeStatus: session.bridgeStatus
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
    if (activeAbort === controller) activeAbort = null;
    if (activeRequestId === requestId) activeRequestId = null;
  }
}
