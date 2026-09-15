import { escapeSqlLiteral, runSqlite, runSqliteTransaction } from "../sqlite";

/**
 * Persists the "waiting on you when app closed" marker on session records.
 * This is the durable alternative to auto-filing work items on quit/transition (C1).
 */
export async function setSessionLastExitWaiting(
  dbPath: string,
  provider: string,
  sessionId: string,
  waiting: boolean
): Promise<void> {
  await runSqlite(
    dbPath,
    `UPDATE sessions SET last_exit_waiting = ${waiting ? 1 : 0}
     WHERE provider = '${escapeSqlLiteral(provider)}' AND agent_session_id = '${escapeSqlLiteral(sessionId)}';`
  );
}

export async function recordLastExitWaitingSessions(
  dbPath: string,
  sessionKeys: readonly string[]
): Promise<void> {
  const statements: string[] = [
    "UPDATE sessions SET last_exit_waiting = 0 WHERE last_exit_waiting = 1;"
  ];
  for (const key of sessionKeys) {
    const colon = key.indexOf(":");
    if (colon <= 0 || colon === key.length - 1) continue;
    const provider = key.slice(0, colon);
    const id = key.slice(colon + 1);
    statements.push(
      `UPDATE sessions SET last_exit_waiting = 1
       WHERE provider = '${escapeSqlLiteral(provider)}' AND agent_session_id = '${escapeSqlLiteral(id)}';`
    );
  }
  await runSqliteTransaction(dbPath, statements);
}

export async function clearSessionLastExitWaiting(
  dbPath: string,
  provider: string,
  sessionId: string
): Promise<void> {
  await setSessionLastExitWaiting(dbPath, provider, sessionId, false);
}
