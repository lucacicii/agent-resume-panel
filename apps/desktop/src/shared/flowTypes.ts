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

export interface FlowTemplate {
  templateId: string;
  name: string;
  description: string;
  definition: {
    nodes: Array<Pick<FlowNode, "title" | "provider" | "bindingMode" | "positionX" | "positionY" | "priority"> & { templateNodeId: string; noteBody?: string }>;
    edges: Array<{ sourceNodeId: string; targetNodeId: string }>;
  };
  createdAtMs: number;
  updatedAtMs: number;
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

export interface FlowGraphNodeInput {
  nodeId?: string;
  noteId?: string;
  externalKey?: string;
  title: string;
  provider: string;
  bindingMode: FlowSessionBindingMode;
  sessionProvider?: string;
  sessionId?: string;
  status?: FlowNodeStatus;
  positionX: number;
  positionY: number;
  priority?: number;
}

export interface FlowGraphEdgeInput {
  edgeId?: string;
  sourceNodeId: string;
  targetNodeId: string;
}

export interface FlowAdvanceResult {
  flow: FlowDefinition;
  run: FlowRun;
  nextNode?: FlowNode;
}
