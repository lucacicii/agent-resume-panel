import { z } from "zod";
import { completeFlowNode, readFlowDefinition, readFlowRun, syncFlowDefinition, validateFlowDefinition } from "../flow/runtime";
import type { FlowCompletionInput, FlowSyncInput } from "../flow/types";
import { runSqliteJson } from "../sqlite";
import { noteResponse, type NoteToolContext } from "./tools";

const id = z.string().min(1).max(200);
const source = z.string().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/);
export const flowSyncSchema = {
  sourceKind: source,
  sourceKey: source,
  rootNoteId: id,
  name: z.string().min(1).max(300),
  nodes: z.array(z.object({
    externalKey: source,
    noteId: id,
    title: z.string().min(1).max(300),
    provider: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/),
    priority: z.number().int().min(0).max(100000).optional()
  })).max(1000),
  edges: z.array(z.object({ sourceExternalKey: source, targetExternalKey: source })).max(5000)
};
export const flowReadSchema = { flowId: id.optional(), sourceKind: source.optional(), sourceKey: source.optional(), includeRun: z.boolean().optional() };
export const flowValidateSchema = { flowId: id.optional(), sourceKind: source.optional(), sourceKey: source.optional() };
export const flowNodeCompleteSchema = {
  runId: id, nodeId: id, attempt: z.number().int().min(1),
  status: z.enum(["completed", "failed", "partial", "blocked"]),
  summary: z.string().min(1).max(100000),
  dedupeKey: source
};

function ctx(input: NoteToolContext) {
  if (!input.catalogDb) throw new Error("catalogDb is required for Flow tools.");
  return { desktopDb: input.dbPath, catalogDb: input.catalogDb, notesStore: input.notesStore };
}
function selector(args: { flowId?: string; sourceKind?: string; sourceKey?: string }) {
  if (!args.flowId && !(args.sourceKind && args.sourceKey)) throw new Error("Provide flowId or sourceKind + sourceKey.");
  return args;
}

export async function handleFlowSync(args: FlowSyncInput, input: NoteToolContext) {
  const result = await syncFlowDefinition(ctx(input), args);
  return noteResponse("Flow synchronized.", { ...result });
}
export async function handleFlowRead(args: { flowId?: string; sourceKind?: string; sourceKey?: string; includeRun?: boolean }, input: NoteToolContext) {
  const flow = await readFlowDefinition(input.dbPath, selector(args));
  let run;
  if (args.includeRun) {
    const rows = await runSqliteJson<{ run_id: string }>(input.dbPath, `SELECT run_id FROM flow_runs WHERE flow_id='${flow.flowId.replaceAll("'", "''")}' ORDER BY started_at_ms DESC LIMIT 1;`);
    if (rows[0]?.run_id) run = await readFlowRun(input.dbPath, rows[0].run_id);
  }
  return noteResponse("Flow read.", { flow, run });
}
export async function handleFlowValidate(args: { flowId?: string; sourceKind?: string; sourceKey?: string }, input: NoteToolContext) {
  const result = await validateFlowDefinition(ctx(input), selector(args));
  return noteResponse(result.valid ? "Flow is valid." : "Flow validation failed.", result);
}
export async function handleFlowNodeComplete(args: FlowCompletionInput, input: NoteToolContext) {
  const result = await completeFlowNode(ctx(input), args);
  return noteResponse(result.deduplicated ? "Flow node completion already recorded." : "Flow node completed.", { ...result });
}
