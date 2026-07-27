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
import type {
  AcpAgentProvider,
  AcpChatMessage,
  AcpFileAttachment,
  AcpImageAttachment,
  AcpSessionRecord
} from "./types";

export const ACP_MAX_IMAGES_PER_MESSAGE = 4;
export const ACP_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACP_MAX_FILES_PER_MESSAGE = 10;
export const ACP_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ACP_ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface IncomingAcpImage {
  mimeType: string;
  fileName: string;
  data: string;
}

/** File attachment from renderer (Electron File.path and/or base64 payload). */
export interface IncomingAcpFile {
  mimeType: string;
  fileName: string;
  /** Absolute filesystem path when available (Electron). */
  absolutePath?: string;
  /** Base64 payload when path is unavailable or for embedded context. */
  data?: string;
  sizeBytes?: number;
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

export async function createAcpRecord(
  panelHome: string,
  projectPath: string,
  provider: AcpAgentProvider
): Promise<AcpSessionRecord> {
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
    // Catalog dual-write must not break ACP chat; sync bridge will backfill.
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
    if (!ext) throw new Error(`Unsupported image type: ${image.mimeType}`);
    const id = crypto.randomUUID();
    const storagePath = acpAttachmentPath(panelHome, chatId, messageId, id, ext);
    const absolutePath = path.join(panelHome, storagePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from(image.data, "base64"));
    saved.push({ id, mimeType: image.mimeType, fileName: image.fileName, storagePath });
  }
  return saved;
}

export async function readAcpImageBase64(panelHome: string, attachment: AcpImageAttachment): Promise<string> {
  const buffer = await fs.readFile(path.join(panelHome, attachment.storagePath));
  return buffer.toString("base64");
}

export function validateIncomingFiles(files: IncomingAcpFile[]): string | undefined {
  if (files.length > ACP_MAX_FILES_PER_MESSAGE) {
    return `At most ${ACP_MAX_FILES_PER_MESSAGE} files per message.`;
  }
  for (const file of files) {
    const name = file.fileName || "file";
    const hasPath = Boolean(file.absolutePath?.trim());
    const hasData = Boolean(file.data);
    if (!hasPath && !hasData) {
      return `File "${name}" has no path or data.`;
    }
    const size =
      typeof file.sizeBytes === "number" && Number.isFinite(file.sizeBytes)
        ? file.sizeBytes
        : file.data
          ? estimateBase64Bytes(file.data)
          : 0;
    if (size > ACP_MAX_FILE_BYTES) {
      return `File "${name}" exceeds the 20 MB limit.`;
    }
  }
  return undefined;
}

/**
 * Persist attachments under panelHome for history; prefer keeping original absolutePath for resource_link.
 */
export async function saveAcpFileAttachments(
  panelHome: string,
  chatId: string,
  messageId: string,
  files: IncomingAcpFile[]
): Promise<AcpFileAttachment[]> {
  const saved: AcpFileAttachment[] = [];
  for (const file of files) {
    const id = crypto.randomUUID();
    const safeName = sanitizeFileName(file.fileName || "file");
    const absolutePath = file.absolutePath?.trim() || undefined;
    let storagePath: string | undefined;
    let sizeBytes = typeof file.sizeBytes === "number" ? file.sizeBytes : undefined;

    if (absolutePath) {
      try {
        const stat = await fs.stat(absolutePath);
        sizeBytes = stat.size;
      } catch {
        // keep provided size
      }
    }

    if (file.data) {
      const ext = path.extname(safeName).replace(/^\./, "") || mimeTypeToGenericExtension(file.mimeType);
      storagePath = path.join("acp", "attachments", chatId, messageId, `${id}.${ext || "bin"}`);
      const absoluteStorage = path.join(panelHome, storagePath);
      await fs.mkdir(path.dirname(absoluteStorage), { recursive: true });
      await fs.writeFile(absoluteStorage, Buffer.from(file.data, "base64"));
      if (sizeBytes == null) sizeBytes = estimateBase64Bytes(file.data);
    } else if (absolutePath) {
      // Copy into panel home so history survives if the original moves; still keep absolutePath for agents.
      const ext = path.extname(safeName).replace(/^\./, "") || "bin";
      storagePath = path.join("acp", "attachments", chatId, messageId, `${id}.${ext}`);
      const absoluteStorage = path.join(panelHome, storagePath);
      await fs.mkdir(path.dirname(absoluteStorage), { recursive: true });
      try {
        await fs.copyFile(absolutePath, absoluteStorage);
      } catch {
        storagePath = undefined;
      }
    }

    saved.push({
      id,
      mimeType: file.mimeType || "application/octet-stream",
      fileName: safeName,
      absolutePath,
      storagePath,
      sizeBytes
    });
  }
  return saved;
}

export function resolveAcpFileAbsolutePath(panelHome: string, file: AcpFileAttachment): string | undefined {
  if (file.absolutePath?.trim()) return path.resolve(file.absolutePath.trim());
  if (file.storagePath?.trim()) return path.join(panelHome, file.storagePath.trim());
  return undefined;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 200) || "file";
}

function mimeTypeToGenericExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "text/plain": "txt",
    "text/markdown": "md",
    "text/csv": "csv",
    "application/json": "json",
    "application/pdf": "pdf",
    "application/zip": "zip"
  };
  return map[mimeType] || mimeTypeToExtension(mimeType) || "bin";
}

function estimateBase64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}
