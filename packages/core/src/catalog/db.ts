import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runSqlite } from "../sqlite";
import {
  AUTO_RENAME_STATE_SCHEMA_SQL,
  EXTENSION_MIGRATION_SQL,
  EXTENSION_SCHEMA_SQL,
  NOTE_ARCHIVE_SCHEMA_SQL
} from "./extensionSchema";
import { ensureProjectsCatalogSchema } from "./projects";

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

export function resetCatalogSchemaCache(): void {
  extensionCatalogInFlight.clear();
  verifiedExtensionCatalogPaths.clear();
}

/** VS Code extension catalog tables. */
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
    await runIdempotentStatements(target, NOTE_ARCHIVE_SCHEMA_SQL);
    await runIdempotentStatements(target, AUTO_RENAME_STATE_SCHEMA_SQL);
    await ensureProjectsCatalogSchema(target);
    verifiedExtensionCatalogPaths.add(target);
  })().finally(() => {
    extensionCatalogInFlight.delete(target);
  });

  extensionCatalogInFlight.set(target, task);
  return task;
}
