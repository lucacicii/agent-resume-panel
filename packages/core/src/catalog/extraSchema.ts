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
`;
