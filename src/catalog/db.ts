import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runSqlite } from "../history/sqlite";

const SCHEMA_SQL = `
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
  last_sync_at_ms INTEGER
);
`;

const MIGRATION_SQL = `
ALTER TABLE sessions ADD COLUMN transcript_kind TEXT;
ALTER TABLE sessions ADD COLUMN transcript_refs TEXT;
ALTER TABLE sessions ADD COLUMN session_summary TEXT;
ALTER TABLE sessions ADD COLUMN session_summary_language TEXT;
ALTER TABLE sessions ADD COLUMN session_summary_at_ms INTEGER;
`;

export async function ensureCatalogSchema(dbPath: string): Promise<void> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await runSqlite(dbPath, SCHEMA_SQL);
  await runCatalogMigrations(dbPath);
}

async function runCatalogMigrations(dbPath: string): Promise<void> {
  const statements = MIGRATION_SQL.split(";")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const statement of statements) {
    try {
      await runSqlite(dbPath, `${statement};`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("duplicate column name")) {
        continue;
      }
      throw error;
    }
  }
}