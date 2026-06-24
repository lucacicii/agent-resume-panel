export type TerminalAgentProvider = "codex" | "claude" | "agy" | "grok" | "opencode" | "pi";

export interface ChatLinkedAgent {
  provider: TerminalAgentProvider;
  sessionId?: string;
  linkedAt?: number;
  handoffCount: number;
}

export interface ChatSessionRecord {
  id: string;
  title: string;
  projectPath: string;
  createdAt: number;
  updatedAt: number;
  model?: string;
  messageCount: number;
  linkedAgent: ChatLinkedAgent;
  lastAgentSummaryAt?: number;
  lastAgentSummaryHash?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: number;
  source?: "chat" | "agent-summary";
}

export interface ChatLinkInfo {
  chatId: string;
  provider: TerminalAgentProvider;
  sessionId?: string;
}