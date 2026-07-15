import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runSqlite, runSqliteJson } from "../sqlite";
import { REPORT_MIGRATION_SQL, REPORT_SCHEMA_SQL } from "../report/schema";
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

const AGENT_CHAT_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS agent_threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_threads_updated ON agent_threads(updated_at_ms DESC);
ALTER TABLE agent_messages ADD COLUMN thread_id TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id);
`;

async function tableExists(dbPath: string, tableName: string): Promise<boolean> {
  const rows = await runSqliteJson(
    dbPath,
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}';`
  );
  return rows.length > 0;
}

async function renameTableIfExists(dbPath: string, from: string, to: string): Promise<void> {
  if (await tableExists(dbPath, from)) {
    if (!(await tableExists(dbPath, to))) {
      await runSqlite(dbPath, `ALTER TABLE ${from} RENAME TO ${to};`);
    }
  }
}

async function renameColumnIfExists(
  dbPath: string,
  table: string,
  from: string,
  to: string
): Promise<void> {
  if (!(await tableExists(dbPath, table))) return;
  const columns = (await runSqliteJson(dbPath, `PRAGMA table_info(${table});`)) as Array<{ name: string }>;
  if (columns.some((c) => c.name === from) && !columns.some((c) => c.name === to)) {
    await runSqlite(dbPath, `ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to};`);
  }
}

/** One-time rename of legacy memory/ask tables to report/agent names. */
async function runReportAgentRenameMigrations(dbPath: string): Promise<void> {
  await renameTableIfExists(dbPath, "memory_entries", "report_entries");
  await renameTableIfExists(dbPath, "memory_jobs", "report_jobs");
  await renameTableIfExists(dbPath, "memory_links", "report_links");
  await renameColumnIfExists(dbPath, "report_links", "memory_id", "report_id");
  await renameTableIfExists(dbPath, "ask_threads", "agent_threads");
  await renameTableIfExists(dbPath, "ask_messages", "agent_messages");
  await renameTableIfExists(dbPath, "ask_note_audit", "agent_note_audit");
  await renameColumnIfExists(dbPath, "agent_note_audit", "ask_message_id", "agent_message_id");
  await renameColumnIfExists(dbPath, "gtd_ai_audit", "source_memory_ids", "source_report_ids");
}

async function tableRowCount(dbPath: string, tableName: string): Promise<number> {
  if (!(await tableExists(dbPath, tableName))) {
    return 0;
  }
  const rows = (await runSqliteJson(dbPath, `SELECT COUNT(*) AS c FROM ${tableName};`)) as Array<{ c: number }>;
  return Number(rows[0]?.c ?? 0);
}

/**
 * When rename was skipped (empty agent_* / report_* already existed), copy legacy rows
 * into the new tables and drop the orphaned legacy tables.
 */
async function runLegacyDataMergeMigrations(dbPath: string): Promise<void> {
  if ((await tableExists(dbPath, "memory_entries")) && (await tableExists(dbPath, "report_entries"))) {
    const legacyCount = await tableRowCount(dbPath, "memory_entries");
    if (legacyCount > 0) {
      await runSqlite(
        dbPath,
        `INSERT OR IGNORE INTO report_entries
         SELECT id, level, period_start_ms, period_end_ms, title, content, embedding_json, created_at_ms
         FROM memory_entries;`
      );
    }
    await runSqlite(dbPath, "DROP TABLE IF EXISTS memory_entries;");
  }

  if ((await tableExists(dbPath, "memory_jobs")) && (await tableExists(dbPath, "report_jobs"))) {
    const legacyCount = await tableRowCount(dbPath, "memory_jobs");
    if (legacyCount > 0) {
      await runSqlite(
        dbPath,
        `INSERT OR IGNORE INTO report_jobs
         SELECT job_key, status, last_error, updated_at_ms FROM memory_jobs;`
      );
    }
    await runSqlite(dbPath, "DROP TABLE IF EXISTS memory_jobs;");
  }

  if ((await tableExists(dbPath, "memory_links")) && (await tableExists(dbPath, "report_links"))) {
    const legacyCount = await tableRowCount(dbPath, "memory_links");
    if (legacyCount > 0) {
      const linkCols = (await runSqliteJson(dbPath, "PRAGMA table_info(memory_links);")) as Array<{
        name: string;
      }>;
      const reportIdCol = linkCols.some((c) => c.name === "memory_id") ? "memory_id" : "report_id";
      await runSqlite(
        dbPath,
        `INSERT OR IGNORE INTO report_links (report_id, provider, agent_session_id, project_path)
         SELECT ${reportIdCol}, provider, agent_session_id, project_path FROM memory_links;`
      );
    }
    await runSqlite(dbPath, "DROP TABLE IF EXISTS memory_links;");
  }

  if ((await tableExists(dbPath, "ask_threads")) && (await tableExists(dbPath, "agent_threads"))) {
    const legacyCount = await tableRowCount(dbPath, "ask_threads");
    if (legacyCount > 0) {
      await runSqlite(
        dbPath,
        `INSERT OR IGNORE INTO agent_threads
         SELECT id, title, created_at_ms, updated_at_ms FROM ask_threads;`
      );
    }
    await runSqlite(dbPath, "DROP TABLE IF EXISTS ask_threads;");
  }

  if ((await tableExists(dbPath, "ask_messages")) && (await tableExists(dbPath, "agent_messages"))) {
    const legacyCount = await tableRowCount(dbPath, "ask_messages");
    if (legacyCount > 0) {
      await runSqlite(
        dbPath,
        `INSERT OR IGNORE INTO agent_messages
         SELECT id, role, content, citations_json, fallback, sort_order, created_at_ms, thread_id
         FROM ask_messages;`
      );
    }
    await runSqlite(dbPath, "DROP TABLE IF EXISTS ask_messages;");
  }

  if ((await tableExists(dbPath, "ask_note_audit")) && (await tableExists(dbPath, "agent_note_audit"))) {
    const legacyCount = await tableRowCount(dbPath, "ask_note_audit");
    if (legacyCount > 0) {
      const auditCols = (await runSqliteJson(dbPath, "PRAGMA table_info(ask_note_audit);")) as Array<{
        name: string;
      }>;
      const msgCol = auditCols.some((c) => c.name === "ask_message_id")
        ? "ask_message_id"
        : "agent_message_id";
      await runSqlite(
        dbPath,
        `INSERT OR IGNORE INTO agent_note_audit (
           id, trace_id, agent_message_id, action, status, note_id, rel_md_path, note_title,
           actor, request_json, before_json, after_json, error, created_at_ms, completed_at_ms
         )
         SELECT
           id, trace_id, ${msgCol}, action, status, note_id, rel_md_path, note_title,
           actor, request_json, before_json, after_json, error, created_at_ms, completed_at_ms
         FROM ask_note_audit;`
      );
    }
    await runSqlite(dbPath, "DROP TABLE IF EXISTS ask_note_audit;");
  }
}

export async function ensureCatalogSchema(dbPath: string): Promise<void> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  // WAL improves concurrent readers (extension) + writer (Desktop)
  try {
    await runSqlite(dbPath, "PRAGMA journal_mode=WAL;");
  } catch {
    // ignore if filesystem disallows WAL
  }
  await runSqlite(dbPath, SESSIONS_SCHEMA_SQL);
  await runCatalogMigrations(dbPath);
  await runReportAgentRenameMigrations(dbPath);
  await runSqlite(dbPath, REPORT_SCHEMA_SQL);
  await runSqlite(dbPath, GTD_AND_NOTES_SCHEMA_SQL);
  await runReportMigrations(dbPath);
  await runAgentChatMigrations(dbPath);
  await runLegacyDataMergeMigrations(dbPath);
}

async function runAgentChatMigrations(dbPath: string): Promise<void> {
  for (const statement of AGENT_CHAT_MIGRATION_SQL.split(";").map((item) => item.trim()).filter(Boolean)) {
    try {
      await runSqlite(dbPath, `${statement};`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("duplicate column name") ||
        message.includes("already exists") ||
        message.includes("no such table")
      ) {
        continue;
      }
      throw error;
    }
  }
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

async function runReportMigrations(dbPath: string): Promise<void> {
  const statements = REPORT_MIGRATION_SQL.split(";")
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