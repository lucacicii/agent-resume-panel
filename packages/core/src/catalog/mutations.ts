import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";
import { AgentProvider, AgentSession } from "./types";

/**
 * Hard-delete retired Alma catalog rows after provider support was removed.
 * Removes Alma sessions and related satellite rows, then deletes projects that
 * only ever had Alma sessions (mixed projects are kept).
 * Does not delete note files; detaches notes that pointed at Alma sessions.
 */
export async function purgeRetiredAlmaCatalog(dbPath: string): Promise<{
  deletedSessions: number;
  deletedProjects: number;
}> {
  let deletedSessions = 0;
  let deletedProjects = 0;

  try {
    const almaOnlyProjects = await runSqliteJson<{ project_id: string }>(
      dbPath,
      `SELECT p.project_id AS project_id
       FROM projects p
       WHERE EXISTS (
         SELECT 1 FROM sessions s
         WHERE s.project_id = p.project_id AND s.provider = 'alma'
       )
       AND NOT EXISTS (
         SELECT 1 FROM sessions s
         WHERE s.project_id = p.project_id AND s.provider != 'alma'
       );`
    );
    const almaOnlyIds = almaOnlyProjects
      .map((row) => row.project_id)
      .filter((id) => typeof id === "string" && id.trim().length > 0);

    // Best-effort satellite tables (schema may differ by catalog age).
    await runSqliteIgnore(dbPath, `DELETE FROM session_gtd WHERE provider = 'alma';`);
    await runSqliteIgnore(dbPath, `DELETE FROM session_notes WHERE provider = 'alma';`);
    await runSqliteIgnore(dbPath, `DELETE FROM report_links WHERE provider = 'alma';`);
    await runSqliteIgnore(
      dbPath,
      `UPDATE notes SET provider = NULL, agent_session_id = NULL WHERE provider = 'alma';`
    );

    const sessionResult = await runSqliteJson<{ changes: number }>(
      dbPath,
      `DELETE FROM sessions WHERE provider = 'alma';
       SELECT changes() AS changes;`
    );
    deletedSessions = Number(sessionResult[0]?.changes) || 0;

    await runSqliteIgnore(dbPath, `DELETE FROM sync_state WHERE provider = 'alma';`);

    if (almaOnlyIds.length) {
      const idList = almaOnlyIds.map((id) => `'${escapeSqlLiteral(id)}'`).join(",");
      await runSqliteIgnore(dbPath, `DELETE FROM project_local_paths WHERE project_id IN (${idList});`);
      await runSqliteIgnore(dbPath, `DELETE FROM project_notes WHERE project_id IN (${idList});`);
      const projectResult = await runSqliteJson<{ changes: number }>(
        dbPath,
        `DELETE FROM projects WHERE project_id IN (${idList});
         SELECT changes() AS changes;`
      );
      deletedProjects = Number(projectResult[0]?.changes) || 0;
    }

    // Empty Alma app-data shells that never linked sessions by project_id.
    await runSqliteIgnore(
      dbPath,
      `DELETE FROM project_local_paths
       WHERE project_id IN (
         SELECT project_id FROM projects p
         WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.project_id = p.project_id)
           AND (
             p.portable_key LIKE '%Application Support/alma%'
             OR p.portable_key LIKE '%/.config/alma%'
             OR p.portable_key LIKE '~/alma/%'
             OR p.portable_key LIKE '%/alma/worktrees/%'
           )
       );`
    );
    const shellResult = await runSqliteJson<{ changes: number }>(
      dbPath,
      `DELETE FROM projects
       WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.project_id = projects.project_id)
         AND (
           portable_key LIKE '%Application Support/alma%'
           OR portable_key LIKE '%/.config/alma%'
           OR portable_key LIKE '~/alma/%'
           OR portable_key LIKE '%/alma/worktrees/%'
         );
       SELECT changes() AS changes;`
    ).catch(() => [] as Array<{ changes: number }>);
    deletedProjects += Number(shellResult[0]?.changes) || 0;
  } catch {
    // Catalog may predate tables used here — ignore so sync still completes.
  }

  return { deletedSessions, deletedProjects };
}

async function runSqliteIgnore(dbPath: string, sql: string): Promise<void> {
  try {
    await runSqlite(dbPath, sql);
  } catch {
    // Optional table / older schema
  }
}

export async function hideSessionsInCatalog(dbPath: string, sessions: AgentSession[]): Promise<void> {
  if (!sessions.length) {
    return;
  }

  const clauses = sessions.map(
    (session) =>
      `(provider = '${escapeSqlLiteral(session.provider)}' AND agent_session_id = '${escapeSqlLiteral(session.id)}')`
  );

  await runSqlite(dbPath, `UPDATE sessions SET hidden = 1 WHERE ${clauses.join(" OR ")};`);
}

export async function unhideAllSessionsInCatalog(dbPath: string): Promise<number> {
  const rows = await runSqliteJson<{ changes: number }>(
    dbPath,
    `UPDATE sessions SET hidden = 0 WHERE hidden = 1;
     SELECT changes() AS changes;`
  );
  return Number(rows[0]?.changes) || 0;
}

export async function unhideSessionInCatalog(
  dbPath: string,
  provider: AgentProvider,
  sessionId: string
): Promise<boolean> {
  const rows = await runSqliteJson<{ changes: number }>(
    dbPath,
    `UPDATE sessions SET hidden = 0
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(sessionId)}'
       AND hidden = 1;
     SELECT changes() AS changes;`
  );
  return Number(rows[0]?.changes) > 0;
}

export async function setUserTitleInCatalog(
  dbPath: string,
  provider: AgentProvider,
  sessionId: string,
  userTitle: string
): Promise<void> {
  const title = userTitle.trim();
  if (!title) {
    throw new Error("Session title cannot be empty.");
  }

  const result = await runSqliteJson<{ changes: number }>(
    dbPath,
    `UPDATE sessions SET user_title = '${escapeSqlLiteral(title)}'
     WHERE provider = '${escapeSqlLiteral(provider)}' AND agent_session_id = '${escapeSqlLiteral(sessionId)}';
     SELECT changes() AS changes;`
  );

  if ((result[0]?.changes ?? 0) < 1) {
    throw new Error(`Session not found in catalog: ${provider}:${sessionId}`);
  }
}

export async function setSessionSummaryInCatalog(
  dbPath: string,
  provider: AgentProvider,
  sessionId: string,
  language: string,
  summary: string
): Promise<void> {
  const trimmed = summary.trim();
  if (!trimmed) {
    throw new Error("Session summary cannot be empty.");
  }

  const nowMs = Date.now();
  const result = await runSqliteJson<{ changes: number }>(
    dbPath,
    `UPDATE sessions SET
      session_summary = '${escapeSqlLiteral(trimmed)}',
      session_summary_language = '${escapeSqlLiteral(language)}',
      session_summary_at_ms = ${nowMs}
     WHERE provider = '${escapeSqlLiteral(provider)}' AND agent_session_id = '${escapeSqlLiteral(sessionId)}';
     SELECT changes() AS changes;`
  );

  if ((result[0]?.changes ?? 0) < 1) {
    throw new Error(`Session not found in catalog: ${provider}:${sessionId}`);
  }
}

export async function setSessionDeliveryStatusInCatalog(
  dbPath: string,
  provider: AgentProvider,
  sessionId: string,
  status: "completed" | "active" | "blocked"
): Promise<{ summary: string }> {
  const rows = await runSqliteJson<{
    session_summary: string | null;
    session_summary_language: string | null;
  }>(
    dbPath,
    `SELECT session_summary, session_summary_language FROM sessions
     WHERE provider = '${escapeSqlLiteral(provider)}' AND agent_session_id = '${escapeSqlLiteral(sessionId)}'
     LIMIT 1;`
  );

  if (!rows.length) {
    throw new Error(`Session not found in catalog: ${provider}:${sessionId}`);
  }

  const existing = rows[0].session_summary?.trim() || "";
  const language = rows[0].session_summary_language?.trim() || "zh-CN";

  let updatedSummary = "";
  if (existing) {
    if (/(?:^|\n)State:\s*[^\n]*/i.test(existing)) {
      updatedSummary = existing.replace(/(?:^|\n)State:\s*[^\n]*/i, (match) => {
        return match.startsWith("\n") ? `\nState: ${status}` : `State: ${status}`;
      });
    } else {
      updatedSummary = `State: ${status}\n${existing}`;
    }
  } else {
    updatedSummary = `State: ${status}\nOutcome: Manual state change\nOpen work: None\nNext action: None\nEvidence: Manually set by user`;
  }

  await setSessionSummaryInCatalog(dbPath, provider, sessionId, language, updatedSummary);
  return { summary: updatedSummary };
}
