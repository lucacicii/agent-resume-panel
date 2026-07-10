import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";
import { AgentProvider } from "./types";

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
