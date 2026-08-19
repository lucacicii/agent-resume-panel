/**
 * MCP tool adapter for link_graph_trace.
 * Independent of Notes / Session / Flow tool contexts.
 */

import { z } from "zod";
import { runLinkGraphTrace } from "../linkgraph/agent";
import type { LinkGraphTraceResult } from "../linkgraph/types";

/** MCP content envelope — not tied to NoteToolContext. */
export type LinkGraphMcpResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export const linkGraphTraceSchema = z.object({
  workspaceRoot: z
    .string()
    .optional()
    .describe("Absolute path to the workspace or monorepo root (e.g. /Users/…/my-app). Defaults to the conversation's project workspace when omitted."),
  symbol: z.string().describe("Seed symbol / field name to trace (e.g. deliveryNum)"),
  filePath: z
    .string()
    .optional()
    .describe("Optional absolute or workspace-relative start file (strongly recommended)"),
  line: z.number().int().positive().optional().describe("Optional 1-based line in filePath"),
  selection: z.string().optional().describe("Optional selection text; defaults to symbol"),
  language: z.string().optional().describe("Summary language preference: auto | zh-cn | en | ja"),
  backendRoots: z
    .array(z.string())
    .optional()
    .describe("Optional extra roots to search for backend code"),
  timeBudgetMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Wall-clock budget in ms (default 90000)"),
  compact: z
    .boolean()
    .optional()
    .describe("Return a condensed summary (chain + summary) instead of the full primaryChain/timeline")
});

export type LinkGraphTraceInput = z.infer<typeof linkGraphTraceSchema>;

function mcpPayload(result: LinkGraphTraceResult, compact: boolean): Record<string, unknown> {
  const message = result.ok
    ? `Link graph for ${result.seed.symbol}: ${result.primaryChain.length} steps, bridge=${result.bridgeStatus}`
    : `Link graph failed: ${result.error || "unknown error"}`;

  const base: Record<string, unknown> = {
    ok: result.ok,
    message,
    engine: result.engine,
    seed: result.seed,
    workspaceRoot: result.workspaceRoot,
    summary: result.summary,
    bridgeStatus: result.bridgeStatus,
    facts: result.facts,
    openEnds: result.openEnds,
    error: result.error
  };

  if (compact) {
    return {
      ...base,
      chain: result.primaryChain.map((s) => `${s.title} @ ${s.file}:${s.line}`)
    };
  }

  return {
    ...base,
    primaryChain: result.primaryChain,
    timeline: result.timeline
  };
}

/**
 * Handle link_graph_trace. No NotesStore / catalog / session injection required —
 * only Agent Resume LLM settings (read inside the engine). The caller may supply a
 * default workspace root (Ask chat injects the selected project) and an abort signal.
 */
export async function handleLinkGraphTrace(
  args: LinkGraphTraceInput,
  options?: { defaultWorkspaceRoot?: string; signal?: AbortSignal; compact?: boolean }
): Promise<LinkGraphMcpResult> {
  const workspaceRoot = (args.workspaceRoot || options?.defaultWorkspaceRoot || "").trim();
  if (!workspaceRoot) {
    return {
      content: [
        {
          type: "text",
          text: "Link graph error: workspaceRoot is required — pass workspaceRoot or scope the conversation to a project."
          + `\n${JSON.stringify({ ok: false, error: "workspaceRoot required" }, null, 2)}`
        }
      ],
      isError: true
    };
  }

  try {
    const result = await runLinkGraphTrace({
      workspaceRoot,
      symbol: args.symbol,
      filePath: args.filePath,
      line: args.line,
      selection: args.selection,
      language: args.language,
      backendRoots: args.backendRoots,
      timeBudgetMs: args.timeBudgetMs,
      signal: options?.signal
    });

    const payload = mcpPayload(result, args.compact ?? options?.compact ?? false);
    const message = String(payload.message || "");

    return {
      content: [
        {
          type: "text",
          text: `${message}\n${JSON.stringify(payload, null, 2)}`
        }
      ],
      isError: !result.ok
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Link graph error: ${msg}\n${JSON.stringify({ ok: false, error: msg }, null, 2)}`
        }
      ],
      isError: true
    };
  }
}
