import { AgentProvider } from "../catalog/types";

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
  /** Truncated digest body for citation hover (no extra DB read). */
  contentPreview?: string;
  /** Tool operation that produced this citation (tool-call mode only). */
  operation?: "search" | "read" | "create" | "write" | "append" | "delete" | "rename" | "move" | "link";
  /** Best-effort linked session from report_links or session tools. */
  session?: {
    provider: AgentProvider;
    id: string;
    projectPath: string;
  };
}
