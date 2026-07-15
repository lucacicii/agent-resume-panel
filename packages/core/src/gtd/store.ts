import { escapeSqlLiteral, runSqlite, runSqliteJson, runSqliteTransaction } from "../sqlite";
import { GtdStatus, isGtdStatus } from "./types";

interface SessionGtdRow {
  provider: string;
  agent_session_id: string;
  status: string;
}

export function sessionGtdKey(provider: string, sessionId: string): string {
  return `${provider}:${sessionId}`;
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
    output[sessionGtdKey(row.provider, row.agent_session_id)] = row.status;
  }
  return output;
}

export async function getSessionGtdStatus(
  dbPath: string,
  provider: string,
  sessionId: string
): Promise<GtdStatus | undefined> {
  const rows = await runSqliteJson<Pick<SessionGtdRow, "status">>(
    dbPath,
    `SELECT status FROM session_gtd
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(sessionId)}'
     LIMIT 1;`
  );
  const status = rows[0]?.status;
  return status && isGtdStatus(status) ? status : undefined;
}

export async function setSessionGtdStatus(
  dbPath: string,
  provider: string,
  sessionId: string,
  status: GtdStatus
): Promise<void> {
  const nowMs = Date.now();
  await runSqlite(
    dbPath,
    `INSERT INTO session_gtd (provider, agent_session_id, status, updated_at_ms)
     VALUES (
       '${escapeSqlLiteral(provider)}',
       '${escapeSqlLiteral(sessionId)}',
       '${escapeSqlLiteral(status)}',
       ${nowMs}
     )
     ON CONFLICT(provider, agent_session_id) DO UPDATE SET
       status = excluded.status,
       updated_at_ms = excluded.updated_at_ms;`
  );
}

/** GTD write on catalog.db plus AI audit row on desktop.db. */
export async function setSessionGtdStatusWithAudit(
  catalogDb: string,
  desktopDb: string,
  input: {
    provider: string;
    sessionId: string;
    status: GtdStatus;
    previousStatus: GtdStatus | null;
    reason: string;
    sourceReportIds: string[];
    auditId: string;
  }
): Promise<void> {
  const nowMs = Date.now();
  const prev =
    input.previousStatus == null ? "NULL" : `'${escapeSqlLiteral(input.previousStatus)}'`;
  const sources = escapeSqlLiteral(JSON.stringify(input.sourceReportIds || []));

  await setSessionGtdStatus(catalogDb, input.provider, input.sessionId, input.status);
  await runSqlite(
    desktopDb,
    `INSERT INTO gtd_ai_audit (
       id, provider, agent_session_id, previous_status, new_status, reason, source_report_ids, created_at_ms
     ) VALUES (
       '${escapeSqlLiteral(input.auditId)}',
       '${escapeSqlLiteral(input.provider)}',
       '${escapeSqlLiteral(input.sessionId)}',
       ${prev},
       '${escapeSqlLiteral(input.status)}',
       '${escapeSqlLiteral(input.reason || "")}',
       '${sources}',
       ${nowMs}
     )`
  );
}
