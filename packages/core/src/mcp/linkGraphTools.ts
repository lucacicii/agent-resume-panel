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
    .describe("Absolute path to the workspace or monorepo root (e.g. /Users/…/my-app)"),
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
    .describe("Wall-clock budget in ms (default 90000)")
});

export type LinkGraphTraceInput = z.infer<typeof linkGraphTraceSchema>;

function mcpPayload(result: LinkGraphTraceResult): Record<string, unknown> {
  const message = result.ok
    ? `Link graph for ${result.seed.symbol}: ${result.primaryChain.length} steps, bridge=${result.bridgeStatus}`
    : `Link graph failed: ${result.error || "unknown error"}`;

  return {
    ok: result.ok,
    message,
    engine: result.engine,
    seed: result.seed,
    workspaceRoot: result.workspaceRoot,
    summary: result.summary,
    bridgeStatus: result.bridgeStatus,
    facts: result.facts,
    primaryChain: result.primaryChain,
    timeline: result.timeline,
    openEnds: result.openEnds,
    error: result.error
  };
}

/**
 * Handle link_graph_trace. No NotesStore / catalog / session injection required —
 * only Agent Resume LLM settings (read inside the engine).
 */
export async function handleLinkGraphTrace(args: LinkGraphTraceInput): Promise<LinkGraphMcpResult> {
  try {
    const result = await runLinkGraphTrace({
      workspaceRoot: args.workspaceRoot,
      symbol: args.symbol,
      filePath: args.filePath,
      line: args.line,
      selection: args.selection,
      language: args.language,
      backendRoots: args.backendRoots,
      timeBudgetMs: args.timeBudgetMs
    });

    const payload = mcpPayload(result);
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
