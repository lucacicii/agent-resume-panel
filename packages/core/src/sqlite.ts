import { spawn } from "node:child_process";
import * as path from "node:path";

/** Wait for locks (ms) when VS Code extension / other processes hold catalog.db */
const SQLITE_BUSY_TIMEOUT_MS = 15_000;
const SQLITE_MAX_ATTEMPTS = 10;
/** Hard cap on a single sqlite3 invocation so a wedged child can never hang an IPC forever. */
const SQLITE_EXEC_TIMEOUT_MS = 60_000;

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
    message.includes("database is locked (5)") ||
    message.includes("cannot start a transaction within a transaction") ||
    (message.includes("table ") && message.includes(" is locked"))
  );
}

// In-process SQLite engine (Node 22+ / Electron 43+)
type NodeDatabaseSyncType = {
  new (
    location: string,
    options?: { readOnly?: boolean; open?: boolean; enableForeignKeyConstraints?: boolean }
  ): {
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    };
    close(): void;
  };
};
type NodeDatabase = InstanceType<NodeDatabaseSyncType>;

let NodeDatabaseSync: NodeDatabaseSyncType | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeSqlite = require("node:sqlite");
  if (typeof nodeSqlite?.DatabaseSync === "function") {
    NodeDatabaseSync = nodeSqlite.DatabaseSync;
  }
} catch {
  NodeDatabaseSync = null;
}

const dbQueues = new Map<string, Promise<void>>();

function openInProcessDb(dbPath: string, readonly: boolean): NodeDatabase | null {
  if (!NodeDatabaseSync) return null;
  const target = path.resolve(dbPath);
  try {
    const db = readonly
      ? new NodeDatabaseSync(target, { readOnly: true })
      : new NodeDatabaseSync(target);
    db.exec(readonly
      ? `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}; PRAGMA query_only = ON;`
      : `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -8000;`);
    return db;
  } catch {
    return null;
  }
}

function withInProcessDb<T>(
  dbPath: string,
  readonly: boolean,
  operation: (db: NodeDatabase) => T
): Promise<T | undefined> {
  if (!NodeDatabaseSync) return Promise.resolve(undefined);
  const target = path.resolve(dbPath);
  const key = `${readonly ? "ro" : "rw"}:${target}`;
  const previous = dbQueues.get(key) || Promise.resolve();
  const task = previous.then(() => {
    const db = openInProcessDb(target, readonly);
    if (!db) return undefined;
    try {
      return operation(db);
    } finally {
      try {
        db.close();
      } catch {
        // ignore operation close errors
      }
    }
  });
  dbQueues.set(key, task.then(() => undefined, () => undefined));
  return task;
}

export function closeAllSqliteDatabases(): void {
  dbQueues.clear();
}

function toPlainRows<T>(rows: unknown[]): T[] {
  return rows.map((row) => Object.assign({}, row) as T);
}

function executeSqlOnDb(db: NodeDatabase, sql: string): void {
  db.exec(sql);
}

function querySqlOnDb<T>(db: NodeDatabase, sql: string): T[] {
  const statements = sql.trim().split(";").map((s) => s.trim()).filter(Boolean);
  if (statements.length === 0) return [];
  if (statements.length === 1) return toPlainRows<T>(db.prepare(statements[0]).all());

  let selectIndex = -1;
  for (let i = statements.length - 1; i >= 0; i--) {
    const upper = statements[i].toUpperCase();
    if (upper.startsWith("SELECT") || upper.startsWith("PRAGMA") || upper.startsWith("WITH")) {
      selectIndex = i;
      break;
    }
  }
  if (selectIndex < 0) {
    db.exec(sql);
    return [];
  }
  if (selectIndex > 0) db.exec(`${statements.slice(0, selectIndex).join(";\n")};`);
  const result = toPlainRows<T>(db.prepare(statements[selectIndex]).all());
  if (selectIndex < statements.length - 1) db.exec(`${statements.slice(selectIndex + 1).join(";\n")};`);
  return result;
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
    // A child that never exits (e.g. stuck on a lock or a wedged FS) would leave
    // the enclosing IPC promise pending forever; kill it so the caller can recover.
    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(stderr.trim() || `sqlite3 timed out after ${SQLITE_EXEC_TIMEOUT_MS / 1000}s.`));
    }, SQLITE_EXEC_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
      if (stdout.length > maxBuffer) {
        clearTimeout(killTimer);
        child.kill();
        reject(new Error("sqlite3 stdout exceeded maxBuffer."));
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(killTimer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `sqlite3 exited with code ${code ?? "unknown"}.`));
    });
    child.stdin.on("error", (error) => {
      clearTimeout(killTimer);
      reject(error);
    });
    child.stdin.end(sql);
  });
}

/**
 * Execute SQL with in-process SQLite or fallback to sqlite3 CLI with retry.
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
  const result = await withInProcessDb(dbPath, false, (db) => {
    executeSqlOnDb(db, sql);
    return true;
  });
  if (result === true) return;
  await execSqlite3(dbPath, sql);
}

export async function runSqliteJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const result = await withInProcessDb(dbPath, false, (db) => querySqlOnDb<T>(db, sql));
  if (result !== undefined) return result;
  const stdout = await execSqlite3(dbPath, sql, { json: true, maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(stdout || "[]") as T[];
}

/** Read external SQLite databases without allowing SQLite to create or update files. */
export async function runSqliteReadOnlyJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const result = await withInProcessDb(dbPath, true, (db) => querySqlOnDb<T>(db, sql));
  if (result !== undefined) return result;
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
