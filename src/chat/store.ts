import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readJsonLines } from "../history/jsonl";
import { ChatMessage, ChatSessionRecord, TerminalAgentProvider } from "./types";

export function chatSessionsPath(panelHome: string): string {
  return path.join(panelHome, "chat", "sessions.jsonl");
}

export function chatThreadPath(panelHome: string, chatId: string): string {
  return path.join(panelHome, "chat", "threads", `${chatId}.jsonl`);
}

export function handoffPath(panelHome: string, chatId: string): string {
  return path.join(panelHome, "handoffs", `${chatId}.md`);
}

export async function ensurePanelDirs(panelHome: string): Promise<void> {
  await fs.mkdir(path.join(panelHome, "chat", "threads"), { recursive: true });
  await fs.mkdir(path.join(panelHome, "handoffs"), { recursive: true });
}

export async function loadChatRecords(panelHome: string): Promise<ChatSessionRecord[]> {
  const rows = await readJsonLines<ChatSessionRecord>(chatSessionsPath(panelHome));
  const byId = new Map<string, ChatSessionRecord>();
  for (const row of rows) {
    if (row.id) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChatRecord(panelHome: string, chatId: string): Promise<ChatSessionRecord | undefined> {
  const records = await loadChatRecords(panelHome);
  return records.find((record) => record.id === chatId);
}

export async function createChatRecord(
  panelHome: string,
  projectPath: string,
  provider: TerminalAgentProvider
): Promise<ChatSessionRecord> {
  await ensurePanelDirs(panelHome);
  const now = Date.now();
  const record: ChatSessionRecord = {
    id: crypto.randomUUID(),
    title: "New Chat",
    projectPath,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    linkedAgent: {
      provider,
      handoffCount: 0
    }
  };
  await appendJsonLine(chatSessionsPath(panelHome), record);
  return record;
}

export async function updateChatRecord(panelHome: string, record: ChatSessionRecord): Promise<void> {
  const records = await loadChatRecords(panelHome);
  const index = records.findIndex((entry) => entry.id === record.id);
  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }
  await writeJsonLines(chatSessionsPath(panelHome), records);
}

export async function loadChatMessages(panelHome: string, chatId: string): Promise<ChatMessage[]> {
  const rows = await readJsonLines<ChatMessage>(chatThreadPath(panelHome, chatId));
  const byId = new Map<string, ChatMessage>();
  for (const row of rows) {
    if (row.id) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export async function appendChatMessage(panelHome: string, chatId: string, message: ChatMessage): Promise<void> {
  await ensurePanelDirs(panelHome);
  await appendJsonLine(chatThreadPath(panelHome, chatId), message);
}

export async function writeHandoffFile(panelHome: string, chatId: string, content: string): Promise<string> {
  await ensurePanelDirs(panelHome);
  const filePath = handoffPath(panelHome, chatId);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

export function buildLinkedAgentKey(provider: TerminalAgentProvider, sessionId: string): string {
  return `${provider}:${sessionId}`;
}

export async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

async function writeJsonLines(filePath: string, rows: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, content ? `${content}\n` : "", "utf8");
}