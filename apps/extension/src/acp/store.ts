import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  acpSessionsPath as coreAcpSessionsPath,
  acpThreadPath as coreAcpThreadPath,
  appendAcpThreadMessage,
  catalogDbPath,
  deleteAcpSessionRecord,
  deleteAcpSessionFromCatalog,
  ensureAcpStoreDirs,
  ensureExtensionCatalogSchema,
  getAcpSessionRecord,
  insertAcpSessionRecord,
  loadAcpSessionRecords,
  loadAcpThreadMessages,
  updateAcpSessionRecord,
  upsertAcpSessionInCatalog
} from "@agent-resume/core";
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
  return coreAcpSessionsPath(panelHome);
}

export function acpThreadPath(panelHome: string, sessionId: string): string {
  return coreAcpThreadPath(panelHome, sessionId);
}

export async function ensureAcpDirs(panelHome: string): Promise<void> {
  await ensureAcpStoreDirs(panelHome);
}

export async function loadAcpRecords(panelHome: string): Promise<AcpSessionRecord[]> {
  return loadAcpSessionRecords<AcpSessionRecord>(panelHome);
}

export async function getAcpRecord(panelHome: string, id: string): Promise<AcpSessionRecord | undefined> {
  return getAcpSessionRecord<AcpSessionRecord>(panelHome, id);
}

export async function createAcpRecord(panelHome: string, projectPath: string, provider: AcpAgentProvider): Promise<AcpSessionRecord> {
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
  await insertAcpSessionRecord(panelHome, record);
  await mirrorAcpRecordToCatalog(panelHome, record);
  return record;
}

export async function deleteAcpRecord(panelHome: string, chatId: string): Promise<void> {
  await deleteAcpSessionRecord(panelHome, chatId);
  await removeAcpRecordFromCatalog(panelHome, chatId);
}

export async function updateAcpRecord(panelHome: string, record: AcpSessionRecord): Promise<void> {
  await updateAcpSessionRecord(panelHome, record);
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
  return loadAcpThreadMessages<AcpChatMessage>(panelHome, sessionId);
}

export async function appendAcpMessage(panelHome: string, sessionId: string, message: AcpChatMessage): Promise<void> {
  await appendAcpThreadMessage(panelHome, sessionId, message);
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
