import * as path from "node:path";
import { AgentSession } from "../../catalog/types";
import { escapeSqlLiteral, runSqlite } from "../../sqlite";

export async function renameAlmaSession(
  almaDataDir: string,
  session: AgentSession,
  title: string
): Promise<void> {
  const dbPath = path.join(almaDataDir, "chat_threads.db");
  const sql = `update chat_threads set title = '${escapeSqlLiteral(title)}' where id = '${escapeSqlLiteral(session.id)}';`;
  await runSqlite(dbPath, sql);
}
