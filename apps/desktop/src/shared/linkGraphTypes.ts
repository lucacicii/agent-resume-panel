/** Shared contracts for Workbench Link Graph (main ↔ preload ↔ renderer). */

export type LinkGraphStopReason =
  | "complete"
  | "time_budget"
  | "cancelled"
  | "empty_seed"
  | "invalid_seed"
  | "bridge_failed";

export type LinkGraphPhase = "searching" | "analyzing" | "done" | "error";

/** Agent exploration phases shown in the side-panel timeline. */
export type LinkGraphAgentPhase =
  | "locate"
  | "expand_fe"
  | "bridge"
  | "expand_be"
  | "structure";

export type LinkGraphTimelineStatus = "running" | "done" | "failed" | "skipped";

export interface LinkGraphTimelineEvidence {
  file: string;
  line: number;
  preview?: string;
  path?: string;
}

export interface LinkGraphTimelineItem {
  id: string;
  phase: LinkGraphAgentPhase;
  status: LinkGraphTimelineStatus;
  title: string;
  detail?: string;
  evidence?: LinkGraphTimelineEvidence[];
  stepId?: string;
  at: number;
}

export type LinkGraphHopRole =
  | "definition"
  | "write"
  | "read"
  | "call"
  | "transform"
  | "import"
  | "bridge"
  | "reference"
  | "other";

export type LinkGraphConfidence = "high" | "medium" | "low";

export type LinkGraphEdgeKind =
  | "refers"
  | "imports"
  | "defines"
  | "reexports"
  | "bridge";

export type LinkGraphBridgeKind =
  | "shared_module"
  | "openapi"
  | "http_route"
  | "name_family"
  | "structural"
  | "llm_ranked"
  | "llm_discover"
  | "api_client";

export type LinkGraphNodeKind =
  | "seed"
  | "reference"
  | "import"
  | "definition"
  | "reexport"
  | "vo_field"
  | "api_client"
  | "be_controller"
  | "bridge"
  | "unknown";

export type LinkGraphBridgeStatus = "skipped" | "ok" | "failed" | "partial";

/** Flattened step for jump navigation. */
export interface LinkGraphHit {
  path: string;
  relativePath: string;
  line: number;
  column: number;
  endColumn: number;
  preview: string;
  depth: number;
  symbol: string;
  reason: string;
  score: number;
  edgeKind?: LinkGraphEdgeKind;
  nodeKind?: LinkGraphNodeKind;
  bridgeKind?: LinkGraphBridgeKind;
  confidence?: LinkGraphConfidence;
}

export interface LinkGraphPageRef {
  line: number;
  column: number;
  endColumn: number;
  preview: string;
}

export interface LinkGraphChainStep {
  id: string;
  edgeKind: LinkGraphEdgeKind;
  nodeKind: LinkGraphNodeKind;
  role: LinkGraphHopRole;
  title: string;
  narrative: string;
  file: string;
  path: string;
  line: number;
  column?: number;
  endColumn?: number;
  symbol: string;
  preview: string;
  confidence: LinkGraphConfidence;
  bridgeKind?: LinkGraphBridgeKind;
  importSpecifier?: string;
  terminal?: boolean;
  pageRefs?: LinkGraphPageRef[];
}

export interface LinkGraphHop {
  id: string;
  role: LinkGraphHopRole;
  title: string;
  narrative: string;
  file: string;
  line: number;
  confidence: LinkGraphConfidence;
  bridgeKind?: LinkGraphBridgeKind;
}

export interface LinkGraphOpenEnd {
  symbol: string;
  file?: string;
  line?: number;
  reason: string;
}

export interface LinkGraphAnalysis {
  summary: string;
  complete: boolean;
  openEnds?: LinkGraphOpenEnd[];
  hops: LinkGraphHop[];
  confidence: LinkGraphConfidence;
}

export type LinkGraphOutputLanguage = "auto" | "en" | "zh-cn" | "ja";

export interface LinkGraphAnalyzeArgs {
  projectPath: string;
  filePath: string;
  selection: string;
  startLine: number;
  endLine: number;
  timeBudgetMs?: number;
  outputLanguage?: LinkGraphOutputLanguage | string;
  /** Extra roots for backend search (also auto-discovered under monorepo). */
  backendRoots?: string[];
}

export interface LinkGraphAnalyzeResult {
  requestId: string;
  seed: {
    selection: string;
    symbol: string;
    filePath: string;
    relativePath: string;
    startLine: number;
    endLine: number;
  };
  hits: LinkGraphHit[];
  primaryChain: LinkGraphChainStep[];
  openEnds: LinkGraphOpenEnd[];
  analysis: LinkGraphAnalysis | null;
  reachedDepth: number;
  stopReason: LinkGraphStopReason;
  complete: boolean;
  engine: "llm_agent" | "none";
  llmStatus: "skipped" | "ok" | "unconfigured" | "failed";
  llmError?: string;
  bridgeStatus?: LinkGraphBridgeStatus;
  timeline?: LinkGraphTimelineItem[];
}

export interface LinkGraphProgressEvent {
  requestId: string;
  phase: LinkGraphPhase;
  message: string;
  hitCount: number;
  reachedDepth: number;
  timeline?: LinkGraphTimelineItem[];
}
