/**
 * Frozen mirror of src/catalog/db.ts (VS Code extension catalog schema).
 * Keep in sync manually when the extension schema changes intentionally.
 */
export const EXTENSION_SCHEMA_SQL = `
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
  project_id TEXT,
  PRIMARY KEY (provider, agent_session_id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
CREATE TABLE IF NOT EXISTS sync_state (
  provider TEXT PRIMARY KEY,
  last_sync_at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  portable_key TEXT NOT NULL UNIQUE,
  alias TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  last_seen_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_local_paths (
  project_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (project_id, machine_id)
);
CREATE INDEX IF NOT EXISTS idx_project_local_paths_path ON project_local_paths(absolute_path);
CREATE TABLE IF NOT EXISTS session_gtd (
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider, agent_session_id)
);
CREATE INDEX IF NOT EXISTS idx_session_gtd_status ON session_gtd(status);
CREATE TABLE IF NOT EXISTS session_notes (
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider, agent_session_id)
);
CREATE TABLE IF NOT EXISTS project_notes (
  project_path TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  note_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  provider TEXT,
  agent_session_id TEXT,
  project_path TEXT,
  filename TEXT NOT NULL,
  rel_dir TEXT NOT NULL,
  rel_md_path TEXT NOT NULL UNIQUE,
  title TEXT,
  content_preview TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  fs_mtime_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(provider, agent_session_id);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_path);
CREATE TABLE IF NOT EXISTS note_links (
  child_note_id TEXT PRIMARY KEY,
  parent_note_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_links_parent ON note_links(parent_note_id);
CREATE TABLE IF NOT EXISTS catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const EXTENSION_MIGRATION_SQL = `
ALTER TABLE sessions ADD COLUMN transcript_kind TEXT;
ALTER TABLE sessions ADD COLUMN transcript_refs TEXT;
ALTER TABLE sessions ADD COLUMN session_summary TEXT;
ALTER TABLE sessions ADD COLUMN session_summary_language TEXT;
ALTER TABLE sessions ADD COLUMN session_summary_at_ms INTEGER;
ALTER TABLE sessions ADD COLUMN project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
CREATE TABLE IF NOT EXISTS project_local_paths (
  project_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (project_id, machine_id)
);
CREATE INDEX IF NOT EXISTS idx_project_local_paths_path ON project_local_paths(absolute_path);
CREATE TABLE IF NOT EXISTS session_gtd (
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider, agent_session_id)
);
CREATE INDEX IF NOT EXISTS idx_session_gtd_status ON session_gtd(status);
CREATE TABLE IF NOT EXISTS session_notes (
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider, agent_session_id)
);
CREATE TABLE IF NOT EXISTS project_notes (
  project_path TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  note_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  provider TEXT,
  agent_session_id TEXT,
  project_path TEXT,
  filename TEXT NOT NULL,
  rel_dir TEXT NOT NULL,
  rel_md_path TEXT NOT NULL UNIQUE,
  title TEXT,
  content_preview TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  fs_mtime_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(provider, agent_session_id);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_path);
CREATE TABLE IF NOT EXISTS note_links (
  child_note_id TEXT PRIMARY KEY,
  parent_note_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_links_parent ON note_links(parent_note_id);
CREATE TABLE IF NOT EXISTS catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;