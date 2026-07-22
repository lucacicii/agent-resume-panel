/** Desktop-only tables and additive migrations on shared tables. */
export const SYNC_STATE_DESKTOP_MIGRATION_SQL = `
ALTER TABLE sync_state ADD COLUMN status TEXT;
ALTER TABLE sync_state ADD COLUMN session_count INTEGER;
ALTER TABLE sync_state ADD COLUMN warning TEXT;
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
`;