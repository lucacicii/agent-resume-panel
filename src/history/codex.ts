import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentSession } from "./types";
import { readJsonLines } from "./jsonl";

const execFileAsync = promisify(execFile);

interface CodexThreadRow {
  id: string;
  title?: string;
  cwd?: string;
  updated_at_ms?: number;
  updated_at?: number;
  model?: string | null;
  git_branch?: string | null;
  archived?: number;
  source?: string | null;
  preview?: string | null;
  first_user_message?: string | null;
}

interface CodexIndexRow {
  id: string;
  thread_name?: string;
  updated_at?: string;
}

export async function loadCodexSessions(
  codexHome: string,
  maxItems: number,
  showArchived: boolean,
  showSubagents: boolean
): Promise<{ sessions: AgentSession[]; warning?: string }> {
  try {
    const dbPath = await findNewestStateDb(codexHome);
    if (dbPath) {
      return {
        sessions: await loadFromSqlite(dbPath, maxItems, showArchived, showSubagents)
      };
    }
  } catch (error) {
    const fallback = await loadFromIndex(codexHome, maxItems);
    return {
      sessions: fallback,
      warning: `Codex sqlite read failed; used session_index.jsonl fallback. ${formatError(error)}`
    };
  }

  const fallback = await loadFromIndex(codexHome, maxItems);
  return {
    sessions: fallback,
    warning: fallback.length ? "Codex sqlite database was not found; used session_index.jsonl fallback." : undefined
  };
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

async function loadFromSqlite(
  dbPath: string,
  maxItems: number,
  showArchived: boolean,
  showSubagents: boolean
): Promise<AgentSession[]> {
  const clauses: string[] = [];
  if (!showArchived) {
    clauses.push("archived = 0");
  }
  if (!showSubagents) {
    clauses.push("(source is null or instr(source, 'subagent') = 0)");
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const sql = `
    select id,title,cwd,updated_at_ms,updated_at,model,git_branch,archived,source,preview,first_user_message
    from threads
    ${where}
    order by coalesce(updated_at_ms, updated_at * 1000) desc
    limit ${Math.max(1, maxItems)}
  `;

  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
    maxBuffer: 20 * 1024 * 1024
  });
  const rows = JSON.parse(stdout || "[]") as CodexThreadRow[];

  return rows
    .filter((row) => row.id && (showSubagents || !isCodexSubagent(row.source)))
    .map((row) => ({
      provider: "codex" as const,
      id: row.id,
      title: firstNonEmpty(row.title, row.preview, row.first_user_message, row.id),
      projectPath: firstNonEmpty(row.cwd, process.env.HOME, ""),
      updatedAt: Number(row.updated_at_ms ?? (row.updated_at ? row.updated_at * 1000 : 0)),
      model: row.model ?? undefined,
      branch: row.git_branch ?? undefined,
      source: row.source ?? undefined,
      archived: Boolean(row.archived)
    }));
}

async function loadFromIndex(codexHome: string, maxItems: number): Promise<AgentSession[]> {
  const rows = await readJsonLines<CodexIndexRow>(path.join(codexHome, "session_index.jsonl"));
  return rows
    .filter((row) => row.id)
    .map((row) => ({
      provider: "codex" as const,
      id: row.id,
      title: firstNonEmpty(row.thread_name, row.id),
      projectPath: process.env.HOME ?? "",
      updatedAt: Date.parse(row.updated_at ?? "") || 0
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, maxItems);
}

function isCodexSubagent(source?: string | null): boolean {
  return (source ?? "").includes("subagent");
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "Untitled";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
