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
  /** Tool operation that produced this citation (tool-call mode only). */
  operation?: "search" | "read" | "create" | "write" | "append" | "delete";
  /** Best-effort linked session from memory_links (usually daily digests). */
  session?: {
    provider: AgentProvider;
    id: string;
    projectPath: string;
  };
}

export type AskStreamPhase = "retrieving" | "indexing_notes" | "generating" | "chunk" | "tool_calling" | "tool_executing" | "done";

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
  /** Tool name for tool_calling / tool_executing phases. */
  toolName?: string;
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
  threadId?: string;
  /** Enable MCP tool-calling for note operations. Default true. */
  enableTools?: boolean;
  /** When aborted, in-flight LLM / tool work stops and no partial turn is persisted. */
  signal?: AbortSignal;
  /** Override the MCP server spawn command. Defaults to auto-detect. */
  mcpServerCommand?: string;
  /** Override the MCP server spawn args. */
  mcpServerArgs?: string[];
}

export interface AskMetaAgentResult {
  answer: string;
  citations: AgentCitation[];
  /** True when embedding search failed/empty and recent digests were used. */
  fallback: boolean;
  digests: MemoryEntry[];
  /** Set when the answer was generated but DB persistence failed. */
  persistWarning?: string;
  /** Number of tool calls executed when enableTools is true. */
  toolCallsExecuted?: number;
}
