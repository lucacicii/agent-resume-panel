import { ensureCatalogSchema } from "../catalog/db";
import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";
import { ReportEntry, ReportLevel } from "./schema";

interface ReportEntryRow {
  id: string;
  level: string;
  period_start_ms: number;
  period_end_ms: number;
  title: string | null;
  content: string;
  embedding_json: string | null;
  created_at_ms: number;
}

function rowToEntry(row: ReportEntryRow): ReportEntry {
  return {
    id: row.id,
    level: row.level,
    periodStartMs: row.period_start_ms,
    periodEndMs: row.period_end_ms,
    title: row.title,
    content: row.content,
    embeddingJson: row.embedding_json,
    createdAtMs: row.created_at_ms
  };
}

export async function listReportEntries(
  dbPath: string,
  options?: { level?: ReportLevel | string; limit?: number }
): Promise<ReportEntry[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 500));
  const levelClause = options?.level
    ? `WHERE level = '${escapeSqlLiteral(options.level)}'`
    : "";

  const rows = await runSqliteJson<ReportEntryRow>(
    dbPath,
    `SELECT id, level, period_start_ms, period_end_ms, title, content, embedding_json, created_at_ms
     FROM report_entries
     ${levelClause}
     ORDER BY period_start_ms DESC, created_at_ms DESC
     LIMIT ${limit};`
  );

  return rows.map(rowToEntry);
}

/** Entries whose period_start falls in [startMs, endMs). */
export async function listReportEntriesInRange(
  dbPath: string,
  options: {
    level?: ReportLevel | string;
    startMs: number;
    endMs: number;
    limit?: number;
  }
): Promise<ReportEntry[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const levelClause = options.level
    ? `AND level = '${escapeSqlLiteral(options.level)}'`
    : "";

  const rows = await runSqliteJson<ReportEntryRow>(
    dbPath,
    `SELECT id, level, period_start_ms, period_end_ms, title, content, embedding_json, created_at_ms
     FROM report_entries
     WHERE period_start_ms >= ${Math.floor(options.startMs)}
       AND period_start_ms < ${Math.floor(options.endMs)}
       ${levelClause}
     ORDER BY period_start_ms ASC
     LIMIT ${limit};`
  );

  return rows.map(rowToEntry);
}

export async function getReportJobStatus(
  dbPath: string,
  jobKey: string
): Promise<{ status: string; lastError: string | null; updatedAtMs: number } | undefined> {
  const rows = await runSqliteJson<{
    status: string;
    last_error: string | null;
    updated_at_ms: number;
  }>(
    dbPath,
    `SELECT status, last_error, updated_at_ms FROM report_jobs
     WHERE job_key = '${escapeSqlLiteral(jobKey)}' LIMIT 1;`
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  return { status: row.status, lastError: row.last_error, updatedAtMs: row.updated_at_ms };
}

export async function insertReportEntry(
  dbPath: string,
  entry: ReportEntry,
  links: Array<{ provider: string; agentSessionId: string; projectPath: string }>
): Promise<{ replaced: boolean }> {
  const existing = await runSqliteJson<{ id: string }>(
    dbPath,
    `SELECT id FROM report_entries WHERE id = '${escapeSqlLiteral(entry.id)}' LIMIT 1;`
  );
  const replaced = existing.length > 0;

  const titleSql = entry.title == null ? "NULL" : `'${escapeSqlLiteral(entry.title)}'`;
  const embeddingSql =
    entry.embeddingJson == null ? "NULL" : `'${escapeSqlLiteral(entry.embeddingJson)}'`;

  await runSqlite(
    dbPath,
    `INSERT OR REPLACE INTO report_entries
      (id, level, period_start_ms, period_end_ms, title, content, embedding_json, created_at_ms)
     VALUES (
      '${escapeSqlLiteral(entry.id)}',
      '${escapeSqlLiteral(entry.level)}',
      ${entry.periodStartMs},
      ${entry.periodEndMs},
      ${titleSql},
      '${escapeSqlLiteral(entry.content)}',
      ${embeddingSql},
      ${entry.createdAtMs}
     );`
  );

  await runSqlite(dbPath, `DELETE FROM report_links WHERE report_id = '${escapeSqlLiteral(entry.id)}';`);

  for (const link of links) {
    await runSqlite(
      dbPath,
      `INSERT INTO report_links (report_id, provider, agent_session_id, project_path)
       VALUES (
        '${escapeSqlLiteral(entry.id)}',
        '${escapeSqlLiteral(link.provider)}',
        '${escapeSqlLiteral(link.agentSessionId)}',
        '${escapeSqlLiteral(link.projectPath)}'
       );`
    );
  }

  return { replaced };
}

export async function upsertReportJob(
  dbPath: string,
  jobKey: string,
  status: string,
  lastError?: string
): Promise<void> {
  const errSql = lastError == null ? "NULL" : `'${escapeSqlLiteral(lastError)}'`;
  const now = Date.now();
  await runSqlite(
    dbPath,
    `INSERT OR REPLACE INTO report_jobs (job_key, status, last_error, updated_at_ms)
     VALUES ('${escapeSqlLiteral(jobKey)}', '${escapeSqlLiteral(status)}', ${errSql}, ${now});`
  );
}

export interface ReportLinkRow {
  reportId: string;
  provider: string | null;
  agentSessionId: string | null;
  projectPath: string | null;
}

export async function listReportLinks(dbPath: string, reportId: string): Promise<ReportLinkRow[]> {
  const rows = await runSqliteJson<{
    report_id: string;
    provider: string | null;
    agent_session_id: string | null;
    project_path: string | null;
  }>(
    dbPath,
    `SELECT report_id, provider, agent_session_id, project_path
     FROM report_links
     WHERE report_id = '${escapeSqlLiteral(reportId)}'
     LIMIT 50;`
  );

  return rows.map((row) => ({
    reportId: row.report_id,
    provider: row.provider,
    agentSessionId: row.agent_session_id,
    projectPath: row.project_path
  }));
}

export async function getReportEntryById(
  dbPath: string,
  id: string
): Promise<ReportEntry | undefined> {
  await ensureCatalogSchema(dbPath);
  const rows = await runSqliteJson<ReportEntryRow>(
    dbPath,
    `SELECT id, level, period_start_ms, period_end_ms, title, content, embedding_json, created_at_ms
     FROM report_entries
     WHERE id = '${escapeSqlLiteral(id)}'
     LIMIT 1;`
  );
  const row = rows[0];
  return row ? rowToEntry(row) : undefined;
}
