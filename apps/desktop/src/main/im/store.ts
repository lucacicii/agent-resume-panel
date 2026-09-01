import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  ensureDesktopDbSchema,
  escapeSqlLiteral,
  expandHome,
  runSqlite,
  runSqliteJson,
  suggestSessionTitleFromMessages,
  type PanelSettings
} from "@agent-resume/core";
import {
  DEFAULT_BUILTIN_CALLABLE_TEMPLATE_IDS,
  IM_BUILTIN_TEMPLATE_IDS,
  isBuiltinTemplateId,
  isImAgent,
  isImPermission,
  parseImRoleTools,
  type ImAgent,
  type ImBuiltinTemplateId,
  type ImDelegationProposal,
  type ImImageAttachment,
  type ImJob,
  type ImJobBrief,
  type ImJobStatus,
  type ImKnowledgeItem,
  type ImKnowledgeKind,
  type ImKnowledgeSnapshot,
  type ImMember,
  type ImMessage,
  type ImMessageKind,
  type ImPermission,
  type ImPermissionRequest,
  type ImProject,
  type ImQuotedMessage,
  type ImRoleTemplate,
  type ImRoleTools,
  type ImRoom,
  IM_BUILTIN_SELECTION_ACTION_IDS,
  isBuiltinSelectionActionId,
  isImSelectionActionKind,
  type ImSelectionAction,
  type ImSelectionActionKind
} from "./types";

interface BuiltinRoleSpec {
  templateId: ImBuiltinTemplateId;
  name: string;
  persona: string;
  permissions: ImPermission;
  tools: ImRoleTools;
}

const BUILTIN_ROLES: readonly BuiltinRoleSpec[] = [
  {
    templateId: "role_product_manager",
    name: "Product Manager",
    persona:
      "You are Product Manager for this project. Clarify requirements, scope, and acceptance criteria. You may list and read the entire project tree. Do not write product code.",
    permissions: "read",
    tools: { fsRead: true, fsWrite: false, execute: false }
  },
  {
    templateId: "role_architect",
    name: "Architect",
    persona:
      "You are Architect for this project. Analyze system architecture, project code, and module boundaries from a global perspective. Plan technical solutions, component designs, and step-by-step implementation plans for the Developer role. You may list and read the entire project tree. Do not write or implement product code directly.",
    permissions: "read",
    tools: { fsRead: true, fsWrite: false, execute: false }
  },
  {
    templateId: "role_project_manager",
    name: "Project Manager",
    persona:
      "You are Project Manager for this project. Break work into sequenced tasks, name owners, and flag risks. You may list and read the entire project tree. Do not write product code or replace the Product Manager on requirements.",
    permissions: "read",
    tools: { fsRead: true, fsWrite: false, execute: false }
  },
  {
    templateId: "role_ui_designer",
    name: "UI Designer",
    persona:
      "You are UI Designer for this project. Propose interaction, visual structure, and copy. You may list and read the entire project tree. Do not implement code.",
    permissions: "read",
    tools: { fsRead: true, fsWrite: false, execute: false }
  },
  {
    templateId: "role_developer",
    name: "Developer",
    persona:
      "You are Developer for this project. Implement the user's instruction in the project working directory. You may list and read the entire tree. Stay inside that directory. Do not invent files outside it.",
    permissions: "write",
    tools: { fsRead: true, fsWrite: true, execute: true }
  },
  {
    templateId: "role_tester",
    name: "Tester",
    persona:
      "You are Tester for this project. Reproduce issues, write test cases, and report defects. You may list and read the entire project tree. Do not change product code; test files are allowed when asked.",
    permissions: "read",
    tools: { fsRead: true, fsWrite: false, execute: true }
  }
];

const QUOTE_BODY_MAX = 4000;
const INSTRUCTION_MAX = 16_000;
const KNOWLEDGE_TEXT_MAX = 8_000;
const KNOWLEDGE_PROMPT_MAX = 8_000;
const KNOWLEDGE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const KNOWLEDGE_IMAGE_MAX_COUNT = 20;
const KNOWLEDGE_ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const SELECTION_PROMPT_MAX = 4_000;
const SELECTION_TEXT_MAX = 8_000;

interface BuiltinSelectionActionSpec {
  actionId: (typeof IM_BUILTIN_SELECTION_ACTION_IDS)[number];
  name: string;
  kind: ImSelectionActionKind;
  prompt: string;
  sortOrder: number;
}

const BUILTIN_SELECTION_ACTIONS: readonly BuiltinSelectionActionSpec[] = [
  { actionId: "quote", name: "Quote", kind: "context", prompt: "", sortOrder: 0 },
  {
    actionId: "translate",
    name: "Translate",
    kind: "independent",
    prompt: "Translate the following text into the user's UI language. Return only the translation.\n\n{selection}",
    sortOrder: 1
  },
  {
    actionId: "explain",
    name: "Explain",
    kind: "independent",
    prompt: "Explain the following text concisely. Return only the explanation.\n\n{selection}",
    sortOrder: 2
  }
];

interface ProjectRow {
  project_id: string;
  name: string;
  local_path: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface TemplateRow {
  template_id: string;
  name: string;
  persona: string;
  agent: string;
  model: string | null;
  thought_level: string | null;
  permissions: string;
  tools_json: string | null;
  callable_template_ids_json: string | null;
  auto_dispatch: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface MemberRow {
  member_id: string;
  project_id: string;
  template_id: string;
  name: string;
  persona: string;
  agent: string;
  model: string | null;
  thought_level: string | null;
  permissions: string;
  tools_json: string | null;
  callable_template_ids_json: string | null;
  auto_dispatch: number | null;
  enabled: number;
  acp_chat_id: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface MessageRow {
  message_id: string;
  project_id: string;
  kind: string;
  author_member_id: string | null;
  author_label: string;
  body: string;
  thinking: string | null;
  images_json: string | null;
  delegation_proposals_json: string | null;
  auto_routed: number | null;
  routed_role_name: string | null;
  routing_tip: string | null;
  routing_timed_out: number | null;
  quote_ids_json: string;
  mention_role_ids_json: string;
  job_id: string | null;
  created_at_ms: number;
}

interface KnowledgeRow {
  item_id: string;
  project_id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  file_name: string | null;
  size_bytes: number | null;
  created_at_ms: number;
}

interface SelectionActionRow {
  action_id: string;
  name: string;
  kind: string;
  prompt: string;
  provider_id?: string | null;
  model_id?: string | null;
  sort_order: number;
  enabled: number;
  created_at_ms: number;
  updated_at_ms: number;
}

interface JobRow {
  job_id: string;
  project_id: string;
  member_id: string;
  message_id: string | null;
  acp_chat_id: string | null;
  status: string;
  brief_json: string;
  error: string | null;
  files_json: string;
  permission_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  finished_at_ms: number | null;
}

function sqlString(value: string): string {
  return `'${escapeSqlLiteral(value)}'`;
}

function sqlNullOrString(value: string | null | undefined): string {
  if (value == null || value === "") return "NULL";
  return sqlString(value);
}

function nowMs(): number {
  return Date.now();
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function clipBody(body: string, max = QUOTE_BODY_MAX): { body: string; truncated: boolean } {
  if (body.length <= max) return { body, truncated: false };
  return { body: `${body.slice(0, max - 1)}…`, truncated: true };
}

function parseImagesJson(raw: string | null | undefined): ImImageAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ImImageAttachment => Boolean(item && typeof item === "object" && item.id && item.fileName));
  } catch {
    return [];
  }
}

function parseProposalsJson(raw: string | null | undefined): ImDelegationProposal[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ImDelegationProposal => Boolean(item && typeof item === "object" && item.id && item.targetTemplateId));
  } catch {
    return [];
  }
}

export async function saveImMessageImage(
  panelHome: string,
  projectId: string,
  image: { fileName: string; mimeType: string; data: string }
): Promise<ImImageAttachment> {
  const id = randomUUID();
  const ext = path.extname(image.fileName) || mimeExtension(image.mimeType);
  const storagePath = path.join(".desktop", "im", projectId, "attachments", `${id}${ext}`);
  const abs = path.join(path.resolve(expandHome(panelHome)), storagePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const buffer = Buffer.from(image.data, "base64");
  await fs.writeFile(abs, buffer);
  const previewUrl = `data:${image.mimeType};base64,${image.data}`;
  return {
    id,
    fileName: image.fileName,
    mimeType: image.mimeType,
    storagePath,
    previewUrl,
    sizeBytes: buffer.length
  };
}

function mimeExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".png";
}

function mapKnowledge(row: KnowledgeRow): ImKnowledgeItem {
  return {
    itemId: row.item_id,
    projectId: row.project_id,
    kind: row.kind as ImKnowledgeKind,
    title: row.title,
    body: row.body,
    url: row.url,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    createdAtMs: row.created_at_ms
  };
}

const DEFAULT_CHAT_NAMES = new Set([
  "new chat",
  "untitled chat",
  "未命名对话",
  "新建对话",
  "新規チャット",
  "new project",
  "untitled project",
  "未命名项目",
  "新建项目"
]);

export function isDefaultChatName(name?: string | null): boolean {
  if (!name) return true;
  const normalized = name.trim().toLowerCase();
  return !normalized || DEFAULT_CHAT_NAMES.has(normalized);
}

const KNOWN_ROLE_MENTIONS = [
  "@product manager",
  "@project manager",
  "@ui designer",
  "@developer",
  "@tester",
  "@产品经理",
  "@项目经理",
  "@ui设计师",
  "@开发",
  "@测试"
];

export function extractFirstQuestionTitle(text: string): string {
  let cleaned = text;
  for (const mention of KNOWN_ROLE_MENTIONS) {
    const reg = new RegExp(mention.replace(/\s+/g, "\\s+"), "gi");
    cleaned = cleaned.replace(reg, " ");
  }
  cleaned = cleaned.replace(/@[a-zA-Z0-9_\u4e00-\u9fa5\-\.]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const firstLine = cleaned.split("\n")[0]?.trim() || cleaned;
  if (firstLine.length <= 48) return firstLine;
  return `${firstLine.slice(0, 47)}…`;
}

function mapProject(row: ProjectRow): ImProject {
  return {
    projectId: row.project_id,
    name: row.name,
    localPath: row.local_path,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function builtinToolsFor(templateId: string): ImRoleTools {
  return BUILTIN_ROLES.find((role) => role.templateId === templateId)?.tools
    ?? { fsRead: true, fsWrite: true, execute: true };
}

function parseToolsJson(raw: string | null | undefined, templateId: string): ImRoleTools {
  if (!raw) return builtinToolsFor(templateId);
  try {
    return parseImRoleTools(JSON.parse(raw), builtinToolsFor(templateId));
  } catch {
    return builtinToolsFor(templateId);
  }
}

function mapSelectionAction(row: SelectionActionRow): ImSelectionAction {
  return {
    actionId: row.action_id,
    name: row.name,
    kind: isImSelectionActionKind(row.kind) ? row.kind : "independent",
    prompt: row.prompt,
    providerId: row.provider_id?.trim() || undefined,
    modelId: row.model_id?.trim() || undefined,
    sortOrder: row.sort_order,
    enabled: row.enabled === 1,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

export function fillSelectionPrompt(template: string, selection: string): string {
  const text = selection.trim();
  if (!template.trim()) return text;
  if (template.includes("{selection}")) return template.split("{selection}").join(text);
  return `${template.trim()}\n\n${text}`;
}

function mapTemplate(row: TemplateRow): ImRoleTemplate {
  const tools = parseToolsJson(row.tools_json, row.template_id);
  const callable = parseJsonArray(row.callable_template_ids_json);
  const defaultCallable = isBuiltinTemplateId(row.template_id)
    ? DEFAULT_BUILTIN_CALLABLE_TEMPLATE_IDS[row.template_id]
    : [];
  return {
    templateId: row.template_id,
    name: row.name,
    persona: row.persona,
    agent: isImAgent(row.agent) ? row.agent : "claude",
    model: row.model?.trim() || undefined,
    thoughtLevel: row.thought_level?.trim() || undefined,
    permissions: tools.fsWrite ? "write" : "read",
    tools,
    callableTemplateIds: callable.length > 0 || row.callable_template_ids_json !== null
      ? callable
      : [...defaultCallable],
    autoDispatch: row.auto_dispatch === 1,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function mapMember(row: MemberRow, template?: ImRoleTemplate): ImMember {
  const tools = template?.tools ?? builtinToolsFor(row.template_id);
  const rowAgent = isImAgent(row.agent) ? row.agent : undefined;
  const rowModel = row.model?.trim() || undefined;
  const rowThoughtLevel = row.thought_level?.trim() || undefined;
  const memberCallable = row.callable_template_ids_json !== null
    ? parseJsonArray(row.callable_template_ids_json)
    : undefined;
  return {
    memberId: row.member_id,
    projectId: row.project_id,
    templateId: row.template_id,
    name: template?.name ?? row.name,
    persona: template?.persona ?? row.persona,
    agent: rowAgent ?? template?.agent ?? "claude",
    model: rowModel ?? template?.model ?? undefined,
    thoughtLevel: rowThoughtLevel ?? template?.thoughtLevel ?? undefined,
    permissions: template?.permissions ?? (isImPermission(row.permissions) ? row.permissions : "write"),
    tools,
    callableTemplateIds: memberCallable ?? template?.callableTemplateIds ?? (
      isBuiltinTemplateId(row.template_id) ? [...DEFAULT_BUILTIN_CALLABLE_TEMPLATE_IDS[row.template_id]] : []
    ),
    autoDispatch: row.auto_dispatch !== null ? row.auto_dispatch === 1 : Boolean(template?.autoDispatch),
    enabled: row.enabled === 1,
    acpChatId: row.acp_chat_id,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function mapJob(row: JobRow): ImJob {
  let brief: ImJobBrief = { persona: "", instruction: "", cwd: "", quotes: [], knowledge: [] };
  try {
    const parsed = JSON.parse(row.brief_json) as Partial<ImJobBrief>;
    brief = {
      persona: typeof parsed.persona === "string" ? parsed.persona : "",
      instruction: typeof parsed.instruction === "string" ? parsed.instruction : "",
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
      knowledge: Array.isArray(parsed.knowledge) ? parsed.knowledge as ImKnowledgeSnapshot[] : [],
      images: Array.isArray(parsed.images) ? parsed.images as ImImageAttachment[] : undefined,
      dispatchChain: Array.isArray(parsed.dispatchChain) ? parsed.dispatchChain.filter((item): item is string => typeof item === "string") : undefined
    };
  } catch {
    // keep empty brief
  }
  let permission: ImPermissionRequest | null = null;
  if (row.permission_json) {
    try {
      permission = JSON.parse(row.permission_json) as ImPermissionRequest;
    } catch {
      permission = null;
    }
  }
  return {
    jobId: row.job_id,
    projectId: row.project_id,
    memberId: row.member_id,
    messageId: row.message_id,
    acpChatId: row.acp_chat_id,
    status: row.status as ImJobStatus,
    brief,
    error: row.error,
    filesChanged: parseJsonArray(row.files_json),
    permission,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    finishedAtMs: row.finished_at_ms
  };
}

function formatKnowledgeBlock(items: ImKnowledgeSnapshot[]): string {
  if (!items.length) return "(none)";
  const lines: string[] = [];
  let used = 0;
  for (const item of items) {
    const header = item.kind === "link" && item.url
      ? `${item.title || item.url} — ${item.url} (URL only; fetch the page yourself if you need its contents)`
      : item.kind === "image"
        ? `${item.title || item.fileName || "image"}${item.fileName ? ` (${item.fileName})` : ""}`
        : item.title || "note";
    const body = item.body.trim();
    const chunk = body ? `${header}\n${body}` : header;
    if (used + chunk.length > KNOWLEDGE_PROMPT_MAX) {
      lines.push("[truncated]");
      break;
    }
    lines.push(item.truncated ? `${chunk} [truncated]` : chunk);
    used += chunk.length + 2;
  }
  return lines.join("\n\n");
}

export async function ensureArpDir(localPath: string): Promise<string> {
  const resolved = path.resolve(expandHome(localPath));
  const arpDir = path.join(resolved, ".arp");
  await fs.mkdir(arpDir, { recursive: true }).catch(() => undefined);
  return arpDir;
}

export function buildDispatchPrompt(
  brief: ImJobBrief,
  callableMembers: Array<{ templateId: string; name: string; persona: string }> = []
): string {
  const quoteBlock = brief.quotes.length
    ? brief.quotes
        .map((quote, index) => {
          const truncated = quote.truncated ? " [truncated]" : "";
          return `${index + 1}. ${quote.authorLabel}${truncated}:\n${quote.body}`;
        })
        .join("\n\n")
    : "(none)";

  const downstreamBlock = callableMembers.length > 0
    ? [
        "[Callable Downstream Roles]",
        "You can delegate follow-up tasks to the following active roles in this room:",
        ...callableMembers.map((m) => `- ${m.name} (id: ${m.templateId}): ${m.persona.slice(0, 140)}`),
        "",
        "If you determine that follow-up work should be delegated to one or more of these roles after completing your response, append your delegation block(s) at the very end of your response using this exact XML format:",
        '<im_dispatch target="<target_id_or_name>" reason="<brief_explanation>">',
        "[Actionable instructions for the target role]",
        "</im_dispatch>"
      ].join("\n")
    : "";

  return [
    "[Role persona]",
    brief.persona.trim() || BUILTIN_ROLES.find((role) => role.templateId === "role_developer")?.persona || "",
    "",
    "[Background knowledge]",
    formatKnowledgeBlock(brief.knowledge ?? []),
    "",
    "[Quoted messages]",
    quoteBlock,
    ...(downstreamBlock ? ["", downstreamBlock] : []),
    "",
    "[User instruction]",
    brief.instruction.trim(),
    "",
    "[Project cwd]",
    brief.cwd
      ? `${brief.cwd}\nYou may list and read the entire tree under this directory. Stay inside it. Background links are URLs only — fetch them yourself if needed. Auxiliary documents, notes, design specs, and chat-generated artifacts should be saved under .arp/ (e.g. .arp/docs/, .arp/specs/) if appropriate to keep the workspace clean.`
      : ""
  ].join("\n");
}

export class ImStore {
  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    await ensureDesktopDbSchema(this.dbPath);
    await this.ensureBuiltinTemplates();
    await this.ensureBuiltinSelectionActions();
    await this.backfillBuiltinMembersOnce();
    await this.reconcileStaleJobs();
  }

  private async reconcileStaleJobs(): Promise<void> {
    const now = nowMs();
    await runSqlite(
      this.dbPath,
      `UPDATE im_jobs
       SET status = 'cancelled',
           error = coalesce(error, 'App restarted while job was running'),
           permission_json = NULL,
           updated_at_ms = ${now},
           finished_at_ms = ${now}
       WHERE status IN ('queued', 'connecting', 'running', 'awaiting_user');`
    );
  }

  private async ensureBuiltinSelectionActions(): Promise<void> {
    const existing = await this.listSelectionActions();
    const known = new Set(existing.map((item) => item.actionId));
    const now = nowMs();
    for (const action of BUILTIN_SELECTION_ACTIONS) {
      if (known.has(action.actionId)) continue;
      await runSqlite(
        this.dbPath,
        `INSERT INTO im_selection_actions (
          action_id, name, kind, prompt, sort_order, enabled, created_at_ms, updated_at_ms
        ) VALUES (
          ${sqlString(action.actionId)},
          ${sqlString(action.name)},
          ${sqlString(action.kind)},
          ${sqlString(action.prompt)},
          ${action.sortOrder},
          1,
          ${now},
          ${now}
        );`
      );
    }
  }

  async listSelectionActions(): Promise<ImSelectionAction[]> {
    const rows = await runSqliteJson<SelectionActionRow>(
      this.dbPath,
      "SELECT * FROM im_selection_actions ORDER BY sort_order ASC, created_at_ms ASC;"
    );
    return rows.map(mapSelectionAction);
  }

  async getSelectionAction(actionId: string): Promise<ImSelectionAction | undefined> {
    const rows = await runSqliteJson<SelectionActionRow>(
      this.dbPath,
      `SELECT * FROM im_selection_actions WHERE action_id = ${sqlString(actionId)} LIMIT 1;`
    );
    return rows[0] ? mapSelectionAction(rows[0]) : undefined;
  }

  async createSelectionAction(input: {
    name: string;
    kind: ImSelectionActionKind;
    prompt?: string;
    providerId?: string;
    modelId?: string;
  }): Promise<ImSelectionAction> {
    const name = input.name.trim();
    if (!name) throw new Error("Action name is required.");
    if (!isImSelectionActionKind(input.kind)) throw new Error("Action kind must be context or independent.");
    const prompt = (input.prompt ?? "").slice(0, SELECTION_PROMPT_MAX);
    if (input.kind === "independent" && !prompt.trim()) {
      throw new Error("Independent actions need a prompt. Use {selection} for the highlighted text.");
    }
    const now = nowMs();
    const existing = await this.listSelectionActions();
    const sortOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
    const actionId = randomUUID();
    const providerId = input.providerId?.trim() || null;
    const modelId = input.modelId?.trim() || null;
    await runSqlite(
      this.dbPath,
      `INSERT INTO im_selection_actions (
        action_id, name, kind, prompt, provider_id, model_id, sort_order, enabled, created_at_ms, updated_at_ms
      ) VALUES (
        ${sqlString(actionId)},
        ${sqlString(name)},
        ${sqlString(input.kind)},
        ${sqlString(prompt)},
        ${sqlNullOrString(providerId)},
        ${sqlNullOrString(modelId)},
        ${sortOrder},
        1,
        ${now},
        ${now}
      );`
    );
    const created = await this.getSelectionAction(actionId);
    if (!created) throw new Error("Failed to load created action.");
    return created;
  }

  async updateSelectionAction(input: {
    actionId: string;
    name?: string;
    kind?: ImSelectionActionKind;
    prompt?: string;
    providerId?: string | null;
    modelId?: string | null;
    enabled?: boolean;
  }): Promise<ImSelectionAction> {
    const current = await this.getSelectionAction(input.actionId);
    if (!current) throw new Error("Selection action not found.");
    const builtin = isBuiltinSelectionActionId(current.actionId);
    const name = input.name !== undefined ? input.name.trim() : current.name;
    if (!name) throw new Error("Action name is required.");
    let kind = current.kind;
    if (input.kind !== undefined) {
      if (builtin && input.kind !== current.kind) {
        throw new Error("Builtin selection actions cannot change type.");
      }
      if (!isImSelectionActionKind(input.kind)) throw new Error("Action kind must be context or independent.");
      kind = input.kind;
    }
    const prompt = input.prompt !== undefined ? input.prompt.slice(0, SELECTION_PROMPT_MAX) : current.prompt;
    if (kind === "independent" && current.actionId !== "quote" && !prompt.trim()) {
      throw new Error("Independent actions need a prompt. Use {selection} for the highlighted text.");
    }
    const providerId = input.providerId !== undefined ? (input.providerId?.trim() || null) : (current.providerId || null);
    const modelId = input.modelId !== undefined ? (input.modelId?.trim() || null) : (current.modelId || null);
    const enabled = input.enabled === undefined ? current.enabled : input.enabled;
    const now = nowMs();
    await runSqlite(
      this.dbPath,
      `UPDATE im_selection_actions SET
        name = ${sqlString(name)},
        kind = ${sqlString(kind)},
        prompt = ${sqlString(prompt)},
        provider_id = ${sqlNullOrString(providerId)},
        model_id = ${sqlNullOrString(modelId)},
        enabled = ${enabled ? 1 : 0},
        updated_at_ms = ${now}
       WHERE action_id = ${sqlString(current.actionId)};`
    );
    const updated = await this.getSelectionAction(current.actionId);
    if (!updated) throw new Error("Failed to load updated action.");
    return updated;
  }

  async deleteSelectionAction(actionId: string): Promise<void> {
    if (isBuiltinSelectionActionId(actionId)) {
      throw new Error("Builtin selection actions cannot be deleted.");
    }
    await runSqlite(
      this.dbPath,
      `DELETE FROM im_selection_actions WHERE action_id = ${sqlString(actionId)};`
    );
  }

  clipSelectionText(value: string): string {
    return clipBody(value, SELECTION_TEXT_MAX).body;
  }

  private async ensureBuiltinTemplates(): Promise<void> {
    const existing = await this.listTemplates();
    const known = new Set(existing.map((template) => template.templateId));
    const now = nowMs();
    for (const role of BUILTIN_ROLES) {
      if (known.has(role.templateId)) continue;
      const defaultCallable = DEFAULT_BUILTIN_CALLABLE_TEMPLATE_IDS[role.templateId] ?? [];
      await runSqlite(
        this.dbPath,
        `INSERT INTO im_role_templates (
          template_id, name, persona, agent, permissions, tools_json, callable_template_ids_json, auto_dispatch, created_at_ms, updated_at_ms
        ) VALUES (
          ${sqlString(role.templateId)},
          ${sqlString(role.name)},
          ${sqlString(role.persona)},
          ${sqlString("claude")},
          ${sqlString(role.permissions)},
          ${sqlString(JSON.stringify(role.tools))},
          ${sqlString(JSON.stringify(defaultCallable))},
          0,
          ${now},
          ${now}
        );`
      );
    }
  }

  private async backfillBuiltinMembersOnce(): Promise<void> {
    const templates = await this.listTemplates();
    const builtins = templates.filter((template) => isBuiltinTemplateId(template.templateId));
    if (!builtins.length) return;
    const projects = await this.listProjects();
    for (const project of projects) {
      const members = await this.listMembers(project.projectId);
      const present = new Set(members.map((member) => member.templateId));
      const missing = builtins.filter((template) => !present.has(template.templateId));
      // Existing rooms that already mixed builtins + custom roles are left alone so
      // removing a builtin later is not undone on the next app launch.
      const onlyLegacyDeveloper = members.length === 1 && present.has("role_developer");
      if (!onlyLegacyDeveloper && members.length > 0) continue;
      for (const template of missing) {
        await this.addMemberFromTemplate(project.projectId, template);
      }
    }
  }

  async listProjects(): Promise<ImProject[]> {
    const rows = await runSqliteJson<ProjectRow>(
      this.dbPath,
      "SELECT * FROM im_projects ORDER BY updated_at_ms DESC;"
    );
    return rows.map(mapProject);
  }

  async getProject(projectId: string): Promise<ImProject | undefined> {
    const rows = await runSqliteJson<ProjectRow>(
      this.dbPath,
      `SELECT * FROM im_projects WHERE project_id = ${sqlString(projectId)} LIMIT 1;`
    );
    return rows[0] ? mapProject(rows[0]) : undefined;
  }

  async createProject(name?: string, panelHome?: string, localPath?: string | null): Promise<ImProject> {
    const trimmed = name?.trim() || "New chat";
    const now = nowMs();
    const projectId = randomUUID();
    let initialPath = localPath?.trim() ? path.resolve(expandHome(localPath.trim())) : null;
    if (!initialPath && panelHome) {
      initialPath = path.join(path.resolve(expandHome(panelHome)), ".desktop", "scratch", "im", projectId);
      await fs.mkdir(initialPath, { recursive: true }).catch(() => undefined);
    }
    if (initialPath) {
      await ensureArpDir(initialPath);
    }
    const project: ImProject = {
      projectId,
      name: trimmed,
      localPath: initialPath,
      createdAtMs: now,
      updatedAtMs: now
    };
    await runSqlite(
      this.dbPath,
      `INSERT INTO im_projects (project_id, name, local_path, created_at_ms, updated_at_ms)
       VALUES (${sqlString(project.projectId)}, ${sqlString(project.name)}, ${sqlNullOrString(project.localPath)}, ${now}, ${now});`
    );
    await this.seedBuiltinMembers(project.projectId);
    return project;
  }

  async ensureProjectLocalPath(projectId: string, panelHome: string): Promise<string> {
    const project = await this.requireProject(projectId);
    if (project.localPath) {
      await fs.mkdir(project.localPath, { recursive: true }).catch(() => undefined);
      await ensureArpDir(project.localPath);
      return project.localPath;
    }
    const scratchPath = path.join(path.resolve(expandHome(panelHome)), ".desktop", "scratch", "im", projectId);
    await fs.mkdir(scratchPath, { recursive: true }).catch(() => undefined);
    await ensureArpDir(scratchPath);
    await this.setLocalPath(projectId, scratchPath);
    return scratchPath;
  }

  private async seedBuiltinMembers(projectId: string): Promise<void> {
    const templates = await this.listTemplates();
    const byId = new Map(templates.map((template) => [template.templateId, template]));
    for (const templateId of IM_BUILTIN_TEMPLATE_IDS) {
      const template = byId.get(templateId);
      if (template) await this.addMemberFromTemplate(projectId, template);
    }
  }

  async renameProject(projectId: string, name: string): Promise<ImProject> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Project name is required.");
    const project = await this.requireProject(projectId);
    const now = nowMs();
    await runSqlite(
      this.dbPath,
      `UPDATE im_projects SET name = ${sqlString(trimmed)}, updated_at_ms = ${now}
       WHERE project_id = ${sqlString(projectId)};`
    );
    return { ...project, name: trimmed, updatedAtMs: now };
  }

  async autoRenameProject(projectId: string, settings: PanelSettings): Promise<{ project: ImProject; title: string }> {
    const room = await this.getRoom(projectId);
    const humanMessages = room.messages.filter((m) => m.kind === "human" && m.body.trim());
    const firstHuman = humanMessages[0];
    const fallbackTitle = firstHuman ? extractFirstQuestionTitle(firstHuman.body) : "";

    const previewMessages = room.messages
      .filter((m) => m.kind === "human" || m.kind === "role.say")
      .map((m) => ({
        role: m.kind === "human" ? ("user" as const) : ("assistant" as const),
        text: m.body
      }))
      .filter((m) => m.text.trim());

    let title = fallbackTitle || room.project.name || "New chat";

    if (settings?.llm?.baseUrl?.trim() && previewMessages.length > 0) {
      try {
        const runtimeConfig = {
          baseUrl: settings.llm.baseUrl.trim(),
          apiKey: settings.llm.apiKey?.trim() || "",
          model: settings.llm.model?.trim() || "gpt-4o",
          outputLanguage: settings.llm.outputLanguage
        };
        const result = await suggestSessionTitleFromMessages(runtimeConfig, room.project.name, previewMessages);
        if (result.title?.trim()) {
          title = result.title.trim();
        }
      } catch (err) {
        console.warn("[IM Store] autoRenameProject LLM failed, using fallback:", err);
      }
    }

    const updated = await this.renameProject(projectId, title);
    return { project: updated, title };
  }

  async setLocalPath(projectId: string, localPath: string | null): Promise<ImProject> {
    const project = await this.requireProject(projectId);
    let nextPath: string | null = null;
    if (localPath?.trim()) {
      const resolved = path.resolve(expandHome(localPath.trim()));
      if (!path.isAbsolute(resolved)) throw new Error("Local path must be absolute.");
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat?.isDirectory()) throw new Error("Selected folder is not a valid directory.");
      nextPath = resolved;
      await ensureArpDir(nextPath);
    }
    const now = nowMs();
    await runSqlite(
      this.dbPath,
      `UPDATE im_projects SET local_path = ${sqlNullOrString(nextPath)}, updated_at_ms = ${now}
       WHERE project_id = ${sqlString(projectId)};`
    );
    return { ...project, localPath: nextPath, updatedAtMs: now };
  }

  async deleteProject(projectId: string, panelHome?: string): Promise<{ deletedAcpChatIds: string[] }> {
    await this.requireProject(projectId);
    // 1. Collect all ACP chat ids linked to this project
    const memberRows = await runSqliteJson<{ acp_chat_id: string | null }>(
      this.dbPath,
      `SELECT acp_chat_id FROM im_members WHERE project_id = ${sqlString(projectId)} AND acp_chat_id IS NOT NULL;`
    );
    const jobRows = await runSqliteJson<{ acp_chat_id: string | null }>(
      this.dbPath,
      `SELECT acp_chat_id FROM im_jobs WHERE project_id = ${sqlString(projectId)} AND acp_chat_id IS NOT NULL;`
    );
    const acpChatIds = [
      ...new Set(
        [...memberRows, ...jobRows]
          .map((r) => r.acp_chat_id?.trim())
          .filter((id): id is string => Boolean(id))
      )
    ];

    // 2. Clean up files on disk if panelHome is provided
    if (panelHome) {
      const home = path.resolve(expandHome(panelHome));
      const scratchDir = path.join(home, ".desktop", "scratch", "im", projectId);
      const attachmentsDir = path.join(home, ".desktop", "im", projectId);
      await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(attachmentsDir, { recursive: true, force: true }).catch(() => undefined);
    }

    // 3. Delete from SQLite
    await runSqlite(
      this.dbPath,
      [
        `DELETE FROM im_jobs WHERE project_id = ${sqlString(projectId)};`,
        `DELETE FROM im_messages WHERE project_id = ${sqlString(projectId)};`,
        `DELETE FROM im_members WHERE project_id = ${sqlString(projectId)};`,
        `DELETE FROM im_knowledge WHERE project_id = ${sqlString(projectId)};`,
        `DELETE FROM im_projects WHERE project_id = ${sqlString(projectId)};`
      ].join("\n")
    );

    return { deletedAcpChatIds: acpChatIds };
  }

  async listTemplates(): Promise<ImRoleTemplate[]> {
    const rows = await runSqliteJson<TemplateRow>(
      this.dbPath,
      "SELECT * FROM im_role_templates ORDER BY created_at_ms ASC;"
    );
    return rows.map(mapTemplate);
  }

  async getTemplate(templateId: string): Promise<ImRoleTemplate | undefined> {
    const rows = await runSqliteJson<TemplateRow>(
      this.dbPath,
      `SELECT * FROM im_role_templates WHERE template_id = ${sqlString(templateId)} LIMIT 1;`
    );
    return rows[0] ? mapTemplate(rows[0]) : undefined;
  }

  async createTemplate(input: {
    name: string;
    persona: string;
    agent: ImAgent;
    model?: string;
    thoughtLevel?: string;
    tools?: ImRoleTools;
    callableTemplateIds?: string[];
    incomingCallerIds?: string[];
    autoDispatch?: boolean;
  }): Promise<ImRoleTemplate> {
    const name = input.name.trim();
    if (!name) throw new Error("Role name is required.");
    if (!isImAgent(input.agent)) throw new Error("IM only supports Pi, Claude Code, and Codex.");
    const tools = parseImRoleTools({ ...input.tools, fsRead: true });
    const model = input.model?.trim() || null;
    const thoughtLevel = input.thoughtLevel?.trim() || null;
    const callableJson = input.callableTemplateIds ? JSON.stringify(input.callableTemplateIds) : JSON.stringify([]);
    const autoDispatch = input.autoDispatch ? 1 : 0;
    const now = nowMs();
    const templateId = randomUUID();
    await runSqlite(
      this.dbPath,
      `INSERT INTO im_role_templates (
        template_id, name, persona, agent, model, thought_level, permissions, tools_json, callable_template_ids_json, auto_dispatch, created_at_ms, updated_at_ms
      ) VALUES (
        ${sqlString(templateId)},
        ${sqlString(name)},
        ${sqlString(input.persona.trim())},
        ${sqlString(input.agent)},
        ${sqlNullOrString(model)},
        ${sqlNullOrString(thoughtLevel)},
        ${sqlString(tools.fsWrite ? "write" : "read")},
        ${sqlString(JSON.stringify(tools))},
        ${sqlString(callableJson)},
        ${autoDispatch},
        ${now},
        ${now}
      );`
    );
    if (input.incomingCallerIds?.length) {
      await this.syncIncomingCallers(templateId, input.incomingCallerIds);
    }
    const created = await this.getTemplate(templateId);
    if (!created) throw new Error("Failed to load created template.");
    return created;
  }

  async updateTemplate(input: {
    templateId: string;
    name?: string;
    persona?: string;
    agent?: ImAgent;
    model?: string | null;
    thoughtLevel?: string | null;
    tools?: ImRoleTools;
    callableTemplateIds?: string[];
    incomingCallerIds?: string[];
    autoDispatch?: boolean;
  }): Promise<ImRoleTemplate> {
    const current = await this.getTemplate(input.templateId);
    if (!current) throw new Error("Role template not found.");
    const name = input.name?.trim() || current.name;
    if (!name) throw new Error("Role name is required.");
    const agent = input.agent ?? current.agent;
    if (!isImAgent(agent)) throw new Error("IM only supports Pi, Claude Code, and Codex.");
    const model = input.model !== undefined ? (input.model?.trim() || null) : (current.model ?? null);
    const thoughtLevel = input.thoughtLevel !== undefined ? (input.thoughtLevel?.trim() || null) : (current.thoughtLevel ?? null);
    const persona = input.persona ?? current.persona;
    const tools = input.tools ? parseImRoleTools({ ...input.tools, fsRead: true }) : { ...current.tools, fsRead: true };
    const callable = input.callableTemplateIds !== undefined
      ? input.callableTemplateIds
      : (current.callableTemplateIds ?? []);
    const autoDispatch = input.autoDispatch !== undefined
      ? (input.autoDispatch ? 1 : 0)
      : (current.autoDispatch ? 1 : 0);
    const now = nowMs();
    await runSqlite(
      this.dbPath,
      `UPDATE im_role_templates SET
        name = ${sqlString(name)},
        persona = ${sqlString(persona)},
        agent = ${sqlString(agent)},
        model = ${sqlNullOrString(model)},
        thought_level = ${sqlNullOrString(thoughtLevel)},
        permissions = ${sqlString(tools.fsWrite ? "write" : "read")},
        tools_json = ${sqlString(JSON.stringify(tools))},
        callable_template_ids_json = ${sqlString(JSON.stringify(callable))},
        auto_dispatch = ${autoDispatch},
        updated_at_ms = ${now}
       WHERE template_id = ${sqlString(input.templateId)};`
    );
    if (agent !== current.agent || model !== (current.model ?? null) || thoughtLevel !== (current.thoughtLevel ?? null)) {
      await runSqlite(
        this.dbPath,
        `UPDATE im_members SET acp_chat_id = NULL, agent = ${sqlString(agent)}, model = ${sqlNullOrString(model)}, thought_level = ${sqlNullOrString(thoughtLevel)}, updated_at_ms = ${now}
         WHERE template_id = ${sqlString(input.templateId)};`
      );
    }
    await runSqlite(
      this.dbPath,
      `UPDATE im_members SET
        callable_template_ids_json = ${sqlString(JSON.stringify(callable))},
        auto_dispatch = ${autoDispatch},
        updated_at_ms = ${now}
       WHERE template_id = ${sqlString(input.templateId)};`
    );
    if (input.incomingCallerIds !== undefined) {
      await this.syncIncomingCallers(input.templateId, input.incomingCallerIds);
    }
    const updated = await this.getTemplate(input.templateId);
    if (!updated) throw new Error("Failed to load updated template.");
    return updated;
  }

  private async syncIncomingCallers(targetTemplateId: string, incomingCallerIds: string[]): Promise<void> {
    const templates = await this.listTemplates();
    const desired = new Set(incomingCallerIds);
    const now = nowMs();
    for (const t of templates) {
      if (t.templateId === targetTemplateId) continue;
      const currentCallables = new Set(t.callableTemplateIds ?? []);
      const shouldHave = desired.has(t.templateId);
      let changed = false;
      if (shouldHave && !currentCallables.has(targetTemplateId)) {
        currentCallables.add(targetTemplateId);
        changed = true;
      } else if (!shouldHave && currentCallables.has(targetTemplateId)) {
        currentCallables.delete(targetTemplateId);
        changed = true;
      }
      if (changed) {
        const nextList = [...currentCallables];
        await runSqlite(
          this.dbPath,
          `UPDATE im_role_templates SET callable_template_ids_json = ${sqlString(JSON.stringify(nextList))}, updated_at_ms = ${now}
           WHERE template_id = ${sqlString(t.templateId)};
           UPDATE im_members SET callable_template_ids_json = ${sqlString(JSON.stringify(nextList))}, updated_at_ms = ${now}
           WHERE template_id = ${sqlString(t.templateId)};`
        );
      }
    }
  }

  async deleteTemplate(templateId: string): Promise<void> {
    if (isBuiltinTemplateId(templateId)) throw new Error("Builtin role templates cannot be deleted.");
    const current = await this.getTemplate(templateId);
    if (!current) throw new Error("Role template not found.");
    const now = nowMs();
    await runSqlite(
      this.dbPath,
      [
        `DELETE FROM im_members WHERE template_id = ${sqlString(templateId)};`,
        `DELETE FROM im_role_templates WHERE template_id = ${sqlString(templateId)};`
      ].join("\n")
    );
    const templates = await this.listTemplates();
    for (const t of templates) {
      if (t.callableTemplateIds?.includes(templateId)) {
        const nextList = t.callableTemplateIds.filter((id) => id !== templateId);
        await runSqlite(
          this.dbPath,
          `UPDATE im_role_templates SET callable_template_ids_json = ${sqlString(JSON.stringify(nextList))}, updated_at_ms = ${now}
           WHERE template_id = ${sqlString(t.templateId)};
           UPDATE im_members SET callable_template_ids_json = ${sqlString(JSON.stringify(nextList))}, updated_at_ms = ${now}
           WHERE template_id = ${sqlString(t.templateId)};`
        );
      }
    }
  }

  async createRole(input: {
    projectId: string;
    name: string;
    persona: string;
    agent: ImAgent;
    model?: string;
    thoughtLevel?: string;
    tools?: ImRoleTools;
  }): Promise<{ template: ImRoleTemplate; member: ImMember }> {
    await this.requireProject(input.projectId);
    const members = await this.listMembers(input.projectId);
    const name = input.name.trim();
    if (members.some((member) => member.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("A role with this name already exists in the room.");
    }
    const template = await this.createTemplate(input);
    const member = await this.addMemberFromTemplate(input.projectId, template);
    return { template, member };
  }

  async addMember(projectId: string, templateId: string): Promise<ImMember> {
    await this.requireProject(projectId);
    const templates = await this.listTemplates();
    const template = templates.find((item) => item.templateId === templateId);
    if (!template) throw new Error("Role template not found.");
    return this.addMemberFromTemplate(projectId, template);
  }

  async removeMember(memberId: string): Promise<void> {
    await this.requireMember(memberId);
    await runSqlite(
      this.dbPath,
      `DELETE FROM im_members WHERE member_id = ${sqlString(memberId)};`
    );
  }

  async updateTemplateAgent(templateId: string, agent: ImAgent): Promise<ImRoleTemplate> {
    if (!isImAgent(agent)) throw new Error("IM only supports Pi, Claude Code, and Codex.");
    const rows = await runSqliteJson<TemplateRow>(
      this.dbPath,
      `SELECT * FROM im_role_templates WHERE template_id = ${sqlString(templateId)} LIMIT 1;`
    );
    const current = rows[0];
    if (!current) throw new Error("Role template not found.");
    const now = nowMs();
    await runSqlite(
      this.dbPath,
      `UPDATE im_role_templates SET agent = ${sqlString(agent)}, updated_at_ms = ${now}
       WHERE template_id = ${sqlString(templateId)};`
    );
    return mapTemplate({ ...current, agent, updated_at_ms: now });
  }

  async listMembers(projectId: string): Promise<ImMember[]> {
    const templates = await this.listTemplates();
    const byId = new Map(templates.map((template) => [template.templateId, template]));
    const rows = await runSqliteJson<MemberRow>(
      this.dbPath,
      `SELECT * FROM im_members WHERE project_id = ${sqlString(projectId)} ORDER BY created_at_ms ASC;`
    );
    return rows.map((row) => mapMember(row, byId.get(row.template_id)));
  }

  async getMember(memberId: string): Promise<ImMember | undefined> {
    const rows = await runSqliteJson<MemberRow>(
      this.dbPath,
      `SELECT * FROM im_members WHERE member_id = ${sqlString(memberId)} LIMIT 1;`
    );
    const row = rows[0];
    if (!row) return undefined;
    const template = await this.getTemplate(row.template_id);
    return mapMember(row, template);
  }

  async addMemberFromTemplate(projectId: string, template: ImRoleTemplate): Promise<ImMember> {
    const existing = await this.listMembers(projectId);
    const found = existing.find((member) => member.templateId === template.templateId);
    if (found) return found;
    const now = nowMs();
    const callable = template.callableTemplateIds ?? (
      isBuiltinTemplateId(template.templateId) ? [...DEFAULT_BUILTIN_CALLABLE_TEMPLATE_IDS[template.templateId]] : []
    );
    const autoDispatch = template.autoDispatch ? 1 : 0;
    const member: ImMember = {
      memberId: randomUUID(),
      projectId,
      templateId: template.templateId,
      name: template.name,
      persona: template.persona,
      agent: template.agent,
      model: template.model,
      thoughtLevel: template.thoughtLevel,
      permissions: template.permissions,
      tools: template.tools,
      callableTemplateIds: callable,
      autoDispatch: template.autoDispatch,
      enabled: true,
      acpChatId: null,
      createdAtMs: now,
      updatedAtMs: now
    };
    await runSqlite(
      this.dbPath,
      `INSERT INTO im_members (
        member_id, project_id, template_id, name, persona, agent, model, thought_level, permissions, tools_json, callable_template_ids_json, auto_dispatch, enabled, acp_chat_id, created_at_ms, updated_at_ms
      ) VALUES (
        ${sqlString(member.memberId)},
        ${sqlString(projectId)},
        ${sqlString(template.templateId)},
        ${sqlString(member.name)},
        ${sqlString(member.persona)},
        ${sqlString(member.agent)},
        ${sqlNullOrString(member.model)},
        ${sqlNullOrString(member.thoughtLevel)},
        ${sqlString(member.permissions)},
        ${sqlString(JSON.stringify(member.tools))},
        ${sqlString(JSON.stringify(callable))},
        ${autoDispatch},
        1,
        NULL,
        ${now},
        ${now}
      );`
    );
    return member;
  }

  async setMemberAgent(memberId: string, agent: ImAgent): Promise<ImMember> {
    if (!isImAgent(agent)) throw new Error("IM only supports Pi, Claude Code, and Codex.");
    const member = await this.requireMember(memberId);
    const now = nowMs();
    await runSqlite(
      this.dbPath,
      `UPDATE im_members SET agent = ${sqlString(agent)}, acp_chat_id = NULL, updated_at_ms = ${now}
       WHERE member_id = ${sqlString(memberId)};`
    );
    return { ...member, agent, acpChatId: null, updatedAtMs: now };
  }

  async setMemberModel(memberId: string, model: string | null): Promise<ImMember> {
    const member = await this.requireMember(memberId);
    const now = nowMs();
    const nextModel = model?.trim() || null;
    await runSqlite(
      this.dbPath,
      `UPDATE im_members SET model = ${sqlNullOrString(nextModel)}, updated_at_ms = ${now}
       WHERE member_id = ${sqlString(memberId)};`
    );
    const template = await this.getTemplate(member.templateId);
    const effectiveModel = nextModel ?? template?.model ?? undefined;
    return { ...member, model: effectiveModel, updatedAtMs: now };
  }

  async setMemberThoughtLevel(memberId: string, thoughtLevel: string | null): Promise<ImMember> {
    const member = await this.requireMember(memberId);
    const now = nowMs();
    const nextThoughtLevel = thoughtLevel?.trim() || null;
    await runSqlite(
      this.dbPath,
      `UPDATE im_members SET thought_level = ${sqlNullOrString(nextThoughtLevel)}, updated_at_ms = ${now}
       WHERE member_id = ${sqlString(memberId)};`
    );
    const template = await this.getTemplate(member.templateId);
    const effectiveThoughtLevel = nextThoughtLevel ?? template?.thoughtLevel ?? undefined;
    return { ...member, thoughtLevel: effectiveThoughtLevel, updatedAtMs: now };
  }

  async resetMemberOverrides(memberId: string): Promise<ImMember> {
    const member = await this.requireMember(memberId);
    const template = await this.getTemplate(member.templateId);
    const now = nowMs();
    const defaultAgent = template?.agent ?? "claude";
    const defaultModel = template?.model ?? null;
    const defaultThoughtLevel = template?.thoughtLevel ?? null;
    await runSqlite(
      this.dbPath,
      `UPDATE im_members SET agent = ${sqlString(defaultAgent)}, model = ${sqlNullOrString(defaultModel)}, thought_level = ${sqlNullOrString(defaultThoughtLevel)}, acp_chat_id = NULL, updated_at_ms = ${now}
       WHERE member_id = ${sqlString(memberId)};`
    );
    return {
      ...member,
      agent: defaultAgent,
      model: defaultModel ?? undefined,
      thoughtLevel: defaultThoughtLevel ?? undefined,
      acpChatId: null,
      updatedAtMs: now
    };
  }

  async setMemberAcpChatId(memberId: string, acpChatId: string): Promise<ImMember> {
    const member = await this.requireMember(memberId);
    const now = nowMs();
    await runSqlite(
      this.dbPath,
      `UPDATE im_members SET acp_chat_id = ${sqlString(acpChatId)}, updated_at_ms = ${now}
       WHERE member_id = ${sqlString(memberId)};`
    );
    return { ...member, acpChatId, updatedAtMs: now };
  }

  async listMessages(projectId: string): Promise<ImMessage[]> {
    const rows = await runSqliteJson<MessageRow>(
      this.dbPath,
      `SELECT * FROM im_messages WHERE project_id = ${sqlString(projectId)} ORDER BY created_at_ms ASC;`
    );
    const byId = new Map(rows.map((row) => [row.message_id, row]));
    return rows.map((row) => this.mapMessage(row, byId));
  }

  async getMessage(messageId: string): Promise<ImMessage | undefined> {
    const rows = await runSqliteJson<MessageRow>(
      this.dbPath,
      `SELECT * FROM im_messages WHERE message_id = ${sqlString(messageId)} LIMIT 1;`
    );
    const row = rows[0];
    if (!row) return undefined;
    const siblings = await runSqliteJson<MessageRow>(
      this.dbPath,
      `SELECT * FROM im_messages WHERE project_id = ${sqlString(row.project_id)};`
    );
    return this.mapMessage(row, new Map(siblings.map((item) => [item.message_id, item])));
  }

  async insertMessage(input: {
    messageId?: string;
    projectId: string;
    kind: ImMessageKind;
    authorMemberId?: string | null;
    authorLabel: string;
    body: string;
    thinking?: string;
    images?: ImImageAttachment[];
    delegationProposals?: ImDelegationProposal[];
    autoRouted?: boolean;
    routedRoleName?: string;
    routingTip?: string;
    routingTimedOut?: boolean;
    quoteIds?: string[];
    mentionRoleIds?: string[];
    jobId?: string | null;
  }): Promise<ImMessage> {
    const now = nowMs();
    const messageId = input.messageId || randomUUID();
    const quoteIds = input.quoteIds ?? [];
    const mentionRoleIds = input.mentionRoleIds ?? [];
    const thinking = input.thinking?.trim() || null;
    const imagesJson = input.images?.length ? JSON.stringify(input.images) : null;
    const proposalsJson = input.delegationProposals?.length ? JSON.stringify(input.delegationProposals) : null;
    const autoRouted = input.autoRouted ? 1 : 0;
    const routingTimedOut = input.routingTimedOut ? 1 : 0;
    await runSqlite(
      this.dbPath,
      `INSERT INTO im_messages (
        message_id, project_id, kind, author_member_id, author_label, body, thinking, images_json, delegation_proposals_json, auto_routed, routed_role_name, routing_tip, routing_timed_out, quote_ids_json, mention_role_ids_json, job_id, created_at_ms
      ) VALUES (
        ${sqlString(messageId)},
        ${sqlString(input.projectId)},
        ${sqlString(input.kind)},
        ${sqlNullOrString(input.authorMemberId ?? null)},
        ${sqlString(input.authorLabel)},
        ${sqlString(input.body)},
        ${sqlNullOrString(thinking)},
        ${sqlNullOrString(imagesJson)},
        ${sqlNullOrString(proposalsJson)},
        ${autoRouted},
        ${sqlNullOrString(input.routedRoleName ?? null)},
        ${sqlNullOrString(input.routingTip ?? null)},
        ${routingTimedOut},
        ${sqlString(JSON.stringify(quoteIds))},
        ${sqlString(JSON.stringify(mentionRoleIds))},
        ${sqlNullOrString(input.jobId ?? null)},
        ${now}
      );`
    );
    await runSqlite(
      this.dbPath,
      `UPDATE im_projects SET updated_at_ms = ${now} WHERE project_id = ${sqlString(input.projectId)};`
    );
    const created = await this.getMessage(messageId);
    if (!created) throw new Error("Failed to load created message.");
    return created;
  }

  async updateMessageRouting(
    messageId: string,
    patch: {
      autoRouted?: boolean;
      routedRoleName?: string | null;
      routingTip?: string | null;
      routingTimedOut?: boolean;
    }
  ): Promise<ImMessage> {
    const current = await this.getMessage(messageId);
    if (!current) throw new Error("Message not found.");
    const now = nowMs();
    const autoRouted = patch.autoRouted !== undefined ? (patch.autoRouted ? 1 : 0) : (current.autoRouted ? 1 : 0);
    const routedRoleName = patch.routedRoleName !== undefined ? patch.routedRoleName : (current.routedRoleName ?? null);
    const routingTip = patch.routingTip !== undefined ? patch.routingTip : (current.routingTip ?? null);
    const routingTimedOut = patch.routingTimedOut !== undefined ? (patch.routingTimedOut ? 1 : 0) : (current.routingTimedOut ? 1 : 0);

    await runSqlite(
      this.dbPath,
      `UPDATE im_messages SET
        auto_routed = ${autoRouted},
        routed_role_name = ${sqlNullOrString(routedRoleName)},
        routing_tip = ${sqlNullOrString(routingTip)},
        routing_timed_out = ${routingTimedOut}
       WHERE message_id = ${sqlString(messageId)};`
    );
    await runSqlite(
      this.dbPath,
      `UPDATE im_projects SET updated_at_ms = ${now} WHERE project_id = ${sqlString(current.projectId)};`
    );
    const updated = await this.getMessage(messageId);
    if (!updated) throw new Error("Failed to load updated message.");
    return updated;
  }

  async updateMessageProposal(
    messageId: string,
    proposalId: string,
    patch: Partial<ImDelegationProposal>
  ): Promise<ImMessage> {
    const message = await this.getMessage(messageId);
    if (!message) throw new Error("Message not found.");
    const proposals = message.delegationProposals ?? [];
    const index = proposals.findIndex((p) => p.id === proposalId);
    if (index < 0) throw new Error("Proposal not found.");
    const updatedProposal = { ...proposals[index]!, ...patch };
    const nextProposals = [...proposals];
    nextProposals[index] = updatedProposal;
    const now = nowMs();
    await runSqlite(
      this.dbPath,
      `UPDATE im_messages SET
        delegation_proposals_json = ${sqlString(JSON.stringify(nextProposals))}
       WHERE message_id = ${sqlString(messageId)};`
    );
    await runSqlite(
      this.dbPath,
      `UPDATE im_projects SET updated_at_ms = ${now} WHERE project_id = ${sqlString(message.projectId)};`
    );
    const updated = await this.getMessage(messageId);
    if (!updated) throw new Error("Failed to load updated message.");
    return updated;
  }

  async updateMessage(
    messageId: string,
    patch: {
      body?: string;
      thinking?: string | null;
    }
  ): Promise<ImMessage> {
    const current = await this.getMessage(messageId);
    if (!current) throw new Error("Message not found.");
    const now = nowMs();
    const body = patch.body !== undefined ? patch.body : current.body;
    const thinking = patch.thinking !== undefined ? (patch.thinking?.trim() || null) : (current.thinking ?? null);
    await runSqlite(
      this.dbPath,
      `UPDATE im_messages SET
        body = ${sqlString(body)},
        thinking = ${sqlNullOrString(thinking)}
       WHERE message_id = ${sqlString(messageId)};`
    );
    await runSqlite(
      this.dbPath,
      `UPDATE im_projects SET updated_at_ms = ${now} WHERE project_id = ${sqlString(current.projectId)};`
    );
    const updated = await this.getMessage(messageId);
    if (!updated) throw new Error("Failed to load updated message.");
    return updated;
  }

  async attachJobToMessage(messageId: string, jobId: string): Promise<void> {
    await runSqlite(
      this.dbPath,
      `UPDATE im_messages SET job_id = ${sqlString(jobId)} WHERE message_id = ${sqlString(messageId)};`
    );
  }

  async createJob(input: {
    projectId: string;
    memberId: string;
    messageId: string | null;
    brief: ImJobBrief;
    status?: ImJobStatus;
  }): Promise<ImJob> {
    const now = nowMs();
    const jobId = randomUUID();
    const status = input.status ?? "queued";
    await runSqlite(
      this.dbPath,
      `INSERT INTO im_jobs (
        job_id, project_id, member_id, message_id, acp_chat_id, status, brief_json, error, files_json, permission_json, created_at_ms, updated_at_ms, finished_at_ms
      ) VALUES (
        ${sqlString(jobId)},
        ${sqlString(input.projectId)},
        ${sqlString(input.memberId)},
        ${sqlNullOrString(input.messageId)},
        NULL,
        ${sqlString(status)},
        ${sqlString(JSON.stringify(input.brief))},
        NULL,
        ${sqlString("[]")},
        NULL,
        ${now},
        ${now},
        NULL
      );`
    );
    const job = await this.getJob(jobId);
    if (!job) throw new Error("Failed to load created job.");
    return job;
  }

  async getJob(jobId: string): Promise<ImJob | undefined> {
    const rows = await runSqliteJson<JobRow>(
      this.dbPath,
      `SELECT * FROM im_jobs WHERE job_id = ${sqlString(jobId)} LIMIT 1;`
    );
    return rows[0] ? mapJob(rows[0]) : undefined;
  }

  async listJobs(projectId: string): Promise<ImJob[]> {
    const rows = await runSqliteJson<JobRow>(
      this.dbPath,
      `SELECT * FROM im_jobs WHERE project_id = ${sqlString(projectId)} ORDER BY created_at_ms DESC;`
    );
    return rows.map(mapJob);
  }

  async findActiveWriterJob(projectId: string): Promise<ImJob | undefined> {
    const jobs = await this.listExclusiveJobs(projectId, ["connecting", "running", "awaiting_user"]);
    return jobs[0];
  }

  async listQueuedExclusiveJobs(projectId: string): Promise<ImJob[]> {
    return this.listExclusiveJobs(projectId, ["queued"]);
  }

  private async listExclusiveJobs(projectId: string, statuses: ImJobStatus[]): Promise<ImJob[]> {
    const jobs = await this.listJobs(projectId);
    const members = await this.listMembers(projectId);
    const byId = new Map(members.map((member) => [member.memberId, member]));
    const wanted = new Set(statuses);
    return jobs
      .filter((job) => wanted.has(job.status))
      .filter((job) => {
        const member = byId.get(job.memberId);
        return Boolean(member?.tools.fsWrite || member?.tools.execute);
      })
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  memberNeedsExclusiveLock(member: ImMember): boolean {
    return member.tools.fsWrite || member.tools.execute;
  }

  async findJobByAcpChatId(acpChatId: string): Promise<ImJob | undefined> {
    const rows = await runSqliteJson<JobRow>(
      this.dbPath,
      `SELECT * FROM im_jobs
       WHERE acp_chat_id = ${sqlString(acpChatId)}
         AND status IN ('queued','connecting','running','awaiting_user')
       ORDER BY updated_at_ms DESC LIMIT 1;`
    );
    return rows[0] ? mapJob(rows[0]) : undefined;
  }

  async updateJob(
    jobId: string,
    patch: {
      status?: ImJobStatus;
      acpChatId?: string | null;
      error?: string | null;
      filesChanged?: string[];
      permission?: ImPermissionRequest | null;
      finished?: boolean;
    }
  ): Promise<ImJob> {
    const current = await this.getJob(jobId);
    if (!current) throw new Error("Job not found.");
    const now = nowMs();
    const finishedAt = patch.finished ? now : current.finishedAtMs;
    const nextStatus = patch.status ?? current.status;
    const nextAcp = patch.acpChatId === undefined ? current.acpChatId : patch.acpChatId;
    const nextError = patch.error === undefined ? current.error : patch.error;
    const nextFiles = patch.filesChanged ?? current.filesChanged;
    const nextPermission = patch.permission === undefined ? current.permission : patch.permission;
    await runSqlite(
      this.dbPath,
      `UPDATE im_jobs SET
        status = ${sqlString(nextStatus)},
        acp_chat_id = ${sqlNullOrString(nextAcp)},
        error = ${sqlNullOrString(nextError)},
        files_json = ${sqlString(JSON.stringify(nextFiles))},
        permission_json = ${sqlNullOrString(nextPermission ? JSON.stringify(nextPermission) : null)},
        updated_at_ms = ${now},
        finished_at_ms = ${finishedAt == null ? "NULL" : String(finishedAt)}
       WHERE job_id = ${sqlString(jobId)};`
    );
    const updated = await this.getJob(jobId);
    if (!updated) throw new Error("Failed to load updated job.");
    return updated;
  }

  async cancelJob(jobId: string): Promise<ImJob> {
    const current = await this.getJob(jobId);
    if (!current) throw new Error("Job not found.");
    if (current.status === "completed" || current.status === "failed" || current.status === "cancelled") {
      return current;
    }
    return this.updateJob(jobId, {
      status: "cancelled",
      error: "Cancelled by user",
      permission: null,
      finished: true
    });
  }

  async resolveQuotes(projectId: string, quoteIds: string[]): Promise<ImQuotedMessage[]> {
    const unique = [...new Set(quoteIds.filter((id) => id.trim()))];
    if (!unique.length) return [];
    const rows = await runSqliteJson<MessageRow>(
      this.dbPath,
      `SELECT * FROM im_messages WHERE project_id = ${sqlString(projectId)};`
    );
    const byId = new Map(rows.map((row) => [row.message_id, row]));
    const quotes: ImQuotedMessage[] = [];
    for (const id of unique) {
      const row = byId.get(id);
      if (!row) throw new Error("Quoted message was not found in this room.");
      const clipped = clipBody(row.body);
      quotes.push({
        messageId: row.message_id,
        authorLabel: row.author_label,
        body: clipped.body,
        createdAtMs: row.created_at_ms,
        truncated: clipped.truncated
      });
    }
    return quotes;
  }

  async listKnowledge(projectId: string): Promise<ImKnowledgeItem[]> {
    const rows = await runSqliteJson<KnowledgeRow>(
      this.dbPath,
      `SELECT * FROM im_knowledge WHERE project_id = ${sqlString(projectId)} ORDER BY created_at_ms ASC;`
    );
    return rows.map(mapKnowledge);
  }

  snapshotKnowledge(items: ImKnowledgeItem[]): ImKnowledgeSnapshot[] {
    return items.map((item) => {
      const clipped = clipBody(item.body, KNOWLEDGE_TEXT_MAX);
      return {
        kind: item.kind,
        title: item.title,
        body: clipped.body,
        url: item.url,
        fileName: item.fileName,
        truncated: clipped.truncated
      };
    });
  }

  async addKnowledgeText(projectId: string, title: string, body: string): Promise<ImKnowledgeItem> {
    await this.requireProject(projectId);
    const clipped = clipBody(body.trim(), KNOWLEDGE_TEXT_MAX);
    if (!clipped.body && !title.trim()) throw new Error("Knowledge text is empty.");
    return this.insertKnowledge({
      projectId,
      kind: "text",
      title: title.trim() || "Note",
      body: clipped.body
    });
  }

  async addKnowledgeLink(projectId: string, url: string, title?: string, note?: string): Promise<ImKnowledgeItem> {
    await this.requireProject(projectId);
    const href = url.trim();
    let parsed: URL;
    try {
      parsed = new URL(href);
    } catch {
      throw new Error("Link must be an http(s) URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Link must be an http(s) URL.");
    }
    const clipped = clipBody((note ?? "").trim(), KNOWLEDGE_TEXT_MAX);
    return this.insertKnowledge({
      projectId,
      kind: "link",
      title: (title ?? "").trim() || parsed.hostname,
      body: clipped.body,
      url: parsed.toString()
    });
  }

  async addKnowledgeImage(input: {
    projectId: string;
    panelHome: string;
    sourcePath: string;
    mimeType: string;
    fileName: string;
  }): Promise<ImKnowledgeItem> {
    await this.requireProject(input.projectId);
    if (!KNOWLEDGE_ALLOWED_IMAGE_TYPES.has(input.mimeType)) {
      throw new Error("Use PNG, JPEG, WebP, or GIF.");
    }
    const existing = await this.listKnowledge(input.projectId);
    if (existing.filter((item) => item.kind === "image").length >= KNOWLEDGE_IMAGE_MAX_COUNT) {
      throw new Error("This room already has the maximum number of images.");
    }
    const source = path.resolve(input.sourcePath);
    const stat = await fs.stat(source).catch(() => null);
    if (!stat?.isFile()) throw new Error("Image file was not found.");
    if (stat.size > KNOWLEDGE_IMAGE_MAX_BYTES) throw new Error("Image exceeds the 5 MB limit.");
    const itemId = randomUUID();
    const ext = path.extname(input.fileName) || mimeExtension(input.mimeType);
    const storagePath = path.join(".desktop", "im", input.projectId, "knowledge", `${itemId}${ext}`);
    const abs = path.join(path.resolve(expandHome(input.panelHome)), storagePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.copyFile(source, abs);
    return this.insertKnowledge({
      projectId: input.projectId,
      kind: "image",
      title: input.fileName,
      body: "",
      storagePath,
      mimeType: input.mimeType,
      fileName: input.fileName,
      sizeBytes: stat.size,
      itemId
    });
  }

  async removeKnowledge(itemId: string, panelHome: string): Promise<void> {
    const rows = await runSqliteJson<KnowledgeRow>(
      this.dbPath,
      `SELECT * FROM im_knowledge WHERE item_id = ${sqlString(itemId)} LIMIT 1;`
    );
    const row = rows[0];
    if (!row) throw new Error("Knowledge item not found.");
    if (row.storage_path) {
      const abs = path.join(path.resolve(expandHome(panelHome)), row.storage_path);
      await fs.unlink(abs).catch(() => undefined);
    }
    await runSqlite(this.dbPath, `DELETE FROM im_knowledge WHERE item_id = ${sqlString(itemId)};`);
  }

  async readKnowledgeImage(itemId: string, panelHome: string): Promise<{ mimeType: string; data: string; fileName: string }> {
    const rows = await runSqliteJson<KnowledgeRow>(
      this.dbPath,
      `SELECT * FROM im_knowledge WHERE item_id = ${sqlString(itemId)} LIMIT 1;`
    );
    const row = rows[0];
    if (!row || row.kind !== "image" || !row.storage_path) throw new Error("Image not found.");
    const abs = path.join(path.resolve(expandHome(panelHome)), row.storage_path);
    const buf = await fs.readFile(abs);
    return {
      mimeType: row.mime_type || "image/png",
      fileName: row.file_name || "image",
      data: buf.toString("base64")
    };
  }

  private async insertKnowledge(input: {
    projectId: string;
    kind: ImKnowledgeKind;
    title: string;
    body: string;
    url?: string | null;
    storagePath?: string | null;
    mimeType?: string | null;
    fileName?: string | null;
    sizeBytes?: number | null;
    itemId?: string;
  }): Promise<ImKnowledgeItem> {
    const now = nowMs();
    const itemId = input.itemId ?? randomUUID();
    await runSqlite(
      this.dbPath,
      `INSERT INTO im_knowledge (
        item_id, project_id, kind, title, body, url, storage_path, mime_type, file_name, size_bytes, created_at_ms
      ) VALUES (
        ${sqlString(itemId)},
        ${sqlString(input.projectId)},
        ${sqlString(input.kind)},
        ${sqlString(input.title)},
        ${sqlString(input.body)},
        ${sqlNullOrString(input.url ?? null)},
        ${sqlNullOrString(input.storagePath ?? null)},
        ${sqlNullOrString(input.mimeType ?? null)},
        ${sqlNullOrString(input.fileName ?? null)},
        ${input.sizeBytes == null ? "NULL" : String(input.sizeBytes)},
        ${now}
      );`
    );
    const items = await this.listKnowledge(input.projectId);
    const created = items.find((item) => item.itemId === itemId);
    if (!created) throw new Error("Failed to load knowledge item.");
    return created;
  }

  async getRoom(projectId: string): Promise<ImRoom> {
    const project = await this.requireProject(projectId);
    const [members, messages, jobs, knowledge] = await Promise.all([
      this.listMembers(projectId),
      this.listMessages(projectId),
      this.listJobs(projectId),
      this.listKnowledge(projectId)
    ]);
    return { project, members, messages, jobs, knowledge };
  }

  clipInstruction(body: string): string {
    return clipBody(body, INSTRUCTION_MAX).body;
  }

  private mapMessage(row: MessageRow, byId: Map<string, MessageRow>): ImMessage {
    const quoteIds = parseJsonArray(row.quote_ids_json);
    const quotes: ImQuotedMessage[] = [];
    for (const id of quoteIds) {
      const quoted = byId.get(id);
      if (!quoted) continue;
      const clipped = clipBody(quoted.body);
      quotes.push({
        messageId: quoted.message_id,
        authorLabel: quoted.author_label,
        body: clipped.body,
        createdAtMs: quoted.created_at_ms,
        truncated: clipped.truncated
      });
    }
    const images = parseImagesJson(row.images_json);
    const proposals = parseProposalsJson(row.delegation_proposals_json);
    return {
      messageId: row.message_id,
      projectId: row.project_id,
      kind: row.kind as ImMessageKind,
      authorMemberId: row.author_member_id,
      authorLabel: row.author_label,
      body: row.body,
      thinking: row.thinking?.trim() || undefined,
      images: images.length ? images : undefined,
      delegationProposals: proposals.length ? proposals : undefined,
      autoRouted: row.auto_routed === 1 ? true : undefined,
      routedRoleName: row.routed_role_name || undefined,
      routingTip: row.routing_tip || undefined,
      routingTimedOut: row.routing_timed_out === 1 ? true : undefined,
      quoteIds,
      quotes,
      mentionRoleIds: parseJsonArray(row.mention_role_ids_json),
      jobId: row.job_id,
      createdAtMs: row.created_at_ms
    };
  }

  private async requireProject(projectId: string): Promise<ImProject> {
    const project = await this.getProject(projectId);
    if (!project) throw new Error("IM project not found.");
    return project;
  }

  private async requireMember(memberId: string): Promise<ImMember> {
    const member = await this.getMember(memberId);
    if (!member) throw new Error("Room member not found.");
    return member;
  }
}
