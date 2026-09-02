export type AcpAgentProvider = "codex" | "claude" | "grok" | "opencode" | "pi" | "prime";

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
  source?: string;
}

export type AcpChatMessageRole = "user" | "assistant" | "system" | "tool" | "plan";

export type AcpToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface AcpToolCallLocation {
  path: string;
  line?: number;
}

export interface AcpToolCallInfo {
  toolCallId: string;
  title: string;
  kind: string;
  status: AcpToolCallStatus;
  locations?: AcpToolCallLocation[];
  content?: unknown[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpImageAttachment {
  id: string;
  mimeType: string;
  fileName: string;
  /** Path relative to panelHome, e.g. acp/attachments/{chatId}/{msgId}/{id}.png */
  storagePath: string;
}

export interface AcpChatMessage {
  id: string;
  role: AcpChatMessageRole;
  text: string;
  timestamp: number;
  images?: AcpImageAttachment[];
  toolCalls?: AcpToolCallInfo[];
  /** @deprecated Legacy field from standalone tool messages */
  toolCallId?: string;
  /** @deprecated Legacy field from standalone tool messages */
  status?: string;
}

export interface SessionUpdatePayload {
  sessionId: string;
  update: {
    sessionUpdate: string;
    [key: string]: unknown;
  };
}
