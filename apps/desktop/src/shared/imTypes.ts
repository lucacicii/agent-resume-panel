export const IM_AGENTS = ["pi", "claude", "codex"] as const;
export type ImAgent = (typeof IM_AGENTS)[number];

export const IM_PERMISSIONS = ["read", "write"] as const;
export type ImPermission = (typeof IM_PERMISSIONS)[number];

export const IM_MESSAGE_KINDS = ["human", "role.say", "job.card", "system"] as const;
export type ImMessageKind = (typeof IM_MESSAGE_KINDS)[number];

export const IM_JOB_STATUSES = [
  "queued",
  "connecting",
  "running",
  "awaiting_user",
  "completed",
  "failed",
  "cancelled"
] as const;
export type ImJobStatus = (typeof IM_JOB_STATUSES)[number];

export function isImAgent(value: string): value is ImAgent {
  return (IM_AGENTS as readonly string[]).includes(value);
}

export function isImPermission(value: string): value is ImPermission {
  return (IM_PERMISSIONS as readonly string[]).includes(value);
}

export const IM_BUILTIN_TEMPLATE_IDS = [
  "role_product_manager",
  "role_project_manager",
  "role_ui_designer",
  "role_developer",
  "role_tester"
] as const;

export type ImBuiltinTemplateId = (typeof IM_BUILTIN_TEMPLATE_IDS)[number];

export function isBuiltinTemplateId(value: string): value is ImBuiltinTemplateId {
  return (IM_BUILTIN_TEMPLATE_IDS as readonly string[]).includes(value);
}

export interface ImRoleTools {
  fsRead: boolean;
  fsWrite: boolean;
  execute: boolean;
}

export const DEFAULT_IM_ROLE_TOOLS: ImRoleTools = {
  fsRead: true,
  fsWrite: true,
  execute: true
};

export function parseImRoleTools(value: unknown, fallback?: ImRoleTools): ImRoleTools {
  const base = fallback ?? DEFAULT_IM_ROLE_TOOLS;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...base };
  const raw = value as Record<string, unknown>;
  return {
    fsRead: true,
    fsWrite: typeof raw.fsWrite === "boolean" ? raw.fsWrite : base.fsWrite,
    execute: typeof raw.execute === "boolean" ? raw.execute : base.execute
  };
}

export const IM_AGENT_SUGGESTED_MODELS: Record<ImAgent, Array<{ id: string; label: string }>> = {
  claude: [
    { id: "", label: "Default" },
    { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    { id: "claude-opus", label: "Claude Opus" }
  ],
  codex: [
    { id: "", label: "Default" },
    { id: "o3-mini", label: "o3-mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" }
  ],
  pi: [
    { id: "", label: "Default" }
  ]
};

export interface ImProject {
  projectId: string;
  name: string;
  localPath: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ImRoleTemplate {
  templateId: string;
  name: string;
  persona: string;
  agent: ImAgent;
  model?: string;
  permissions: ImPermission;
  tools: ImRoleTools;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ImMember {
  memberId: string;
  projectId: string;
  templateId: string;
  name: string;
  persona: string;
  agent: ImAgent;
  model?: string;
  permissions: ImPermission;
  tools: ImRoleTools;
  enabled: boolean;
  acpChatId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ImQuotedMessage {
  messageId: string;
  authorLabel: string;
  body: string;
  createdAtMs: number;
  truncated: boolean;
}

export interface ImMessage {
  messageId: string;
  projectId: string;
  kind: ImMessageKind;
  authorMemberId: string | null;
  authorLabel: string;
  body: string;
  thinking?: string;
  streaming?: boolean;
  quoteIds: string[];
  quotes: ImQuotedMessage[];
  mentionRoleIds: string[];
  jobId: string | null;
  createdAtMs: number;
}

export const IM_KNOWLEDGE_KINDS = ["text", "link", "image"] as const;
export type ImKnowledgeKind = (typeof IM_KNOWLEDGE_KINDS)[number];

export function isImKnowledgeKind(value: string): value is ImKnowledgeKind {
  return (IM_KNOWLEDGE_KINDS as readonly string[]).includes(value);
}

export interface ImKnowledgeItem {
  itemId: string;
  projectId: string;
  kind: ImKnowledgeKind;
  title: string;
  body: string;
  url: string | null;
  storagePath: string | null;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  createdAtMs: number;
}

export interface ImKnowledgeSnapshot {
  kind: ImKnowledgeKind;
  title: string;
  body: string;
  url: string | null;
  fileName: string | null;
  truncated: boolean;
}

export interface ImJobBrief {
  persona: string;
  instruction: string;
  cwd: string;
  quotes: ImQuotedMessage[];
  knowledge: ImKnowledgeSnapshot[];
}

export interface ImPermissionRequest {
  requestId: string;
  title: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
}

export interface ImJob {
  jobId: string;
  projectId: string;
  memberId: string;
  messageId: string | null;
  acpChatId: string | null;
  status: ImJobStatus;
  brief: ImJobBrief;
  error: string | null;
  filesChanged: string[];
  permission: ImPermissionRequest | null;
  createdAtMs: number;
  updatedAtMs: number;
  finishedAtMs: number | null;
}

export interface ImRoom {
  project: ImProject;
  members: ImMember[];
  messages: ImMessage[];
  jobs: ImJob[];
  knowledge: ImKnowledgeItem[];
}

export type ImEvent =
  | { type: "room"; room: ImRoom }
  | { type: "message"; projectId: string; message: ImMessage }
  | { type: "messageUpdate"; projectId: string; message: ImMessage }
  | { type: "job"; projectId: string; job: ImJob }
  | { type: "member"; projectId: string; member: ImMember };

export const IM_SELECTION_ACTION_KINDS = ["context", "independent"] as const;
export type ImSelectionActionKind = (typeof IM_SELECTION_ACTION_KINDS)[number];

export function isImSelectionActionKind(value: string): value is ImSelectionActionKind {
  return (IM_SELECTION_ACTION_KINDS as readonly string[]).includes(value);
}

export const IM_BUILTIN_SELECTION_ACTION_IDS = ["quote", "translate", "explain"] as const;
export type ImBuiltinSelectionActionId = (typeof IM_BUILTIN_SELECTION_ACTION_IDS)[number];

export function isBuiltinSelectionActionId(value: string): value is ImBuiltinSelectionActionId {
  return (IM_BUILTIN_SELECTION_ACTION_IDS as readonly string[]).includes(value);
}

export interface ImSelectionAction {
  actionId: string;
  name: string;
  kind: ImSelectionActionKind;
  prompt: string;
  providerId?: string;
  modelId?: string;
  sortOrder: number;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}
