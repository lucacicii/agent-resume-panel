import * as fs from "node:fs/promises";
import * as path from "node:path";
import { escapeSqlLiteral, runSqliteReadOnlyJson } from "../../history/sqlite";
import { isNodeError } from "../../history/jsonl";
import { TranscriptRefs } from "./types";

interface TranscriptExportFile {
  sourcePath: string;
  fileName: string;
  content: string;
  missing?: boolean;
}

export async function readTranscriptFiles(refs: TranscriptRefs): Promise<TranscriptExportFile[]> {
  switch (refs.kind) {
    case "jsonl":
      return readJsonlRefs(refs.paths);
    case "sqlite":
      return readSqliteRef(refs);
    case "acp":
      return readAcpRefs(refs);
    case "unavailable":
      return [];
    default:
      return [];
  }
}

async function readJsonlRefs(paths: string[]): Promise<TranscriptExportFile[]> {
  const output: TranscriptExportFile[] = [];
  for (const sourcePath of paths) {
    try {
      const content = await fs.readFile(sourcePath, "utf8");
      output.push({
        sourcePath,
        fileName: path.basename(sourcePath),
        content
      });
    } catch (error) {
      output.push({
        sourcePath,
        fileName: path.basename(sourcePath),
        content: "",
        missing: true
      });
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return output;
}

async function readSqliteRef(refs: Extract<TranscriptRefs, { kind: "sqlite" }>): Promise<TranscriptExportFile[]> {
  if (refs.dialect === "alma") {
    const threadSql = `
      SELECT id, title, model, workspace_id, parent_thread_id, is_incognito, created_at, updated_at
      FROM chat_threads
      WHERE id = '${escapeSqlLiteral(refs.sessionId)}'
      LIMIT 1
    `;
    const messageSql = `
      SELECT id, thread_id, message, timestamp, created_at
      FROM chat_messages
      WHERE thread_id = '${escapeSqlLiteral(refs.sessionId)}'
      ORDER BY created_at ASC, timestamp ASC
    `;
    const threads = await runSqliteReadOnlyJson(refs.dbPath, threadSql);
    const messages = await runSqliteReadOnlyJson(refs.dbPath, messageSql);
    return [
      {
        sourcePath: refs.dbPath,
        fileName: `alma-thread-${refs.sessionId}.json`,
        content: JSON.stringify({ thread: threads[0] ?? null, messages }, null, 2)
      }
    ];
  }

  const messageSql = `
    select id, time_created, data
    from message
    where session_id = '${escapeSqlLiteral(refs.sessionId)}'
    order by time_created asc
  `;
  const partSql = `
    select message_id, time_created, data
    from part
    where session_id = '${escapeSqlLiteral(refs.sessionId)}'
    order by time_created asc
  `;
  const messages = await runSqliteReadOnlyJson(refs.dbPath, messageSql);
  const parts = await runSqliteReadOnlyJson(refs.dbPath, partSql);
  const payload = { messages, parts };
  return [
    {
      sourcePath: refs.dbPath,
      fileName: `opencode-session-${refs.sessionId}.json`,
      content: JSON.stringify(payload, null, 2)
    }
  ];
}

async function readAcpRefs(refs: Extract<TranscriptRefs, { kind: "acp" }>): Promise<TranscriptExportFile[]> {
  const output: TranscriptExportFile[] = [];
  for (const sourcePath of [refs.threadPath, refs.sessionsIndexPath]) {
    try {
      const content = await fs.readFile(sourcePath, "utf8");
      output.push({
        sourcePath,
        fileName: path.basename(sourcePath),
        content
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT" && sourcePath === refs.threadPath) {
        output.push({
          sourcePath,
          fileName: path.basename(sourcePath),
          content: "",
          missing: true
        });
        continue;
      }
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return output;
}