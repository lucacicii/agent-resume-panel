import { AgentProvider } from "../catalog/types";
import { MemoryEntry } from "../memory/schema";

export interface AgentCitation {
  /** Missing on persisted citations created before note sources were supported. */
  source?: "memory" | "note";
  index: number;
  memoryId?: string;
  noteId?: string;
  relMdPath?: string;
  scope?: string;
  heading?: string;
  level: string;
  title: string;
  score?: number;
  periodStartMs?: number;
  /** Truncated digest body for Ask citation hover (no extra DB read). */
  contentPreview?: string;
  /** Best-effort linked session from memory_links (usually daily digests). */
  session?: {
    provider: AgentProvider;
    id: string;
    projectPath: string;
  };
}

export type AskStreamPhase = "retrieving" | "indexing_notes" | "generating" | "chunk" | "done";

export interface AskStreamEvent {
  phase: AskStreamPhase;
  /** Present when phase is "chunk". */
  delta?: string;
  message?: string;
  current?: number;
  total?: number;
  noteTitle?: string;
  chunkCurrent?: number;
  chunkTotal?: number;
}

export interface AskMetaAgentOptions {
  query: string;
  /** Prior turns (user/assistant only); last 6 used. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  panelHome?: string;
  /** Max digests in context. Default 8. */
  limit?: number;
  /** Optional streaming progress callback (desktop Ask tab). */
  onStream?: (event: AskStreamEvent) => void | Promise<void>;
}

export interface AskMetaAgentResult {
  answer: string;
  citations: AgentCitation[];
  /** True when embedding search failed/empty and recent digests were used. */
  fallback: boolean;
  digests: MemoryEntry[];
  /** Set when the answer was generated but DB persistence failed. */
  persistWarning?: string;
}
