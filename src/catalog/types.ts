import { AcpAgentProvider } from "../acp/types";
import { AgentProvider, AgentSession } from "../history/types";
import { summaryLanguagesMatch } from "@agent-resume/core";
import { LlmOutputLanguage } from "../llm/languages";

export type CatalogStalePolicy = "hide" | "purge";
export type CatalogSidebarMode = "legacy" | "full";

export interface CatalogSettings {
  dbPath: string;
  syncMaxItems: number;
  stalePolicy: CatalogStalePolicy;
  sidebarMode: CatalogSidebarMode;
}

export interface CatalogSessionRow {
  provider: AgentProvider;
  agent_session_id: string;
  title: string;
  project_path: string;
  updated_at_ms: number;
  archived: number;
  message_count: number | null;
  model: string | null;
  branch: string | null;
  source: string | null;
  acp_provider: string | null;
  user_title: string | null;
  hidden: number;
  last_synced_at_ms: number | null;
  transcript_kind?: string | null;
  transcript_refs?: string | null;
  session_summary?: string | null;
  session_summary_language?: string | null;
  session_summary_at_ms?: number | null;
}

export type SessionSummaryPolicy = "match" | "any";

export function toAgentSession(
  row: CatalogSessionRow,
  outputLanguage?: LlmOutputLanguage,
  summaryPolicy: SessionSummaryPolicy = "match"
): AgentSession {
  const title = (row.user_title?.trim() || row.title || row.agent_session_id).trim();
  const session: AgentSession = {
    provider: row.provider,
    id: row.agent_session_id,
    title,
    projectPath: row.project_path,
    updatedAt: row.updated_at_ms
  };

  if (row.archived) {
    session.archived = true;
  }
  if (row.message_count != null) {
    session.messageCount = row.message_count;
  }
  if (row.model) {
    session.model = row.model;
  }
  if (row.branch) {
    session.branch = row.branch;
  }
  if (row.source) {
    session.source = row.source;
  }
  if (row.acp_provider && row.provider === "chat") {
    session.acpProvider = row.acp_provider as AcpAgentProvider;
  }
  const summary = row.session_summary?.trim();
  if (
    summary &&
    (summaryPolicy === "any" ||
      (outputLanguage && summaryLanguagesMatch(row.session_summary_language, outputLanguage)))
  ) {
    session.sessionSummary = summary;
  }

  return session;
}

export function fromAgentSession(session: AgentSession, syncTimeMs: number): CatalogSessionRow {
  return {
    provider: session.provider,
    agent_session_id: session.id,
    title: session.title,
    project_path: session.projectPath,
    updated_at_ms: session.updatedAt,
    archived: session.archived ? 1 : 0,
    message_count: session.messageCount ?? null,
    model: session.model ?? null,
    branch: session.branch ?? null,
    source: session.source ?? null,
    acp_provider: session.acpProvider ?? null,
    user_title: null,
    hidden: 0,
    last_synced_at_ms: syncTimeMs
  };
}