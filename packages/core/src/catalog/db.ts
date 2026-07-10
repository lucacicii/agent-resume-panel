import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runSqlite } from "../sqlite";
import { MEMORY_MIGRATION_SQL, MEMORY_SCHEMA_SQL } from "../memory/schema";
import { GTD_AND_NOTES_SCHEMA_SQL } from "./extraSchema";

/** Minimal sessions table so desktop can open a fresh panelHome; extension owns full migrations. */
const SESSIONS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  project_path TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER,
  model TEXT,
  branch TEXT,
  source TEXT,
  acp_provider TEXT,
  user_title TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  last_synced_at_ms INTEGER,
  transcript_kind TEXT,
  transcript_refs TEXT,
  session_summary TEXT,
  session_summary_language TEXT,
  session_summary_at_ms INTEGER,
  PRIMARY KEY (provider, agent_session_id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
CREATE TABLE IF NOT EXISTS sync_state (
  provider TEXT PRIMARY KEY,
  last_sync_at_ms INTEGER,
  status TEXT,
  session_count INTEGER,
  warning TEXT
);
`;

const CATALOG_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS sync_state (
  provider TEXT PRIMARY KEY,
  last_sync_at_ms INTEGER,
  status TEXT,
  session_count INTEGER,
  warning TEXT
);
ALTER TABLE sync_state ADD COLUMN status TEXT;
ALTER TABLE sync_state ADD COLUMN session_count INTEGER;
ALTER TABLE sync_state ADD COLUMN warning TEXT;
`;

export async function ensureCatalogSchema(dbPath: string): Promise<void> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  // WAL improves concurrent readers (extension) + writer (Desktop)
  try {
    await runSqlite(dbPath, "PRAGMA journal_mode=WAL;");
  } catch {
    // ignore if filesystem disallows WAL
  }
  await runSqlite(dbPath, SESSIONS_SCHEMA_SQL);
  await runSqlite(dbPath, MEMORY_SCHEMA_SQL);
  await runSqlite(dbPath, GTD_AND_NOTES_SCHEMA_SQL);
  await runCatalogMigrations(dbPath);
  await runMemoryMigrations(dbPath);
}

async function runCatalogMigrations(dbPath: string): Promise<void> {
  for (const statement of CATALOG_MIGRATION_SQL.split(";").map((item) => item.trim()).filter(Boolean)) {
    try {
      await runSqlite(dbPath, `${statement};`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("duplicate column name") || message.includes("already exists")) {
        continue;
      }
      throw error;
    }
  }
}

async function runMemoryMigrations(dbPath: string): Promise<void> {
  const statements = MEMORY_MIGRATION_SQL.split(";")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const statement of statements) {
    try {
      await runSqlite(dbPath, `${statement};`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("duplicate column name") || message.includes("already exists")) {
        continue;
      }
      throw error;
    }
  }
}
