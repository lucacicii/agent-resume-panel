import * as path from "node:path";
import { AgentSession } from "../types";
import { escapeSqlLiteral, runSqlite } from "../sqlite";
import { isAlmaApiRunning, renameAlmaThreadViaApi } from "../../terminal/almaApi";

export async function renameAlmaSession(
  almaHome: string,
  session: AgentSession,
  title: string
): Promise<void> {
  if (await isAlmaApiRunning()) {
    await renameAlmaThreadViaApi(session.id, title);
    return;
  }

  const dbPath = path.join(almaHome, "chat_threads.db");
  const sql = `UPDATE chat_threads SET title = '${escapeSqlLiteral(title)}' WHERE id = '${escapeSqlLiteral(session.id)}';`;
  await runSqlite(dbPath, sql);
}
