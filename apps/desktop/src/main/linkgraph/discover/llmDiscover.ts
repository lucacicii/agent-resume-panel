/**
 * LLM proposes discover hypotheses; tools verify (never invent file:line).
 */

import {
  chatCompletion,
  llmConfigFromSettings,
  loadSettings
} from "@agent-resume/core";
import type { DiscoverHypothesis } from "./actions";
import type { LinkGraphChainStep, LinkGraphOpenEnd } from "../../../shared/linkGraphTypes";

export type DiscoverContext = {
  seedSymbol: string;
  seedRelativePath: string;
  seedSnippet: string;
  chainSummary: string;
  importsSummary: string;
  apiCallsSummary: string;
  openEnds: string[];
  failedActions: string[];
  knownUrls: string[];
};

function parseHypotheses(raw: string): DiscoverHypothesis[] {
  const text = String(raw || "").trim();
  if (!text) return [];
  const candidates: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) candidates.push(brace[0]);
  candidates.push(text);

  for (const c of candidates) {
    try {
      const repaired = c.replace(/,\s*([}\]])/g, "$1");
      const parsed = JSON.parse(repaired) as { hypotheses?: unknown };
      if (!parsed || !Array.isArray(parsed.hypotheses)) continue;
      const out: DiscoverHypothesis[] = [];
      for (const h of parsed.hypotheses) {
        if (!h || typeof h !== "object") continue;
        const rec = h as Record<string, unknown>;
        const kind = rec.kind;
        if (
          kind !== "follow_api_client"
          && kind !== "extract_url"
          && kind !== "search_route"
          && kind !== "open_import"
          && kind !== "stop"
        ) {
          continue;
        }
        const args = (rec.args && typeof rec.args === "object" ? rec.args : {}) as DiscoverHypothesis["args"];
        out.push({
          kind,
          reason: typeof rec.reason === "string" ? rec.reason.slice(0, 240) : "",
          confidence:
            rec.confidence === "high" || rec.confidence === "low" ? rec.confidence : "medium",
          args: {
            symbol: typeof args.symbol === "string" ? args.symbol : undefined,
            method: typeof args.method === "string" ? args.method : undefined,
            fromFile: typeof args.fromFile === "string" ? args.fromFile : undefined,
            query: typeof args.query === "string" ? args.query : undefined,
            pathHint: typeof args.pathHint === "string" ? args.pathHint : undefined,
            specifier: typeof args.specifier === "string" ? args.specifier : undefined
          },
          evidence: Array.isArray(rec.evidence)
            ? rec.evidence.filter((x): x is string => typeof x === "string").slice(0, 6)
            : undefined
        });
      }
      if (out.length) return out.slice(0, 4);
    } catch {
      /* next */
    }
  }
  return [];
}

export async function proposeDiscoverHypotheses(args: {
  ctx: DiscoverContext;
  systemLocale?: string;
  signal?: AbortSignal;
}): Promise<{
  hypotheses: DiscoverHypothesis[];
  status: "ok" | "unconfigured" | "failed" | "skipped";
  error?: string;
}> {
  if (args.signal?.aborted) return { hypotheses: [], status: "skipped" };
  const settings = await loadSettings();
  const llm = llmConfigFromSettings(settings, args.systemLocale);
  if (!llm) return { hypotheses: [], status: "unconfigured" };

  const system = [
    "You are a senior full-stack engineer exploring a code link graph.",
    "Given evidence, propose the next discovery steps to connect a form field to its API and backend.",
    "Respond with ONE JSON object only. No markdown fences.",
    'Shape: {"hypotheses":[{"kind":"follow_api_client|extract_url|search_route|open_import|stop","reason":"...","confidence":"high|medium|low","args":{"symbol":"ajax_invoice","method":"pageQuery","query":"/manager/invoice/pageQuery"},"evidence":["file:line"]}]}',
    "Max 3 hypotheses. Prefer follow_api_client when you see ajax_*/api*.method(params).",
    "Prefer search_route when a URL path is already known.",
    "Use stop when the chain looks complete or no useful next hop.",
    "Do NOT invent absolute paths. Use only symbols/paths visible in evidence."
  ].join("\n");

  const user = [
    `Seed symbol: ${args.ctx.seedSymbol}`,
    `Seed file: ${args.ctx.seedRelativePath}`,
    "",
    "Seed snippet:",
    args.ctx.seedSnippet.slice(0, 3500),
    "",
    "Current chain:",
    args.ctx.chainSummary.slice(0, 1500) || "(empty)",
    "",
    "Imports:",
    args.ctx.importsSummary.slice(0, 800) || "(none)",
    "",
    "API-like calls in seed file:",
    args.ctx.apiCallsSummary.slice(0, 800) || "(none)",
    "",
    "Known URLs:",
    args.ctx.knownUrls.join(", ") || "(none)",
    "",
    "Open ends:",
    args.ctx.openEnds.join(", ") || "(none)",
    "",
    "Already failed:",
    args.ctx.failedActions.join(", ") || "(none)",
    "",
    "Return JSON hypotheses now."
  ].join("\n");

  try {
    const content = await chatCompletion(
      llm,
      [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      900
    );
    const hypotheses = parseHypotheses(content);
    if (!hypotheses.length) {
      return { hypotheses: [], status: "failed", error: "No valid hypotheses JSON" };
    }
    return { hypotheses, status: "ok" };
  } catch (error) {
    return {
      hypotheses: [],
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function buildChainSummary(steps: LinkGraphChainStep[]): string {
  return steps
    .map((s) => `- [${s.edgeKind}] ${s.file}:${s.line} ${s.title}`)
    .join("\n");
}

export function buildOpenEndsSummary(openEnds: LinkGraphOpenEnd[]): string[] {
  return openEnds.map((o) => o.reason + (o.file ? `@${o.file}` : ""));
}
