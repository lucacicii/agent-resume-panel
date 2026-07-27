export type AgentProvider =
  | "codex"
  | "claude"
  | "agy"
  | "grok"
  | "opencode"
  | "pi"
  | "cursor"
  | "cursor-ide"
  | "chat";

export interface AgentSession {
  provider: AgentProvider;
  id: string;
  title: string;
  projectPath: string;
  /** Logical project id when catalog projects reconcile has run. */
  projectId?: string;
  updatedAt: number;
  model?: string;
  branch?: string;
  source?: string;
  /**
   * When provider is "chat" (ACP), the underlying ACP agent
   * (codex / claude / grok / opencode / pi).
   */
  acpProvider?: string;
  archived?: boolean;
  messageCount?: number;
  sessionSummary?: string;
  /** Catalog session_summary_at_ms when known. */
  sessionSummaryAtMs?: number;
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
  session_summary?: string | null;
  session_summary_language?: string | null;
  session_summary_at_ms?: number | null;
  project_id?: string | null;
}

export function toAgentSession(row: CatalogSessionRow): AgentSession {
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
    session.acpProvider = row.acp_provider;
  }
  const summary = row.session_summary?.trim();
  if (summary) {
    session.sessionSummary = summary;
  }
  if (row.session_summary_at_ms != null && Number.isFinite(row.session_summary_at_ms)) {
    session.sessionSummaryAtMs = Number(row.session_summary_at_ms);
  }
  const projectId = row.project_id?.trim();
  if (projectId) {
    session.projectId = projectId;
  }

  return session;
}
