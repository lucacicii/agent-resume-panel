export type AcpAgentProvider = "codex" | "claude" | "grok" | "opencode" | "pi";

export interface AcpAgentLaunchConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AcpSessionRecord {
  id: string;
  title: string;
  projectPath: string;
  provider: AcpAgentProvider;
  acpSessionId?: string;
  currentModeId?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export type AcpChatMessageRole = "user" | "assistant" | "system" | "tool" | "plan";

export interface AcpChatMessage {
  id: string;
  role: AcpChatMessageRole;
  text: string;
  timestamp: number;
  toolCallId?: string;
  status?: string;
}

export interface SessionUpdatePayload {
  sessionId: string;
  update: {
    sessionUpdate: string;
    [key: string]: unknown;
  };
}