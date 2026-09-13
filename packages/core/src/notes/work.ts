import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";
import { workFieldsFromFrontmatter, type NoteFrontmatter, type NoteWorkFields } from "./frontmatter";

/**
 * Work-item side table for notes.
 *
 * A row exists if and only if the note's front-matter carries `work: true`.
 * The markdown file stays the source of truth; this table only makes work items
 * queryable (the board) without re-reading every file.
 */
interface NoteWorkRow {
  note_id: string;
  next_action: string | null;
  decision: string | null;
  sessions_json: string | null;
  projects_json?: string | null;
  primary_project?: string | null;
}

function sqlNullable(value: string | undefined | null): string {
  if (value == null || value === "") {
    return "NULL";
  }
  return `'${escapeSqlLiteral(value)}'`;
}

export function parseStringListJson(raw: string | null | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) {
      const list = value
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim());
      return list.length > 0 ? list : undefined;
    }
  } catch {
    /* malformed payload falls through to undefined */
  }
  return undefined;
}

function mapRow(row: NoteWorkRow): NoteWorkFields {
  const fields: NoteWorkFields = {};
  if (row.next_action) fields.next = row.next_action;
  if (row.decision) fields.decision = row.decision;
  const sessions = parseStringListJson(row.sessions_json);
  if (sessions) fields.sessions = sessions;
  const projects = parseStringListJson(row.projects_json ?? null);
  if (projects) fields.projects = projects;
  if (row.primary_project) fields.primaryProject = row.primary_project;
  return fields;
}

export async function loadNoteWorkMap(dbPath: string): Promise<Record<string, NoteWorkFields>> {
  const rows = await runSqliteJson<NoteWorkRow>(
    dbPath,
    "SELECT note_id, next_action, decision, sessions_json, projects_json, primary_project FROM note_work;"
  );
  const output: Record<string, NoteWorkFields> = {};
  for (const row of rows) {
    output[row.note_id] = mapRow(row);
  }
  return output;
}

export async function setNoteWork(
  dbPath: string,
  noteId: string,
  fields: NoteWorkFields
): Promise<void> {
  const nowMs = Date.now();
  const sessionsJson =
    fields.sessions && fields.sessions.length > 0 ? JSON.stringify(fields.sessions) : undefined;
  const projectsJson =
    fields.projects && fields.projects.length > 0 ? JSON.stringify(fields.projects) : undefined;
  await runSqlite(
    dbPath,
    `INSERT INTO note_work (note_id, next_action, decision, sessions_json, projects_json, primary_project, updated_at_ms)
     VALUES (
       '${escapeSqlLiteral(noteId)}',
       ${sqlNullable(fields.next)},
       ${sqlNullable(fields.decision)},
       ${sqlNullable(sessionsJson)},
       ${sqlNullable(projectsJson)},
       ${sqlNullable(fields.primaryProject)},
       ${nowMs}
     )
     ON CONFLICT(note_id) DO UPDATE SET
       next_action = excluded.next_action,
       decision = excluded.decision,
       sessions_json = excluded.sessions_json,
       projects_json = excluded.projects_json,
       primary_project = excluded.primary_project,
       updated_at_ms = excluded.updated_at_ms;`
  );
  await replaceWorkItemSessions(dbPath, noteId, fields.sessions ?? []);
}

/** `provider:id` → parts, or null when the key is malformed. */
export function splitSessionKey(key: string): { provider: string; sessionId: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) return null;
  return { provider: key.slice(0, separator), sessionId: key.slice(separator + 1) };
}

/**
 * Mirror a work item's `sessions` list into the link table.
 *
 * The markdown stays the source of truth; this table exists so reverse lookups
 * (session → work item) and project derivation are indexed queries. A session
 * belongs to at most one work item, so other claims are dropped first.
 */
async function replaceWorkItemSessions(
  dbPath: string,
  noteId: string,
  sessions: readonly string[]
): Promise<void> {
  const parsed = sessions
    .map((key) => splitSessionKey(key.trim()))
    .filter((entry): entry is { provider: string; sessionId: string } => entry !== null);
  const owned = parsed.length
    ? parsed.map((entry) => `(provider = '${escapeSqlLiteral(entry.provider)}' AND agent_session_id = '${escapeSqlLiteral(entry.sessionId)}')`).join(" OR ")
    : "";
  const statements = [`DELETE FROM work_item_sessions WHERE work_item_note_id = '${escapeSqlLiteral(noteId)}';`];
  if (parsed.length) {
    statements.push(
      `DELETE FROM work_item_sessions WHERE work_item_note_id != '${escapeSqlLiteral(noteId)}' AND (${owned});`
    );
    const nowMs = Date.now();
    const values = parsed
      .map((entry) => `('${escapeSqlLiteral(noteId)}', '${escapeSqlLiteral(entry.provider)}', '${escapeSqlLiteral(entry.sessionId)}', ${nowMs})`)
      .join(",\n");
    statements.push(`INSERT OR REPLACE INTO work_item_sessions (work_item_note_id, provider, agent_session_id, created_at_ms) VALUES ${values};`);
  }
  await runSqlite(dbPath, statements.join("\n"));
}

const SESSION_INDEX_KEY = "work_item_sessions_index_v1";

/**
 * One-time backfill of the link table from `note_work.sessions_json`. Existing
 * rows were written before the link table existed, and reconcile skips files
 * whose mtime did not change, so they would otherwise stay unindexed.
 */
export async function ensureWorkItemSessionIndex(dbPath: string): Promise<void> {
  const flag = await runSqliteJson<{ value: string }>(
    dbPath,
    `SELECT value FROM catalog_meta WHERE key = '${escapeSqlLiteral(SESSION_INDEX_KEY)}' LIMIT 1;`
  ).catch(() => []);
  if (flag[0]?.value === "1") return;
  const rows = await runSqliteJson<{ note_id: string; sessions_json: string | null }>(
    dbPath,
    "SELECT note_id, sessions_json FROM note_work;"
  ).catch(() => []);
  for (const row of rows) {
    await replaceWorkItemSessions(dbPath, row.note_id, parseStringListJson(row.sessions_json) ?? []);
  }
  await runSqlite(
    dbPath,
    `INSERT INTO catalog_meta (key, value) VALUES ('${escapeSqlLiteral(SESSION_INDEX_KEY)}', '1')
     ON CONFLICT(key) DO UPDATE SET value = '1';`
  ).catch(() => undefined);
}

export async function clearNoteWork(dbPath: string, noteId: string): Promise<void> {
  await runSqlite(
    dbPath,
    `DELETE FROM work_item_sessions WHERE work_item_note_id = '${escapeSqlLiteral(noteId)}';
     DELETE FROM note_work WHERE note_id = '${escapeSqlLiteral(noteId)}';`
  );
}

/** Keep the `note_work` index in step with a note's front-matter. */
export async function syncNoteWorkFromFrontmatter(
  dbPath: string,
  noteId: string,
  fm: NoteFrontmatter
): Promise<void> {
  const work = workFieldsFromFrontmatter(fm);
  if (work) {
    await setNoteWork(dbPath, noteId, work);
  } else {
    await clearNoteWork(dbPath, noteId);
  }
}
