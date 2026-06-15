export type AgentProvider = "codex" | "claude" | "agy" | "grok";

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
  messageCount?: number;
}

export interface HistoryLoadOptions {
  codexHome: string;
  claudeHome: string;
  antigravityHome: string;
  grokHome: string;
  maxItems: number;
  showArchivedCodex: boolean;
  showSubagentGrok: boolean;
}

export interface HistoryLoadResult {
  sessions: AgentSession[];
  warnings: string[];
}
