import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseNoteDocument } from "../notes/frontmatter";
import { escapeSqlLiteral, runSqliteReadOnlyJson } from "../sqlite";
import { candidateAgyRoots } from "../transcript/agyRoots";
import {
  extractTextFromContent,
  isConversationPreviewText,
  isUserOrAssistantRole
} from "../transcript/text";

export const DEFAULT_MAX_BODY_CHARS = 512_000;

const USER_REQUEST_RE = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i;
const METADATA_BLOCK_RE =
  /<(?:ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|CONVERSATION_HISTORY|SYSTEM_MESSAGE|PLAN)>[\s\S]*?<\/(?:ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|CONVERSATION_HISTORY|SYSTEM_MESSAGE|PLAN)>/gi;

export interface ParsedTranscriptRefs {
  kind: "jsonl" | "sqlite" | "acp" | "proxy" | "unavailable";
  dialect?: "opencode" | "alma";
  paths?: string[];
  dbPath?: string;
  sessionId?: string;
  threadPath?: string;
}

export function parseTranscriptRefsJson(raw: string | null | undefined): ParsedTranscriptRefs | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as ParsedTranscriptRefs;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function statSignature(filePaths: string[]): Promise<string> {
  const parts: string[] = [];
  for (const filePath of filePaths) {
    try {
      const st = await fs.stat(filePath);
      parts.push(`${filePath}:${Math.floor(st.mtimeMs)}:${st.size}`);
    } catch {
      parts.push(`${filePath}:missing`);
    }
  }
  return parts.join("|");
}

function appendSegment(chunks: string[], totalLen: { value: number }, text: string, maxChars: number): boolean {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned || !isConversationPreviewText(cleaned)) {
    return true;
  }
  const remaining = maxChars - totalLen.value;
  if (remaining <= 0) {
    return false;
  }
  const slice = cleaned.length > remaining ? cleaned.slice(0, remaining) : cleaned;
  chunks.push(slice);
  totalLen.value += slice.length + 1;
  return totalLen.value < maxChars;
}

export async function extractJsonlFilesConversationText(
  filePaths: string[],
  provider: string,
  maxChars = DEFAULT_MAX_BODY_CHARS
): Promise<string> {
  const chunks: string[] = [];
  const totalLen = { value: 0 };

  for (const filePath of filePaths) {
    if (totalLen.value >= maxChars) {
      break;
    }
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }

      const text = extractJsonlRowText(row, provider);
      if (text && !appendSegment(chunks, totalLen, text, maxChars)) {
        break;
      }
    }
  }

  return chunks.join("\n");
}

function extractJsonlRowText(row: Record<string, unknown>, provider: string): string {
  if (provider === "chat") {
    const role = row.role;
    if (!isUserOrAssistantRole(role)) {
      return "";
    }
    if (typeof row.text === "string" && row.text.trim()) {
      return row.text;
    }
    return extractTextFromContent(row.content);
  }

  if (provider === "codex") {
    if (row.type !== "response_item" || !row.payload || typeof row.payload !== "object") {
      return "";
    }
    const payload = row.payload as Record<string, unknown>;
    if (payload.type !== "message" || !isUserOrAssistantRole(payload.role)) {
      return "";
    }
    return extractTextFromContent(payload.content);
  }

  if (provider === "claude") {
    if (row.isMeta || (row.type !== "user" && row.type !== "assistant")) {
      return "";
    }
    const msg = row.message as Record<string, unknown> | undefined;
    return extractTextFromContent(msg?.content);
  }

  if (provider === "pi" || provider === "prime" || provider === "omp") {
    if (row.type !== "message" || !row.message || typeof row.message !== "object") {
      return "";
    }
    const msg = row.message as Record<string, unknown>;
    if (!isUserOrAssistantRole(msg.role)) {
      return "";
    }
    return extractTextFromContent(msg.content);
  }

  if (provider === "grok") {
    const role = row.type ?? row.role;
    if (!isUserOrAssistantRole(role)) {
      return "";
    }
    return extractTextFromContent(row.content);
  }

  if (provider === "cursor") {
    if (!isUserOrAssistantRole(row.role)) {
      return "";
    }
    const msg = row.message as Record<string, unknown> | undefined;
    return extractTextFromContent(msg?.content);
  }

  // Generic fallback for unknown JSONL formats
  const role = row.role ?? row.type;
  if (isUserOrAssistantRole(role)) {
    const msg = row.message as Record<string, unknown> | undefined;
    return extractTextFromContent(msg?.content ?? row.content ?? row.text);
  }
  return "";
}

export async function resolveAgySessionLogFiles(
  antigravityHome: string,
  sessionId: string
): Promise<string[]> {
  if (!sessionId || path.basename(sessionId) !== sessionId) {
    return [];
  }
  for (const root of candidateAgyRoots(antigravityHome)) {
    const logsDir = path.join(root, "brain", sessionId, ".system_generated", "logs");
    const full = path.join(logsDir, "transcript_full.jsonl");
    const compact = path.join(logsDir, "transcript.jsonl");
    const existing: string[] = [];
    for (const candidate of [compact, full]) {
      try {
        await fs.access(candidate);
        existing.push(candidate);
      } catch {
        // missing
      }
    }
    if (existing.length > 0) {
      return existing;
    }
  }
  return [];
}

interface AgyLogRow {
  type?: string;
  step_index?: number;
  content?: string | null;
}

export async function extractAgyConversationText(
  logFiles: string[],
  maxChars = DEFAULT_MAX_BODY_CHARS
): Promise<string> {
  const byStep = new Map<number, AgyLogRow>();
  for (const filePath of logFiles) {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const row = JSON.parse(trimmed) as AgyLogRow;
        if (typeof row.step_index === "number") {
          byStep.set(row.step_index, row);
        }
      } catch {
        // skip malformed line
      }
    }
  }

  const chunks: string[] = [];
  const totalLen = { value: 0 };
  for (const step of [...byStep.keys()].sort((a, b) => a - b)) {
    const row = byStep.get(step)!;
    let text = "";
    if (row.type === "USER_INPUT") {
      const raw = row.content ?? "";
      const match = USER_REQUEST_RE.exec(raw);
      text = match ? match[1].trim() : raw.replace(METADATA_BLOCK_RE, "").trim();
    } else if (row.type === "PLANNER_RESPONSE") {
      text = (row.content ?? "").trim();
    }
    if (text && !appendSegment(chunks, totalLen, text, maxChars)) {
      break;
    }
  }
  return chunks.join("\n");
}

export async function loadAgyHistoryFallbackMap(
  antigravityHome: string
): Promise<Map<string, string>> {
  const result = new Map<string, string[]>();
  for (const root of candidateAgyRoots(antigravityHome)) {
    const historyPath = path.join(root, "history.jsonl");
    let raw: string;
    try {
      raw = await fs.readFile(historyPath, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as { conversationId?: string; display?: string };
        if (row.conversationId && typeof row.display === "string" && row.display.trim()) {
          const list = result.get(row.conversationId) ?? [];
          list.push(row.display.trim());
          result.set(row.conversationId, list);
        }
      } catch {
        // ignore
      }
    }
  }
  const joined = new Map<string, string>();
  for (const [id, list] of result.entries()) {
    joined.set(id, list.join("\n"));
  }
  return joined;
}

export async function extractOpenCodeConversationTextMap(
  dbPath: string,
  sessionIds: string[],
  maxChars = DEFAULT_MAX_BODY_CHARS
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!sessionIds.length) {
    return out;
  }

  const CHUNK = 80;
  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const slice = sessionIds.slice(i, i + CHUNK);
    const idList = slice.map((id) => `'${escapeSqlLiteral(id)}'`).join(",");
    let messages: Array<{ id: string; session_id: string; data: string }>;
    let parts: Array<{ message_id: string; session_id: string; data: string }>;
    try {
      messages = await runSqliteReadOnlyJson<{ id: string; session_id: string; data: string }>(
        dbPath,
        `SELECT id, session_id, data FROM message WHERE session_id IN (${idList}) ORDER BY time_created ASC;`
      );
      parts = await runSqliteReadOnlyJson<{ message_id: string; session_id: string; data: string }>(
        dbPath,
        `SELECT message_id, session_id, data FROM part WHERE session_id IN (${idList}) ORDER BY time_created ASC;`
      );
    } catch {
      continue;
    }

    const partsByMessage = new Map<string, string[]>();
    for (const part of parts) {
      try {
        const payload = JSON.parse(part.data) as { type?: string; text?: string };
        if (payload.type === "text" && typeof payload.text === "string" && payload.text.trim()) {
          const list = partsByMessage.get(part.message_id) ?? [];
          list.push(payload.text.trim());
          partsByMessage.set(part.message_id, list);
        }
      } catch {
        // ignore malformed part
      }
    }

    const sessionChunks = new Map<string, string[]>();
    const sessionLen = new Map<string, { value: number }>();
    for (const msg of messages) {
      let role: string | undefined;
      try {
        role = (JSON.parse(msg.data) as { role?: string }).role;
      } catch {
        continue;
      }
      if (!isUserOrAssistantRole(role)) {
        continue;
      }
      const msgText = (partsByMessage.get(msg.id) ?? []).join("\n").trim();
      if (!msgText) {
        continue;
      }
      const chunks = sessionChunks.get(msg.session_id) ?? [];
      const lenObj = sessionLen.get(msg.session_id) ?? { value: 0 };
      sessionChunks.set(msg.session_id, chunks);
      sessionLen.set(msg.session_id, lenObj);
      appendSegment(chunks, lenObj, msgText, maxChars);
    }

    for (const [sid, chunks] of sessionChunks.entries()) {
      out.set(sid, chunks.join("\n"));
    }
  }

  return out;
}

export async function extractAlmaConversationTextMap(
  dbPath: string,
  sessionIds: string[],
  maxChars = DEFAULT_MAX_BODY_CHARS
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!sessionIds.length) {
    return out;
  }

  const CHUNK = 80;
  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const slice = sessionIds.slice(i, i + CHUNK);
    const idList = slice.map((id) => `'${escapeSqlLiteral(id)}'`).join(",");
    let rows: Array<{ thread_id: string; message: string }>;
    try {
      rows = await runSqliteReadOnlyJson<{ thread_id: string; message: string }>(
        dbPath,
        `SELECT thread_id, message FROM chat_messages WHERE thread_id IN (${idList}) ORDER BY created_at ASC, timestamp ASC;`
      );
    } catch {
      continue;
    }

    const sessionChunks = new Map<string, string[]>();
    const sessionLen = new Map<string, { value: number }>();
    for (const row of rows) {
      let payload: { role?: string; parts?: unknown; content?: unknown };
      try {
        payload = JSON.parse(row.message) as { role?: string; parts?: unknown; content?: unknown };
      } catch {
        continue;
      }
      if (!isUserOrAssistantRole(payload.role)) {
        continue;
      }
      const msgText = (
        extractTextFromContent(payload.parts) ||
        extractTextFromContent(payload.content) ||
        (typeof payload.content === "string" ? payload.content.trim() : "")
      ).trim();
      if (!msgText) {
        continue;
      }
      const chunks = sessionChunks.get(row.thread_id) ?? [];
      const lenObj = sessionLen.get(row.thread_id) ?? { value: 0 };
      sessionChunks.set(row.thread_id, chunks);
      sessionLen.set(row.thread_id, lenObj);
      appendSegment(chunks, lenObj, msgText, maxChars);
    }

    for (const [sid, chunks] of sessionChunks.entries()) {
      out.set(sid, chunks.join("\n"));
    }
  }

  return out;
}

export async function extractNoteBodyText(
  absPath: string,
  maxChars = DEFAULT_MAX_BODY_CHARS
): Promise<string> {
  try {
    const raw = await fs.readFile(absPath, "utf8");
    const parsed = parseNoteDocument(raw);
    return parsed.body.replace(/\r\n/g, "\n").trim().slice(0, maxChars);
  } catch {
    return "";
  }
}
