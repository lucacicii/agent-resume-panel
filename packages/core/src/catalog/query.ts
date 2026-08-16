import { escapeSqlLiteral, runSqliteJson } from "../sqlite";
import { AgentProvider, AgentSession, CatalogSessionRow, toAgentSession } from "./types";

export async function listSessions(dbPath: string, limit?: number): Promise<AgentSession[]> {
  const safeLimit = limit == null
    ? undefined
    : Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 500, 50_000));
  const limitClause = limit == null
    ? ""
    : `\n     LIMIT ${safeLimit}`;
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms, project_id, native_project_path
     FROM sessions
     WHERE hidden = 0
     ORDER BY updated_at_ms DESC${limitClause};`
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
      session_summary, session_summary_language, session_summary_at_ms, project_id, native_project_path
     FROM sessions
     WHERE hidden = 0
       AND updated_at_ms >= ${from}
       AND updated_at_ms < ${to}
     ORDER BY updated_at_ms DESC, provider ASC, agent_session_id ASC
     LIMIT ${safeLimit};`
  );

  return rows.map((row) => toAgentSession(row));
}


export interface SessionRangeCursor {
  updatedAt: number;
  provider: string;
  id: string;
}

/** Stable keyset-paginated session range reader for unbounded report generation. */
export async function listSessionsInRangePage(
  dbPath: string,
  startMs: number,
  endMs: number,
  options?: { limit?: number; cursor?: SessionRangeCursor }
): Promise<{ sessions: AgentSession[]; nextCursor?: SessionRangeCursor }> {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { sessions: [] };
  }
  const from = Math.floor(startMs);
  const to = Math.floor(endMs);
  if (to <= from) return { sessions: [] };
  const limit = Math.max(1, Math.min(options?.limit ?? 500, 5_000));
  const cursor = options?.cursor;
  const cursorClause = cursor
    ? `AND (
         updated_at_ms < ${Math.floor(cursor.updatedAt)}
         OR (updated_at_ms = ${Math.floor(cursor.updatedAt)} AND provider > '${escapeSqlLiteral(cursor.provider)}')
         OR (updated_at_ms = ${Math.floor(cursor.updatedAt)} AND provider = '${escapeSqlLiteral(cursor.provider)}' AND agent_session_id > '${escapeSqlLiteral(cursor.id)}')
       )`
    : "";
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms, project_id, native_project_path
     FROM sessions
     WHERE hidden = 0
       AND updated_at_ms >= ${from}
       AND updated_at_ms < ${to}
       ${cursorClause}
     ORDER BY updated_at_ms DESC, provider ASC, agent_session_id ASC
     LIMIT ${limit};`
  );
  const sessions = rows.map((row) => toAgentSession(row));
  const last = sessions.at(-1);
  return {
    sessions,
    nextCursor: sessions.length === limit && last
      ? { updatedAt: last.updatedAt, provider: last.provider, id: last.id }
      : undefined
  };
}

export async function listAllSessionsInRange(
  dbPath: string,
  startMs: number,
  endMs: number,
  pageSize = 500
): Promise<AgentSession[]> {
  const sessions: AgentSession[] = [];
  let cursor: SessionRangeCursor | undefined;
  do {
    const page = await listSessionsInRangePage(dbPath, startMs, endMs, {
      limit: pageSize,
      cursor
    });
    sessions.push(...page.sessions);
    cursor = page.nextCursor;
  } while (cursor);
  return sessions;
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
      session_summary, session_summary_language, session_summary_at_ms, project_id, native_project_path
     FROM sessions
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(id)}'
       AND hidden = 0
     LIMIT 1;`
  );

  const row = rows[0];
  return row ? toAgentSession(row) : undefined;
}
