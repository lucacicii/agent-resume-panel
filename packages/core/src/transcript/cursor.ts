import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AgentSession } from "../catalog/types";
import { isNodeError, readJsonLines } from "./jsonl";
import { extractPreviewContent, finalizePreviewMessages, isUserOrAssistantRole } from "./text";
import { PreviewHomes, SessionPreviewResult } from "./types";

export interface CursorChatMeta {
  id: string;
  title: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  hasConversation: boolean;
}

interface CursorMetaFile {
  schemaVersion?: unknown;
  title?: unknown;
  cwd?: unknown;
  createdAtMs?: unknown;
  updatedAtMs?: unknown;
  hasConversation?: unknown;
}

interface CursorTranscriptRow {
  role?: unknown;
  message?: { content?: unknown };
}

/** Cursor CLI stores one metadata file per locally available chat. */
export async function listCursorChatMetas(cursorHome: string, maxItems: number): Promise<CursorChatMeta[]> {
  const chatsRoot = path.join(cursorHome, "chats");
  const chats: CursorChatMeta[] = [];
  for (const workspace of await readDirs(chatsRoot)) {
    const workspaceRoot = path.join(chatsRoot, workspace);
    for (const id of await readDirs(workspaceRoot)) {
      const metaPath = path.join(workspaceRoot, id, "meta.json");
      const meta = await readMeta(metaPath);
      if (!meta || path.basename(id) !== id) {
        continue;
      }
      chats.push({ id, ...meta });
    }
  }
  return chats.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxItems);
}

export async function findCursorTranscriptFile(cursorHome: string, sessionId: string): Promise<string | undefined> {
  if (!sessionId || path.basename(sessionId) !== sessionId) {
    return undefined;
  }
  const projectsRoot = path.join(cursorHome, "projects");
  for (const project of await readDirs(projectsRoot)) {
    const candidate = path.join(projectsRoot, project, "agent-transcripts", sessionId, `${sessionId}.jsonl`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue through the locally recorded project roots.
    }
  }
  return undefined;
}

export async function previewCursorSession(
  session: AgentSession,
  homes: PreviewHomes
): Promise<SessionPreviewResult> {
  const transcript = await findCursorTranscriptFile(homes.cursorHome, session.id);
  if (!transcript) {
    throw new Error("Cursor CLI transcript not found for this session.");
  }
  const rows = await readJsonLines<CursorTranscriptRow>(transcript);
  const messages: SessionPreviewResult["messages"] = [];
  for (const row of rows) {
    if (!isUserOrAssistantRole(row.role)) {
      continue;
    }
    const extracted = extractPreviewContent(row.message?.content);
    if (extracted.text || extracted.thinking) {
      messages.push({
        role: row.role,
        text: extracted.text,
        thinking: extracted.thinking || undefined
      });
    }
  }
  if (!messages.length) {
    throw new Error("Cursor CLI transcript is empty for this session.");
  }
  return finalizePreviewMessages(session.title, messages);
}

async function readMeta(filePath: string): Promise<Omit<CursorChatMeta, "id"> | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  let value: CursorMetaFile;
  try {
    value = JSON.parse(raw) as CursorMetaFile;
  } catch {
    return undefined;
  }
  if (value.schemaVersion !== 1 || typeof value.cwd !== "string") {
    return undefined;
  }
  const createdAt = number(value.createdAtMs);
  const updatedAt = number(value.updatedAtMs) || createdAt;
  if (!createdAt || !updatedAt) {
    return undefined;
  }
  return {
    title: typeof value.title === "string" ? value.title : "",
    cwd: value.cwd,
    createdAt,
    updatedAt,
    hasConversation: value.hasConversation === true
  };
}

async function readDirs(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
