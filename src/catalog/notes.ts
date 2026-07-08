import { sessionGtdKey } from "./gtd";
import { AgentSession } from "../history/types";
import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../history/sqlite";
import { normalizeProjectPath } from "../projects/projectAliases";

interface SessionNoteRow {
  provider: string;
  agent_session_id: string;
  content: string;
}

interface ProjectNoteRow {
  project_path: string;
  content: string;
}

interface SessionNoteFlagRow {
  provider: string;
  agent_session_id: string;
}

interface ProjectNoteFlagRow {
  project_path: string;
}

function hasNoteContent(content: string | undefined): boolean {
  return Boolean(content?.trim());
}

export async function getSessionNote(
  dbPath: string,
  provider: AgentSession["provider"],
  sessionId: string
): Promise<string | undefined> {
  const rows = await runSqliteJson<Pick<SessionNoteRow, "content">>(
    dbPath,
    `SELECT content FROM session_notes
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(sessionId)}'
     LIMIT 1;`
  );

  const content = rows[0]?.content;
  return hasNoteContent(content) ? content : undefined;
}

export async function upsertSessionNote(
  dbPath: string,
  provider: AgentSession["provider"],
  sessionId: string,
  content: string
): Promise<void> {
  const nowMs = Date.now();
  await runSqlite(
    dbPath,
    `INSERT INTO session_notes (provider, agent_session_id, content, updated_at_ms)
     VALUES (
       '${escapeSqlLiteral(provider)}',
       '${escapeSqlLiteral(sessionId)}',
       '${escapeSqlLiteral(content)}',
       ${nowMs}
     )
     ON CONFLICT(provider, agent_session_id) DO UPDATE SET
       content = excluded.content,
       updated_at_ms = excluded.updated_at_ms;`
  );
}

export async function deleteSessionNote(
  dbPath: string,
  provider: AgentSession["provider"],
  sessionId: string
): Promise<void> {
  await runSqlite(
    dbPath,
    `DELETE FROM session_notes
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(sessionId)}';`
  );
}

export async function getProjectNote(dbPath: string, projectPath: string): Promise<string | undefined> {
  const normalized = normalizeProjectPath(projectPath);
  const rows = await runSqliteJson<Pick<ProjectNoteRow, "content">>(
    dbPath,
    `SELECT content FROM project_notes
     WHERE project_path = '${escapeSqlLiteral(normalized)}'
     LIMIT 1;`
  );

  const content = rows[0]?.content;
  return hasNoteContent(content) ? content : undefined;
}

export async function upsertProjectNote(dbPath: string, projectPath: string, content: string): Promise<void> {
  const normalized = normalizeProjectPath(projectPath);
  const nowMs = Date.now();
  await runSqlite(
    dbPath,
    `INSERT INTO project_notes (project_path, content, updated_at_ms)
     VALUES ('${escapeSqlLiteral(normalized)}', '${escapeSqlLiteral(content)}', ${nowMs})
     ON CONFLICT(project_path) DO UPDATE SET
       content = excluded.content,
       updated_at_ms = excluded.updated_at_ms;`
  );
}

export async function deleteProjectNote(dbPath: string, projectPath: string): Promise<void> {
  const normalized = normalizeProjectPath(projectPath);
  await runSqlite(
    dbPath,
    `DELETE FROM project_notes WHERE project_path = '${escapeSqlLiteral(normalized)}';`
  );
}

export async function loadSessionNoteFlags(dbPath: string): Promise<Set<string>> {
  const rows = await runSqliteJson<SessionNoteFlagRow>(
    dbPath,
    `SELECT provider, agent_session_id FROM session_notes
     WHERE TRIM(content) != '';`
  );

  const output = new Set<string>();
  for (const row of rows) {
    output.add(sessionGtdKey({ provider: row.provider as AgentSession["provider"], id: row.agent_session_id }));
  }
  return output;
}

export async function loadProjectNoteFlags(dbPath: string): Promise<Set<string>> {
  const rows = await runSqliteJson<ProjectNoteFlagRow>(
    dbPath,
    `SELECT project_path FROM project_notes
     WHERE TRIM(content) != '';`
  );

  return new Set(rows.map((row) => normalizeProjectPath(row.project_path)));
}