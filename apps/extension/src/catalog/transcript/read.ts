import * as fs from "node:fs/promises";
import * as path from "node:path";
import { escapeSqlLiteral, runSqliteJson } from "../../history/sqlite";
import { isNodeError } from "../../history/jsonl";
import { TranscriptRefs } from "./types";

export interface TranscriptExportFile {
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
  const messages = await runSqliteJson(refs.dbPath, messageSql);
  const parts = await runSqliteJson(refs.dbPath, partSql);
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