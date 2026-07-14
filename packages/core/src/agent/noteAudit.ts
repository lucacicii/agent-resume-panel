import { randomUUID } from "node:crypto";
import { ensureCatalogSchema } from "../catalog/db";
import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";

export type AskNoteAuditStatus = "proposed" | "confirmed" | "applied" | "rejected" | "failed";

export interface AskNoteAuditEvent {
  id: string;
  traceId: string;
  askMessageId?: string | null;
  action: string;
  status: AskNoteAuditStatus;
  noteId?: string | null;
  relMdPath?: string | null;
  noteTitle?: string | null;
  actor: string;
  requestJson?: string | null;
  beforeJson?: string | null;
  afterJson?: string | null;
  error?: string | null;
  createdAtMs: number;
  completedAtMs?: number | null;
}

interface AskNoteAuditRow {
  id: string;
  trace_id: string;
  ask_message_id: string | null;
  action: string;
  status: string;
  note_id: string | null;
  rel_md_path: string | null;
  note_title: string | null;
  actor: string;
  request_json: string | null;
  before_json: string | null;
  after_json: string | null;
  error: string | null;
  created_at_ms: number;
  completed_at_ms: number | null;
}

function sqlNullable(value: string | null | undefined): string {
  return value == null ? "NULL" : `'${escapeSqlLiteral(value)}'`;
}

function normalizeJson(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function mapAskNoteAudit(row: AskNoteAuditRow): AskNoteAuditEvent {
  return {
    id: row.id,
    traceId: row.trace_id,
    askMessageId: row.ask_message_id,
    action: row.action,
    status: row.status as AskNoteAuditStatus,
    noteId: row.note_id,
    relMdPath: row.rel_md_path,
    noteTitle: row.note_title,
    actor: row.actor,
    requestJson: row.request_json,
    beforeJson: row.before_json,
    afterJson: row.after_json,
    error: row.error,
    createdAtMs: row.created_at_ms,
    completedAtMs: row.completed_at_ms
  };
}

export async function insertAskNoteAudit(
  dbPath: string,
  input: {
    traceId?: string;
    askMessageId?: string | null;
    action: string;
    status?: AskNoteAuditStatus;
    noteId?: string | null;
    relMdPath?: string | null;
    noteTitle?: string | null;
    actor?: string;
    request?: unknown;
    before?: unknown;
    after?: unknown;
    error?: string | null;
  }
): Promise<string> {
  await ensureCatalogSchema(dbPath);
  const id = randomUUID();
  const traceId = input.traceId || randomUUID();
  const now = Date.now();
  const requestJson = normalizeJson(input.request);
  const beforeJson = normalizeJson(input.before);
  const afterJson = normalizeJson(input.after);

  await runSqlite(
    dbPath,
    `INSERT INTO ask_note_audit (
       id, trace_id, ask_message_id, action, status, note_id, rel_md_path, note_title,
       actor, request_json, before_json, after_json, error, created_at_ms, completed_at_ms
     ) VALUES (
       '${escapeSqlLiteral(id)}',
       '${escapeSqlLiteral(traceId)}',
       ${sqlNullable(input.askMessageId)},
       '${escapeSqlLiteral(input.action)}',
       '${escapeSqlLiteral(input.status || "proposed")}',
       ${sqlNullable(input.noteId)},
       ${sqlNullable(input.relMdPath)},
       ${sqlNullable(input.noteTitle)},
       '${escapeSqlLiteral(input.actor || "ask")}',
       ${sqlNullable(requestJson)},
       ${sqlNullable(beforeJson)},
       ${sqlNullable(afterJson)},
       ${sqlNullable(input.error)},
       ${now},
       ${input.status === "applied" || input.status === "rejected" || input.status === "failed" ? now : "NULL"}
     );`
  );
  return id;
}

export async function updateAskNoteAuditStatus(
  dbPath: string,
  id: string,
  input: {
    status: AskNoteAuditStatus;
    before?: unknown;
    after?: unknown;
    error?: string | null;
  }
): Promise<void> {
  await ensureCatalogSchema(dbPath);
  const completed = input.status === "applied" || input.status === "rejected" || input.status === "failed";
  const sets = [`status = '${escapeSqlLiteral(input.status)}'`];
  const beforeJson = normalizeJson(input.before);
  const afterJson = normalizeJson(input.after);
  if (beforeJson != null) {
    sets.push(`before_json = ${sqlNullable(beforeJson)}`);
  }
  if (afterJson != null) {
    sets.push(`after_json = ${sqlNullable(afterJson)}`);
  }
  if (input.error !== undefined) {
    sets.push(`error = ${sqlNullable(input.error)}`);
  }
  if (completed) {
    sets.push(`completed_at_ms = ${Date.now()}`);
  }

  await runSqlite(
    dbPath,
    `UPDATE ask_note_audit SET ${sets.join(", ")} WHERE id = '${escapeSqlLiteral(id)}';`
  );
}

export async function listAskNoteAudit(
  dbPath: string,
  options?: {
    limit?: number;
    noteId?: string;
    traceId?: string;
    status?: string;
  }
): Promise<AskNoteAuditEvent[]> {
  await ensureCatalogSchema(dbPath);
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
  const clauses: string[] = [];
  if (options?.noteId) {
    clauses.push(`note_id = '${escapeSqlLiteral(options.noteId)}'`);
  }
  if (options?.traceId) {
    clauses.push(`trace_id = '${escapeSqlLiteral(options.traceId)}'`);
  }
  if (options?.status) {
    clauses.push(`status = '${escapeSqlLiteral(options.status)}'`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await runSqliteJson<AskNoteAuditRow>(
    dbPath,
    `SELECT * FROM ask_note_audit ${where} ORDER BY created_at_ms DESC LIMIT ${limit};`
  );
  return rows.map(mapAskNoteAudit);
}
