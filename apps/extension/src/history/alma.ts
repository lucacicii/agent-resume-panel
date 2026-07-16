import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function defaultAlmaDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "alma");
  }

  return path.join(os.homedir(), ".config", "alma");
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

function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}
