import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { readJsonLines } from "../transcript/jsonl";

export interface AcpSessionStoreRecord {
  id: string;
  title: string;
  projectPath: string;
  provider: string;
  /** Native agent session id returned by the ACP adapter after session/new. */
  acpSessionId?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  source?: string;
}

export interface AcpThreadStoreMessage {
  id: string;
  timestamp: number;
}

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 40;
const STALE_LOCK_MS = 30_000;

export function acpSessionsPath(panelHome: string): string {
  return path.join(panelHome, "acp", "sessions.jsonl");
}

export function acpThreadPath(panelHome: string, sessionId: string): string {
  return path.join(panelHome, "acp", "threads", `${sessionId}.jsonl`);
}

export function acpStoreLockPath(panelHome: string): string {
  return path.join(panelHome, "acp", ".store.lock");
}

export async function ensureAcpStoreDirs(panelHome: string): Promise<void> {
  await fs.mkdir(path.join(panelHome, "acp", "threads"), { recursive: true });
}

export async function loadAcpSessionRecords<T extends AcpSessionStoreRecord>(panelHome: string): Promise<T[]> {
  const rows = await readJsonLines<T>(acpSessionsPath(panelHome));
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (row.id) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAcpSessionRecord<T extends AcpSessionStoreRecord>(
  panelHome: string,
  id: string
): Promise<T | undefined> {
  const records = await loadAcpSessionRecords<T>(panelHome);
  return records.find((record) => record.id === id);
}

export async function insertAcpSessionRecord<T extends AcpSessionStoreRecord>(
  panelHome: string,
  record: T
): Promise<void> {
  await withAcpStoreLock(panelHome, async () => {
    const records = await loadAcpSessionRecords<T>(panelHome);
    const index = records.findIndex((entry) => entry.id === record.id);
    if (index >= 0) {
      records[index] = record;
    } else {
      records.push(record);
    }
    await writeAcpSessionRecords(panelHome, records);
  });
}

export async function updateAcpSessionRecord<T extends AcpSessionStoreRecord>(
  panelHome: string,
  record: T
): Promise<void> {
  await insertAcpSessionRecord(panelHome, record);
}

export async function deleteAcpSessionRecord(panelHome: string, sessionId: string): Promise<void> {
  await withAcpStoreLock(panelHome, async () => {
    const records = await loadAcpSessionRecords<AcpSessionStoreRecord>(panelHome);
    await writeAcpSessionRecords(
      panelHome,
      records.filter((record) => record.id !== sessionId)
    );
    try {
      await fs.unlink(acpThreadPath(panelHome, sessionId));
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  });
}

export async function loadAcpThreadMessages<T extends AcpThreadStoreMessage>(
  panelHome: string,
  sessionId: string
): Promise<T[]> {
  const rows = await readJsonLines<T>(acpThreadPath(panelHome, sessionId));
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (row.id) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export async function appendAcpThreadMessage<T extends AcpThreadStoreMessage>(
  panelHome: string,
  sessionId: string,
  message: T
): Promise<void> {
  await withAcpStoreLock(panelHome, async () => {
    await ensureAcpStoreDirs(panelHome);
    await fs.appendFile(acpThreadPath(panelHome, sessionId), `${JSON.stringify(message)}\n`, "utf8");
  });
}

async function writeAcpSessionRecords(panelHome: string, records: AcpSessionStoreRecord[]): Promise<void> {
  await ensureAcpStoreDirs(panelHome);
  const filePath = acpSessionsPath(panelHome);
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.agent-resume-${process.pid}-${randomUUID()}`
  );
  const handle = await fs.open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(body ? `${body}\n` : "", "utf8");
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function withAcpStoreLock<T>(panelHome: string, operation: () => Promise<T>): Promise<T> {
  await ensureAcpStoreDirs(panelHome);
  const lockPath = acpStoreLockPath(panelHome);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      await removeStaleLock(lockPath);
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for ACP store lock.");
      }
      await delay(LOCK_RETRY_MS);
    }
  }

  try {
    return await operation();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

async function removeStaleLock(lockPath: string): Promise<void> {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
      await fs.rm(lockPath, { recursive: true, force: true });
    }
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return isNodeError(error, "ENOENT");
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return isNodeError(error, "EEXIST");
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
