export const REPORT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS report_entries (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  period_start_ms INTEGER NOT NULL,
  period_end_ms INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  embedding_json TEXT,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_entries_level ON report_entries(level, period_start_ms DESC);
CREATE TABLE IF NOT EXISTS report_links (
  report_id TEXT NOT NULL,
  provider TEXT,
  agent_session_id TEXT,
  project_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_links_report ON report_links(report_id);
CREATE INDEX IF NOT EXISTS idx_report_links_session ON report_links(provider, agent_session_id);
CREATE TABLE IF NOT EXISTS report_jobs (
  job_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_error TEXT,
  updated_at_ms INTEGER NOT NULL
);
`;

export type ReportLevel = "daily" | "weekly" | "monthly" | "session" | "profile";

export interface ReportEntry {
  id: string;
  level: ReportLevel | string;
  periodStartMs: number;
  periodEndMs: number;
  title: string | null;
  content: string;
  embeddingJson: string | null;
  createdAtMs: number;
}

export interface ReportLink {
  reportId: string;
  provider: string | null;
  agentSessionId: string | null;
  projectPath: string | null;
}