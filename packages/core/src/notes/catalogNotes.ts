import type { AgentProvider } from "../catalog/types";
import { sessionGtdKey } from "../gtd/store";
import { isGtdStatus, type GtdStatus } from "../gtd/types";
import { normalizeProjectPath } from "../pathUtils";
import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";
import type { NoteScope } from "./paths";

export interface NoteRecord {
  noteId: string;
  scope: NoteScope;
  provider?: string;
  agentSessionId?: string;
  projectPath?: string;
  filename: string;
  relDir: string;
  relMdPath: string;
  title?: string;
  contentPreview?: string;
  createdAtMs: number;
  updatedAtMs: number;
  fsMtimeMs?: number;
  gtdStatus?: GtdStatus;
}

interface NoteRow {
  note_id: string;
  scope: string;
  provider: string | null;
  agent_session_id: string | null;
  project_path: string | null;
  filename: string;
  rel_dir: string;
  rel_md_path: string;
  title: string | null;
  content_preview: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  fs_mtime_ms: number | null;
  gtd_status: string | null;
}

function mapRow(row: NoteRow): NoteRecord {
  return {
    noteId: row.note_id,
    scope: row.scope as NoteScope,
    provider: row.provider ?? undefined,
    agentSessionId: row.agent_session_id ?? undefined,
    projectPath: row.project_path ?? undefined,
    filename: row.filename,
    relDir: row.rel_dir,
    relMdPath: row.rel_md_path,
    title: row.title ?? undefined,
    contentPreview: row.content_preview ?? undefined,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    fsMtimeMs: row.fs_mtime_ms ?? undefined,
    gtdStatus: row.gtd_status && isGtdStatus(row.gtd_status) ? row.gtd_status : undefined
  };
}

function sqlNullOrString(value: string | undefined): string {
  if (value === undefined) {
    return "NULL";
  }
  return `'${escapeSqlLiteral(value)}'`;
}

export async function listAllNotes(dbPath: string, limit?: number): Promise<NoteRecord[]> {
  const limitClause = limit == null
    ? ""
    : ` LIMIT ${Math.max(1, Math.min(Math.floor(Number(limit)) || 1, 50_000))}`;
  const rows = await runSqliteJson<NoteRow>(
    dbPath,
    `SELECT n.*, g.status AS gtd_status
     FROM notes n LEFT JOIN note_gtd g ON g.note_id = n.note_id
     ORDER BY n.updated_at_ms DESC${limitClause};`
  );
  return rows.map(mapRow);
}

export async function getNoteById(dbPath: string, noteId: string): Promise<NoteRecord | undefined> {
  const rows = await runSqliteJson<NoteRow>(
    dbPath,
    `SELECT n.*, g.status AS gtd_status FROM notes n LEFT JOIN note_gtd g ON g.note_id = n.note_id WHERE n.note_id = '${escapeSqlLiteral(noteId)}' LIMIT 1;`
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function getNoteByRelPath(dbPath: string, relMdPath: string): Promise<NoteRecord | undefined> {
  const rows = await runSqliteJson<NoteRow>(
    dbPath,
    `SELECT n.*, g.status AS gtd_status FROM notes n LEFT JOIN note_gtd g ON g.note_id = n.note_id WHERE n.rel_md_path = '${escapeSqlLiteral(relMdPath)}' LIMIT 1;`
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function listSessionNotes(
  dbPath: string,
  provider: AgentProvider,
  sessionId: string
): Promise<NoteRecord[]> {
  const rows = await runSqliteJson<NoteRow>(
    dbPath,
    `SELECT n.*, g.status AS gtd_status FROM notes n LEFT JOIN note_gtd g ON g.note_id = n.note_id
     WHERE n.scope = 'session'
       AND provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(sessionId)}'
     ORDER BY updated_at_ms DESC;`
  );
  return rows.map(mapRow);
}

export async function listLibraryNotes(dbPath: string): Promise<NoteRecord[]> {
  const rows = await runSqliteJson<NoteRow>(
    dbPath,
    `SELECT n.*, g.status AS gtd_status FROM notes n LEFT JOIN note_gtd g ON g.note_id = n.note_id
     WHERE n.scope = 'library'
     ORDER BY updated_at_ms DESC;`
  );
  return rows.map(mapRow);
}

export async function listProjectNotes(dbPath: string, projectPath: string): Promise<NoteRecord[]> {
  const normalized = normalizeProjectPath(projectPath);
  const rows = await runSqliteJson<NoteRow>(
    dbPath,
    `SELECT n.*, g.status AS gtd_status FROM notes n LEFT JOIN note_gtd g ON g.note_id = n.note_id
     WHERE n.scope = 'project'
       AND project_path = '${escapeSqlLiteral(normalized)}'
     ORDER BY updated_at_ms DESC;`
  );
  return rows.map(mapRow);
}

export async function upsertNoteRecord(dbPath: string, record: NoteRecord): Promise<void> {
  const projectPath =
    record.projectPath !== undefined ? normalizeProjectPath(record.projectPath) : undefined;

  // Path is UNIQUE. If another note_id already owns this path, update that row
  // (path identity) instead of inserting a second note_id for the same file.
  const existingByPath = await getNoteByRelPath(dbPath, record.relMdPath);
  const noteId =
    existingByPath && existingByPath.noteId !== record.noteId
      ? existingByPath.noteId
      : record.noteId;
  const createdAtMs =
    existingByPath && existingByPath.noteId === noteId
      ? Math.min(existingByPath.createdAtMs, record.createdAtMs)
      : record.createdAtMs;

  await runSqlite(
    dbPath,
    `INSERT INTO notes (
       note_id, scope, provider, agent_session_id, project_path,
       filename, rel_dir, rel_md_path, title, content_preview,
       created_at_ms, updated_at_ms, fs_mtime_ms
     ) VALUES (
       '${escapeSqlLiteral(noteId)}',
       '${escapeSqlLiteral(record.scope)}',
       ${sqlNullOrString(record.provider)},
       ${sqlNullOrString(record.agentSessionId)},
       ${sqlNullOrString(projectPath)},
       '${escapeSqlLiteral(record.filename)}',
       '${escapeSqlLiteral(record.relDir)}',
       '${escapeSqlLiteral(record.relMdPath)}',
       ${sqlNullOrString(record.title)},
       ${sqlNullOrString(record.contentPreview)},
       ${createdAtMs},
       ${record.updatedAtMs},
       ${record.fsMtimeMs ?? "NULL"}
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
       created_at_ms = excluded.created_at_ms,
       updated_at_ms = excluded.updated_at_ms,
       fs_mtime_ms = excluded.fs_mtime_ms;`
  );
}

export async function deleteNoteRecord(dbPath: string, noteId: string): Promise<void> {
  await runSqlite(
    dbPath,
    `DELETE FROM note_gtd WHERE note_id = '${escapeSqlLiteral(noteId)}';
     DELETE FROM notes WHERE note_id = '${escapeSqlLiteral(noteId)}';`
  );
}

export async function deleteNotesByRelPaths(dbPath: string, relPaths: string[]): Promise<void> {
  if (!relPaths.length) {
    return;
  }
  const list = relPaths.map((p) => `'${escapeSqlLiteral(p)}'`).join(", ");
  await runSqlite(
    dbPath,
    `DELETE FROM note_gtd WHERE note_id IN (SELECT note_id FROM notes WHERE rel_md_path IN (${list}));
     DELETE FROM notes WHERE rel_md_path IN (${list});`
  );
}

export async function loadSessionNoteFlags(dbPath: string): Promise<Set<string>> {
  const rows = await runSqliteJson<{ provider: string; agent_session_id: string }>(
    dbPath,
    `SELECT DISTINCT provider, agent_session_id FROM notes
     WHERE scope = 'session' AND provider IS NOT NULL AND agent_session_id IS NOT NULL;`
  );
  const output = new Set<string>();
  for (const row of rows) {
    output.add(sessionGtdKey(row.provider, row.agent_session_id));
  }
  return output;
}

export async function loadProjectNoteFlags(dbPath: string): Promise<Set<string>> {
  const rows = await runSqliteJson<{ project_path: string }>(
    dbPath,
    `SELECT DISTINCT project_path FROM notes
     WHERE scope = 'project' AND project_path IS NOT NULL;`
  );
  return new Set(rows.map((row) => normalizeProjectPath(row.project_path)));
}

export async function getCatalogMeta(dbPath: string, key: string): Promise<string | undefined> {
  try {
    const rows = await runSqliteJson<{ value: string }>(
      dbPath,
      `SELECT value FROM catalog_meta WHERE key = '${escapeSqlLiteral(key)}' LIMIT 1;`
    );
    return rows[0]?.value;
  } catch {
    return undefined;
  }
}

export async function setCatalogMeta(dbPath: string, key: string, value: string): Promise<void> {
  await runSqlite(
    dbPath,
    `INSERT INTO catalog_meta (key, value) VALUES ('${escapeSqlLiteral(key)}', '${escapeSqlLiteral(value)}')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`
  );
}

export async function listLegacySessionNotes(
  dbPath: string
): Promise<Array<{ provider: string; agent_session_id: string; content: string; updated_at_ms: number }>> {
  try {
    return await runSqliteJson(
      dbPath,
      `SELECT provider, agent_session_id, content, updated_at_ms FROM session_notes
       WHERE TRIM(content) != '';`
    );
  } catch {
    return [];
  }
}

export async function listLegacyProjectNotes(
  dbPath: string
): Promise<Array<{ project_path: string; content: string; updated_at_ms: number }>> {
  try {
    return await runSqliteJson(
      dbPath,
      `SELECT project_path, content, updated_at_ms FROM project_notes
       WHERE TRIM(content) != '';`
    );
  } catch {
    return [];
  }
}
