import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";
import { isGtdStatus, type GtdStatus } from "../gtd/types";

interface NoteGtdRow {
  note_id: string;
  status: string;
}

export async function loadNoteGtdMap(dbPath: string): Promise<Record<string, GtdStatus>> {
  const rows = await runSqliteJson<NoteGtdRow>(
    dbPath,
    "SELECT note_id, status FROM note_gtd;"
  );
  const output: Record<string, GtdStatus> = {};
  for (const row of rows) {
    if (isGtdStatus(row.status)) {
      output[row.note_id] = row.status;
    }
  }
  return output;
}

export async function getNoteGtdStatus(
  dbPath: string,
  noteId: string
): Promise<GtdStatus | undefined> {
  const rows = await runSqliteJson<Pick<NoteGtdRow, "status">>(
    dbPath,
    `SELECT status FROM note_gtd
     WHERE note_id = '${escapeSqlLiteral(noteId)}'
     LIMIT 1;`
  );
  const status = rows[0]?.status;
  return status && isGtdStatus(status) ? status : undefined;
}

export async function setNoteGtdStatus(
  dbPath: string,
  noteId: string,
  status: GtdStatus
): Promise<void> {
  const nowMs = Date.now();
  await runSqlite(
    dbPath,
    `INSERT INTO note_gtd (note_id, status, updated_at_ms)
     VALUES (
       '${escapeSqlLiteral(noteId)}',
       '${escapeSqlLiteral(status)}',
       ${nowMs}
     )
     ON CONFLICT(note_id) DO UPDATE SET
       status = excluded.status,
       updated_at_ms = excluded.updated_at_ms;`
  );
}

export async function clearNoteGtdStatus(dbPath: string, noteId: string): Promise<void> {
  await runSqlite(
    dbPath,
    `DELETE FROM note_gtd WHERE note_id = '${escapeSqlLiteral(noteId)}';`
  );
}
