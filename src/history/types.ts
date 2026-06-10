export type AgentProvider = "codex" | "claude";

export interface AgentSession {
  provider: AgentProvider;
  id: string;
  title: string;
  projectPath: string;
  updatedAt: number;
  model?: string;
  branch?: string;
  source?: string;
  archived?: boolean;
}

export interface HistoryLoadOptions {
  codexHome: string;
  claudeHome: string;
  maxItems: number;
  showArchivedCodex: boolean;
}

export interface HistoryLoadResult {
  sessions: AgentSession[];
  warnings: string[];
}
