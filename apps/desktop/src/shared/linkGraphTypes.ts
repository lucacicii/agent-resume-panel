/** Shared contracts for Workbench Link Graph (main ↔ preload ↔ renderer). */

export type LinkGraphStopReason =
  | "complete"
  | "time_budget"
  | "cancelled"
  | "empty_seed"
  | "invalid_seed"
  | "bridge_failed";

export type LinkGraphPhase = "searching" | "analyzing" | "done" | "error";

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

/** Flattened step for jump / LLM evidence (not primary UI). */
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
  matchedAlias?: string;
  edgeKind?: LinkGraphEdgeKind;
  nodeKind?: LinkGraphNodeKind;
  bridgeKind?: LinkGraphBridgeKind;
  confidence?: LinkGraphConfidence;
  branchId?: string;
}

/** Same-file extra references under the seed step. */
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

export interface LinkGraphBranch {
  id: string;
  entryFile: string;
  entryLine: number;
  entryPreview: string;
  pruned: boolean;
  pruneReason?: string;
  steps: LinkGraphChainStep[];
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

export interface LinkGraphSeed {
  projectPath: string;
  filePath: string;
  selection: string;
  startLine: number;
  endLine: number;
}

export type LinkGraphOutputLanguage = "auto" | "en" | "zh-cn" | "ja";

export interface LinkGraphAnalyzeArgs extends LinkGraphSeed {
  /** Re-run LLM narrative only; pair with sessionRequestId. */
  reanalyzeOnly?: boolean;
  sessionRequestId?: string;
  maxBranches?: number;
  timeBudgetMs?: number;
  maxHops?: number;
  skipLlm?: boolean;
  outputLanguage?: LinkGraphOutputLanguage | string;
  /**
   * Extra roots to search for BE controllers / DTOs (absolute or ~ paths).
   * Also auto-includes sibling repos under the parent of projectPath when present.
   */
  backendRoots?: string[];
  /**
   * LLM discover policy:
   * - off: never
   * - on_gap: when bridge fails or no URL on chain (default)
   * - always: after rule dig
   */
  discoverMode?: "off" | "on_gap" | "always";
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
  branches: LinkGraphBranch[];
  openEnds: LinkGraphOpenEnd[];
  analysis: LinkGraphAnalysis | null;
  reachedDepth: number;
  stopReason: LinkGraphStopReason;
  truncated: boolean;
  truncatedBranchCount: number;
  complete: boolean;
  engine: "rg" | "node" | "mixed" | "none";
  llmStatus: "skipped" | "ok" | "unconfigured" | "failed";
  llmError?: string;
  discardedCount?: number;
  bridgeStatus?: LinkGraphBridgeStatus;
}

export interface LinkGraphProgressEvent {
  requestId: string;
  phase: LinkGraphPhase;
  message: string;
  hitCount: number;
  reachedDepth: number;
}
