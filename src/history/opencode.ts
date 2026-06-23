import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentSession } from "./types";

const execFileAsync = promisify(execFile);

interface OpenCodeSessionRow {
  id: string;
  directory?: string;
  title?: string;
  time_updated?: number;
  time_archived?: number | null;
  model?: string | null;
}

export async function loadOpenCodeSessions(
  opencodeHome: string,
  maxItems: number,
  showArchived: boolean
): Promise<{ sessions: AgentSession[]; warning?: string }> {
  const dbPath = path.join(opencodeHome, "opencode.db");

  try {
    await fs.access(dbPath);
  } catch {
    return { sessions: [] };
  }

  try {
    return {
      sessions: await loadFromSqlite(dbPath, maxItems, showArchived)
    };
  } catch (error) {
    return {
      sessions: [],
      warning: `OpenCode sqlite read failed. ${formatError(error)}`
    };
  }
}

async function loadFromSqlite(
  dbPath: string,
  maxItems: number,
  showArchived: boolean
): Promise<AgentSession[]> {
  const where = showArchived ? "" : "where time_archived is null";
  const sql = `
    select id, directory, title, time_updated, time_archived, model
    from session
    ${where}
    order by time_updated desc
    limit ${Math.max(1, maxItems)}
  `;

  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
    maxBuffer: 20 * 1024 * 1024
  });
  const rows = JSON.parse(stdout || "[]") as OpenCodeSessionRow[];

  return rows
    .filter((row) => row.id)
    .map((row) => ({
      provider: "opencode" as const,
      id: row.id,
      title: cleanTitle(row.title) || row.id,
      projectPath: row.directory?.trim() || process.env.HOME || "",
      updatedAt: Number(row.time_updated ?? 0),
      model: parseModel(row.model),
      archived: row.time_archived != null,
      source: "sqlite"
    }));
}

function parseModel(raw?: string | null): string | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as { id?: string; providerID?: string };
    if (parsed.id && parsed.providerID) {
      return `${parsed.providerID}/${parsed.id}`;
    }
    return parsed.id || parsed.providerID || raw;
  } catch {
    return raw;
  }
}

function cleanTitle(input?: string): string {
  return (input ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}