import * as fs from "node:fs/promises";
import { NotesStore } from "../notes/store";
import { escapeSqlLiteral, runSqlite, runSqliteJson, runSqliteTransaction } from "../sqlite";

interface LegacyExecutionRow {
  note_id: string;
}

export interface RemovedExecutionNotesCleanupOptions {
  catalogDb: string;
  desktopDb: string;
  panelHome: string;
  /** Old backup database files whose mappings identify notes imported into this panel home. */
  sourceDesktopDbs?: string[];
}

async function hasTable(dbPath: string, table: string): Promise<boolean> {
  const rows = await runSqliteJson<{ name: string }>(
    dbPath,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${escapeSqlLiteral(table)}' LIMIT 1;`
  );
  return Boolean(rows[0]);
}

async function legacyNoteIds(dbPath: string): Promise<string[]> {
  try {
    await fs.access(dbPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!(await hasTable(dbPath, "session_execution_notes"))) {
    return [];
  }
  const rows = await runSqliteJson<LegacyExecutionRow>(
    dbPath,
    "SELECT note_id FROM session_execution_notes WHERE note_id <> '';"
  );
  return rows.map((row) => row.note_id).filter(Boolean);
}

/**
 * Permanently removes the retired system-managed execution notes. Mapping data
 * is the sole authority, so ordinary session notes are never selected here.
 */
export async function cleanupRemovedSessionExecutionNotes(
  options: RemovedExecutionNotesCleanupOptions
): Promise<number> {
  const noteIds = new Set(await legacyNoteIds(options.desktopDb));
  for (const sourceDesktopDb of options.sourceDesktopDbs || []) {
    for (const noteId of await legacyNoteIds(sourceDesktopDb)) {
      noteIds.add(noteId);
    }
  }

  if (noteIds.size) {
    const notesStore = new NotesStore(options.catalogDb, options.panelHome);
    await notesStore.initialize();
    for (const noteId of noteIds) {
      await notesStore.deleteNote(noteId);
    }

    const ids = [...noteIds].map((noteId) => `'${escapeSqlLiteral(noteId)}'`).join(", ");
    await runSqliteTransaction(options.desktopDb, [
      `DELETE FROM note_chunks WHERE note_id IN (${ids});`,
      `DELETE FROM note_vector_index WHERE note_id IN (${ids});`
    ]);
  }

  if (await hasTable(options.desktopDb, "session_execution_notes")) {
    await runSqlite(options.desktopDb, "DROP TABLE session_execution_notes;");
  }
  return noteIds.size;
}
