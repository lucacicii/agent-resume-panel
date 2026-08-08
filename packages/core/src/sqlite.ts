import { spawn } from "node:child_process";

/** Wait for locks (ms) when VS Code extension / other processes hold catalog.db */
const SQLITE_BUSY_TIMEOUT_MS = 15_000;
const SQLITE_MAX_ATTEMPTS = 10;

export function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("database is locked") ||
    message.includes("SQLITE_BUSY") ||
    message.includes("database is locked (5)")
  );
}

function runSqlite3Once(
  dbPath: string,
  sql: string,
  options?: { json?: boolean; maxBuffer?: number; readonly?: boolean }
): Promise<string> {
  const args: string[] = [];
  if (options?.readonly) {
    args.push("-readonly");
  }
  if (options?.json) {
    args.push("-json");
  }
  // SQL via stdin avoids ARG_MAX limits when inserting long Ask replies / digests.
  args.push("-cmd", `.timeout ${SQLITE_BUSY_TIMEOUT_MS}`, dbPath);
  const maxBuffer = options?.maxBuffer ?? (options?.json ? 20 * 1024 * 1024 : 1024 * 1024);

  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
      if (stdout.length > maxBuffer) {
        child.kill();
        reject(new Error("sqlite3 stdout exceeded maxBuffer."));
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `sqlite3 exited with code ${code ?? "unknown"}.`));
    });
    child.stdin.on("error", reject);
    child.stdin.end(sql);
  });
}

/**
 * Invoke sqlite3 CLI with busy timeout + retries.
 * Shared catalog.db is often opened by the VS Code extension at the same time.
 */
async function execSqlite3(
  dbPath: string,
  sql: string,
  options?: { json?: boolean; maxBuffer?: number; readonly?: boolean }
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SQLITE_MAX_ATTEMPTS; attempt++) {
    try {
      const stdout = await runSqlite3Once(dbPath, sql, options);
      return stdout || "";
    } catch (error) {
      lastError = error;
      if (!isBusyError(error) || attempt === SQLITE_MAX_ATTEMPTS) {
        throw error;
      }
      // exponential-ish backoff: 40, 160, 360, … ms
      await sleep(40 * attempt * attempt);
    }
  }
  throw lastError;
}

export async function runSqlite(dbPath: string, sql: string): Promise<void> {
  await execSqlite3(dbPath, sql);
}

export async function runSqliteJson<T>(
  dbPath: string,
  sql: string,
  options?: { maxBuffer?: number }
): Promise<T[]> {
  const stdout = await execSqlite3(dbPath, sql, {
    json: true,
    maxBuffer: options?.maxBuffer ?? 20 * 1024 * 1024
  });
  return JSON.parse(stdout || "[]") as T[];
}

/** Read external SQLite databases without allowing SQLite to create or update files. */
export async function runSqliteReadOnlyJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const stdout = await execSqlite3(dbPath, sql, {
    json: true,
    maxBuffer: 20 * 1024 * 1024,
    readonly: true
  });
  return JSON.parse(stdout || "[]") as T[];
}

/** Run multiple statements in one connection under BEGIN IMMEDIATE (reduces lock races). */
export async function runSqliteTransaction(dbPath: string, statements: string[]): Promise<void> {
  const body = statements.map((s) => s.replace(/;\s*$/, "")).join(";\n");
  const sql = `BEGIN IMMEDIATE;\n${body};\nCOMMIT;`;
  await runSqlite(dbPath, sql);
}
