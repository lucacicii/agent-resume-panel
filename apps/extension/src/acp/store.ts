import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  catalogDbPath,
  deleteAcpSessionFromCatalog,
  ensureExtensionCatalogSchema,
  upsertAcpSessionInCatalog
} from "@agent-resume/core";
import { readJsonLines } from "../history/jsonl";
import { AcpAgentProvider, AcpChatMessage, AcpImageAttachment, AcpSessionRecord } from "./types";

export const ACP_MAX_IMAGES_PER_MESSAGE = 4;
export const ACP_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACP_ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

export interface IncomingAcpImage {
  mimeType: string;
  fileName: string;
  data: string;
}

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
  await mirrorAcpRecordToCatalog(panelHome, record);
  return record;
}

export async function deleteAcpRecord(panelHome: string, chatId: string): Promise<void> {
  const records = await loadAcpRecords(panelHome);
  const nextRecords = records.filter((record) => record.id !== chatId);
  await writeJsonLines(acpSessionsPath(panelHome), nextRecords);

  const threadFile = acpThreadPath(panelHome, chatId);
  try {
    await fs.unlink(threadFile);
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
  await removeAcpRecordFromCatalog(panelHome, chatId);
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
  await mirrorAcpRecordToCatalog(panelHome, record);
}

async function mirrorAcpRecordToCatalog(panelHome: string, record: AcpSessionRecord): Promise<void> {
  try {
    const dbPath = catalogDbPath(panelHome);
    await ensureExtensionCatalogSchema(dbPath);
    await upsertAcpSessionInCatalog(dbPath, panelHome, {
      id: record.id,
      title: record.title,
      projectPath: record.projectPath,
      acpProvider: record.provider,
      updatedAt: record.updatedAt,
      messageCount: record.messageCount,
      model: record.provider
    });
  } catch {
    // Dual-write must not break ACP chat; session sync backfills catalog.
  }
}

async function removeAcpRecordFromCatalog(panelHome: string, chatId: string): Promise<void> {
  try {
    await deleteAcpSessionFromCatalog(catalogDbPath(panelHome), chatId);
  } catch {
    /* ignore */
  }
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

export function acpAttachmentPath(
  panelHome: string,
  chatId: string,
  messageId: string,
  attachmentId: string,
  ext: string
): string {
  return path.join("acp", "attachments", chatId, messageId, `${attachmentId}.${ext}`);
}

export function mimeTypeToExtension(mimeType: string): string | undefined {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return undefined;
  }
}

export function validateIncomingImages(images: IncomingAcpImage[]): string | undefined {
  if (images.length > ACP_MAX_IMAGES_PER_MESSAGE) {
    return `At most ${ACP_MAX_IMAGES_PER_MESSAGE} images per message.`;
  }

  for (const image of images) {
    if (!ACP_ALLOWED_IMAGE_MIME_TYPES.has(image.mimeType)) {
      return `Unsupported image type: ${image.mimeType}`;
    }
    const bytes = estimateBase64Bytes(image.data);
    if (bytes > ACP_MAX_IMAGE_BYTES) {
      return `Image "${image.fileName}" exceeds the 5 MB limit.`;
    }
  }

  return undefined;
}

export async function saveAcpImageAttachments(
  panelHome: string,
  chatId: string,
  messageId: string,
  images: IncomingAcpImage[]
): Promise<AcpImageAttachment[]> {
  const saved: AcpImageAttachment[] = [];

  for (const image of images) {
    const ext = mimeTypeToExtension(image.mimeType);
    if (!ext) {
      throw new Error(`Unsupported image type: ${image.mimeType}`);
    }

    const id = crypto.randomUUID();
    const storagePath = acpAttachmentPath(panelHome, chatId, messageId, id, ext);
    const absolutePath = path.join(panelHome, storagePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from(image.data, "base64"));

    saved.push({
      id,
      mimeType: image.mimeType,
      fileName: image.fileName,
      storagePath
    });
  }

  return saved;
}

export async function readAcpImageBase64(panelHome: string, attachment: AcpImageAttachment): Promise<string> {
  const absolutePath = path.join(panelHome, attachment.storagePath);
  const buffer = await fs.readFile(absolutePath);
  return buffer.toString("base64");
}

function estimateBase64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
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