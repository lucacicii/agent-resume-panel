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
      session_summary, session_summary_language, session_summary_at_ms, project_id, native_project_path,
      last_exit_waiting
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
      session_summary, session_summary_language, session_summary_at_ms, project_id, native_project_path,
      last_exit_waiting
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
      session_summary, session_summary_language, session_summary_at_ms, project_id, native_project_path,
      last_exit_waiting
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

export interface SessionQueryCursor {
  updatedAt: number;
  provider: string;
  id: string;
}

export interface SessionQueryRequest {
  limit?: number;
  cursor?: SessionQueryCursor;
  search?: string;
  /** Keep only sessions from these providers (matches every one of them). */
  providers?: string[];
  fromMs?: number;
  toMs?: number;
  projectPath?: string;
  projectId?: string;
  /** Keep only sessions this work item owns (the reverse of `work_item_sessions`). */
  taskNoteId?: string;
  /** Keep only sessions carrying one of these stored GTD marks. */
  gtdStatuses?: string[];
  /** Keep only sessions that carry no stored GTD mark. */
  gtdUntagged?: boolean;
  keys?: Array<{ provider: string; id: string }>;
  unassignedOnly?: boolean;
}

export interface SessionQueryPage {
  sessions: AgentSession[];
  total: number;
  nextCursor?: SessionQueryCursor;
}

/**
 * Stable keyset-paginated reader for Desktop session surfaces.  Keep all
 * filtering in SQL so a search or scope change covers the entire catalog,
 * rather than only the pages already rendered by the client.
 */
export async function querySessionsPage(
  dbPath: string,
  request: SessionQueryRequest = {}
): Promise<SessionQueryPage> {
  const rawLimit = request.limit ?? 100;
  if (!Number.isFinite(rawLimit) || rawLimit < 1 || rawLimit > 500) {
    throw new Error("Session page limit must be between 1 and 500.");
  }
  const limit = Math.floor(rawLimit);
  const where: string[] = ["s.hidden = 0"];
  const add = (sql: string) => where.push(sql);
  const like = (value: string) => `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const inList = (values: string[]) =>
    values.map((value) => `'${escapeSqlLiteral(value)}'`).join(", ");

  const providers = (request.providers ?? []).map((value) => value.trim()).filter(Boolean);
  if (providers.length > 0) add(`s.provider IN (${inList(providers)})`);
  if (request.projectPath?.trim()) add(`s.project_path = '${escapeSqlLiteral(request.projectPath.trim())}'`);
  if (request.projectId?.trim()) add(`s.project_id = '${escapeSqlLiteral(request.projectId.trim())}'`);
  if (request.taskNoteId?.trim()) {
    add(`EXISTS (SELECT 1 FROM work_item_sessions w
      WHERE w.provider = s.provider AND w.agent_session_id = s.agent_session_id
        AND w.work_item_note_id = '${escapeSqlLiteral(request.taskNoteId.trim())}')`);
  }
  if (request.fromMs != null) {
    if (!Number.isFinite(request.fromMs)) throw new Error("Invalid session fromMs.");
    add(`s.updated_at_ms >= ${Math.floor(request.fromMs)}`);
  }
  if (request.toMs != null) {
    if (!Number.isFinite(request.toMs)) throw new Error("Invalid session toMs.");
    add(`s.updated_at_ms < ${Math.floor(request.toMs)}`);
  }
  if (request.search?.trim()) {
    const term = escapeSqlLiteral(like(request.search.trim()));
    add(`(s.title LIKE '${term}' ESCAPE '\\' COLLATE NOCASE
      OR s.user_title LIKE '${term}' ESCAPE '\\' COLLATE NOCASE
      OR s.agent_session_id LIKE '${term}' ESCAPE '\\' COLLATE NOCASE
      OR s.provider LIKE '${term}' ESCAPE '\\' COLLATE NOCASE
      OR s.project_path LIKE '${term}' ESCAPE '\\' COLLATE NOCASE
      OR s.session_summary LIKE '${term}' ESCAPE '\\' COLLATE NOCASE)`);
  }
  const gtdStatuses = (request.gtdStatuses ?? []).map((value) => value.trim()).filter(Boolean);
  if (gtdStatuses.length > 0) {
    add(`EXISTS (SELECT 1 FROM session_gtd g WHERE g.provider = s.provider AND g.agent_session_id = s.agent_session_id AND g.status IN (${inList(gtdStatuses)}))`);
  }
  if (request.gtdUntagged) {
    add(`NOT EXISTS (SELECT 1 FROM session_gtd g WHERE g.provider = s.provider AND g.agent_session_id = s.agent_session_id)`);
  }
  if (request.unassignedOnly) {
    add(`NOT EXISTS (SELECT 1 FROM work_item_sessions w WHERE w.provider = s.provider AND w.agent_session_id = s.agent_session_id)`);
  }
  if (request.keys) {
    if (request.keys.length > 5000) throw new Error("Too many session keys.");
    if (!request.keys.length) return { sessions: [], total: 0 };
    add(`(${request.keys.map((key) => `(s.provider = '${escapeSqlLiteral(key.provider)}' AND s.agent_session_id = '${escapeSqlLiteral(key.id)}')`).join(" OR ")})`);
  }
  // `total` describes the complete filtered result set, not just rows after
  // the current keyset cursor.
  const countBase = `FROM sessions s WHERE ${where.join(" AND ")}`;
  const countRows = await runSqliteJson<{ total: number }>(dbPath, `SELECT COUNT(*) AS total ${countBase};`);

  const cursor = request.cursor;
  if (cursor) {
    if (!Number.isFinite(cursor.updatedAt) || !cursor.provider || !cursor.id) throw new Error("Invalid session cursor.");
    add(`(s.updated_at_ms < ${Math.floor(cursor.updatedAt)}
      OR (s.updated_at_ms = ${Math.floor(cursor.updatedAt)} AND s.provider > '${escapeSqlLiteral(cursor.provider)}')
      OR (s.updated_at_ms = ${Math.floor(cursor.updatedAt)} AND s.provider = '${escapeSqlLiteral(cursor.provider)}' AND s.agent_session_id > '${escapeSqlLiteral(cursor.id)}'))`);
  }

  const base = `FROM sessions s WHERE ${where.join(" AND ")}`;
  const rows = await runSqliteJson<CatalogSessionRow>(dbPath, `
    SELECT s.provider, s.agent_session_id, s.title, s.project_path, s.updated_at_ms, s.archived,
      s.message_count, s.model, s.branch, s.source, s.acp_provider, s.user_title, s.hidden, s.last_synced_at_ms,
      s.session_summary, s.session_summary_language, s.session_summary_at_ms, s.project_id, s.native_project_path,
      s.last_exit_waiting
    ${base}
    ORDER BY s.updated_at_ms DESC, s.provider ASC, s.agent_session_id ASC
    LIMIT ${limit};`);
  const sessions = rows.map((row) => toAgentSession(row));
  const last = sessions.at(-1);
  return {
    sessions,
    total: Number(countRows[0]?.total) || 0,
    nextCursor: sessions.length === limit && last
      ? { updatedAt: last.updatedAt, provider: last.provider, id: last.id }
      : undefined
  };
}

export interface SessionFacetCounts {
  /** Visible sessions in the catalog, before any filter. */
  total: number;
  byProvider: Record<string, number>;
  byGtdStatus: Record<string, number>;
  /** Visible sessions with no stored GTD mark. */
  untagged: number;
  /** Visible sessions per owning work item. */
  byTask: Record<string, number>;
  /** Visible sessions owned by no work item. */
  unassigned: number;
}

/**
 * Filter-chip counts for the whole catalog, ignoring search and date filters.
 *
 * A paginated list only ever holds a few pages, so the counts behind the
 * provider / GTD chips have to come from SQL rather than from what is rendered.
 */
export async function sessionFacetCounts(dbPath: string): Promise<SessionFacetCounts> {
  const [totalRows, providerRows, gtdRows, untaggedRows, taskRows, unassignedRows] = await Promise.all([
    runSqliteJson<{ n: number }>(dbPath, `SELECT COUNT(*) AS n FROM sessions WHERE hidden = 0;`),
    runSqliteJson<{ provider: string; n: number }>(
      dbPath,
      `SELECT provider, COUNT(*) AS n FROM sessions WHERE hidden = 0 GROUP BY provider;`
    ),
    runSqliteJson<{ status: string; n: number }>(
      dbPath,
      `SELECT g.status AS status, COUNT(*) AS n
       FROM session_gtd g
       JOIN sessions s ON s.provider = g.provider AND s.agent_session_id = g.agent_session_id
       WHERE s.hidden = 0
       GROUP BY g.status;`
    ),
    runSqliteJson<{ n: number }>(
      dbPath,
      `SELECT COUNT(*) AS n FROM sessions s
       WHERE s.hidden = 0
         AND NOT EXISTS (SELECT 1 FROM session_gtd g
                         WHERE g.provider = s.provider AND g.agent_session_id = s.agent_session_id);`
    ),
    runSqliteJson<{ note_id: string; n: number }>(
      dbPath,
      `SELECT w.work_item_note_id AS note_id, COUNT(*) AS n
       FROM work_item_sessions w
       JOIN sessions s ON s.provider = w.provider AND s.agent_session_id = w.agent_session_id
       WHERE s.hidden = 0
       GROUP BY w.work_item_note_id;`
    ),
    runSqliteJson<{ n: number }>(
      dbPath,
      `SELECT COUNT(*) AS n FROM sessions s
       WHERE s.hidden = 0
         AND NOT EXISTS (SELECT 1 FROM work_item_sessions w
                         WHERE w.provider = s.provider AND w.agent_session_id = s.agent_session_id);`
    )
  ]);

  const byProvider: Record<string, number> = {};
  for (const row of providerRows) byProvider[row.provider] = Number(row.n) || 0;
  const byGtdStatus: Record<string, number> = {};
  for (const row of gtdRows) byGtdStatus[row.status] = Number(row.n) || 0;
  const byTask: Record<string, number> = {};
  for (const row of taskRows) byTask[row.note_id] = Number(row.n) || 0;

  return {
    total: Number(totalRows[0]?.n) || 0,
    byProvider,
    byGtdStatus,
    untagged: Number(untaggedRows[0]?.n) || 0,
    byTask,
    unassigned: Number(unassignedRows[0]?.n) || 0
  };
}
