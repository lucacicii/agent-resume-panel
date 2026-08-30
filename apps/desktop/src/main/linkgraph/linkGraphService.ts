/**
 * Desktop Link Graph shell — IPC / progress / cancel only.
 * Engine: `@agent-resume/core` `runLinkGraphTrace` (same as MCP `link_graph_trace`).
 */

import * as path from "node:path";
import {
  expandHome,
  loadSettings,
  normalizeLinkGraphSymbol,
  resolveEffectiveOutputLanguage,
  runLinkGraphTrace
} from "@agent-resume/core";
import {
  mapBridgeStatus,
  mapCoreStepToDesktop,
  mapCoreTimeline,
  mapCoreTraceToAnalysis,
  stepsToHits
} from "./mapCoreTrace";
import type {
  LinkGraphAnalyzeArgs,
  LinkGraphAnalyzeResult,
  LinkGraphProgressEvent,
  LinkGraphStopReason
} from "../../shared/linkGraphTypes";

export { normalizeLinkGraphSymbol } from "@agent-resume/core";

const DEFAULT_TIME_BUDGET_MS = 90_000;

type ProgressEmitter = (
  event: Omit<LinkGraphProgressEvent, "requestId"> & { requestId?: string }
) => void;

let activeAbort: AbortController | null = null;

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

function emptyResult(
  requestId: string,
  seed: LinkGraphAnalyzeResult["seed"],
  stopReason: LinkGraphStopReason,
  llmError?: string,
  llmStatus: LinkGraphAnalyzeResult["llmStatus"] = "skipped"
): LinkGraphAnalyzeResult {
  return {
    requestId,
    seed,
    hits: [],
    primaryChain: [],
    openEnds: [],
    analysis: null,
    reachedDepth: 0,
    stopReason,
    complete: true,
    engine: "none",
    llmStatus,
    llmError,
    bridgeStatus: "skipped",
    timeline: []
  };
}

export function cancelLinkGraphAnalyze(): { ok: boolean } {
  if (activeAbort && !activeAbort.signal.aborted) activeAbort.abort();
  activeAbort = null;
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

  const seedBase: LinkGraphAnalyzeResult["seed"] = {
    selection: (raw.selection || "").trim(),
    symbol: normalized?.symbol || "",
    filePath,
    relativePath,
    startLine: Math.max(1, Math.floor(raw.startLine || 1)),
    endLine: Math.max(1, Math.floor(raw.endLine || raw.startLine || 1))
  };

  if (!normalized) {
    return emptyResult(newRequestId(), seedBase, "invalid_seed");
  }

  const requestId = newRequestId();
  const seed = { ...seedBase, symbol: normalized.symbol };

  const settings = await loadSettings();
  const catalogLanguage = resolveEffectiveOutputLanguage({
    outputPreference:
      raw.outputLanguage && raw.outputLanguage !== "auto"
        ? raw.outputLanguage
        : settings.llmOptions?.tool?.outputLanguage,
    uiPreference: settings.uiLanguage,
    systemLocale: options?.systemLocale
  }).catalogLanguage;

  const timeBudgetMs = clampInt(raw.timeBudgetMs, DEFAULT_TIME_BUDGET_MS, 5_000, 180_000);
  const backendRoots = Array.isArray(raw.backendRoots) ? raw.backendRoots : undefined;

  onProgress({
    requestId,
    phase: "searching",
    message: `Link graph: ${seed.symbol}`,
    hitCount: 0,
    reachedDepth: 0,
    timeline: []
  });

  try {
    const trace = await runLinkGraphTrace({
      workspaceRoot: projectPath,
      symbol: seed.symbol,
      selection: seed.selection || seed.symbol,
      filePath,
      line: seed.startLine,
      language: catalogLanguage,
      backendRoots,
      timeBudgetMs,
      signal: controller.signal,
      onTimeline: (timeline, message) => {
        onProgress({
          requestId,
          phase: "searching",
          message: message || "Link graph…",
          hitCount: 0,
          reachedDepth: 0,
          timeline: mapCoreTimeline(timeline)
        });
      }
    });

    if (controller.signal.aborted) {
      return emptyResult(requestId, seed, "cancelled");
    }

    const unconfigured = Boolean(trace.error && /unconfigured/i.test(trace.error));
    const primaryChain = trace.primaryChain.map(mapCoreStepToDesktop);
    const timeline = mapCoreTimeline(trace.timeline);
    const analysis = mapCoreTraceToAnalysis(trace);
    const hits = stepsToHits(primaryChain);

    const llmStatus: LinkGraphAnalyzeResult["llmStatus"] = unconfigured
      ? "unconfigured"
      : primaryChain.length
        ? "ok"
        : "failed";

    const stopReason: LinkGraphStopReason = primaryChain.length ? "complete" : "empty_seed";

    const result: LinkGraphAnalyzeResult = {
      requestId,
      seed,
      hits,
      primaryChain,
      openEnds: trace.openEnds,
      analysis,
      reachedDepth: Math.max(0, primaryChain.length - 1),
      stopReason,
      complete: true,
      engine: "llm_agent",
      llmStatus,
      llmError: trace.error,
      bridgeStatus: mapBridgeStatus(trace.bridgeStatus),
      timeline
    };

    onProgress({
      requestId,
      phase: "done",
      message: trace.ok ? "Complete" : trace.error || "Incomplete",
      hitCount: hits.length,
      reachedDepth: result.reachedDepth,
      timeline
    });

    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      return emptyResult(requestId, seed, "cancelled");
    }
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
  }
}
