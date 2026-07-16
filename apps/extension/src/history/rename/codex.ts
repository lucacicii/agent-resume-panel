import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "../types";
import { readJsonLines } from "../jsonl";
import { escapeSqlLiteral, runSqlite } from "../sqlite";

interface CodexIndexRow {
  id: string;
  thread_name?: string;
  updated_at?: string;
}

export async function renameCodexSession(codexHome: string, session: AgentSession, title: string): Promise<void> {
  const dbPath = await findNewestStateDb(codexHome);
  if (dbPath) {
    const sql = `update threads set title = '${escapeSqlLiteral(title)}' where id = '${escapeSqlLiteral(session.id)}';`;
    await runSqlite(dbPath, sql);
  }

  await updateSessionIndex(path.join(codexHome, "session_index.jsonl"), session.id, title);
}

async function findNewestStateDb(codexHome: string): Promise<string | undefined> {
  const entries = await fs.readdir(codexHome, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/.test(entry.name))
    .map((entry) => path.join(codexHome, entry.name));

  if (!candidates.length) {
    return undefined;
  }

  const stats = await Promise.all(
    candidates.map(async (candidate) => ({
      path: candidate,
      mtimeMs: (await fs.stat(candidate)).mtimeMs
    }))
  );

  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats[0].path;
}

async function updateSessionIndex(indexPath: string, sessionId: string, title: string): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }

  const lines = raw.split(/\r?\n/);
  let changed = false;
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return line;
    }

    let row: CodexIndexRow;
    try {
      row = JSON.parse(trimmed) as CodexIndexRow;
    } catch {
      return line;
    }

    if (row.id !== sessionId) {
      return line;
    }

    changed = true;
    return JSON.stringify({ ...row, thread_name: title });
  });

  if (changed) {
    const output = nextLines.join("\n");
    await fs.writeFile(indexPath, output.endsWith("\n") ? output : `${output}\n`, "utf8");
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}