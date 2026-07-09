import { escapeSqlLiteral, runSqliteJson } from "../sqlite";
import { AgentProvider, AgentSession, CatalogSessionRow, toAgentSession } from "./types";

export async function listSessions(dbPath: string, limit = 500): Promise<AgentSession[]> {
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

  return rows.map((row) => toAgentSession(row));
}

export async function listSessionsInRange(
  dbPath: string,
  startMs: number,
  endMs: number,
  limit = 2000
): Promise<AgentSession[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50_000));
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms
     FROM sessions
     WHERE hidden = 0
       AND updated_at_ms >= ${Math.floor(startMs)}
       AND updated_at_ms < ${Math.floor(endMs)}
     ORDER BY updated_at_ms DESC
     LIMIT ${safeLimit};`
  );

  return rows.map((row) => toAgentSession(row));
}

export async function getSessionById(
  dbPath: string,
  provider: AgentProvider,
  id: string
): Promise<AgentSession | undefined> {
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms
     FROM sessions
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(id)}'
       AND hidden = 0
     LIMIT 1;`
  );

  const row = rows[0];
  return row ? toAgentSession(row) : undefined;
}
