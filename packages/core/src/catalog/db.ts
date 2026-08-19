import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runSqlite, runSqliteJson } from "../sqlite";
import { REPORT_SCHEMA_SQL } from "../report/schema";
import { DESKTOP_AGENT_TRACE_MIGRATION_SQL, DESKTOP_ONLY_SCHEMA_SQL, SYNC_STATE_DESKTOP_MIGRATION_SQL } from "./desktopSchema";
import { EXTENSION_MIGRATION_SQL, EXTENSION_SCHEMA_SQL } from "./extensionSchema";
import { ensureProjectsCatalogSchema } from "./projects";

async function tableExists(dbPath: string, tableName: string): Promise<boolean> {
  const rows = await runSqliteJson(
    dbPath,
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}';`
  );
  return rows.length > 0;
}

async function runIdempotentStatements(dbPath: string, sql: string): Promise<void> {
  for (const statement of sql.split(";").map((item) => item.trim()).filter(Boolean)) {
    try {
      await runSqlite(dbPath, `${statement};`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("duplicate column name") ||
        message.includes("already exists") ||
        message.includes("no such table") ||
        message.includes("no such column")
      ) {
        continue;
      }
      throw error;
    }
  }
}

async function ensureWalMode(dbPath: string): Promise<void> {
  try {
    await runSqlite(dbPath, "PRAGMA journal_mode=WAL;");
  } catch {
    // ignore if filesystem disallows WAL
  }
}

/** VS Code extension frozen catalog tables only. */
export async function ensureExtensionCatalogSchema(dbPath: string): Promise<void> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await ensureWalMode(dbPath);
  await runSqlite(dbPath, EXTENSION_SCHEMA_SQL);
  await runIdempotentStatements(dbPath, EXTENSION_MIGRATION_SQL);
  await ensureProjectsCatalogSchema(dbPath);
}

/** Additive sync_state columns on the shared catalog (Desktop sync status). */
export async function ensureCatalogSyncStateDesktop(catalogDb: string): Promise<void> {
  await runIdempotentStatements(catalogDb, SYNC_STATE_DESKTOP_MIGRATION_SQL);
}

/** Desktop-private tables in panelHome/.desktop/desktop.db. */
export async function ensureDesktopDbSchema(desktopDb: string): Promise<void> {
  await fs.mkdir(path.dirname(desktopDb), { recursive: true });
  await ensureWalMode(desktopDb);
  await runSqlite(desktopDb, REPORT_SCHEMA_SQL);
  await runSqlite(desktopDb, DESKTOP_ONLY_SCHEMA_SQL);
  await runIdempotentStatements(desktopDb, DESKTOP_AGENT_TRACE_MIGRATION_SQL);
}

export async function syncStateHasExtendedColumns(dbPath: string): Promise<boolean> {
  if (!(await tableExists(dbPath, "sync_state"))) {
    return false;
  }
  const columns = (await runSqliteJson(dbPath, "PRAGMA table_info(sync_state);")) as Array<{ name: string }>;
  return columns.some((column) => column.name === "status");
}
