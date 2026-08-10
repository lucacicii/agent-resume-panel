/** Shared contracts for Workbench Link Graph (main ↔ preload ↔ renderer). */

export type LinkGraphStopReason =
  | "complete"
  | "max_hits"
  | "max_files"
  | "max_symbols"
  | "time_budget"
  | "safety_depth"
  | "cancelled"
  | "empty_seed"
  | "invalid_seed";

export type LinkGraphPhase = "searching" | "analyzing" | "done" | "error";

export type LinkGraphHopRole =
  | "definition"
  | "write"
  | "read"
  | "call"
  | "transform"
  | "other";

export type LinkGraphConfidence = "high" | "medium" | "low";

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
}

export interface LinkGraphFrontierItem {
  symbol: string;
  depth: number;
  fromRelativePath?: string;
  score: number;
}

export interface LinkGraphHop {
  id: string;
  role: LinkGraphHopRole;
  title: string;
  narrative: string;
  file: string;
  line: number;
  confidence: LinkGraphConfidence;
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
  edges?: Array<{ from: string; to: string; label?: string }>;
  discardedHits?: string[];
  confidence: LinkGraphConfidence;
}

export interface LinkGraphSeed {
  projectPath: string;
  filePath: string;
  selection: string;
  startLine: number;
  endLine: number;
}

/** Narrative language for summary / hops. `auto` follows LLM/UI settings. */
export type LinkGraphOutputLanguage = "auto" | "en" | "zh-cn" | "ja";

export interface LinkGraphAnalyzeArgs extends LinkGraphSeed {
  /** Resume a prior request: expand remaining frontier with a fresh budget. */
  continueFromRequestId?: string;
  /**
   * Re-run LLM on an existing session without re-searching (language change).
   * Requires continueFromRequestId.
   */
  reanalyzeOnly?: boolean;
  maxHits?: number;
  maxFiles?: number;
  maxSymbols?: number;
  timeBudgetMs?: number;
  safetyMaxDepth?: number;
  /** When true, skip LLM even if configured. */
  skipLlm?: boolean;
  /** Summary / hop narrative language preference. */
  outputLanguage?: LinkGraphOutputLanguage | string;
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
  /** Remaining expand queue (full list retained in session; may be large). */
  frontier: LinkGraphFrontierItem[];
  /** True remaining count (equals frontier.length; kept explicit for UI). */
  frontierCount: number;
  analysis: LinkGraphAnalysis | null;
  reachedDepth: number;
  stopReason: LinkGraphStopReason;
  truncated: boolean;
  complete: boolean;
  engine: "rg" | "node" | "mixed" | "none";
  llmStatus: "skipped" | "ok" | "unconfigured" | "failed";
  llmError?: string;
}

export interface LinkGraphProgressEvent {
  requestId: string;
  phase: LinkGraphPhase;
  message: string;
  hitCount: number;
  reachedDepth: number;
}
