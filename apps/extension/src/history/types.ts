import { AcpAgentProvider } from "../acp/types";

export type AgentProvider = "codex" | "claude" | "agy" | "grok" | "opencode" | "pi" | "cursor" | "cursor-ide" | "chat";

export interface AgentSession {
  provider: AgentProvider;
  id: string;
  title: string;
  projectPath: string;
  /** Logical catalog project id when projects schema v2 is available. */
  projectId?: string;
  updatedAt: number;
  model?: string;
  branch?: string;
  source?: string;
  archived?: boolean;
  messageCount?: number;
  acpProvider?: AcpAgentProvider;
  sessionSummary?: string;
}

export interface HistoryLoadOptions {
  panelHome: string;
  codexHome: string;
  claudeHome: string;
  antigravityHome: string;
  grokHome: string;
  opencodeHome: string;
  piHome: string;
  cursorHome: string;
  cursorIdeUserDataHome: string;
  maxItems: number;
  showArchivedCodex: boolean;
  showArchivedOpenCode: boolean;
  showSubagentCodex: boolean;
  showSubagentGrok: boolean;
  showArchivedCursorIde: boolean;
  showSubagentCursorIde: boolean;
}

export interface HistoryLoadResult {
  sessions: AgentSession[];
  warnings: string[];
}
