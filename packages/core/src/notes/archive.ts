import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";

interface NoteArchiveRow {
  note_id: string;
  archived_at_ms: number;
}

/** `note_id` → archive timestamp (ms) for every archived note. */
export async function loadNoteArchiveMap(dbPath: string): Promise<Record<string, number>> {
  const rows = await runSqliteJson<NoteArchiveRow>(
    dbPath,
    "SELECT note_id, archived_at_ms FROM note_archive;"
  );
  const output: Record<string, number> = {};
  for (const row of rows) {
    output[row.note_id] = Number(row.archived_at_ms);
  }
  return output;
}

export async function getNoteArchivedAtMs(
  dbPath: string,
  noteId: string
): Promise<number | undefined> {
  const rows = await runSqliteJson<Pick<NoteArchiveRow, "archived_at_ms">>(
    dbPath,
    `SELECT archived_at_ms FROM note_archive
     WHERE note_id = '${escapeSqlLiteral(noteId)}'
     LIMIT 1;`
  );
  const value = rows[0]?.archived_at_ms;
  return value === undefined ? undefined : Number(value);
}

/** Deduplicate and drop blanks so an empty batch is a no-op. */
function cleanNoteIds(noteIds: readonly string[]): string[] {
  return [...new Set(noteIds.map((id) => id.trim()).filter(Boolean))];
}

/** Mark notes archived. Re-archiving only refreshes the timestamp. */
export async function archiveNotes(dbPath: string, noteIds: readonly string[]): Promise<void> {
  const ids = cleanNoteIds(noteIds);
  if (ids.length === 0) return;
  const nowMs = Date.now();
  const values = ids
    .map((noteId) => `('${escapeSqlLiteral(noteId)}', ${nowMs})`)
    .join(", ");
  await runSqlite(
    dbPath,
    `INSERT INTO note_archive (note_id, archived_at_ms)
     VALUES ${values}
     ON CONFLICT(note_id) DO UPDATE SET archived_at_ms = excluded.archived_at_ms;`
  );
}

/** Restore notes from the archive. Ids that are not archived are ignored. */
export async function unarchiveNotes(dbPath: string, noteIds: readonly string[]): Promise<void> {
  const ids = cleanNoteIds(noteIds);
  if (ids.length === 0) return;
  const list = ids.map((noteId) => `'${escapeSqlLiteral(noteId)}'`).join(", ");
  await runSqlite(dbPath, `DELETE FROM note_archive WHERE note_id IN (${list});`);
}
