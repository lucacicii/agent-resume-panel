export type FlowRunStatus = "idle" | "running" | "completed" | "partial" | "failed" | "blocked" | "cancelled";
export type FlowNodeStatus = "idle" | "ready" | "running" | "completed" | "failed" | "blocked" | "skipped" | "cancelled";
export type FlowResultStatus = "completed" | "failed" | "partial" | "blocked";
export type FlowSessionBindingMode = "new-yolo" | "native";

export interface FlowNode {
  nodeId: string;
  flowId: string;
  noteId: string;
  externalKey?: string;
  title: string;
  provider: string;
  bindingMode: FlowSessionBindingMode;
  sessionProvider?: string;
  sessionId?: string;
  status: FlowNodeStatus;
  positionX: number;
  positionY: number;
  priority: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface FlowEdge {
  edgeId: string;
  flowId: string;
  sourceNodeId: string;
  targetNodeId: string;
  createdAtMs: number;
}

export interface FlowWorkflow {
  flowId: string;
  projectId: string;
  projectPath: string;
  name: string;
  rootNoteId: string;
  sourceKind?: string;
  sourceKey?: string;
  status: FlowRunStatus;
  revision: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface FlowDefinition extends FlowWorkflow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowRunNode {
  runId: string;
  nodeId: string;
  status: FlowNodeStatus;
  attempt: number;
  provider?: string;
  sessionId?: string;
  resultStatus?: FlowResultStatus;
  resultText?: string;
  startedAtMs?: number;
  finishedAtMs?: number;
}

export interface FlowRun {
  runId: string;
  flowId: string;
  status: FlowRunStatus;
  revision: number;
  startedAtMs: number;
  finishedAtMs?: number;
  nodes: FlowRunNode[];
}

export interface FlowAdvanceResult {
  flow: FlowDefinition;
  run: FlowRun;
  nextNode?: FlowNode;
}

export interface FlowSyncNodeInput {
  externalKey: string;
  noteId: string;
  title: string;
  provider: string;
  priority?: number;
}

export interface FlowSyncEdgeInput {
  sourceExternalKey: string;
  targetExternalKey: string;
}

export interface FlowSyncInput {
  sourceKind: string;
  sourceKey: string;
  rootNoteId: string;
  name: string;
  nodes: FlowSyncNodeInput[];
  edges: FlowSyncEdgeInput[];
}

export interface FlowSyncResult {
  flow: FlowDefinition;
  created: boolean;
  preservedActive: boolean;
}

export interface FlowCompletionInput {
  runId: string;
  nodeId: string;
  attempt: number;
  status: FlowResultStatus;
  summary: string;
  dedupeKey: string;
}

export interface FlowCompletionResult extends FlowAdvanceResult {
  deduplicated: boolean;
}
