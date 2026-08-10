/** Shared link-graph trace types (MCP + Desktop). */

export type LinkGraphConfidence = "high" | "medium" | "low";

export type LinkGraphTimelineStatus = "running" | "done" | "failed" | "skipped";

export type LinkGraphAgentPhase =
  | "locate"
  | "expand_fe"
  | "bridge"
  | "expand_be"
  | "structure";

export interface LinkGraphTimelineItem {
  id: string;
  phase: LinkGraphAgentPhase;
  status: LinkGraphTimelineStatus;
  title: string;
  detail?: string;
  evidence?: Array<{ file: string; line: number; preview?: string; path?: string }>;
  at: number;
}

export interface LinkGraphStep {
  id: string;
  role: string;
  title: string;
  narrative: string;
  file: string;
  path: string;
  line: number;
  symbol: string;
  preview: string;
  confidence: LinkGraphConfidence;
  kind?: string;
  terminal?: boolean;
}

export interface LinkGraphOpenEnd {
  symbol: string;
  file?: string;
  line?: number;
  reason: string;
}

export interface LinkGraphFacts {
  hasFeApiClient: boolean;
  hasHttpPath: boolean;
  hasBackendHandler: boolean;
  hasVoField: boolean;
}

export interface LinkGraphTraceArgs {
  workspaceRoot: string;
  symbol: string;
  filePath?: string;
  line?: number;
  selection?: string;
  language?: string;
  backendRoots?: string[];
  timeBudgetMs?: number;
  /** Optional live timeline updates for Desktop UI. */
  onTimeline?: (timeline: LinkGraphTimelineItem[], message?: string) => void;
  signal?: AbortSignal;
}

export interface LinkGraphTraceResult {
  ok: boolean;
  error?: string;
  engine: "llm_agent";
  primaryChain: LinkGraphStep[];
  timeline: LinkGraphTimelineItem[];
  summary: string;
  openEnds: LinkGraphOpenEnd[];
  bridgeStatus: "ok" | "partial" | "failed" | "skipped";
  facts: LinkGraphFacts;
  workspaceRoot: string;
  seed: {
    symbol: string;
    filePath?: string;
    line?: number;
  };
}
