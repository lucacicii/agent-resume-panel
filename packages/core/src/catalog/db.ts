import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runSqlite, runSqliteJson } from "../sqlite";
import { REPORT_SCHEMA_SQL } from "../report/schema";
import {
  DESKTOP_AGENT_TRACE_MIGRATION_SQL,
  DESKTOP_ONLY_SCHEMA_SQL,
  IM_MESSAGE_IMAGES_MIGRATION_SQL,
  IM_MESSAGE_THINKING_MIGRATION_SQL,
  IM_ROLE_MODEL_MIGRATION_SQL,
  IM_ROLE_DELEGATION_MIGRATION_SQL,
  IM_SMART_ROUTING_MIGRATION_SQL,
  IM_ROLE_THOUGHT_LEVEL_MIGRATION_SQL,
  IM_SELECTION_ACTION_MODEL_MIGRATION_SQL,
  IM_THREAD_MIGRATION_SQL,
  IM_TOOLS_MIGRATION_SQL,
  SYNC_STATE_DESKTOP_MIGRATION_SQL
} from "./desktopSchema";
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

const extensionCatalogInFlight = new Map<string, Promise<void>>();
const verifiedExtensionCatalogPaths = new Set<string>();
const desktopDbInFlight = new Map<string, Promise<void>>();
const verifiedDesktopDbPaths = new Set<string>();

export function resetCatalogSchemaCache(): void {
  extensionCatalogInFlight.clear();
  verifiedExtensionCatalogPaths.clear();
  desktopDbInFlight.clear();
  verifiedDesktopDbPaths.clear();
}

/** VS Code extension frozen catalog tables only. */
export async function ensureExtensionCatalogSchema(dbPath: string): Promise<void> {
  const target = path.resolve(dbPath);
  if (verifiedExtensionCatalogPaths.has(target)) {
    return;
  }
  const existing = extensionCatalogInFlight.get(target);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await ensureWalMode(target);
    await runIdempotentStatements(target, EXTENSION_SCHEMA_SQL);
    await runIdempotentStatements(target, EXTENSION_MIGRATION_SQL);
    await ensureProjectsCatalogSchema(target);
    verifiedExtensionCatalogPaths.add(target);
  })().finally(() => {
    extensionCatalogInFlight.delete(target);
  });

  extensionCatalogInFlight.set(target, task);
  return task;
}

/** Additive sync_state columns on the shared catalog (Desktop sync status). */
export async function ensureCatalogSyncStateDesktop(catalogDb: string): Promise<void> {
  await runIdempotentStatements(catalogDb, SYNC_STATE_DESKTOP_MIGRATION_SQL);
}

/** Desktop-private tables in panelHome/.desktop/desktop.db. */
export async function ensureDesktopDbSchema(desktopDb: string): Promise<void> {
  const target = path.resolve(desktopDb);
  if (verifiedDesktopDbPaths.has(target)) {
    return;
  }
  const existing = desktopDbInFlight.get(target);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await ensureWalMode(target);
    await runSqlite(target, REPORT_SCHEMA_SQL);
    await runSqlite(target, DESKTOP_ONLY_SCHEMA_SQL);
    await runIdempotentStatements(target, DESKTOP_AGENT_TRACE_MIGRATION_SQL);
    await runIdempotentStatements(target, IM_TOOLS_MIGRATION_SQL);
    await runIdempotentStatements(target, IM_ROLE_MODEL_MIGRATION_SQL);
    await runIdempotentStatements(target, IM_ROLE_THOUGHT_LEVEL_MIGRATION_SQL);
    await runIdempotentStatements(target, IM_ROLE_DELEGATION_MIGRATION_SQL);
    await runIdempotentStatements(target, IM_SMART_ROUTING_MIGRATION_SQL);
    await runIdempotentStatements(target, IM_MESSAGE_THINKING_MIGRATION_SQL);
    await runIdempotentStatements(target, IM_MESSAGE_IMAGES_MIGRATION_SQL);
    await runIdempotentStatements(target, IM_SELECTION_ACTION_MODEL_MIGRATION_SQL);
    await runIdempotentStatements(target, IM_THREAD_MIGRATION_SQL);
    verifiedDesktopDbPaths.add(target);
  })().finally(() => {
    desktopDbInFlight.delete(target);
  });

  desktopDbInFlight.set(target, task);
  return task;
}

export async function syncStateHasExtendedColumns(dbPath: string): Promise<boolean> {
  if (!(await tableExists(dbPath, "sync_state"))) {
    return false;
  }
  const columns = (await runSqliteJson(dbPath, "PRAGMA table_info(sync_state);")) as Array<{ name: string }>;
  return columns.some((column) => column.name === "status");
}
