export const MEMORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  period_start_ms INTEGER NOT NULL,
  period_end_ms INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  embedding_json TEXT,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_entries_level ON memory_entries(level, period_start_ms DESC);
CREATE TABLE IF NOT EXISTS memory_links (
  memory_id TEXT NOT NULL,
  provider TEXT,
  agent_session_id TEXT,
  project_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_memory_links_memory ON memory_links(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_session ON memory_links(provider, agent_session_id);
CREATE TABLE IF NOT EXISTS memory_jobs (
  job_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_error TEXT,
  updated_at_ms INTEGER NOT NULL
);
`;

/** Idempotent migrations for older DBs that already have sessions. */
export const MEMORY_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  period_start_ms INTEGER NOT NULL,
  period_end_ms INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  embedding_json TEXT,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_entries_level ON memory_entries(level, period_start_ms DESC);
CREATE TABLE IF NOT EXISTS memory_links (
  memory_id TEXT NOT NULL,
  provider TEXT,
  agent_session_id TEXT,
  project_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_memory_links_memory ON memory_links(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_session ON memory_links(provider, agent_session_id);
CREATE TABLE IF NOT EXISTS memory_jobs (
  job_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_error TEXT,
  updated_at_ms INTEGER NOT NULL
);
`;

export type MemoryLevel = "daily" | "weekly" | "monthly" | "session" | "profile";

export interface MemoryEntry {
  id: string;
  level: MemoryLevel | string;
  periodStartMs: number;
  periodEndMs: number;
  title: string | null;
  content: string;
  embeddingJson: string | null;
  createdAtMs: number;
}

export interface MemoryLink {
  memoryId: string;
  provider: string | null;
  agentSessionId: string | null;
  projectPath: string | null;
}
