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
  title?: string;
  kind?: string;
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
  storagePath: string;
}

/** Local file attachment shown in chat and sent as ACP resource_link / embedded resource. */
export interface AcpFileAttachment {
  id: string;
  mimeType: string;
  fileName: string;
  /** Absolute path on disk when known (preferred for resource_link). */
  absolutePath?: string;
  /** Path relative to panelHome when the file was copied into acp/attachments. */
  storagePath?: string;
  sizeBytes?: number;
}

export interface AcpChatMessage {
  id: string;
  role: AcpChatMessageRole;
  text: string;
  thinking?: string;
  timestamp: number;
  images?: AcpImageAttachment[];
  files?: AcpFileAttachment[];
  toolCalls?: AcpToolCallInfo[];
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

export interface AcpMode {
  id: string;
  name: string;
}

export type AcpConfigOptionCategory =
  | "mode"
  | "model"
  | "model_config"
  | "thought_level"
  | "collaboration_mode"
  | string;

export interface AcpConfigSelectOption {
  value: string;
  name: string;
}

export interface AcpConfigSelectGroup {
  group: string;
  name: string;
  options: AcpConfigSelectOption[];
}

/** Session configuration option (ACP configOptions). */
export type AcpConfigOption =
  | {
      type: "select";
      id: string;
      name: string;
      category?: AcpConfigOptionCategory | null;
      currentValue: string;
      options: Array<AcpConfigSelectOption | AcpConfigSelectGroup>;
    }
  | {
      type: "boolean";
      id: string;
      name: string;
      category?: AcpConfigOptionCategory | null;
      currentValue: boolean;
    };

export interface AcpModelsState {
  currentModelId: string;
  availableModels: Array<{ modelId: string; name: string }>;
}

/** A slash command advertised by the connected ACP agent. */
export interface AcpAvailableCommand {
  name: string;
  description: string;
  inputHint?: string;
}

export type AcpStreamEvent =
  | { type: "status"; chatId: string; status: string; isRunning: boolean; isConnecting: boolean }
  | { type: "error"; chatId: string; message: string }
  | { type: "init"; chatId: string; init: AcpChatInit }
  | { type: "history"; chatId: string; messages: AcpChatMessage[] }
  | { type: "message"; chatId: string; message: AcpChatMessage }
  | { type: "messageUpdate"; chatId: string; message: AcpChatMessage }
  | { type: "assistantDelta"; chatId: string; id: string; text: string; thinking?: string; toolCalls: AcpToolCallInfo[]; streaming: boolean }
  | { type: "assistantDone"; chatId: string; message: AcpChatMessage; streaming: boolean }
  | {
      type: "permissionRequest";
      chatId: string;
      requestId: string;
      title: string;
      options: Array<{ optionId: string; name: string; kind: string }>;
    }
  | {
      type: "userQuestion";
      chatId: string;
      requestId: string;
      questions: Array<{
        question: string;
        options: Array<{ label: string; description?: string; preview?: string }>;
        multiSelect?: boolean;
      }>;
    }
  | {
      type: "permissionResolved";
      chatId: string;
      requestId: string;
    }
  | {
      type: "userQuestionResolved";
      chatId: string;
      requestId: string;
    }
  | {
      type: "planFile";
      chatId: string;
      path: string;
      content: string;
      updatedAt: number;
    };

export interface AcpChatInit {
  title: string;
  projectPath: string;
  provider: AcpAgentProvider;
  acpSessionId?: string;
  modes: AcpMode[];
  modeId?: string;
  /** Legacy models payload when agent does not use configOptions.category=model. */
  models?: AcpModelsState | null;
  modelId?: string;
  /** Full session config options (model / thought_level / mode, etc.). */
  configOptions: AcpConfigOption[];
  /** Commands dynamically advertised by the connected ACP agent. */
  availableCommands: AcpAvailableCommand[];
  isRunning: boolean;
  isConnecting: boolean;
  status: string;
  imageUpload: boolean;
  /** Agent accepts embedded resource content blocks. */
  embeddedContext: boolean;
  /** Baseline ACP: resource_link always available after connect. */
  fileUpload: boolean;
}
