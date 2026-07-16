import { AgentSession } from "../history/types";
import { runSqliteJson } from "../history/sqlite";
import { LlmOutputLanguage } from "../llm/languages";
import { CatalogSessionRow, CatalogSettings, SessionSummaryPolicy, toAgentSession } from "./types";

export async function querySidebarSessions(
  catalog: CatalogSettings,
  maxItems: number,
  outputLanguage?: LlmOutputLanguage
): Promise<AgentSession[]> {
  const limit = catalog.sidebarMode === "full" ? Math.max(maxItems, catalog.syncMaxItems) : maxItems;
  return queryVisibleSessions(catalog.dbPath, limit, outputLanguage);
}

export async function queryCatalogSessions(
  catalog: CatalogSettings,
  outputLanguage?: LlmOutputLanguage,
  summaryPolicy: SessionSummaryPolicy = "match"
): Promise<AgentSession[]> {
  return queryVisibleSessions(catalog.dbPath, catalog.syncMaxItems, outputLanguage, summaryPolicy);
}

export async function querySessionById(
  dbPath: string,
  provider: AgentSession["provider"],
  id: string
): Promise<AgentSession | undefined> {
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms
     FROM sessions
     WHERE provider = '${escapeProvider(provider)}' AND agent_session_id = '${escapeId(id)}' AND hidden = 0
     LIMIT 1;`
  );

  const row = rows[0];
  return row ? toAgentSession(row) : undefined;
}

export async function getSessionSummaryFromCatalog(
  dbPath: string,
  provider: AgentSession["provider"],
  sessionId: string,
  language: LlmOutputLanguage
): Promise<string | undefined> {
  const rows = await runSqliteJson<Pick<CatalogSessionRow, "session_summary" | "session_summary_language">>(
    dbPath,
    `SELECT session_summary, session_summary_language
     FROM sessions
     WHERE provider = '${escapeProvider(provider)}' AND agent_session_id = '${escapeId(sessionId)}'
     LIMIT 1;`
  );

  const row = rows[0];
  if (!row?.session_summary?.trim() || row.session_summary_language !== language) {
    return undefined;
  }

  return row.session_summary.trim();
}

async function queryVisibleSessions(
  dbPath: string,
  limit: number,
  outputLanguage?: LlmOutputLanguage,
  summaryPolicy: SessionSummaryPolicy = "match"
): Promise<AgentSession[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50_000));
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms
     FROM sessions
     WHERE hidden = 0
     ORDER BY updated_at_ms DESC
     LIMIT ${safeLimit};`
  );

  return rows.map((row) => toAgentSession(row, outputLanguage, summaryPolicy));
}

function escapeProvider(provider: string): string {
  return provider.replaceAll("'", "''");
}

function escapeId(id: string): string {
  return id.replaceAll("'", "''");
}