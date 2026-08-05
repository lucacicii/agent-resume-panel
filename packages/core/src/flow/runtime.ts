import { randomUUID } from "node:crypto";
import type { NotesStore } from "../notes/store";
import { ensureProjectForPath } from "../catalog/projects";
import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";
import { chooseReadyFlowNodeId, validateFlowDag } from "./model";
import type {
  FlowCompletionInput,
  FlowCompletionResult,
  FlowDefinition,
  FlowEdge,
  FlowNode,
  FlowNodeStatus,
  FlowResultStatus,
  FlowRun,
  FlowRunNode,
  FlowRunStatus,
  FlowWorkflow,
  FlowSyncInput,
  FlowSyncResult
} from "./types";

interface FlowContext {
  desktopDb: string;
  catalogDb: string;
  notesStore: NotesStore;
}

interface WorkflowRow {
  flow_id: string;
  project_id: string;
  project_path: string;
  name: string;
  root_note_id: string;
  source_kind?: string | null;
  source_key?: string | null;
  status: FlowRunStatus;
  revision: number;
  created_at_ms: number;
  updated_at_ms: number;
}

interface NodeRow {
  node_id: string;
  flow_id: string;
  note_id: string;
  external_key?: string | null;
  title: string;
  provider: string;
  binding_mode: FlowNode["bindingMode"];
  session_provider?: string | null;
  session_id?: string | null;
  status: FlowNodeStatus;
  position_x: number;
  position_y: number;
  priority: number;
  created_at_ms: number;
  updated_at_ms: number;
}

interface EdgeRow {
  edge_id: string;
  flow_id: string;
  source_node_id: string;
  target_node_id: string;
  created_at_ms: number;
}

interface RunRow {
  run_id: string;
  flow_id: string;
  status: FlowRunStatus;
  revision: number;
  started_at_ms: number;
  finished_at_ms?: number | null;
}

interface RunNodeRow {
  run_id: string;
  node_id: string;
  status: FlowNodeStatus;
  attempt: number;
  provider?: string | null;
  session_id?: string | null;
  result_status?: FlowResultStatus | null;
  result_text?: string | null;
  started_at_ms?: number | null;
  finished_at_ms?: number | null;
}

const q = (value: string): string => `'${escapeSqlLiteral(value)}'`;
const n = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

function mapWorkflow(row: WorkflowRow): FlowWorkflow {
  return {
    flowId: row.flow_id,
    projectId: row.project_id,
    projectPath: row.project_path,
    name: row.name,
    rootNoteId: row.root_note_id,
    sourceKind: row.source_kind || undefined,
    sourceKey: row.source_key || undefined,
    status: row.status,
    revision: n(row.revision),
    createdAtMs: n(row.created_at_ms),
    updatedAtMs: n(row.updated_at_ms)
  };
}

function mapNode(row: NodeRow): FlowNode {
  return {
    nodeId: row.node_id,
    flowId: row.flow_id,
    noteId: row.note_id,
    externalKey: row.external_key || undefined,
    title: row.title,
    provider: row.provider,
    bindingMode: row.binding_mode,
    sessionProvider: row.session_provider || undefined,
    sessionId: row.session_id || undefined,
    status: row.status,
    positionX: n(row.position_x),
    positionY: n(row.position_y),
    priority: n(row.priority),
    createdAtMs: n(row.created_at_ms),
    updatedAtMs: n(row.updated_at_ms)
  };
}

function mapEdge(row: EdgeRow): FlowEdge {
  return {
    edgeId: row.edge_id,
    flowId: row.flow_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    createdAtMs: n(row.created_at_ms)
  };
}

function mapRunNode(row: RunNodeRow): FlowRunNode {
  return {
    runId: row.run_id,
    nodeId: row.node_id,
    status: row.status,
    attempt: n(row.attempt) || 1,
    provider: row.provider || undefined,
    sessionId: row.session_id || undefined,
    resultStatus: row.result_status || undefined,
    resultText: row.result_text || undefined,
    startedAtMs: row.started_at_ms == null ? undefined : n(row.started_at_ms),
    finishedAtMs: row.finished_at_ms == null ? undefined : n(row.finished_at_ms)
  };
}

export async function readFlowDefinition(
  desktopDb: string,
  selector: {
    flowId?: string;
    sourceKind?: string;
    sourceKey?: string;
    rootNoteId?: string;
  }
): Promise<FlowDefinition> {
  const where = selector.flowId
    ? `flow_id=${q(selector.flowId)}`
    : selector.sourceKind && selector.sourceKey
      ? `source_kind=${q(selector.sourceKind)} AND source_key=${q(selector.sourceKey)}`
      : selector.rootNoteId
        ? `root_note_id=${q(selector.rootNoteId)}`
        : "0";
  const rows = await runSqliteJson<WorkflowRow>(
    desktopDb,
    `SELECT * FROM flow_workflows WHERE ${where} LIMIT 1;`
  );
  if (!rows[0]) throw new Error("Flow not found.");

  const flowId = rows[0].flow_id;
  const [nodes, edges] = await Promise.all([
    runSqliteJson<NodeRow>(
      desktopDb,
      `SELECT * FROM flow_nodes WHERE flow_id=${q(flowId)} ORDER BY priority,position_y,created_at_ms;`
    ),
    runSqliteJson<EdgeRow>(
      desktopDb,
      `SELECT * FROM flow_edges WHERE flow_id=${q(flowId)} ORDER BY created_at_ms;`
    )
  ]);

  return {
    ...mapWorkflow(rows[0]),
    nodes: nodes.map(mapNode),
    edges: edges.map(mapEdge)
  };
}

export async function readFlowRun(desktopDb: string, runId: string): Promise<FlowRun> {
  const rows = await runSqliteJson<RunRow>(
    desktopDb,
    `SELECT run_id,flow_id,status,revision,started_at_ms,finished_at_ms FROM flow_runs WHERE run_id=${q(runId)} LIMIT 1;`
  );
  if (!rows[0]) throw new Error("Flow run not found.");

  const nodes = await runSqliteJson<RunNodeRow>(
    desktopDb,
    `SELECT run_id,node_id,status,attempt,provider,session_id,result_status,result_text,started_at_ms,finished_at_ms FROM flow_run_nodes WHERE run_id=${q(runId)};`
  );
  return {
    runId: rows[0].run_id,
    flowId: rows[0].flow_id,
    status: rows[0].status,
    revision: n(rows[0].revision),
    startedAtMs: n(rows[0].started_at_ms),
    finishedAtMs: rows[0].finished_at_ms == null ? undefined : n(rows[0].finished_at_ms),
    nodes: nodes.map(mapRunNode)
  };
}

const FLOW_START = "<!-- agent-resume-flow:start -->";
const FLOW_END = "<!-- agent-resume-flow:end -->";

function eventsFrom(content: string): string[] {
  const start = content.indexOf(FLOW_START);
  const end = start >= 0 ? content.indexOf(FLOW_END, start) : -1;
  return start < 0 || end < 0
    ? []
    : content
        .slice(start, end)
        .split("\n")
        .filter((line) => line.startsWith("- [`"));
}

function replaceStatus(content: string, section: string): string {
  const start = content.indexOf(FLOW_START);
  const end = start >= 0 ? content.indexOf(FLOW_END, start) : -1;
  const managed = `${FLOW_START}\n${section.trim()}\n${FLOW_END}`;
  const next = start >= 0 && end >= 0
    ? `${content.slice(0, start)}${managed}${content.slice(end + FLOW_END.length)}`
    : `${content.trimEnd()}${content.trim() ? "\n\n" : ""}${managed}\n`;
  return `${next.replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export async function writeFlowStatus(
  notesStore: NotesStore,
  noteId: string,
  args: {
    flowId: string;
    runId?: string;
    nodeId?: string;
    status: string;
    summary?: string;
  }
): Promise<void> {
  const content = await notesStore.readNoteContent(noteId);
  const event = `- [\`${new Date().toISOString()}\`] **${args.status}**${args.nodeId ? ` · node \`${args.nodeId}\`` : ""}${args.summary ? ` — ${args.summary.replace(/\s+/g, " ").trim()}` : ""}`;
  const events = [...eventsFrom(content), event].slice(-100);
  const section = [
    "## Flow Status",
    "",
    `- Flow: \`${args.flowId}\``,
    args.runId ? `- Run: \`${args.runId}\`` : undefined,
    args.nodeId ? `- Node: \`${args.nodeId}\`` : undefined,
    `- Current status: **${args.status}**`,
    "",
    "### Events",
    ...events
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  await notesStore.writeValidatedNoteContent(noteId, replaceStatus(content, section));
}

export async function syncFlowDefinition(ctx: FlowContext, input: FlowSyncInput): Promise<FlowSyncResult> {
  const sourceKind = input.sourceKind.trim();
  const sourceKey = input.sourceKey.trim();
  if (!sourceKind || !sourceKey) {
    throw new Error("Flow sourceKind and sourceKey are required.");
  }

  const root = await ctx.notesStore.getNote(input.rootNoteId);
  if (!root || root.scope !== "project" || !root.projectPath) {
    throw new Error("Flow root must be a Project Note.");
  }

  const descendants = await ctx.notesStore.collectNoteDescendantIds(root.noteId);
  descendants.add(root.noteId);
  const seenExternal = new Set<string>();
  for (const node of input.nodes) {
    if (!node.externalKey.trim() || seenExternal.has(node.externalKey)) {
      throw new Error(`Duplicate or empty Flow node key: ${node.externalKey}`);
    }
    seenExternal.add(node.externalKey);
    const note = await ctx.notesStore.getNote(node.noteId);
    if (!note || note.scope !== "project" || note.projectPath !== root.projectPath || !descendants.has(note.noteId)) {
      throw new Error(`Flow node Note is outside the root Note subtree: ${node.noteId}`);
    }
  }

  const currentRows = await runSqliteJson<WorkflowRow>(
    ctx.desktopDb,
    `SELECT * FROM flow_workflows WHERE source_kind=${q(sourceKind)} AND source_key=${q(sourceKey)} LIMIT 1;`
  );
  const current = currentRows[0]
    ? await readFlowDefinition(ctx.desktopDb, { flowId: currentRows[0].flow_id })
    : undefined;
  if (current?.status === "running") {
    return { flow: current, created: false, preservedActive: true };
  }

  const flowId = current?.flowId || randomUUID();
  const now = Date.now();
  const projectId = await ensureProjectForPath(ctx.catalogDb, root.projectPath, { touchSeen: false });
  const existingByKey = new Map(
    current?.nodes
      .filter((node) => node.externalKey)
      .map((node) => [node.externalKey!, node]) || []
  );
  const nodes: FlowNode[] = input.nodes.map((node, index) => {
    const existing = existingByKey.get(node.externalKey);
    return {
      nodeId: existing?.nodeId || randomUUID(),
      flowId,
      noteId: node.noteId,
      externalKey: node.externalKey,
      title: node.title.trim() || node.externalKey,
      provider: node.provider.trim() || "codex",
      bindingMode: "new-yolo",
      status: existing?.status || "idle",
      positionX: existing?.positionX ?? index * 240,
      positionY: existing?.positionY ?? 80,
      priority: node.priority ?? index,
      createdAtMs: existing?.createdAtMs || now,
      updatedAtMs: now
    };
  });
  const byKey = new Map(nodes.map((node) => [node.externalKey!, node.nodeId]));
  const edges: FlowEdge[] = input.edges.map((edge) => {
    const sourceNodeId = byKey.get(edge.sourceExternalKey);
    const targetNodeId = byKey.get(edge.targetExternalKey);
    if (!sourceNodeId || !targetNodeId) {
      throw new Error(`Flow edge references an unknown external key: ${edge.sourceExternalKey} -> ${edge.targetExternalKey}`);
    }
    return {
      edgeId: randomUUID(),
      flowId,
      sourceNodeId,
      targetNodeId,
      createdAtMs: now
    };
  });
  validateFlowDag(nodes, edges);

  const statements = [
    current
      ? `UPDATE flow_workflows SET project_id=${q(projectId)},project_path=${q(root.projectPath)},name=${q(input.name.trim() || sourceKey)},root_note_id=${q(root.noteId)},revision=revision+1,updated_at_ms=${now} WHERE flow_id=${q(flowId)}`
      : `INSERT INTO flow_workflows (flow_id,project_id,project_path,name,root_note_id,source_kind,source_key,status,revision,created_at_ms,updated_at_ms) VALUES (${q(flowId)},${q(projectId)},${q(root.projectPath)},${q(input.name.trim() || sourceKey)},${q(root.noteId)},${q(sourceKind)},${q(sourceKey)},'idle',1,${now},${now})`,
    `DELETE FROM flow_edges WHERE flow_id=${q(flowId)}`,
    `DELETE FROM flow_nodes WHERE flow_id=${q(flowId)}`,
    ...nodes.map(
      (node) =>
        `INSERT INTO flow_nodes (node_id,flow_id,note_id,external_key,title,provider,binding_mode,session_provider,session_id,status,position_x,position_y,priority,created_at_ms,updated_at_ms) VALUES (${q(node.nodeId)},${q(flowId)},${q(node.noteId)},${q(node.externalKey!)},${q(node.title)},${q(node.provider)},'new-yolo',NULL,NULL,${q(node.status)},${node.positionX},${node.positionY},${node.priority},${node.createdAtMs},${now})`
    ),
    ...edges.map(
      (edge) =>
        `INSERT INTO flow_edges (edge_id,flow_id,source_node_id,target_node_id,created_at_ms) VALUES (${q(edge.edgeId)},${q(flowId)},${q(edge.sourceNodeId)},${q(edge.targetNodeId)},${now})`
    )
  ];
  await runSqlite(ctx.desktopDb, `BEGIN IMMEDIATE;\n${statements.join(";\n")};\nCOMMIT;`);
  await writeFlowStatus(ctx.notesStore, root.noteId, {
    flowId,
    status: "idle",
    summary: `Synchronized from ${sourceKind}:${sourceKey}`
  });
  return {
    flow: await readFlowDefinition(ctx.desktopDb, { flowId }),
    created: !current,
    preservedActive: false
  };
}

export async function validateFlowDefinition(
  ctx: FlowContext,
  selector: { flowId?: string; sourceKind?: string; sourceKey?: string }
): Promise<{ valid: boolean; errors: string[]; flow: FlowDefinition }> {
  const flow = await readFlowDefinition(ctx.desktopDb, selector);
  const errors: string[] = [];
  try {
    validateFlowDag(flow.nodes, flow.edges);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const root = await ctx.notesStore.getNote(flow.rootNoteId);
  if (!root || root.scope !== "project" || root.projectPath !== flow.projectPath) {
    errors.push("Flow root Note is missing or outside the Flow project.");
  }
  const descendants = root
    ? await ctx.notesStore.collectNoteDescendantIds(root.noteId)
    : new Set<string>();
  if (root) descendants.add(root.noteId);
  for (const node of flow.nodes) {
    if (!descendants.has(node.noteId)) {
      errors.push(`Flow node Note is outside the root subtree: ${node.noteId}`);
    }
  }
  return { valid: errors.length === 0, errors, flow };
}

export async function completeFlowNode(
  ctx: FlowContext,
  input: FlowCompletionInput
): Promise<FlowCompletionResult> {
  if (!input.dedupeKey.trim()) {
    throw new Error("dedupeKey is required.");
  }

  let run = await readFlowRun(ctx.desktopDb, input.runId);
  let flow = await readFlowDefinition(ctx.desktopDb, { flowId: run.flowId });
  const node = flow.nodes.find((item) => item.nodeId === input.nodeId);
  const runNode = run.nodes.find((item) => item.nodeId === input.nodeId);
  if (!node || !runNode) {
    throw new Error("Flow run node not found.");
  }

  const eventId = `flow-complete:${input.dedupeKey}`;
  const prior = await runSqliteJson<{ event_id: string }>(
    ctx.desktopDb,
    `SELECT event_id FROM flow_run_events WHERE event_id=${q(eventId)} LIMIT 1;`
  );
  if (prior.length) {
    return { flow, run, deduplicated: true };
  }
  if (run.status !== "running" || runNode.status !== "running") {
    throw new Error("Flow node is not running.");
  }
  if (runNode.attempt !== input.attempt) {
    throw new Error(`Flow node attempt mismatch: expected ${runNode.attempt}.`);
  }

  const mapped: FlowNodeStatus = input.status === "completed"
    ? "completed"
    : input.status === "failed"
      ? "failed"
      : "blocked";
  const now = Date.now();
  await runSqlite(
    ctx.desktopDb,
    `BEGIN IMMEDIATE; UPDATE flow_run_nodes SET status=${q(mapped)},result_status=${q(input.status)},result_text=${q(input.summary)},finished_at_ms=${now} WHERE run_id=${q(run.runId)} AND node_id=${q(node.nodeId)}; UPDATE flow_nodes SET status=${q(mapped)},updated_at_ms=${now} WHERE node_id=${q(node.nodeId)}; INSERT INTO flow_run_events (event_id,run_id,node_id,status,summary,created_at_ms) VALUES (${q(eventId)},${q(run.runId)},${q(node.nodeId)},${q(input.status)},${q(input.summary)},${now}); COMMIT;`
  );
  await writeFlowStatus(ctx.notesStore, node.noteId, {
    flowId: flow.flowId,
    runId: run.runId,
    nodeId: node.nodeId,
    status: mapped,
    summary: input.summary
  });
  run = await readFlowRun(ctx.desktopDb, run.runId);

  if (input.status !== "completed") {
    const finalStatus: FlowRunStatus = input.status === "failed"
      ? "failed"
      : input.status === "partial"
        ? "partial"
        : "blocked";
    await runSqlite(
      ctx.desktopDb,
      `UPDATE flow_runs SET status=${q(finalStatus)},finished_at_ms=${now} WHERE run_id=${q(run.runId)}; UPDATE flow_workflows SET status=${q(finalStatus)},updated_at_ms=${now} WHERE flow_id=${q(flow.flowId)};`
    );
    await writeFlowStatus(ctx.notesStore, flow.rootNoteId, {
      flowId: flow.flowId,
      runId: run.runId,
      nodeId: node.nodeId,
      status: finalStatus,
      summary: input.summary
    });
    return {
      flow: await readFlowDefinition(ctx.desktopDb, { flowId: flow.flowId }),
      run: await readFlowRun(ctx.desktopDb, run.runId),
      deduplicated: false
    };
  }

  const nextNode = flow.nodes.find((item) => item.nodeId === chooseReadyFlowNodeId(flow, run));
  if (nextNode) {
    await runSqlite(
      ctx.desktopDb,
      `UPDATE flow_run_nodes SET status='ready' WHERE run_id=${q(run.runId)} AND node_id=${q(nextNode.nodeId)}; UPDATE flow_nodes SET status='ready',updated_at_ms=${now} WHERE node_id=${q(nextNode.nodeId)};`
    );
    await writeFlowStatus(ctx.notesStore, flow.rootNoteId, {
      flowId: flow.flowId,
      runId: run.runId,
      nodeId: node.nodeId,
      status: "running",
      summary: input.summary
    });
    return {
      flow: await readFlowDefinition(ctx.desktopDb, { flowId: flow.flowId }),
      run: await readFlowRun(ctx.desktopDb, run.runId),
      nextNode,
      deduplicated: false
    };
  }

  const refreshed = await readFlowRun(ctx.desktopDb, run.runId);
  if (refreshed.nodes.every((item) => item.status === "completed" || item.status === "skipped")) {
    await runSqlite(
      ctx.desktopDb,
      `UPDATE flow_runs SET status='completed',finished_at_ms=${now} WHERE run_id=${q(run.runId)}; UPDATE flow_workflows SET status='completed',updated_at_ms=${now} WHERE flow_id=${q(flow.flowId)};`
    );
    await writeFlowStatus(ctx.notesStore, flow.rootNoteId, {
      flowId: flow.flowId,
      runId: run.runId,
      status: "completed",
      summary: "All Flow nodes completed"
    });
  }

  flow = await readFlowDefinition(ctx.desktopDb, { flowId: flow.flowId });
  return {
    flow,
    run: await readFlowRun(ctx.desktopDb, run.runId),
    deduplicated: false
  };
}
