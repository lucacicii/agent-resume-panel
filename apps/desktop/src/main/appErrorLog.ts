import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { shell } from "electron";
import {
  desktopLogsDir,
  effectivePanelHome,
  expandHome,
  loadSettings
} from "@agent-resume/core";

export type AppErrorLogLevel = "error" | "warn";

export type AppErrorLogEntry = {
  id: string;
  createdAtMs: number;
  level: AppErrorLogLevel;
  source: string;
  message: string;
  detail?: string;
};

export const APP_ERROR_LOG_FILE_NAME = "app-errors.jsonl";
export const APP_ERROR_LOG_MAX_ENTRIES = 500;
export const APP_ERROR_LOG_MAX_BYTES = 1_048_576;
export const APP_ERROR_LOG_MESSAGE_MAX = 2_000;
export const APP_ERROR_LOG_DETAIL_MAX = 4_000;

const WRITE_QUEUE: Array<() => Promise<void>> = [];
let writeRunning = false;
let processHandlersInstalled = false;

/** Redact common secret patterns before persisting log text. */
export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]");
  out = out.replace(/\b(Bearer)\s+[A-Za-z0-9._\-+/=]{8,}/gi, "$1 [REDACTED]");
  out = out.replace(
    /\b(api[_-]?key|access[_-]?token|secret|password|authorization)\s*[:=]\s*["']?([^\s"'\\,;]{6,})/gi,
    "$1=[REDACTED]"
  );
  out = out.replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g, "[REDACTED_TOKEN]");
  return out;
}

export function truncateText(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function formatUnknownError(error: unknown): { message: string; detail?: string } {
  if (error instanceof Error) {
    const message = error.message || error.name || "Error";
    const detail = error.stack && error.stack !== message ? error.stack : undefined;
    return { message, detail };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

export function sanitizeLogField(value: string, max: number): string {
  return truncateText(redactSecrets(value.replace(/\r\n/g, "\n").trim()), max);
}

export function parseAppErrorLogText(text: string): AppErrorLogEntry[] {
  const entries: AppErrorLogEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const raw = JSON.parse(trimmed) as Partial<AppErrorLogEntry>;
      if (
        typeof raw.id !== "string" ||
        typeof raw.createdAtMs !== "number" ||
        typeof raw.source !== "string" ||
        typeof raw.message !== "string"
      ) {
        continue;
      }
      const level: AppErrorLogLevel = raw.level === "warn" ? "warn" : "error";
      entries.push({
        id: raw.id,
        createdAtMs: raw.createdAtMs,
        level,
        source: raw.source,
        message: raw.message,
        detail: typeof raw.detail === "string" ? raw.detail : undefined
      });
    } catch {
      // skip corrupt lines
    }
  }
  return entries;
}

export function trimAppErrorEntries(
  entries: AppErrorLogEntry[],
  maxEntries = APP_ERROR_LOG_MAX_ENTRIES
): AppErrorLogEntry[] {
  if (entries.length <= maxEntries) {
    return entries;
  }
  return entries.slice(entries.length - maxEntries);
}

export function serializeAppErrorEntries(entries: AppErrorLogEntry[]): string {
  if (entries.length === 0) {
    return "";
  }
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

async function resolveLogPaths(): Promise<{ dir: string; file: string }> {
  const settings = await loadSettings();
  const home = expandHome(effectivePanelHome(settings));
  const dir = desktopLogsDir(home);
  return { dir, file: path.join(dir, APP_ERROR_LOG_FILE_NAME) };
}

async function enqueueWrite(task: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    WRITE_QUEUE.push(async () => {
      try {
        await task();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    void drainWriteQueue();
  });
}

async function drainWriteQueue(): Promise<void> {
  if (writeRunning) {
    return;
  }
  writeRunning = true;
  try {
    while (WRITE_QUEUE.length > 0) {
      const task = WRITE_QUEUE.shift();
      if (task) {
        await task();
      }
    }
  } finally {
    writeRunning = false;
  }
}

async function readAllEntries(filePath: string): Promise<AppErrorLogEntry[]> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return parseAppErrorLogText(text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function rewriteIfNeeded(filePath: string, entries: AppErrorLogEntry[]): Promise<void> {
  let next = trimAppErrorEntries(entries);
  let body = serializeAppErrorEntries(next);
  while (Buffer.byteLength(body, "utf8") > APP_ERROR_LOG_MAX_BYTES && next.length > 1) {
    next = next.slice(Math.ceil(next.length / 4));
    body = serializeAppErrorEntries(next);
  }
  await fs.writeFile(filePath, body, "utf8");
}

/**
 * Persist an application error/warn and echo to the process console.
 * Logger I/O failures never throw to callers (avoid recursive failure loops).
 */
export async function recordAppError(input: {
  source: string;
  message?: string;
  detail?: string;
  error?: unknown;
  level?: AppErrorLogLevel;
}): Promise<void> {
  const level = input.level === "warn" ? "warn" : "error";
  const fromError = input.error != null ? formatUnknownError(input.error) : undefined;
  const message = sanitizeLogField(
    input.message?.trim() || fromError?.message || "Unknown error",
    APP_ERROR_LOG_MESSAGE_MAX
  );
  const detailRaw = input.detail?.trim() || fromError?.detail;
  const detail = detailRaw ? sanitizeLogField(detailRaw, APP_ERROR_LOG_DETAIL_MAX) : undefined;
  const source = sanitizeLogField(input.source || "app", 120) || "app";

  const prefix = `[${source}]`;
  if (level === "warn") {
    console.warn(prefix, message, detail || "");
  } else {
    console.error(prefix, message, detail || "");
  }

  const entry: AppErrorLogEntry = {
    id: randomUUID(),
    createdAtMs: Date.now(),
    level,
    source,
    message,
    detail
  };

  try {
    await enqueueWrite(async () => {
      const { dir, file } = await resolveLogPaths();
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
      try {
        const stat = await fs.stat(file);
        if (stat.size > APP_ERROR_LOG_MAX_BYTES) {
          const entries = await readAllEntries(file);
          await rewriteIfNeeded(file, entries);
          return;
        }
      } catch {
        // ignore stat failure; append already succeeded
      }
      const entries = await readAllEntries(file);
      if (entries.length > APP_ERROR_LOG_MAX_ENTRIES) {
        await rewriteIfNeeded(file, entries);
      }
    });
  } catch (error) {
    console.error("[app-error-log] failed to write", error instanceof Error ? error.message : String(error));
  }
}

export async function listAppErrors(options?: {
  limit?: number;
  level?: AppErrorLogLevel;
  source?: string;
}): Promise<AppErrorLogEntry[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 100, APP_ERROR_LOG_MAX_ENTRIES));
  const { file } = await resolveLogPaths();
  let entries = await readAllEntries(file);
  if (options?.level) {
    entries = entries.filter((entry) => entry.level === options.level);
  }
  if (options?.source) {
    const source = options.source.trim();
    if (source) {
      entries = entries.filter((entry) => entry.source === source);
    }
  }
  entries.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return entries.slice(0, limit);
}

export async function clearAppErrors(): Promise<{ ok: true }> {
  await enqueueWrite(async () => {
    const { dir, file } = await resolveLogPaths();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, "", "utf8");
  });
  return { ok: true };
}

export async function openAppErrorLogDir(): Promise<{ ok: boolean; path: string }> {
  const { dir, file } = await resolveLogPaths();
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(file);
    shell.showItemInFolder(file);
  } catch {
    await shell.openPath(dir);
  }
  return { ok: true, path: dir };
}

/** Install process-level handlers once (uncaughtException / unhandledRejection). */
export function installProcessErrorHandlers(): void {
  if (processHandlersInstalled) {
    return;
  }
  processHandlersInstalled = true;
  process.on("uncaughtException", (error) => {
    void recordAppError({ source: "process", error, level: "error" });
  });
  process.on("unhandledRejection", (reason) => {
    void recordAppError({ source: "process", error: reason, level: "error" });
  });
}
