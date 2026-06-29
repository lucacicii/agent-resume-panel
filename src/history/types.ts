export type AgentProvider = "codex" | "claude" | "agy" | "grok" | "alma" | "opencode" | "pi";

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
  almaDataDir: string;
  opencodeHome: string;
  piHome: string;
  maxItems: number;
  showArchivedCodex: boolean;
  showArchivedOpenCode: boolean;
  showSubagentCodex: boolean;
  showSubagentGrok: boolean;
  hideCronAlma: boolean;
  hideChannelAlma: boolean;
  showIncognitoAlma: boolean;
}

export interface HistoryLoadResult {
  sessions: AgentSession[];
  warnings: string[];
}
