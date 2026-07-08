import { AgentSession } from "../history/types";
import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../history/sqlite";
import { CatalogSessionRow, toAgentSession } from "./types";

export const GTD_STATUSES = ["inbox", "next", "waiting", "someday", "reference"] as const;
export type GtdStatus = (typeof GTD_STATUSES)[number];

interface SessionGtdRow {
  provider: string;
  agent_session_id: string;
  status: string;
}

export function isGtdStatus(value: string): value is GtdStatus {
  return (GTD_STATUSES as readonly string[]).includes(value);
}

export function sessionGtdKey(session: Pick<AgentSession, "provider" | "id">): string {
  return `${session.provider}:${session.id}`;
}

export async function loadSessionGtdMap(dbPath: string): Promise<Record<string, GtdStatus>> {
  const rows = await runSqliteJson<SessionGtdRow>(
    dbPath,
    "SELECT provider, agent_session_id, status FROM session_gtd;"
  );

  const output: Record<string, GtdStatus> = {};
  for (const row of rows) {
    if (!isGtdStatus(row.status)) {
      continue;
    }
    output[`${row.provider}:${row.agent_session_id}`] = row.status;
  }

  return output;
}

export async function getSessionGtdStatus(
  dbPath: string,
  provider: AgentSession["provider"],
  sessionId: string
): Promise<GtdStatus | undefined> {
  const rows = await runSqliteJson<Pick<SessionGtdRow, "status">>(
    dbPath,
    `SELECT status FROM session_gtd
     WHERE provider = '${escapeSqlLiteral(provider)}' AND agent_session_id = '${escapeSqlLiteral(sessionId)}'
     LIMIT 1;`
  );

  const status = rows[0]?.status;
  return status && isGtdStatus(status) ? status : undefined;
}

export async function setSessionGtdStatus(
  dbPath: string,
  session: Pick<AgentSession, "provider" | "id">,
  status: GtdStatus
): Promise<void> {
  const nowMs = Date.now();
  await runSqlite(
    dbPath,
    `INSERT INTO session_gtd (provider, agent_session_id, status, updated_at_ms)
     VALUES (
       '${escapeSqlLiteral(session.provider)}',
       '${escapeSqlLiteral(session.id)}',
       '${escapeSqlLiteral(status)}',
       ${nowMs}
     )
     ON CONFLICT(provider, agent_session_id) DO UPDATE SET
       status = excluded.status,
       updated_at_ms = excluded.updated_at_ms;`
  );
}

export async function clearSessionGtdStatus(
  dbPath: string,
  session: Pick<AgentSession, "provider" | "id">
): Promise<void> {
  await runSqlite(
    dbPath,
    `DELETE FROM session_gtd
     WHERE provider = '${escapeSqlLiteral(session.provider)}'
       AND agent_session_id = '${escapeSqlLiteral(session.id)}';`
  );
}

export async function querySessionsByGtdStatus(
  dbPath: string,
  status: GtdStatus,
  limit = 50_000
): Promise<AgentSession[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50_000));
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT s.provider, s.agent_session_id, s.title, s.project_path, s.updated_at_ms, s.archived,
      s.message_count, s.model, s.branch, s.source, s.acp_provider, s.user_title, s.hidden, s.last_synced_at_ms,
      s.session_summary, s.session_summary_language, s.session_summary_at_ms
     FROM sessions s
     INNER JOIN session_gtd g
       ON g.provider = s.provider AND g.agent_session_id = s.agent_session_id
     WHERE s.hidden = 0 AND g.status = '${escapeSqlLiteral(status)}'
     ORDER BY s.updated_at_ms DESC
     LIMIT ${safeLimit};`
  );

  return rows.map((row) => toAgentSession(row, undefined, "any"));
}