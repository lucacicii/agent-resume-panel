import { randomUUID } from "node:crypto";
import { escapeSqlLiteral, runSqlite } from "../sqlite";
import { GtdStatus } from "./types";

export async function insertGtdAiAudit(
  dbPath: string,
  input: {
    provider: string;
    sessionId: string;
    previousStatus: GtdStatus | null;
    newStatus: GtdStatus;
    reason: string;
    sourceReportIds: string[];
  }
): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  const prev =
    input.previousStatus == null ? "NULL" : `'${escapeSqlLiteral(input.previousStatus)}'`;
  const sources = escapeSqlLiteral(JSON.stringify(input.sourceReportIds || []));

  await runSqlite(
    dbPath,
    `INSERT INTO gtd_ai_audit (
       id, provider, agent_session_id, previous_status, new_status, reason, source_report_ids, created_at_ms
     ) VALUES (
       '${escapeSqlLiteral(id)}',
       '${escapeSqlLiteral(input.provider)}',
       '${escapeSqlLiteral(input.sessionId)}',
       ${prev},
       '${escapeSqlLiteral(input.newStatus)}',
       '${escapeSqlLiteral(input.reason || "")}',
       '${sources}',
       ${now}
     );`
  );
  return id;
}
