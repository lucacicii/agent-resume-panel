import { createHash } from "node:crypto";
import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";

export async function upsertSessionTodolistNoteIndex(
  dbPath: string,
  input: {
    provider: string;
    sessionId: string;
    projectPath: string;
    relDir: string;
    relMdPath: string;
    title: string;
    contentPreview: string;
    mtimeMs: number;
  }
): Promise<void> {
  // Stable note id from path so rewrites update same row
  const noteId = createHash("sha256").update(input.relMdPath).digest("hex").slice(0, 32);
  const now = Date.now();

  // Preserve created_at if exists
  let createdAt = now;
  try {
    const existing = await runSqliteJson<{ created_at_ms: number }>(
      dbPath,
      `SELECT created_at_ms FROM notes WHERE note_id = '${escapeSqlLiteral(noteId)}' LIMIT 1;`
    );
    if (existing[0]?.created_at_ms) {
      createdAt = existing[0].created_at_ms;
    }
  } catch {
    // notes table might be brand new
  }

  await runSqlite(
    dbPath,
    `INSERT INTO notes (
       note_id, scope, provider, agent_session_id, project_path,
       filename, rel_dir, rel_md_path, title, content_preview,
       created_at_ms, updated_at_ms, fs_mtime_ms
     ) VALUES (
       '${escapeSqlLiteral(noteId)}',
       'session',
       '${escapeSqlLiteral(input.provider)}',
       '${escapeSqlLiteral(input.sessionId)}',
       '${escapeSqlLiteral(input.projectPath)}',
       'todolist.md',
       '${escapeSqlLiteral(input.relDir)}',
       '${escapeSqlLiteral(input.relMdPath)}',
       '${escapeSqlLiteral(input.title)}',
       '${escapeSqlLiteral(input.contentPreview.slice(0, 240))}',
       ${createdAt},
       ${now},
       ${input.mtimeMs}
     )
     ON CONFLICT(note_id) DO UPDATE SET
       scope = excluded.scope,
       provider = excluded.provider,
       agent_session_id = excluded.agent_session_id,
       project_path = excluded.project_path,
       filename = excluded.filename,
       rel_dir = excluded.rel_dir,
       rel_md_path = excluded.rel_md_path,
       title = excluded.title,
       content_preview = excluded.content_preview,
       updated_at_ms = excluded.updated_at_ms,
       fs_mtime_ms = excluded.fs_mtime_ms;`
  );
}
