import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

export async function runSqlite(dbPath: string, sql: string): Promise<void> {
  await execFileAsync("sqlite3", [dbPath, sql], {
    maxBuffer: 1024 * 1024
  });
}

export async function runSqliteJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
    maxBuffer: 20 * 1024 * 1024
  });
  return JSON.parse(stdout || "[]") as T[];
}
