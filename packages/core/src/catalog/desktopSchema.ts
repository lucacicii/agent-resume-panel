/** Desktop-only tables and additive migrations on shared tables. */
export const SYNC_STATE_DESKTOP_MIGRATION_SQL = `
ALTER TABLE sync_state ADD COLUMN status TEXT;
ALTER TABLE sync_state ADD COLUMN session_count INTEGER;
ALTER TABLE sync_state ADD COLUMN warning TEXT;
`;

/** Task templates store a JSON list of referenced projects, not a single path. */
export const TASK_TEMPLATE_PROJECT_PATHS_MIGRATION_SQL = `
ALTER TABLE task_templates ADD COLUMN project_paths_json TEXT;
`;

export const DESKTOP_ONLY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS gtd_ai_audit (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT,
  source_report_ids TEXT,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gtd_ai_audit_session ON gtd_ai_audit(provider, agent_session_id);
CREATE INDEX IF NOT EXISTS idx_gtd_ai_audit_created ON gtd_ai_audit(created_at_ms DESC);

CREATE TABLE IF NOT EXISTS task_templates (
  template_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project_paths_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_templates_updated ON task_templates(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS note_chunks (
  chunk_id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  rel_md_path TEXT NOT NULL,
  scope TEXT NOT NULL,
  title TEXT,
  heading TEXT,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_chunks_note ON note_chunks(note_id);
CREATE INDEX IF NOT EXISTS idx_note_chunks_updated ON note_chunks(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS note_vector_index (
  note_id TEXT PRIMARY KEY,
  rel_md_path TEXT NOT NULL,
  scope TEXT NOT NULL,
  title TEXT,
  source_mtime_ms INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_key TEXT NOT NULL,
  indexed_at_ms INTEGER NOT NULL
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

CREATE TABLE IF NOT EXISTS session_embeddings (
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  title TEXT,
  summary_preview TEXT,
  embedding_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_key TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider, agent_session_id)
);
CREATE INDEX IF NOT EXISTS idx_session_embeddings_updated ON session_embeddings(updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_session_embeddings_key ON session_embeddings(embedding_key);

CREATE TABLE IF NOT EXISTS session_transcript_chunks (
  chunk_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  embedding_key TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_tx_chunks_session
  ON session_transcript_chunks(provider, agent_session_id);
CREATE INDEX IF NOT EXISTS idx_session_tx_chunks_key
  ON session_transcript_chunks(embedding_key);
CREATE INDEX IF NOT EXISTS idx_session_tx_chunks_updated
  ON session_transcript_chunks(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS session_transcript_index (
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  embedding_key TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider, agent_session_id)
);

CREATE TABLE IF NOT EXISTS task_workbenches (
  workbench_id TEXT PRIMARY KEY,
  task_note_id TEXT NOT NULL,
  name TEXT NOT NULL,
  project_path TEXT,
  position INTEGER NOT NULL,
  layout_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_workbenches_task
  ON task_workbenches(task_note_id, position);

CREATE TABLE IF NOT EXISTS task_workbench_sessions (
  workbench_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (workbench_id, provider, agent_session_id)
);
CREATE INDEX IF NOT EXISTS idx_task_workbench_sessions_session
  ON task_workbench_sessions(provider, agent_session_id);

CREATE TABLE IF NOT EXISTS workbench_session_folders (
  folder_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workbench_session_folders_project
  ON workbench_session_folders(project_id, parent_id, name COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workbench_session_folders_sibling_name
  ON workbench_session_folders(project_id, COALESCE(parent_id, ''), name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS workbench_session_folder_items (
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  folder_id TEXT,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider, agent_session_id)
);
CREATE INDEX IF NOT EXISTS idx_workbench_session_folder_items_project
  ON workbench_session_folder_items(project_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_workbench_session_folder_items_folder
  ON workbench_session_folder_items(folder_id);

CREATE TABLE IF NOT EXISTS catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS selection_actions (
  action_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  provider_id TEXT,
  model_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_selection_actions_sort
  ON selection_actions(sort_order, created_at_ms);

CREATE TABLE IF NOT EXISTS workbench_composer_sends (
  id TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL,
  pane_key TEXT NOT NULL,
  project_path TEXT NOT NULL,
  session_key TEXT,
  provider TEXT,
  agent_session_id TEXT,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workbench_composer_sends_created
  ON workbench_composer_sends(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_workbench_composer_sends_project
  ON workbench_composer_sends(project_path, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_workbench_composer_sends_session
  ON workbench_composer_sends(provider, agent_session_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_workbench_composer_sends_pane
  ON workbench_composer_sends(pane_key, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_workbench_composer_sends_session_key
  ON workbench_composer_sends(session_key, created_at_ms DESC);
`;
