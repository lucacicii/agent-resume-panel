import { AgentProvider } from "../catalog/types";
import { MemoryEntry } from "../memory/schema";

export interface AgentCitation {
  index: number;
  memoryId: string;
  level: string;
  title: string;
  score?: number;
  periodStartMs?: number;
  /** Best-effort linked session from memory_links (usually daily digests). */
  session?: {
    provider: AgentProvider;
    id: string;
    projectPath: string;
  };
}

export interface AgentSessionRef {
  provider: AgentProvider;
  id: string;
  projectPath: string;
  title?: string;
}

export interface AskMetaAgentOptions {
  query: string;
  /** Prior turns (user/assistant only); last 6 used. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  panelHome?: string;
  /** Max digests in context. Default 8. */
  limit?: number;
}

export interface AskMetaAgentResult {
  answer: string;
  citations: AgentCitation[];
  /** True when embedding search failed/empty and recent digests were used. */
  fallback: boolean;
  digests: MemoryEntry[];
}

export interface BuildHandoffBriefOptions {
  query?: string;
  answer?: string;
  citations: AgentCitation[];
  digests: MemoryEntry[];
  targetSession?: AgentSessionRef;
  resumeCommand?: string;
}
