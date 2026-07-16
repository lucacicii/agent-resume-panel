import * as path from "node:path";
import { AgentSession } from "../types";
import { escapeSqlLiteral, runSqlite } from "../sqlite";

export async function renameOpenCodeSession(
  opencodeHome: string,
  session: AgentSession,
  title: string
): Promise<void> {
  const dbPath = path.join(opencodeHome, "opencode.db");
  const sql = `update session set title = '${escapeSqlLiteral(title)}' where id = '${escapeSqlLiteral(session.id)}';`;
  await runSqlite(dbPath, sql);
}