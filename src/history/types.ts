import { TerminalAgentProvider } from "../chat/types";

export type AgentProvider = "codex" | "claude" | "agy" | "grok" | "alma" | "opencode" | "pi" | "chat";

export interface ChatLinkInfo {
  chatId: string;
  provider: TerminalAgentProvider;
  sessionId?: string;
  handoffCount?: number;
  lastAgentSummaryAt?: number;
}

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
  chatLink?: ChatLinkInfo;
}

export interface HistoryLoadOptions {
  panelHome: string;
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
  showSubagentGrok: boolean;
  hideCronAlma: boolean;
  hideChannelAlma: boolean;
  showIncognitoAlma: boolean;
}

export interface HistoryLoadResult {
  sessions: AgentSession[];
  linkedAgentKeys: Set<string>;
  warnings: string[];
}
