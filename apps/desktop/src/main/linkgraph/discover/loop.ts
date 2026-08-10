/**
 * Discover loop: rule bootstrap + optional LLM propose → tool verify.
 */

import * as fs from "node:fs/promises";
import {
  findApiClientCalls,
  ruleDiscoverApiFromSeed,
  verifyFollowApiClient,
  verifySearchRoute
} from "./actions";
import {
  buildChainSummary,
  buildOpenEndsSummary,
  proposeDiscoverHypotheses
} from "./llmDiscover";
import { parseImportsForFile } from "../importResolve";
import type {
  LinkGraphBridgeStatus,
  LinkGraphChainStep,
  LinkGraphOpenEnd
} from "../../../shared/linkGraphTypes";

export type DiscoverLoopResult = {
  steps: LinkGraphChainStep[];
  openEnds: LinkGraphOpenEnd[];
  pathKeys: Set<string>;
  bridgeStatus: LinkGraphBridgeStatus;
  llmStatus: "skipped" | "ok" | "unconfigured" | "failed";
  llmError?: string;
  urls: string[];
};

async function readSnippet(abs: string, maxChars = 4000): Promise<string> {
  try {
    const text = await fs.readFile(abs, "utf8");
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  } catch {
    return "";
  }
}

function isRealBackendHandlerStep(s: LinkGraphChainStep): boolean {
  if (s.nodeKind === "vo_field" && s.terminal) return true;
  if (s.nodeKind !== "be_controller" && s.edgeKind !== "bridge") return false;
  // FE api modules are not backend handlers
  if (/\.(ts|js|vue|tsx|jsx)$/i.test(s.file) && /(^|\/)api\//i.test(s.file)) return false;
  if (/\$post|\$get/i.test(s.preview || "")) return false;
  return s.bridgeKind === "http_route" || s.bridgeKind === "llm_discover" || s.nodeKind === "be_controller";
}

function shouldRunDiscover(
  mode: "off" | "on_gap" | "always",
  bridgeStatus: LinkGraphBridgeStatus,
  steps: LinkGraphChainStep[]
): boolean {
  if (mode === "off") return false;
  if (mode === "always") return true;
  // on_gap: run unless we already have a real BE handler + field
  if (bridgeStatus === "ok" && steps.some(isRealBackendHandlerStep) && steps.some((s) => s.terminal || s.nodeKind === "vo_field")) {
    return false;
  }
  if (bridgeStatus === "failed" || bridgeStatus === "skipped" || bridgeStatus === "partial") return true;
  if (!steps.some((s) => s.bridgeKind === "api_client" || (s.narrative && s.narrative.includes("/")))) return true;
  return true;
}

export async function runDiscoverLoop(args: {
  roots: string[];
  projectRoot: string;
  seedAbsolute: string;
  seedRelative: string;
  seedSymbol: string;
  primarySteps: LinkGraphChainStep[];
  openEnds: LinkGraphOpenEnd[];
  prunePathKeys: Set<string>;
  priorBridgeStatus: LinkGraphBridgeStatus;
  discoverMode: "off" | "on_gap" | "always";
  skipLlm?: boolean;
  systemLocale?: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  onProgress?: (message: string) => void;
}): Promise<DiscoverLoopResult> {
  const empty: DiscoverLoopResult = {
    steps: [],
    openEnds: [],
    pathKeys: new Set(),
    bridgeStatus: args.priorBridgeStatus,
    llmStatus: "skipped",
    urls: []
  };

  if (!shouldRunDiscover(args.discoverMode, args.priorBridgeStatus, args.primarySteps)) {
    return empty;
  }

  const steps: LinkGraphChainStep[] = [];
  const openEnds: LinkGraphOpenEnd[] = [...args.openEnds];
  const pathKeys = new Set<string>();
  const urls: string[] = [];
  const failedActions: string[] = [];
  let bridgeStatus: LinkGraphBridgeStatus = args.priorBridgeStatus;
  let llmStatus: DiscoverLoopResult["llmStatus"] = "skipped";
  let llmError: string | undefined;

  // —— Rule bootstrap (no LLM): ajax_*.method → api module → URL → BE ——
  args.onProgress?.("Discovering API client calls…");
  const rule = await ruleDiscoverApiFromSeed({
    roots: args.roots,
    projectRoot: args.projectRoot,
    seedAbsolute: args.seedAbsolute,
    seedRelative: args.seedRelative,
    seedSymbol: args.seedSymbol,
    prunePathKeys: args.prunePathKeys,
    signal: args.signal,
    skipLlm: args.skipLlm,
    systemLocale: args.systemLocale,
    deadlineMs: args.deadlineMs,
    onProgress: args.onProgress
  });
  steps.push(...rule.steps);
  for (const k of rule.pathKeys) pathKeys.add(k);
  openEnds.push(...rule.openEnds);
  if (rule.urls?.length) urls.push(...rule.urls);

  const hasRealBeHandler = steps.some(
    (s) =>
      (s.nodeKind === "be_controller" || s.bridgeKind === "http_route" || s.bridgeKind === "llm_discover")
      && !/\.(ts|js|vue|tsx)$/i.test(s.file)
      && !/\/api\//i.test(s.file)
  );
  const hasVoField = steps.some((s) => s.nodeKind === "vo_field" || s.terminal);

  if (hasRealBeHandler && hasVoField) {
    bridgeStatus = "ok";
  } else if (hasRealBeHandler || rule.urls?.length) {
    bridgeStatus = "partial";
  } else if (rule.steps.some((s) => s.bridgeKind === "api_client")) {
    bridgeStatus = bridgeStatus === "failed" || bridgeStatus === "skipped" ? "partial" : bridgeStatus;
  }

  // Endpoint match already ran LLM 纵深 inside verifySearchRoute; only continue if still gapped
  if (hasRealBeHandler && hasVoField) {
    return {
      steps,
      openEnds,
      pathKeys,
      bridgeStatus: "ok",
      llmStatus: args.skipLlm ? "skipped" : "ok",
      urls: [...new Set(urls)]
    };
  }

  if (args.skipLlm) {
    return {
      steps,
      openEnds,
      pathKeys,
      bridgeStatus,
      llmStatus: "skipped",
      urls: [...new Set(urls)]
    };
  }

  // If we have URLs but no real BE handler yet, force endpoint match again with LLM
  if (urls.length && !hasRealBeHandler) {
    args.onProgress?.("LLM matching backend endpoint…");
    const { runEndpointMatchLoop } = await import("./llmMatch");
    for (const url of [...new Set(urls)].slice(0, 2)) {
      const matched = await runEndpointMatchLoop({
        roots: args.roots,
        projectRoot: args.projectRoot,
        fePath: url,
        seedSymbol: args.seedSymbol,
        chainSummary: buildChainSummary([...args.primarySteps, ...steps]),
        prunePathKeys: pathKeys,
        skipLlm: false,
        systemLocale: args.systemLocale,
        signal: args.signal,
        deadlineMs: args.deadlineMs,
        onProgress: args.onProgress
      });
      steps.push(...matched.steps);
      for (const k of matched.pathKeys) pathKeys.add(k);
      openEnds.push(...matched.openEnds);
      if (matched.llmStatus === "ok") llmStatus = "ok";
      if (matched.llmError) llmError = matched.llmError;
      if (matched.bridgeStatus === "ok" || matched.bridgeStatus === "partial") {
        bridgeStatus = matched.bridgeStatus;
      }
      if (matched.bridgeStatus === "ok") break;
    }
    return {
      steps,
      openEnds,
      pathKeys,
      bridgeStatus,
      llmStatus,
      llmError,
      urls: [...new Set(urls)]
    };
  }

  // —— LLM propose / verify rounds ——
  const seedSnippet = await readSnippet(args.seedAbsolute);
  const imports = parseImportsForFile(seedSnippet, args.seedAbsolute);
  const importsSummary = imports
    .slice(0, 20)
    .map((b) => `${b.localName} ← ${b.specifier}`)
    .join("\n");
  const apiCalls = findApiClientCalls(seedSnippet);
  const apiCallsSummary = apiCalls
    .slice(0, 15)
    .map((c) => `L${c.line}: ${c.client}.${c.method}`)
    .join("\n");

  const maxRounds = 4;
  for (let round = 0; round < maxRounds; round += 1) {
    if (args.signal?.aborted) break;
    if (args.deadlineMs && Date.now() >= args.deadlineMs) break;

    args.onProgress?.(`LLM discover round ${round + 1}…`);
    const proposed = await proposeDiscoverHypotheses({
      ctx: {
        seedSymbol: args.seedSymbol,
        seedRelativePath: args.seedRelative,
        seedSnippet,
        chainSummary: buildChainSummary([...args.primarySteps, ...steps]),
        importsSummary,
        apiCallsSummary,
        openEnds: buildOpenEndsSummary(openEnds),
        failedActions,
        knownUrls: [...new Set(urls)]
      },
      systemLocale: args.systemLocale,
      signal: args.signal
    });

    llmStatus = proposed.status === "ok" ? "ok" : proposed.status;
    if (proposed.error) llmError = proposed.error;
    if (proposed.status === "unconfigured" || proposed.status === "failed") break;
    if (!proposed.hypotheses.length) break;

    let stop = false;
    for (const h of proposed.hypotheses) {
      if (args.signal?.aborted) break;
      const actionKey = `${h.kind}:${h.args.symbol || ""}:${h.args.method || ""}:${h.args.query || h.args.pathHint || ""}`;
      if (failedActions.includes(actionKey)) continue;

      if (h.kind === "stop") {
        stop = true;
        break;
      }

      if (h.kind === "follow_api_client") {
        const client = h.args.symbol;
        const method = h.args.method;
        if (!client || !method) {
          failedActions.push(actionKey);
          continue;
        }
        const res = await verifyFollowApiClient({
          roots: args.roots,
          projectRoot: args.projectRoot,
          fromAbsolute: args.seedAbsolute,
          client,
          method,
          seedSymbol: args.seedSymbol
        });
        if (!res.ok && !res.steps.length) {
          failedActions.push(actionKey);
          openEnds.push(...res.openEnds);
          continue;
        }
        steps.push(...res.steps);
        for (const k of res.pathKeys) pathKeys.add(k);
        if (res.urls?.length) urls.push(...res.urls);
        openEnds.push(...res.openEnds);
        if (res.urls?.length) bridgeStatus = bridgeStatus === "ok" ? "ok" : "partial";
        continue;
      }

      if (h.kind === "search_route" || h.kind === "extract_url") {
        const pathHint = h.args.query || h.args.pathHint || urls[0];
        if (!pathHint) {
          failedActions.push(actionKey);
          continue;
        }
        if (!urls.includes(pathHint) && pathHint.startsWith("/")) urls.push(pathHint);
        const res = await verifySearchRoute({
          roots: args.roots,
          projectRoot: args.projectRoot,
          fePath: pathHint.startsWith("/") ? pathHint : `/${pathHint}`,
          seedSymbol: args.seedSymbol,
          prunePathKeys: args.prunePathKeys,
          signal: args.signal
        });
        steps.push(...res.steps);
        for (const k of res.pathKeys) pathKeys.add(k);
        openEnds.push(...res.openEnds);
        if (res.ok) {
          bridgeStatus = res.steps.some((s) => s.terminal) ? "ok" : "partial";
        } else {
          failedActions.push(actionKey);
        }
        continue;
      }

      // open_import not fully separate in P0 — fold into follow_api_client
      failedActions.push(actionKey);
    }

    if (stop) break;
    if (bridgeStatus === "ok") break;
    // If we gained URLs, try one more automatic search_route without LLM
    for (const url of [...new Set(urls)].slice(0, 4)) {
      if (args.signal?.aborted) break;
      const key = `auto_route:${url}`;
      if (failedActions.includes(key)) continue;
      const res = await verifySearchRoute({
        roots: args.roots,
        projectRoot: args.projectRoot,
        fePath: url,
        seedSymbol: args.seedSymbol,
        prunePathKeys: new Set([...args.prunePathKeys, ...pathKeys]),
        signal: args.signal
      });
      if (res.ok) {
        steps.push(...res.steps);
        for (const k of res.pathKeys) pathKeys.add(k);
        openEnds.push(...res.openEnds);
        bridgeStatus = res.steps.some((s) => s.terminal) ? "ok" : "partial";
        break;
      }
      failedActions.push(key);
    }
    if (bridgeStatus === "ok" || bridgeStatus === "partial") break;
  }

  return {
    steps,
    openEnds,
    pathKeys,
    bridgeStatus,
    llmStatus,
    llmError,
    urls: [...new Set(urls)]
  };
}

/** Exported for tests */
export function __testShouldRunDiscover(
  mode: "off" | "on_gap" | "always",
  bridgeStatus: LinkGraphBridgeStatus,
  steps: LinkGraphChainStep[] = []
): boolean {
  return shouldRunDiscover(mode, bridgeStatus, steps);
}
