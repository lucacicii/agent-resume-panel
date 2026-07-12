/** Tables needed by Desktop workflow; compatible with extension (IF NOT EXISTS). */
export const GTD_AND_NOTES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS session_gtd (
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider, agent_session_id)
);
CREATE INDEX IF NOT EXISTS idx_session_gtd_status ON session_gtd(status);

CREATE TABLE IF NOT EXISTS gtd_ai_audit (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT,
  source_memory_ids TEXT,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gtd_ai_audit_session ON gtd_ai_audit(provider, agent_session_id);
CREATE INDEX IF NOT EXISTS idx_gtd_ai_audit_created ON gtd_ai_audit(created_at_ms DESC);

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

CREATE TABLE IF NOT EXISTS catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  project_path TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_usage_events (
  id TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  job_key TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_usage_created ON llm_usage_events(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_usage_source ON llm_usage_events(source, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS schedule_run_logs (
  id TEXT PRIMARY KEY,
  started_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER,
  level TEXT NOT NULL,
  period_key TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'schedule',
  status TEXT NOT NULL,
  error TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_started ON schedule_run_logs(started_at_ms DESC);

CREATE TABLE IF NOT EXISTS ask_messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT,
  fallback INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ask_messages_order ON ask_messages(sort_order ASC);
`;
