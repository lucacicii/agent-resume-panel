import { randomUUID } from "node:crypto";
import {
  completeFlowNode,
  escapeSqlLiteral,
  runSqlite,
  runSqliteJson,
  writeFlowStatus
} from "@agent-resume/core";
import type {
  FlowAdvanceResult,
  FlowDefinition,
  FlowEdge,
  FlowGraphEdgeInput,
  FlowGraphNodeInput,
  FlowNode,
  FlowNodeStatus,
  FlowResultStatus,
  FlowRun,
  FlowRunNode,
  FlowRunStatus,
  FlowTemplate,
  FlowWorkflow
} from "../../shared/flowTypes";
import { loadPanelDbPaths } from "../panelDatabases";
import {
  getDesktopNotesStore,
  notesCreate,
  notesCreateLinkedChild,
  notesRead,
  notesSetParent,
  notesWrite
} from "../notesService";
import { chooseReadyFlowNodeId, validateFlowDag } from "./flowModel";

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
  definition_json: string;
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

interface FlowCreateInput {
  projectId: string;
  projectPath: string;
  name: string;
}

interface FlowUpdateGraphInput {
  flowId: string;
  name?: string;
  nodes: FlowGraphNodeInput[];
  edges: FlowGraphEdgeInput[];
}

interface FlowTemplateSaveInput {
  flowId: string;
  name: string;
  description?: string;
}

interface FlowTemplateInstantiateInput {
  templateId: string;
  projectId: string;
  projectPath: string;
  name?: string;
}

interface FlowBindSessionInput {
  flowId: string;
  nodeId: string;
  provider: string;
  sessionId: string;
}

interface FlowRunMarkNodeRunningInput {
  runId: string;
  nodeId: string;
}

interface FlowRunCompleteNodeInput {
  runId: string;
  nodeId: string;
  status: FlowResultStatus;
  summary: string;
}

interface FlowRunSetNodeStatusInput {
  flowId: string;
  runId?: string;
  nodeId: string;
  status: FlowNodeStatus;
}

interface FlowRunInput {
  runId: string;
  nodeId: string;
}

const sql = (value: string): string => `'${escapeSqlLiteral(value)}'`;
const nullableSql = (value?: string): string => value?.trim() ? sql(value.trim()) : "NULL";
const num = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

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
    revision: num(row.revision),
    createdAtMs: num(row.created_at_ms),
    updatedAtMs: num(row.updated_at_ms)
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
    positionX: num(row.position_x),
    positionY: num(row.position_y),
    priority: num(row.priority),
    createdAtMs: num(row.created_at_ms),
    updatedAtMs: num(row.updated_at_ms)
  };
}

function mapEdge(row: EdgeRow): FlowEdge {
  return {
    edgeId: row.edge_id,
    flowId: row.flow_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    createdAtMs: num(row.created_at_ms)
  };
}

function mapRunNode(row: RunNodeRow): FlowRunNode {
  return {
    runId: row.run_id,
    nodeId: row.node_id,
    status: row.status,
    attempt: num(row.attempt) || 1,
    provider: row.provider || undefined,
    sessionId: row.session_id || undefined,
    resultStatus: row.result_status || undefined,
    resultText: row.result_text || undefined,
    startedAtMs: row.started_at_ms == null ? undefined : num(row.started_at_ms),
    finishedAtMs: row.finished_at_ms == null ? undefined : num(row.finished_at_ms)
  };
}

async function writeStatus(
  noteId: string,
  args: Parameters<typeof writeFlowStatus>[2]
): Promise<void> {
  await writeFlowStatus(await getDesktopNotesStore(), noteId, args);
}

async function databasePath(): Promise<string> {
  return (await loadPanelDbPaths()).desktopDb;
}

async function loadDefinition(db: string, flowId: string): Promise<FlowDefinition> {
  const workflows = await runSqliteJson<WorkflowRow>(
    db,
    `SELECT * FROM flow_workflows WHERE flow_id=${sql(flowId)} LIMIT 1;`
  );
  if (!workflows[0]) throw new Error("Flow not found.");
  const [nodes, edges] = await Promise.all([
    runSqliteJson<NodeRow>(
      db,
      `SELECT * FROM flow_nodes WHERE flow_id=${sql(flowId)} ORDER BY priority, position_y, created_at_ms;`
    ),
    runSqliteJson<EdgeRow>(
      db,
      `SELECT * FROM flow_edges WHERE flow_id=${sql(flowId)} ORDER BY created_at_ms;`
    )
  ]);
  return {
    ...mapWorkflow(workflows[0]),
    nodes: nodes.map(mapNode),
    edges: edges.map(mapEdge)
  };
}

export async function flowList(projectId?: string): Promise<FlowWorkflow[]> {
  const db = await databasePath();
  const where = projectId?.trim() ? `WHERE project_id=${sql(projectId.trim())}` : "";
  const rows = await runSqliteJson<WorkflowRow>(
    db,
    `SELECT * FROM flow_workflows ${where} ORDER BY updated_at_ms DESC;`
  );
  return rows.map(mapWorkflow);
}

export async function flowGet(flowId: string): Promise<FlowDefinition> {
  return loadDefinition(await databasePath(), flowId);
}

export async function flowCreate(args: FlowCreateInput): Promise<FlowDefinition> {
  const projectId = args.projectId.trim();
  const projectPath = args.projectPath.trim();
  const name = args.name.trim() || "Untitled Flow";
  if (!projectId || !projectPath) {
    throw new Error("Project and local path are required.");
  }

  const root = await notesCreate({ scope: "project", projectPath });
  const flowId = randomUUID();
  await notesWrite(root.noteId, `# ${name}\n\nFlow root note. Add task details here.\n`);
  const now = Date.now();
  const db = await databasePath();
  await runSqlite(
    db,
    `INSERT INTO flow_workflows (flow_id, project_id, project_path, name, root_note_id, status, revision, created_at_ms, updated_at_ms) VALUES (${sql(flowId)},${sql(projectId)},${sql(projectPath)},${sql(name)},${sql(root.noteId)},'idle',1,${now},${now});`
  );
  await writeStatus(root.noteId, { flowId, status: "idle", summary: "Flow created" });
  return loadDefinition(db, flowId);
}

async function createNodeNote(flow: FlowDefinition, title: string, provider: string): Promise<string> {
  void provider;
  const child = await notesCreateLinkedChild(flow.rootNoteId);
  await notesWrite(child.noteId, `# ${title}\n\nDescribe the task for this Flow node.\n`);
  return child.noteId;
}

export async function flowUpdateGraph(args: FlowUpdateGraphInput): Promise<FlowDefinition> {
  const db = await databasePath();
  const flow = await loadDefinition(db, args.flowId);
  if (flow.status === "running") {
    throw new Error("Stop the active Flow run before editing its graph.");
  }

  const now = Date.now();
  const assigned = args.nodes.map((input) => ({
    ...input,
    nodeId: input.nodeId?.trim() || randomUUID()
  }));
  validateFlowDag(assigned, args.edges);

  const normalized: FlowNode[] = [];
  for (const [index, input] of assigned.entries()) {
    const nodeId = input.nodeId!;
    const title = input.title.trim() || `Task ${index + 1}`;
    const provider = input.provider.trim() || "codex";
    let noteId = input.noteId?.trim();
    if (!noteId) {
      noteId = await createNodeNote(flow, title, provider);
    } else {
      await notesSetParent(noteId, flow.rootNoteId);
    }
    const previous = flow.nodes.find((node) => node.nodeId === nodeId);
    normalized.push({
      nodeId,
      flowId: flow.flowId,
      noteId,
      externalKey: input.externalKey || previous?.externalKey,
      title,
      provider,
      bindingMode: input.bindingMode || "new-yolo",
      sessionProvider: input.sessionProvider?.trim() || undefined,
      sessionId: input.sessionId?.trim() || undefined,
      status: input.status || previous?.status || "idle",
      positionX: num(input.positionX),
      positionY: num(input.positionY),
      priority: input.priority ?? index,
      createdAtMs: previous?.createdAtMs || now,
      updatedAtMs: now
    });
  }

  const nodeIds = new Set(normalized.map((node) => node.nodeId));
  const edges: FlowEdge[] = args.edges
    .map((edge) => ({
      edgeId: edge.edgeId?.trim() || randomUUID(),
      flowId: flow.flowId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      createdAtMs: now
    }))
    .filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId));

  const statements = [
    `DELETE FROM flow_edges WHERE flow_id=${sql(flow.flowId)}`,
    `DELETE FROM flow_nodes WHERE flow_id=${sql(flow.flowId)}`,
    ...normalized.map(
      (node) =>
        `INSERT INTO flow_nodes (node_id,flow_id,note_id,external_key,title,provider,binding_mode,session_provider,session_id,status,position_x,position_y,priority,created_at_ms,updated_at_ms) VALUES (${sql(node.nodeId)},${sql(flow.flowId)},${sql(node.noteId)},${nullableSql(node.externalKey)},${sql(node.title)},${sql(node.provider)},${sql(node.bindingMode)},${nullableSql(node.sessionProvider)},${nullableSql(node.sessionId)},${sql(node.status)},${node.positionX},${node.positionY},${node.priority},${node.createdAtMs},${now})`
    ),
    ...edges.map(
      (edge) =>
        `INSERT INTO flow_edges (edge_id,flow_id,source_node_id,target_node_id,created_at_ms) VALUES (${sql(edge.edgeId)},${sql(flow.flowId)},${sql(edge.sourceNodeId)},${sql(edge.targetNodeId)},${now})`
    ),
    `UPDATE flow_workflows SET name=${sql(args.name?.trim() || flow.name)}, revision=revision+1, updated_at_ms=${now} WHERE flow_id=${sql(flow.flowId)}`
  ];
  await runSqlite(db, `BEGIN IMMEDIATE;\n${statements.join(";\n")};\nCOMMIT;`);

  for (const removed of flow.nodes.filter((node) => !nodeIds.has(node.nodeId))) {
    await notesSetParent(removed.noteId, null);
  }
  return loadDefinition(db, flow.flowId);
}

export async function flowDelete(flowId: string): Promise<{ ok: true }> {
  const db = await databasePath();
  await runSqlite(
    db,
    `DELETE FROM flow_edges WHERE flow_id=${sql(flowId)}; DELETE FROM flow_nodes WHERE flow_id=${sql(flowId)}; DELETE FROM flow_run_nodes WHERE run_id IN (SELECT run_id FROM flow_runs WHERE flow_id=${sql(flowId)}); DELETE FROM flow_run_events WHERE run_id IN (SELECT run_id FROM flow_runs WHERE flow_id=${sql(flowId)}); DELETE FROM flow_runs WHERE flow_id=${sql(flowId)}; DELETE FROM flow_workflows WHERE flow_id=${sql(flowId)};`
  );
  return { ok: true };
}

export async function flowTemplateList(): Promise<FlowTemplate[]> {
  const db = await databasePath();
  const rows = await runSqliteJson<{
    template_id: string;
    name: string;
    description: string;
    definition_json: string;
    created_at_ms: number;
    updated_at_ms: number;
  }>(db, "SELECT * FROM flow_templates ORDER BY updated_at_ms DESC;");
  return rows.map((row) => ({
    templateId: row.template_id,
    name: row.name,
    description: row.description,
    definition: JSON.parse(row.definition_json) as FlowTemplate["definition"],
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  }));
}

export async function flowTemplateSave(args: FlowTemplateSaveInput): Promise<FlowTemplate> {
  const flow = await flowGet(args.flowId);
  const noteBodies = new Map<string, string>();
  for (const node of flow.nodes) {
    const raw = (await notesRead(node.noteId)).content;
    const clean = raw
      .replace(/<!-- agent-resume-flow:start -->[\s\S]*?<!-- agent-resume-flow:end -->/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    noteBodies.set(node.nodeId, clean ? `${clean}\n` : `# ${node.title}\n`);
  }

  const definition: FlowTemplate["definition"] = {
    nodes: flow.nodes.map((node) => ({
      templateNodeId: node.nodeId,
      title: node.title,
      provider: node.provider,
      bindingMode: "new-yolo",
      positionX: node.positionX,
      positionY: node.positionY,
      priority: node.priority,
      noteBody: noteBodies.get(node.nodeId)
    })),
    edges: flow.edges.map((edge) => ({
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId
    }))
  };
  const templateId = randomUUID();
  const now = Date.now();
  const name = args.name.trim() || flow.name;
  const db = await databasePath();
  await runSqlite(
    db,
    `INSERT INTO flow_templates (template_id,name,description,definition_json,created_at_ms,updated_at_ms) VALUES (${sql(templateId)},${sql(name)},${sql(args.description?.trim() || "")},${sql(JSON.stringify(definition))},${now},${now});`
  );
  return {
    templateId,
    name,
    description: args.description?.trim() || "",
    definition,
    createdAtMs: now,
    updatedAtMs: now
  };
}

export async function flowTemplateDelete(templateId: string): Promise<{ ok: true }> {
  await runSqlite(await databasePath(), `DELETE FROM flow_templates WHERE template_id=${sql(templateId)};`);
  return { ok: true };
}

export async function flowTemplateInstantiate(args: FlowTemplateInstantiateInput): Promise<FlowDefinition> {
  const template = (await flowTemplateList()).find((item) => item.templateId === args.templateId);
  if (!template) throw new Error("Flow template not found.");

  const flow = await flowCreate({
    projectId: args.projectId,
    projectPath: args.projectPath,
    name: args.name?.trim() || template.name
  });
  const idMap = new Map<string, string>();
  const nodes: FlowGraphNodeInput[] = [];
  for (const source of template.definition.nodes) {
    const child = await notesCreateLinkedChild(flow.rootNoteId);
    const body = source.noteBody
      ?.replace(/<!-- agent-resume-flow:start -->[\s\S]*?<!-- agent-resume-flow:end -->/g, "")
      .trim() || `# ${source.title}\n\nDescribe the task for this Flow node.`;
    await notesWrite(child.noteId, `${body}\n`);
    const nodeId = randomUUID();
    idMap.set(source.templateNodeId, nodeId);
    nodes.push({
      nodeId,
      noteId: child.noteId,
      title: source.title,
      provider: source.provider,
      bindingMode: "new-yolo",
      positionX: source.positionX,
      positionY: source.positionY,
      priority: source.priority
    });
  }

  const edges: FlowGraphEdgeInput[] = template.definition.edges.map((edge) => {
    const sourceNodeId = idMap.get(edge.sourceNodeId);
    const targetNodeId = idMap.get(edge.targetNodeId);
    if (!sourceNodeId || !targetNodeId) {
      throw new Error("Flow template edge references a missing template node.");
    }
    return { sourceNodeId, targetNodeId };
  });
  return flowUpdateGraph({ flowId: flow.flowId, nodes, edges });
}

async function loadRun(db: string, runId: string): Promise<FlowRun> {
  const rows = await runSqliteJson<RunRow>(
    db,
    `SELECT * FROM flow_runs WHERE run_id=${sql(runId)} LIMIT 1;`
  );
  if (!rows[0]) throw new Error("Flow run not found.");
  const nodes = await runSqliteJson<RunNodeRow>(
    db,
    `SELECT * FROM flow_run_nodes WHERE run_id=${sql(runId)};`
  );
  return {
    runId: rows[0].run_id,
    flowId: rows[0].flow_id,
    status: rows[0].status,
    revision: rows[0].revision,
    startedAtMs: rows[0].started_at_ms,
    finishedAtMs: rows[0].finished_at_ms || undefined,
    nodes: nodes.map(mapRunNode)
  };
}

export async function flowRunStart(flowId: string): Promise<FlowAdvanceResult> {
  const db = await databasePath();
  const flow = await loadDefinition(db, flowId);
  const activeRuns = await runSqliteJson<{ run_id: string }>(
    db,
    `SELECT run_id FROM flow_runs WHERE flow_id=${sql(flowId)} AND status='running' LIMIT 1;`
  );
  if (activeRuns.length) throw new Error("This Flow already has an active run.");
  if (!flow.nodes.length) throw new Error("Add at least one node before running a Flow.");
  validateFlowDag(flow.nodes, flow.edges);

  const runId = randomUUID();
  const now = Date.now();
  await runSqlite(
    db,
    `INSERT INTO flow_runs (run_id,flow_id,status,revision,definition_json,started_at_ms) VALUES (${sql(runId)},${sql(flowId)},'running',${flow.revision},${sql(JSON.stringify(flow))},${now}); UPDATE flow_workflows SET status='running',updated_at_ms=${now} WHERE flow_id=${sql(flowId)}; UPDATE flow_nodes SET status='idle',updated_at_ms=${now} WHERE flow_id=${sql(flowId)};`
  );
  for (const node of flow.nodes) {
    await runSqlite(
      db,
      `INSERT INTO flow_run_nodes (run_id,node_id,status,attempt) VALUES (${sql(runId)},${sql(node.nodeId)},'idle',1);`
    );
  }

  let run = await loadRun(db, runId);
  const nextNode = flow.nodes.find((node) => node.nodeId === chooseReadyFlowNodeId(flow, run));
  if (nextNode) {
    await runSqlite(
      db,
      `UPDATE flow_run_nodes SET status='ready' WHERE run_id=${sql(runId)} AND node_id=${sql(nextNode.nodeId)}; UPDATE flow_nodes SET status='ready' WHERE node_id=${sql(nextNode.nodeId)};`
    );
    run = await loadRun(db, runId);
  }
  await writeStatus(flow.rootNoteId, { flowId, runId, status: "running", summary: "Flow run started" });
  return { flow: await loadDefinition(db, flowId), run, nextNode };
}

export async function flowRunGet(runId: string): Promise<FlowRun> {
  return loadRun(await databasePath(), runId);
}

export async function flowRunMarkNodeRunning(args: FlowRunMarkNodeRunningInput): Promise<FlowAdvanceResult> {
  const db = await databasePath();
  const run = await loadRun(db, args.runId);
  const flow = await loadDefinition(db, run.flowId);
  const node = flow.nodes.find((item) => item.nodeId === args.nodeId);
  if (!node) throw new Error("Flow node not found.");
  const now = Date.now();
  await runSqlite(
    db,
    `UPDATE flow_run_nodes SET status='running',started_at_ms=${now} WHERE run_id=${sql(args.runId)} AND node_id=${sql(args.nodeId)}; UPDATE flow_nodes SET status='running',updated_at_ms=${now} WHERE node_id=${sql(args.nodeId)};`
  );
  await writeStatus(node.noteId, {
    flowId: flow.flowId,
    runId: run.runId,
    nodeId: node.nodeId,
    status: "running",
    summary: "Session execution started"
  });
  return {
    flow: await loadDefinition(db, flow.flowId),
    run: await loadRun(db, run.runId),
    nextNode: node
  };
}

export async function flowBindSession(args: FlowBindSessionInput): Promise<FlowDefinition> {
  const db = await databasePath();
  const flow = await loadDefinition(db, args.flowId);
  const node = flow.nodes.find((item) => item.nodeId === args.nodeId);
  if (!node) throw new Error("Flow node not found.");
  await runSqlite(
    db,
    `UPDATE flow_nodes SET session_provider=${sql(args.provider)},session_id=${sql(args.sessionId)},updated_at_ms=${Date.now()} WHERE node_id=${sql(args.nodeId)}; UPDATE flow_run_nodes SET provider=${sql(args.provider)},session_id=${sql(args.sessionId)} WHERE node_id=${sql(args.nodeId)} AND run_id IN (SELECT run_id FROM flow_runs WHERE flow_id=${sql(args.flowId)} AND status='running');`
  );
  return loadDefinition(db, args.flowId);
}

export async function flowRunCompleteNode(args: FlowRunCompleteNodeInput): Promise<FlowAdvanceResult> {
  const paths = await loadPanelDbPaths();
  const run = await loadRun(paths.desktopDb, args.runId);
  const runNode = run.nodes.find((item) => item.nodeId === args.nodeId);
  if (!runNode) throw new Error("Flow run node not found.");
  return completeFlowNode(
    {
      desktopDb: paths.desktopDb,
      catalogDb: paths.catalogDb,
      notesStore: await getDesktopNotesStore()
    },
    {
      ...args,
      attempt: runNode.attempt,
      dedupeKey: `desktop:${args.runId}:${args.nodeId}:${runNode.attempt}:${args.status}`
    }
  );
}

export async function flowRunSetNodeStatus(args: FlowRunSetNodeStatusInput): Promise<FlowDefinition> {
  const db = await databasePath();
  const flow = await loadDefinition(db, args.flowId);
  const node = flow.nodes.find((item) => item.nodeId === args.nodeId);
  if (!node) throw new Error("Flow node not found.");
  await runSqlite(
    db,
    `UPDATE flow_nodes SET status=${sql(args.status)},updated_at_ms=${Date.now()} WHERE node_id=${sql(args.nodeId)};${args.runId ? ` UPDATE flow_run_nodes SET status=${sql(args.status)} WHERE run_id=${sql(args.runId)} AND node_id=${sql(args.nodeId)};` : ""}`
  );
  await writeStatus(node.noteId, {
    flowId: flow.flowId,
    runId: args.runId,
    nodeId: node.nodeId,
    status: args.status,
    summary: "Status set manually"
  });
  return loadDefinition(db, flow.flowId);
}

export async function flowRunCancel(args: Pick<FlowRunInput, "runId">): Promise<FlowAdvanceResult> {
  const db = await databasePath();
  const run = await loadRun(db, args.runId);
  const flow = await loadDefinition(db, run.flowId);
  const now = Date.now();
  await runSqlite(
    db,
    `UPDATE flow_runs SET status='cancelled',finished_at_ms=${now} WHERE run_id=${sql(args.runId)}; UPDATE flow_run_nodes SET status='cancelled',finished_at_ms=${now} WHERE run_id=${sql(args.runId)} AND status IN ('idle','ready','running'); UPDATE flow_workflows SET status='cancelled',updated_at_ms=${now} WHERE flow_id=${sql(flow.flowId)}; UPDATE flow_nodes SET status='cancelled',updated_at_ms=${now} WHERE flow_id=${sql(flow.flowId)} AND status IN ('idle','ready','running');`
  );
  await writeStatus(flow.rootNoteId, {
    flowId: flow.flowId,
    runId: run.runId,
    status: "cancelled",
    summary: "Flow run cancelled"
  });
  return {
    flow: await loadDefinition(db, flow.flowId),
    run: await loadRun(db, run.runId)
  };
}

export async function flowRunRetryNode(args: FlowRunInput): Promise<FlowAdvanceResult> {
  const db = await databasePath();
  const run = await loadRun(db, args.runId);
  const flow = await loadDefinition(db, run.flowId);
  const node = flow.nodes.find((item) => item.nodeId === args.nodeId);
  if (!node) throw new Error("Flow node not found.");
  const now = Date.now();
  await runSqlite(
    db,
    `UPDATE flow_runs SET status='running',finished_at_ms=NULL WHERE run_id=${sql(run.runId)}; UPDATE flow_workflows SET status='running',updated_at_ms=${now} WHERE flow_id=${sql(flow.flowId)}; UPDATE flow_run_nodes SET status='ready',attempt=attempt+1,result_status=NULL,result_text=NULL,provider=NULL,session_id=NULL,started_at_ms=NULL,finished_at_ms=NULL WHERE run_id=${sql(run.runId)} AND node_id=${sql(node.nodeId)}; UPDATE flow_nodes SET status='ready',updated_at_ms=${now} WHERE node_id=${sql(node.nodeId)};`
  );
  await writeStatus(node.noteId, {
    flowId: flow.flowId,
    runId: run.runId,
    nodeId: node.nodeId,
    status: "ready",
    summary: "Node queued for retry"
  });
  await writeStatus(flow.rootNoteId, {
    flowId: flow.flowId,
    runId: run.runId,
    nodeId: node.nodeId,
    status: "running",
    summary: "Flow resumed for node retry"
  });
  return {
    flow: await loadDefinition(db, flow.flowId),
    run: await loadRun(db, run.runId),
    nextNode: node
  };
}

export async function flowRunSkipNode(args: FlowRunInput): Promise<FlowAdvanceResult> {
  const db = await databasePath();
  let run = await loadRun(db, args.runId);
  let flow = await loadDefinition(db, run.flowId);
  const node = flow.nodes.find((item) => item.nodeId === args.nodeId);
  if (!node) throw new Error("Flow node not found.");
  const now = Date.now();
  await runSqlite(
    db,
    `UPDATE flow_runs SET status='running',finished_at_ms=NULL WHERE run_id=${sql(run.runId)}; UPDATE flow_workflows SET status='running',updated_at_ms=${now} WHERE flow_id=${sql(flow.flowId)}; UPDATE flow_run_nodes SET status='skipped',result_status='completed',result_text='Skipped manually',finished_at_ms=${now} WHERE run_id=${sql(run.runId)} AND node_id=${sql(node.nodeId)}; UPDATE flow_nodes SET status='skipped',updated_at_ms=${now} WHERE node_id=${sql(node.nodeId)};`
  );
  await writeStatus(node.noteId, {
    flowId: flow.flowId,
    runId: run.runId,
    nodeId: node.nodeId,
    status: "skipped",
    summary: "Skipped manually"
  });
  run = await loadRun(db, run.runId);
  const nextNode = flow.nodes.find((item) => item.nodeId === chooseReadyFlowNodeId(flow, run));
  if (nextNode) {
    await runSqlite(
      db,
      `UPDATE flow_run_nodes SET status='ready' WHERE run_id=${sql(run.runId)} AND node_id=${sql(nextNode.nodeId)}; UPDATE flow_nodes SET status='ready',updated_at_ms=${now} WHERE node_id=${sql(nextNode.nodeId)};`
    );
    await writeStatus(flow.rootNoteId, {
      flowId: flow.flowId,
      runId: run.runId,
      nodeId: node.nodeId,
      status: "running",
      summary: "Node skipped; advancing Flow"
    });
    return {
      flow: await loadDefinition(db, flow.flowId),
      run: await loadRun(db, run.runId),
      nextNode
    };
  }

  const refreshed = await loadRun(db, run.runId);
  if (refreshed.nodes.every((item) => item.status === "completed" || item.status === "skipped")) {
    await runSqlite(
      db,
      `UPDATE flow_runs SET status='completed',finished_at_ms=${now} WHERE run_id=${sql(run.runId)}; UPDATE flow_workflows SET status='completed',updated_at_ms=${now} WHERE flow_id=${sql(flow.flowId)};`
    );
    await writeStatus(flow.rootNoteId, {
      flowId: flow.flowId,
      runId: run.runId,
      status: "completed",
      summary: "Flow completed after manual skip"
    });
  }
  flow = await loadDefinition(db, flow.flowId);
  return { flow, run: await loadRun(db, run.runId) };
}

export async function flowRunLatest(flowId: string): Promise<FlowRun | null> {
  const db = await databasePath();
  const rows = await runSqliteJson<{ run_id: string }>(
    db,
    `SELECT run_id FROM flow_runs WHERE flow_id=${sql(flowId)} ORDER BY started_at_ms DESC LIMIT 1;`
  );
  return rows[0]?.run_id ? loadRun(db, rows[0].run_id) : null;
}
