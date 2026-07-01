import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { readJsonLines } from "../history/jsonl";
import { AcpAgentProvider, AcpChatMessage, AcpSessionRecord } from "./types";

export function acpSessionsPath(panelHome: string): string {
  return path.join(panelHome, "acp", "sessions.jsonl");
}

export function acpThreadPath(panelHome: string, sessionId: string): string {
  return path.join(panelHome, "acp", "threads", `${sessionId}.jsonl`);
}

export async function ensureAcpDirs(panelHome: string): Promise<void> {
  await fs.mkdir(path.join(panelHome, "acp", "threads"), { recursive: true });
}

export async function loadAcpRecords(panelHome: string): Promise<AcpSessionRecord[]> {
  const rows = await readJsonLines<AcpSessionRecord>(acpSessionsPath(panelHome));
  const byId = new Map<string, AcpSessionRecord>();
  for (const row of rows) {
    if (row.id) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAcpRecord(panelHome: string, id: string): Promise<AcpSessionRecord | undefined> {
  const records = await loadAcpRecords(panelHome);
  return records.find((record) => record.id === id);
}

export async function createAcpRecord(panelHome: string, projectPath: string, provider: AcpAgentProvider): Promise<AcpSessionRecord> {
  await ensureAcpDirs(panelHome);
  const now = Date.now();
  const record: AcpSessionRecord = {
    id: crypto.randomUUID(),
    title: "New ACP Chat",
    projectPath,
    provider,
    createdAt: now,
    updatedAt: now,
    messageCount: 0
  };
  await appendJsonLine(acpSessionsPath(panelHome), record);
  return record;
}

export async function updateAcpRecord(panelHome: string, record: AcpSessionRecord): Promise<void> {
  const records = await loadAcpRecords(panelHome);
  const index = records.findIndex((entry) => entry.id === record.id);
  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }
  await writeJsonLines(acpSessionsPath(panelHome), records);
}

export async function loadAcpMessages(panelHome: string, sessionId: string): Promise<AcpChatMessage[]> {
  const rows = await readJsonLines<AcpChatMessage>(acpThreadPath(panelHome, sessionId));
  const byId = new Map<string, AcpChatMessage>();
  for (const row of rows) {
    if (row.id) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export async function appendAcpMessage(panelHome: string, sessionId: string, message: AcpChatMessage): Promise<void> {
  await ensureAcpDirs(panelHome);
  await appendJsonLine(acpThreadPath(panelHome, sessionId), message);
}

async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

async function writeJsonLines(filePath: string, values: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const body = values.map((value) => JSON.stringify(value)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
}