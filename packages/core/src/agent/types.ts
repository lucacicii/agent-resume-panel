import { AgentProvider } from "../catalog/types";
import { ReportEntry } from "../report/schema";

export interface AgentCitation {
  /** Missing on persisted citations created before note sources were supported. */
  source?: "report" | "note" | "session";
  index: number;
  reportId?: string;
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
  /** Best-effort linked session from report_links or session tools. */
  session?: {
    provider: AgentProvider;
    id: string;
    projectPath: string;
  };
}

export type AgentStreamPhase = "retrieving" | "indexing_notes" | "generating" | "chunk" | "tool_calling" | "tool_executing" | "done";

export interface AgentStreamEvent {
  phase: AgentStreamPhase;
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

export interface AgentChatOptions {
  query: string;
  /** Prior turns (user/assistant only); last 6 used. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  panelHome?: string;
  /** Max digests in context. Default 8. */
  limit?: number;
  /** Optional streaming progress callback (desktop Ask tab). */
  onStream?: (event: AgentStreamEvent) => void | Promise<void>;
  threadId?: string;
  /** Enable MCP tool-calling for note operations. Default true. */
  enableTools?: boolean;
  /** When aborted, in-flight LLM / tool work stops and no partial turn is persisted. */
  signal?: AbortSignal;
  /** Override the MCP server spawn command. Defaults to auto-detect. */
  mcpServerCommand?: string;
  /** Override the MCP server spawn args. */
  mcpServerArgs?: string[];
  /** OS / VS Code display locale when output language is auto. */
  systemLocale?: string;
  /**
   * Desktop injects resume launcher so session_resume tool can open Workbench/terminal.
   */
  onResumeSession?: (args: {
    provider: AgentProvider;
    sessionId: string;
  }) => Promise<{
    ok: boolean;
    command?: string;
    cwd?: string;
    mode?: string;
    external?: boolean;
    error?: string;
  }>;
}

export interface AgentChatResult {
  answer: string;
  citations: AgentCitation[];
  /** True when embedding search failed/empty and recent digests were used. */
  fallback: boolean;
  digests: ReportEntry[];
  /** Set when the answer was generated but DB persistence failed. */
  persistWarning?: string;
  /** Number of tool calls executed when enableTools is true. */
  toolCallsExecuted?: number;
}
