import { AgentSession } from "../history/types";
import { escapeSqlLiteral, runSqlite } from "../history/sqlite";

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

export async function setUserTitleInCatalog(
  dbPath: string,
  provider: AgentSession["provider"],
  sessionId: string,
  userTitle: string
): Promise<void> {
  const title = userTitle.trim();
  if (!title) {
    throw new Error("Session title cannot be empty.");
  }

  await runSqlite(
    dbPath,
    `UPDATE sessions SET user_title = '${escapeSqlLiteral(title)}'
     WHERE provider = '${escapeSqlLiteral(provider)}' AND agent_session_id = '${escapeSqlLiteral(sessionId)}';`
  );
}

/** Remove from extension UI only; does not modify native agent storage. */
export async function removeSessionsFromPanel(dbPath: string, sessions: AgentSession[]): Promise<void> {
  await hideSessionsInCatalog(dbPath, sessions);
}