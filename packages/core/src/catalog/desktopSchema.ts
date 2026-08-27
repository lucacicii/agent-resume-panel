/** Desktop-only tables and additive migrations on shared tables. */
export const SYNC_STATE_DESKTOP_MIGRATION_SQL = `
ALTER TABLE sync_state ADD COLUMN status TEXT;
ALTER TABLE sync_state ADD COLUMN session_count INTEGER;
ALTER TABLE sync_state ADD COLUMN warning TEXT;
`;

export const DESKTOP_AGENT_TRACE_MIGRATION_SQL = `
ALTER TABLE agent_messages ADD COLUMN tool_trace_json TEXT;
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

CREATE TABLE IF NOT EXISTS agent_threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_threads_updated ON agent_threads(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT,
  tool_trace_json TEXT,
  fallback INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  thread_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_order ON agent_messages(sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id);

CREATE TABLE IF NOT EXISTS agent_note_audit (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  agent_message_id TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  note_id TEXT,
  rel_md_path TEXT,
  note_title TEXT,
  actor TEXT NOT NULL,
  request_json TEXT,
  before_json TEXT,
  after_json TEXT,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_note_audit_created ON agent_note_audit(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_agent_note_audit_trace ON agent_note_audit(trace_id);
CREATE INDEX IF NOT EXISTS idx_agent_note_audit_note ON agent_note_audit(note_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_tags (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  normalized_tag TEXT NOT NULL,
  category TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  consensus_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'auto',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  last_hit_at_ms INTEGER NOT NULL,
  last_decay_at_ms INTEGER NOT NULL,
  obsolete_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_entity_tags_entity ON entity_tags(entity_type, entity_id, status);
CREATE INDEX IF NOT EXISTS idx_entity_tags_tag ON entity_tags(normalized_tag, status, weight DESC);
CREATE INDEX IF NOT EXISTS idx_entity_tags_category ON entity_tags(category, status, normalized_tag);
CREATE INDEX IF NOT EXISTS idx_entity_tags_weight ON entity_tags(status, weight DESC, updated_at_ms DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_tags_unique ON entity_tags(entity_type, entity_id, normalized_tag);

CREATE TABLE IF NOT EXISTS tag_definitions (
  normalized_tag TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  session_count INTEGER NOT NULL DEFAULT 0,
  note_count INTEGER NOT NULL DEFAULT 0,
  active_entity_count INTEGER NOT NULL DEFAULT 0,
  total_hits INTEGER NOT NULL DEFAULT 0,
  global_weight REAL NOT NULL DEFAULT 1.0,
  status TEXT NOT NULL DEFAULT 'active',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tag_defs_counts ON tag_definitions(status, active_entity_count DESC);
CREATE INDEX IF NOT EXISTS idx_tag_defs_category ON tag_definitions(category, status, global_weight DESC);
`;
