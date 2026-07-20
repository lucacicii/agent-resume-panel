import { escapeSqlLiteral, runSqliteJson } from "../sqlite";
import { AgentProvider, AgentSession, CatalogSessionRow, toAgentSession } from "./types";

export async function listSessions(dbPath: string, limit = 500): Promise<AgentSession[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50_000));
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms, project_id
     FROM sessions
     WHERE hidden = 0
     ORDER BY updated_at_ms DESC
     LIMIT ${safeLimit};`
  );

  return rows.map((row) => toAgentSession(row));
}

export interface SessionCatalogCounts {
  total: number;
  visible: number;
  hidden: number;
}

export async function countSessions(dbPath: string): Promise<SessionCatalogCounts> {
  const rows = await runSqliteJson<SessionCatalogCounts>(
    dbPath,
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN hidden = 0 THEN 1 ELSE 0 END) AS visible,
      SUM(CASE WHEN hidden = 1 THEN 1 ELSE 0 END) AS hidden
     FROM sessions;`
  );
  const row = rows[0];
  return {
    total: Number(row?.total) || 0,
    visible: Number(row?.visible) || 0,
    hidden: Number(row?.hidden) || 0
  };
}

export async function listSessionsInRange(
  dbPath: string,
  startMs: number,
  endMs: number,
  limit = 2000
): Promise<AgentSession[]> {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return [];
  }
  const from = Math.floor(startMs);
  const to = Math.floor(endMs);
  if (to <= from) {
    return [];
  }
  const safeLimit = Math.max(1, Math.min(limit, 50_000));
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms, project_id
     FROM sessions
     WHERE hidden = 0
       AND updated_at_ms >= ${from}
       AND updated_at_ms < ${to}
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
      session_summary, session_summary_language, session_summary_at_ms, project_id
     FROM sessions
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(id)}'
       AND hidden = 0
     LIMIT 1;`
  );

  const row = rows[0];
  return row ? toAgentSession(row) : undefined;
}
