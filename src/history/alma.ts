import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentSession } from "./types";

const execFileAsync = promisify(execFile);

const CHANNEL_TITLE_PREFIXES = ["WeChat:", "Telegram:", "Discord:", "Slack:"];

interface AlmaThreadRow {
  id: string;
  title: string;
  updated_at: string;
  model?: string | null;
  workspace_path?: string | null;
  workspace_name?: string | null;
  is_incognito?: number;
  message_count?: number;
}

export interface AlmaLoadFilters {
  hideCron: boolean;
  hideChannel: boolean;
  showIncognito: boolean;
}

export function defaultAlmaDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "alma");
  }

  return path.join(os.homedir(), ".config", "alma");
}

export async function loadAlmaSessions(
  almaDataDir: string,
  maxItems: number,
  filters: AlmaLoadFilters
): Promise<{ sessions: AgentSession[]; warning?: string }> {
  const dbPath = path.join(almaDataDir, "chat_threads.db");

  try {
    await fs.access(dbPath);
  } catch {
    return {
      sessions: [],
      warning: `Alma database not found at ${dbPath}.`
    };
  }

  try {
    const sessions = await loadFromSqlite(dbPath, maxItems, filters);
    return { sessions };
  } catch (error) {
    return {
      sessions: [],
      warning: `Alma sqlite read failed. ${formatError(error)}`
    };
  }
}

export async function resolveAlmaWorkspaceId(almaDataDir: string, projectPath: string): Promise<string | undefined> {
  const dbPath = path.join(almaDataDir, "chat_threads.db");

  try {
    await fs.access(dbPath);
  } catch {
    return undefined;
  }

  const normalized = path.resolve(projectPath);
  const sql = `
    select id
    from workspaces
    where path = '${escapeSqlLiteral(normalized)}'
    limit 1
  `;

  try {
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
      maxBuffer: 1024 * 1024
    });
    const id = stdout.trim();
    return id || undefined;
  } catch {
    return undefined;
  }
}

async function loadFromSqlite(
  dbPath: string,
  maxItems: number,
  filters: AlmaLoadFilters
): Promise<AgentSession[]> {
  const incognitoClause = filters.showIncognito ? "" : "and ct.is_incognito = 0";
  const sql = `
    select
      ct.id,
      ct.title,
      ct.updated_at,
      ct.model,
      ct.is_incognito,
      w.path as workspace_path,
      w.name as workspace_name,
      (select count(*) from chat_messages cm where cm.thread_id = ct.id) as message_count
    from chat_threads ct
    left join workspaces w on ct.workspace_id = w.id
    where 1 = 1
    ${incognitoClause}
    order by ct.updated_at desc
    limit ${Math.max(1, maxItems * 3)}
  `;

  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
    maxBuffer: 20 * 1024 * 1024
  });
  const rows = JSON.parse(stdout || "[]") as AlmaThreadRow[];

  return rows
    .filter((row) => row.id && !shouldHideThread(row.title, filters))
    .map((row) => ({
      provider: "alma" as const,
      id: row.id,
      title: cleanTitle(row.title) || row.id,
      projectPath: row.workspace_path?.trim() || defaultAlmaDataDir(),
      updatedAt: Date.parse(row.updated_at) || 0,
      model: row.model ?? undefined,
      source: row.workspace_name?.trim() || undefined,
      messageCount: Number(row.message_count) || undefined
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, maxItems);
}

function shouldHideThread(title: string, filters: AlmaLoadFilters): boolean {
  const normalized = title.trim();

  if (filters.hideCron && normalized.startsWith("⏰ Cron:")) {
    return true;
  }

  if (filters.hideChannel && CHANNEL_TITLE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }

  return false;
}

function cleanTitle(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, 180);
}

function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}