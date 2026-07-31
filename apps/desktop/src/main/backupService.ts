import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, createHash } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  buildNativeConversationArtifacts,
  effectivePanelHome,
  cleanupRemovedSessionExecutionNotes,
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
  getMachineId,
  NotesStore,
  resolvePreviewHomes,
  runSqlite,
  runSqliteJson,
  type NativeConversationProvider,
  type NativeConversationProviderSummary,
  type PanelSettings
} from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";

const yazl = require("yazl") as {
  ZipFile: new () => {
    addFile(filePath: string, metadataPath: string, options?: { mtime?: Date }): void;
    addBuffer(buffer: Buffer, metadataPath: string): void;
    end(): void;
    outputStream: NodeJS.ReadableStream;
  };
};
const yauzl = require("yauzl") as {
  open(
    file: string,
    options: { lazyEntries: boolean; autoClose: boolean; validateEntrySizes: boolean },
    callback: (error: Error | null, zip?: ZipReader) => void
  ): void;
};

interface ZipEntry {
  fileName: string;
  uncompressedSize: number;
  externalFileAttributes: number;
}

interface ZipReader {
  readEntry(): void;
  openReadStream(entry: ZipEntry, callback: (error: Error | null, stream?: Readable) => void): void;
  close(): void;
  once(event: "entry", listener: (entry: ZipEntry) => void): this;
  once(event: "end", listener: () => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  removeListener(event: "entry" | "end" | "error", listener: (...args: never[]) => void): this;
}

const FORMAT_VERSION = 2;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
const MANIFEST_PATH = "manifest.json";
const PAYLOAD_ROOT = "payload";
const NATIVE_ROOT = "native";
const CREDENTIALS_PATH = "credentials.enc";
const RECOVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TEMP_RETENTION_MS = 24 * 60 * 60 * 1000;
const ICLOUD_RETENTION_COUNT = 10;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const ARBAK_MAGIC = Buffer.from("ARBAK001", "ascii");
const ARBAK_TAG_BYTES = 16;
const MAX_ARBAK_HEADER_BYTES = 64 * 1024;
const NATIVE_PROVIDERS = new Set<Exclude<NativeConversationProvider, "cursor-ide">>([
  "codex", "claude", "agy", "grok", "opencode", "pi", "cursor"
]);

export type BackupStorageTarget = "local-file" | "icloud-drive";

export type BackupProgressPhase = "preparing" | "snapshotting" | "collecting" | "archiving" | "validating" | "merging" | "finalizing" | "complete";

export interface BackupProgressEvent {
  operation: "export" | "import";
  phase: BackupProgressPhase;
  percent: number;
}

export interface BackupCreateOptions {
  target: BackupStorageTarget;
  includeCredentials: boolean;
  includeNativeConversations?: boolean;
  password?: string;
  onProgress?: (event: BackupProgressEvent) => void;
}

export interface BackupImportOptions {
  includeCredentials: boolean;
  password?: string;
  restoreNativeConversations?: boolean;
  recoveryDir: string;
  onProgress?: (event: BackupProgressEvent) => void;
}

export interface BackupStorageTargetStatus {
  target: BackupStorageTarget;
  available: boolean;
  reason?: string;
  location?: string;
}

export interface BackupStoredItem {
  backupId: string;
  createdAtMs: number;
  sourceMachineId: string;
  appVersion: string;
  fileName: string;
  totalBytes: number;
  encrypted: boolean;
  nativeConversationFileCount: number;
  nativeConversationBytes: number;
  providers: NativeConversationProviderSummary[];
}

export interface BackupStorageProvider {
  target: BackupStorageTarget;
  status(): Promise<BackupStorageTargetStatus>;
  publish(options: { fileName: string; write: (partialPath: string) => Promise<void> }): Promise<string>;
  list(): Promise<BackupStoredItem[]>;
  read(backupId: string): Promise<string>;
}

type BackupFile = {
  path: string;
  size: number;
  mtimeMs: number;
  sha256: string;
};

type NativeConversationManifest = {
  /** v2 provider artifacts use compact OpenCode and final-only Grok records. */
  artifactVersion?: number;
  fileCount: number;
  totalBytes: number;
  providers: NativeConversationProviderSummary[];
  warnings: string[];
};

type BackupManifest = {
  formatVersion: number;
  backupId?: string;
  createdAtMs: number;
  sourceMachineId?: string;
  appVersion: string;
  credentialsEncrypted: boolean;
  nativeConversations?: NativeConversationManifest;
  files: BackupFile[];
};

type ArbakHeader = {
  formatVersion: 1;
  backupId: string;
  createdAtMs: number;
  sourceMachineId: string;
  appVersion: string;
  plaintextBytes: number;
  fileCount: number;
  nativeConversationFileCount: number;
  nativeConversationBytes: number;
  providers: NativeConversationProviderSummary[];
  salt: string;
  iv: string;
  kdf: { name: "scrypt"; N: number; r: number; p: number };
};

export type BackupPreview = {
  importToken: string;
  createdAtMs: number;
  appVersion: string;
  fileCount: number;
  totalBytes: number;
  credentialsEncrypted: boolean;
  nativeConversationFileCount: number;
  nativeConversationBytes: number;
  providers: NativeConversationProviderSummary[];
  warnings: string[];
};

export type BackupResult = {
  canceled: boolean;
  file?: string;
  fileCount?: number;
  totalBytes?: number;
  recoveryFile?: string;
  warnings?: string[];
  storedItem?: BackupStoredItem;
};

type PendingImport = { root: string; manifest: BackupManifest; expiresAt: number };
type ArchiveBuild = { result: BackupResult; manifest: BackupManifest };
const pendingImports = new Map<string, PendingImport>();
let operation: Promise<unknown> | null = null;

const CATALOG_UPDATED_TABLES: Record<string, { keys: string[]; timestamp: string }> = {
  sessions: { keys: ["provider", "agent_session_id"], timestamp: "updated_at_ms" },
  projects: { keys: ["project_id"], timestamp: "updated_at_ms" },
  project_local_paths: { keys: ["project_id", "machine_id"], timestamp: "updated_at_ms" },
  session_gtd: { keys: ["provider", "agent_session_id"], timestamp: "updated_at_ms" },
  session_notes: { keys: ["provider", "agent_session_id"], timestamp: "updated_at_ms" },
  project_notes: { keys: ["project_path"], timestamp: "updated_at_ms" }
};
const CATALOG_APPEND_TABLES: Record<string, string[]> = {};
const DESKTOP_UPDATED_TABLES: Record<string, { keys: string[]; timestamp: string }> = {
  report_jobs: { keys: ["job_key"], timestamp: "updated_at_ms" },
  note_chunks: { keys: ["chunk_id"], timestamp: "updated_at_ms" },
  note_vector_index: { keys: ["note_id"], timestamp: "indexed_at_ms" },
  session_embeddings: { keys: ["provider", "agent_session_id"], timestamp: "updated_at_ms" },
  session_transcript_chunks: { keys: ["chunk_id"], timestamp: "updated_at_ms" },
  session_transcript_index: { keys: ["provider", "agent_session_id"], timestamp: "updated_at_ms" },
  agent_threads: { keys: ["id"], timestamp: "updated_at_ms" }
};
const DESKTOP_APPEND_TABLES: Record<string, string[]> = {
  report_entries: ["id"],
  gtd_ai_audit: ["id"],
  llm_usage_events: ["id"],
  schedule_run_logs: ["id"],
  agent_messages: ["id"],
  agent_note_audit: ["id"]
};

function sql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

function backupId(): string {
  return randomBytes(16).toString("hex");
}

function utcFileTime(value = new Date()): string {
  return value.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "").replace("Z", "Z");
}

function reportProgress(callback: BackupCreateOptions["onProgress"] | BackupImportOptions["onProgress"] | undefined, operation: BackupProgressEvent["operation"], phase: BackupProgressPhase, percent: number): void {
  callback?.({ operation, phase, percent: Math.max(0, Math.min(100, Math.round(percent))) });
}

async function withExclusive<T>(task: () => Promise<T>): Promise<T> {
  if (operation) throw new Error("A backup or restore operation is already running.");
  const next = task();
  operation = next;
  try {
    return await next;
  } finally {
    operation = null;
  }
}

async function exists(file: string): Promise<boolean> {
  try { await fsp.access(file); return true; } catch { return false; }
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  const input = fs.createReadStream(file);
  for await (const chunk of input) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function walk(root: string, prefix = ""): Promise<Array<{ absolute: string; relative: string }>> {
  if (!(await exists(root))) return [];
  const rows = await fsp.readdir(root, { withFileTypes: true });
  const output: Array<{ absolute: string; relative: string }> = [];
  for (const row of rows) {
    if (row.isSymbolicLink()) continue;
    const relative = path.posix.join(prefix, row.name);
    const absolute = path.join(root, row.name);
    if (row.isDirectory()) output.push(...await walk(absolute, relative));
    else if (row.isFile()) output.push({ absolute, relative });
  }
  return output;
}

function stripCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCredentials);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(api.?key|token|secret|password)/i.test(key))
    .map(([key, child]) => [key, stripCredentials(child)]));
}

async function snapshotDatabase(source: string, destination: string): Promise<void> {
  if (!(await exists(source))) return;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await runSqlite(source, `VACUUM INTO ${sql(destination)};`);
}

async function deriveBackupKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 32, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

async function encryptCredentials(value: Record<string, unknown>, password: string): Promise<Buffer> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveBackupKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.from(JSON.stringify({ version: 2, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }), "utf8");
}

async function decryptCredentials(value: Buffer, password: string): Promise<Record<string, unknown>> {
  const payload = JSON.parse(value.toString("utf8")) as { salt: string; iv: string; tag: string; ciphertext: string };
  const key = await deriveBackupKey(password, Buffer.from(payload.salt, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8")) as Record<string, unknown>;
}

function preserveCredentials(next: unknown, current: unknown): unknown {
  if (Array.isArray(next) || !next || typeof next !== "object") return next;
  const nextRecord = { ...(next as Record<string, unknown>) };
  const currentRecord = current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  for (const [key, value] of Object.entries(currentRecord)) {
    if (/(api.?key|token|secret|password)/i.test(key)) nextRecord[key] = value;
    else if (key in nextRecord) nextRecord[key] = preserveCredentials(nextRecord[key], value);
  }
  return nextRecord;
}

async function writeZip(destination: string, files: Array<{ absolute: string; archivePath: string }>, manifest: BackupManifest, credentials?: Buffer): Promise<void> {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.${randomBytes(6).toString("hex")}.partial`;
  const zip = new yazl.ZipFile();
  try {
    for (const file of files) zip.addFile(file.absolute, file.archivePath);
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), MANIFEST_PATH);
    if (credentials) zip.addBuffer(credentials, CREDENTIALS_PATH);
    const output = fs.createWriteStream(partial, { flags: "w", mode: 0o600 });
    const done = pipeline(zip.outputStream as Readable, output);
    zip.end();
    await done;
    const stat = await fsp.stat(partial);
    if (stat.size > MAX_ARCHIVE_BYTES) throw new Error("Backup archive exceeds the 2 GB limit.");
    await fsp.rename(partial, destination);
  } catch (error) {
    await fsp.rm(partial, { force: true });
    throw error;
  }
}

function validateArchiveEntries(entries: Array<{ absolute: string; relative: string }>): Promise<void> {
  return (async () => {
    let total = 0;
    for (const entry of entries) {
      const stat = await fsp.stat(entry.absolute);
      if (stat.size > MAX_ENTRY_BYTES) throw new Error(`Backup file exceeds the 512 MB limit: ${entry.relative}`);
      total += stat.size;
      if (total > MAX_EXPANDED_BYTES) throw new Error("Backup expands beyond the 4 GB limit.");
    }
  })();
}

async function copyNativeConversations(settings: PanelSettings, payload: string): Promise<NativeConversationManifest> {
  const collected = await buildNativeConversationArtifacts(settings, path.join(payload, NATIVE_ROOT), {
    maxFileBytes: MAX_ENTRY_BYTES,
    maxTotalBytes: MAX_EXPANDED_BYTES
  });
  return {
    artifactVersion: 2,
    fileCount: collected.files.length,
    totalBytes: collected.files.reduce((sum, file) => sum + file.size, 0),
    providers: collected.providers,
    warnings: collected.warnings
  };
}

async function createArchive(settings: PanelSettings, destination: string, appVersion: string, options: Omit<BackupCreateOptions, "target">): Promise<ArchiveBuild> {
  reportProgress(options.onProgress, "export", "preparing", 2);
  const home = effectivePanelHome(settings);
  const paths = await loadPanelDbPaths(settings);
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-resume-backup-"));
  try {
    const payload = path.join(stage, PAYLOAD_ROOT);
    await snapshotDatabase(paths.catalogDb, path.join(payload, "catalog.db"));
    await snapshotDatabase(paths.desktopDb, path.join(payload, ".desktop", "desktop.db"));
    reportProgress(options.onProgress, "export", "snapshotting", 25);
    for (const rel of ["notes", "acp", ".desktop/scratch"]) {
      const source = path.join(home, rel);
      const target = path.join(payload, rel);
      if (await exists(source)) await fsp.cp(source, target, { recursive: true, dereference: false });
    }
    const originals: Record<string, unknown> = {};
    for (const name of ["settings.json", "settings.desktop.json"]) {
      const source = path.join(home, name);
      if (!(await exists(source))) continue;
      const raw = await fsp.readFile(source, "utf8");
      try {
        const parsed = JSON.parse(raw) as unknown;
        originals[name] = parsed;
        await fsp.mkdir(payload, { recursive: true });
        await fsp.writeFile(path.join(payload, name), `${JSON.stringify(stripCredentials(parsed), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      } catch {
        await fsp.copyFile(source, path.join(payload, name));
      }
    }
    reportProgress(options.onProgress, "export", "collecting", 45);
    const nativeConversations = options.includeNativeConversations !== false ? await copyNativeConversations(settings, payload) : undefined;
    reportProgress(options.onProgress, "export", "archiving", 70);
    const entries = await walk(payload);
    await validateArchiveEntries(entries);
    const files: BackupFile[] = await Promise.all(entries.map(async (entry) => {
      const stat = await fsp.stat(entry.absolute);
      return { path: `${PAYLOAD_ROOT}/${entry.relative}`, size: stat.size, mtimeMs: stat.mtimeMs, sha256: await sha256(entry.absolute) };
    }));
    const manifest: BackupManifest = {
      formatVersion: FORMAT_VERSION,
      backupId: backupId(),
      createdAtMs: Date.now(),
      sourceMachineId: await getMachineId(),
      appVersion,
      credentialsEncrypted: options.includeCredentials,
      nativeConversations,
      files
    };
    const credentials = options.includeCredentials ? await encryptCredentials(originals, options.password || "") : undefined;
    await writeZip(destination, entries.map((entry) => ({ absolute: entry.absolute, archivePath: `${PAYLOAD_ROOT}/${entry.relative}` })), manifest, credentials);
    reportProgress(options.onProgress, "export", "finalizing", 95);
    return {
      manifest,
      result: {
        canceled: false,
        file: destination,
        fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
        warnings: nativeConversations?.warnings
      }
    };
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
  }
}

function safeArchivePath(name: string): string {
  if (!name || name.includes("\\") || path.posix.isAbsolute(name) || name.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Archive contains an unsafe path.");
  if (name !== MANIFEST_PATH && name !== CREDENTIALS_PATH && !name.startsWith(`${PAYLOAD_ROOT}/`)) throw new Error("Archive contains an unexpected file.");
  return name;
}

function assertSupportedManifest(manifest: BackupManifest): void {
  if ((manifest.formatVersion !== 1 && manifest.formatVersion !== FORMAT_VERSION) || !Array.isArray(manifest.files)) {
    throw new Error("Unsupported backup format.");
  }
}

async function extractArchive(file: string): Promise<{ root: string; manifest: BackupManifest }> {
  const stat = await fsp.stat(file);
  if (stat.size > MAX_ARCHIVE_BYTES) throw new Error("Backup archive exceeds the 2 GB limit.");
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-resume-import-"));
  const zip = await openZip(file);
  let expanded = 0;
  try {
    for (let entry = await nextZipEntry(zip); entry; entry = await nextZipEntry(zip)) {
      const name = safeArchivePath(entry.fileName);
      const unixMode = entry.externalFileAttributes >>> 16;
      if ((unixMode & 0o170000) === 0o120000) throw new Error("Backup archive may not contain symbolic links.");
      if (entry.uncompressedSize > MAX_ENTRY_BYTES || (expanded += entry.uncompressedSize) > MAX_EXPANDED_BYTES) throw new Error("Backup archive expands beyond the allowed size.");
      const target = path.join(root, name);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await pipeline(await openZipEntry(zip, entry), fs.createWriteStream(target, { mode: 0o600 }));
    }
    const manifest = JSON.parse(await fsp.readFile(path.join(root, MANIFEST_PATH), "utf8")) as BackupManifest;
    assertSupportedManifest(manifest);
    for (const item of manifest.files) {
      const relative = safeArchivePath(item.path);
      const actual = path.join(root, relative);
      if (!(await exists(actual)) || await sha256(actual) !== item.sha256) throw new Error(`Backup checksum failed for ${relative}.`);
    }
    return { root, manifest };
  } catch (error) {
    await fsp.rm(root, { recursive: true, force: true });
    throw error;
  } finally {
    zip.close();
  }
}

function openZip(file: string): Promise<ZipReader> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(error || new Error("Unable to open backup archive."));
      else resolve(zip);
    });
  });
}

function nextZipEntry(zip: ZipReader): Promise<ZipEntry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: ZipEntry) => finish(() => resolve(entry));
    const onEnd = () => finish(() => resolve(null));
    const onError = (error: Error) => finish(() => reject(error));
    const finish = (action: () => void) => {
      zip.removeListener("entry", onEntry as never);
      zip.removeListener("end", onEnd as never);
      zip.removeListener("error", onError as never);
      action();
    };
    zip.once("entry", onEntry);
    zip.once("end", onEnd);
    zip.once("error", onError);
    zip.readEntry();
  });
}

function openZipEntry(zip: ZipReader, entry: ZipEntry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error || new Error("Unable to read backup entry."));
      else resolve(stream);
    });
  });
}

function arbakPrefix(header: Buffer): Buffer {
  const size = Buffer.allocUnsafe(4);
  size.writeUInt32BE(header.length, 0);
  return Buffer.concat([ARBAK_MAGIC, size, header]);
}

async function readArbakHeader(file: string): Promise<{ header: ArbakHeader; raw: Buffer; ciphertextOffset: number; isArbak: boolean }> {
  const handle = await fsp.open(file, "r");
  try {
    const initial = Buffer.alloc(ARBAK_MAGIC.length + 4);
    const { bytesRead } = await handle.read(initial, 0, initial.length, 0);
    if (bytesRead < ARBAK_MAGIC.length || !initial.subarray(0, ARBAK_MAGIC.length).equals(ARBAK_MAGIC)) {
      return { header: undefined as never, raw: Buffer.alloc(0), ciphertextOffset: 0, isArbak: false };
    }
    if (bytesRead !== initial.length) throw new Error("Encrypted backup header is incomplete.");
    const headerBytes = initial.readUInt32BE(ARBAK_MAGIC.length);
    if (!headerBytes || headerBytes > MAX_ARBAK_HEADER_BYTES) throw new Error("Encrypted backup header is invalid.");
    const raw = Buffer.alloc(headerBytes);
    const body = await handle.read(raw, 0, raw.length, initial.length);
    if (body.bytesRead !== raw.length) throw new Error("Encrypted backup header is incomplete.");
    const header = JSON.parse(raw.toString("utf8")) as ArbakHeader;
    if (
      header.formatVersion !== 1 || !header.backupId || !header.sourceMachineId ||
      header.kdf?.name !== "scrypt" || header.kdf.N !== SCRYPT_OPTIONS.N ||
      header.kdf.r !== SCRYPT_OPTIONS.r || header.kdf.p !== SCRYPT_OPTIONS.p ||
      Buffer.from(header.salt || "", "base64").length !== 16 ||
      Buffer.from(header.iv || "", "base64").length !== 12
    ) {
      throw new Error("Encrypted backup header is unsupported.");
    }
    return { header, raw, ciphertextOffset: initial.length + raw.length, isArbak: true };
  } finally {
    await handle.close();
  }
}

async function encryptArbak(sourceZip: string, destination: string, details: Omit<ArbakHeader, "salt" | "iv" | "kdf" | "formatVersion">, password: string): Promise<void> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header: ArbakHeader = {
    formatVersion: 1,
    ...details,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    kdf: { name: "scrypt", N: SCRYPT_OPTIONS.N, r: SCRYPT_OPTIONS.r, p: SCRYPT_OPTIONS.p }
  };
  const raw = Buffer.from(JSON.stringify(header), "utf8");
  const key = await deriveBackupKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(raw);
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fsp.writeFile(destination, arbakPrefix(raw), { mode: 0o600 });
    await pipeline(fs.createReadStream(sourceZip), cipher, fs.createWriteStream(destination, { flags: "a", mode: 0o600 }));
    await fsp.appendFile(destination, cipher.getAuthTag());
  } catch (error) {
    await fsp.rm(destination, { force: true });
    throw error;
  }
}

async function decryptArbak(file: string, password: string): Promise<string> {
  const info = await readArbakHeader(file);
  if (!info.isArbak) throw new Error("The selected backup is not an encrypted Agent Resume backup.");
  if (!password) throw new Error("A password is required for this encrypted iCloud backup.");
  const stat = await fsp.stat(file);
  if (stat.size > MAX_ARCHIVE_BYTES) throw new Error("Encrypted backup exceeds the 2 GB limit.");
  if (stat.size <= info.ciphertextOffset + ARBAK_TAG_BYTES) throw new Error("Encrypted backup is incomplete.");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-resume-decrypt-"));
  const output = path.join(dir, "backup.zip");
  try {
    const key = await deriveBackupKey(password, Buffer.from(info.header.salt, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(info.header.iv, "base64"));
    decipher.setAAD(info.raw);
    const tag = Buffer.alloc(ARBAK_TAG_BYTES);
    const handle = await fsp.open(file, "r");
    try {
      await handle.read(tag, 0, tag.length, stat.size - ARBAK_TAG_BYTES);
    } finally {
      await handle.close();
    }
    decipher.setAuthTag(tag);
    await pipeline(
      fs.createReadStream(file, { start: info.ciphertextOffset, end: stat.size - ARBAK_TAG_BYTES - 1 }),
      decipher,
      fs.createWriteStream(output, { mode: 0o600 })
    );
    return output;
  } catch {
    await fsp.rm(dir, { recursive: true, force: true });
    throw new Error("Unable to decrypt this backup. Check the password and ensure the backup was not modified.");
  }
}

async function extractBackupFile(file: string, password?: string): Promise<{ root: string; manifest: BackupManifest }> {
  const info = await readArbakHeader(file);
  if (!info.isArbak) return extractArchive(file);
  const temporaryZip = await decryptArbak(file, password || "");
  try {
    return await extractArchive(temporaryZip);
  } finally {
    await fsp.rm(path.dirname(temporaryZip), { recursive: true, force: true });
  }
}

function icloudBackupDir(): string {
  return path.join(os.homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs", "Agent Resume", "Backups");
}

function storedItemFromHeader(fileName: string, header: ArbakHeader): BackupStoredItem {
  return {
    backupId: header.backupId,
    createdAtMs: header.createdAtMs,
    sourceMachineId: header.sourceMachineId,
    appVersion: header.appVersion,
    fileName,
    totalBytes: header.plaintextBytes,
    encrypted: true,
    nativeConversationFileCount: header.nativeConversationFileCount,
    nativeConversationBytes: header.nativeConversationBytes,
    providers: header.providers
  };
}

class IcloudDriveBackupStorageProvider implements BackupStorageProvider {
  readonly target = "icloud-drive" as const;

  async status(): Promise<BackupStorageTargetStatus> {
    if (process.platform !== "darwin") return { target: this.target, available: false, reason: "iCloud Drive backups are available only on macOS." };
    const root = path.join(os.homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs");
    try {
      const stat = await fsp.stat(root);
      if (!stat.isDirectory()) throw new Error("not a directory");
      return { target: this.target, available: true, location: icloudBackupDir() };
    } catch {
      return { target: this.target, available: false, reason: "iCloud Drive is not available for this macOS account." };
    }
  }

  async publish(options: { fileName: string; write: (partialPath: string) => Promise<void> }): Promise<string> {
    const status = await this.status();
    if (!status.available || !status.location) throw new Error(status.reason || "iCloud Drive is unavailable.");
    if (!/^[A-Za-z0-9._-]+\.arbak$/.test(options.fileName)) throw new Error("Invalid managed iCloud backup filename.");
    await fsp.mkdir(status.location, { recursive: true });
    const destination = path.join(status.location, options.fileName);
    const partial = `${destination}.${randomBytes(6).toString("hex")}.partial`;
    try {
      await options.write(partial);
      await fsp.rename(partial, destination);
      return destination;
    } catch (error) {
      await fsp.rm(partial, { force: true });
      throw error;
    }
  }

  async list(): Promise<BackupStoredItem[]> {
    const status = await this.status();
    if (!status.available || !status.location) return [];
    const rows = await fsp.readdir(status.location, { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[]);
    const items: BackupStoredItem[] = [];
    for (const row of rows) {
      if (!row.isFile() || !row.name.endsWith(".arbak") || row.name.includes(".partial")) continue;
      try {
        const parsed = await readArbakHeader(path.join(status.location, row.name));
        if (parsed.isArbak) items.push(storedItemFromHeader(row.name, parsed.header));
      } catch {
        // Damaged or unrelated files remain untouched and are not offered as managed backups.
      }
    }
    return items.sort((left, right) => right.createdAtMs - left.createdAtMs);
  }

  async read(id: string): Promise<string> {
    if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error("Invalid iCloud backup id.");
    const status = await this.status();
    if (!status.available || !status.location) throw new Error(status.reason || "iCloud Drive is unavailable.");
    const rows = await fsp.readdir(status.location, { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[]);
    for (const row of rows) {
      if (!row.isFile() || !row.name.endsWith(".arbak") || row.name.includes(".partial")) continue;
      const candidate = path.join(status.location, row.name);
      try {
        const parsed = await readArbakHeader(candidate);
        if (parsed.isArbak && parsed.header.backupId === id) return candidate;
      } catch {
        // Do not offer damaged backups.
      }
    }
    throw new Error("The selected iCloud backup is no longer available.");
  }
}

class LocalFileBackupStorageProvider implements BackupStorageProvider {
  readonly target = "local-file" as const;
  async status(): Promise<BackupStorageTargetStatus> { return { target: this.target, available: true }; }
  async publish(): Promise<string> { throw new Error("Local backups are written through the user-selected save location."); }
  async list(): Promise<BackupStoredItem[]> { return []; }
  async read(): Promise<string> { throw new Error("Local backups are selected through the file picker."); }
}

const storageProviders: Record<BackupStorageTarget, BackupStorageProvider> = {
  "local-file": new LocalFileBackupStorageProvider(),
  "icloud-drive": new IcloudDriveBackupStorageProvider()
};

async function pruneIcloudBackups(provider: BackupStorageProvider, machineId: string): Promise<void> {
  const items = (await provider.list()).filter((item) => item.sourceMachineId === machineId).sort((left, right) => right.createdAtMs - left.createdAtMs);
  for (const item of items.slice(ICLOUD_RETENTION_COUNT)) {
    const file = await provider.read(item.backupId).catch(() => undefined);
    if (file) await fsp.rm(file, { force: true });
  }
}

async function cleanupTemporaryBackups(): Promise<void> {
  const rows = await fsp.readdir(os.tmpdir(), { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[]);
  await Promise.all(rows.filter((row) => /^(agent-resume-(?:backup|import|decrypt|native-journal)-)/.test(row.name)).map(async (row) => {
    const candidate = path.join(os.tmpdir(), row.name);
    const stat = await fsp.stat(candidate).catch(() => undefined);
    if (stat && stat.mtimeMs < Date.now() - TEMP_RETENTION_MS) await fsp.rm(candidate, { recursive: true, force: true });
  }));
}

async function sourceTables(db: string, source: string): Promise<Set<string>> {
  const rows = await runSqliteJson<{ name: string }>(db, `ATTACH DATABASE ${sql(source)} AS incoming; SELECT name FROM incoming.sqlite_master WHERE type = 'table'; DETACH DATABASE incoming;`);
  return new Set(rows.map((row) => row.name));
}

async function targetColumns(db: string, table: string): Promise<string[]> {
  const rows = await runSqliteJson<{ name: string }>(db, `PRAGMA table_info(${sql(table)});`);
  return rows.map((row) => row.name);
}

async function mergeDatabase(target: string, source: string, updated: Record<string, { keys: string[]; timestamp: string }>, appended: Record<string, string[]>): Promise<void> {
  if (!(await exists(source))) return;
  const sourceTableNames = await sourceTables(target, source);
  const statements: string[] = [];
  for (const [table, rule] of Object.entries(updated)) {
    if (!sourceTableNames.has(table)) continue;
    const columns = await targetColumns(target, table);
    if (!columns.includes(rule.timestamp)) continue;
    const list = columns.map(quoteIdentifier).join(", ");
    const keyMatch = rule.keys.map((key) => `target.${quoteIdentifier(key)} = incoming.${quoteIdentifier(key)}`).join(" AND ");
    const assignments = columns.filter((column) => !rule.keys.includes(column)).map((column) => `${quoteIdentifier(column)} = (SELECT incoming.${quoteIdentifier(column)} FROM incoming.${quoteIdentifier(table)} AS incoming WHERE ${keyMatch})`).join(", ");
    statements.push(`INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${list}) SELECT ${list} FROM incoming.${quoteIdentifier(table)}`);
    statements.push(`UPDATE ${quoteIdentifier(table)} AS target SET ${assignments} WHERE EXISTS (SELECT 1 FROM incoming.${quoteIdentifier(table)} AS incoming WHERE ${keyMatch} AND incoming.${quoteIdentifier(rule.timestamp)} > target.${quoteIdentifier(rule.timestamp)})`);
  }
  for (const [table] of Object.entries(appended)) {
    if (!sourceTableNames.has(table)) continue;
    const columns = await targetColumns(target, table);
    const list = columns.map(quoteIdentifier).join(", ");
    statements.push(`INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${list}) SELECT ${list} FROM incoming.${quoteIdentifier(table)}`);
  }
  if (sourceTableNames.has("report_links")) statements.push(`INSERT INTO report_links (report_id, provider, agent_session_id, project_path) SELECT incoming.report_id, incoming.provider, incoming.agent_session_id, incoming.project_path FROM incoming.report_links AS incoming WHERE NOT EXISTS (SELECT 1 FROM report_links AS target WHERE target.report_id IS incoming.report_id AND target.provider IS incoming.provider AND target.agent_session_id IS incoming.agent_session_id AND target.project_path IS incoming.project_path)`);
  if (sourceTableNames.has("agent_messages")) statements.push(`WITH ordered AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY COALESCE(thread_id, '') ORDER BY created_at_ms, id) AS position FROM agent_messages) UPDATE agent_messages SET sort_order = (SELECT position FROM ordered WHERE ordered.id = agent_messages.id)`);
  await runSqlite(target, `ATTACH DATABASE ${sql(source)} AS incoming;\nBEGIN IMMEDIATE;\n${statements.map((item) => `${item};`).join("\n")}\nCOMMIT;\nDETACH DATABASE incoming;`);
}

async function mergeTree(source: string, destination: string, manifest: BackupManifest, prefix: string): Promise<void> {
  for (const entry of await walk(source)) {
    const manifestPath = `${prefix}/${entry.relative}`;
    const sourceMeta = manifest.files.find((file) => file.path === manifestPath);
    const target = path.join(destination, entry.relative);
    const targetStat = await fsp.stat(target).catch(() => undefined);
    if (targetStat && sourceMeta && targetStat.mtimeMs > sourceMeta.mtimeMs) continue;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(entry.absolute, target);
    if (sourceMeta) await fsp.utimes(target, new Date(sourceMeta.mtimeMs), new Date(sourceMeta.mtimeMs));
  }
}

async function readJsonLines<T>(file: string): Promise<T[]> {
  if (!(await exists(file))) return [];
  return (await fsp.readFile(file, "utf8")).split("\n").flatMap((line) => {
    try { return line.trim() ? [JSON.parse(line) as T] : []; } catch { return []; }
  });
}

async function mergeAcp(source: string, destination: string, manifest: BackupManifest): Promise<void> {
  const sourceSessions = await readJsonLines<Record<string, unknown>>(path.join(source, "sessions.jsonl"));
  const targetSessions = await readJsonLines<Record<string, unknown>>(path.join(destination, "sessions.jsonl"));
  const sessions = new Map<string, Record<string, unknown>>();
  for (const item of [...targetSessions, ...sourceSessions]) {
    const id = typeof item.id === "string" ? item.id : "";
    if (!id || (sessions.get(id) && Number(sessions.get(id)?.updatedAt || 0) > Number(item.updatedAt || 0))) continue;
    sessions.set(id, item);
  }
  if (sessions.size) {
    await fsp.mkdir(destination, { recursive: true });
    await fsp.writeFile(path.join(destination, "sessions.jsonl"), `${[...sessions.values()].map((item) => JSON.stringify(item)).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  }
  const ids = new Set([...sessions.keys()]);
  for (const id of ids) {
    const rows = new Map<string, Record<string, unknown>>();
    for (const item of [...await readJsonLines<Record<string, unknown>>(path.join(destination, "threads", `${id}.jsonl`)), ...await readJsonLines<Record<string, unknown>>(path.join(source, "threads", `${id}.jsonl`))]) {
      const messageId = typeof item.id === "string" ? item.id : "";
      if (!messageId || (rows.get(messageId) && Number(rows.get(messageId)?.timestamp || 0) > Number(item.timestamp || 0))) continue;
      rows.set(messageId, item);
    }
    if (rows.size) {
      const values = [...rows.values()].sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));
      const target = path.join(destination, "threads", `${id}.jsonl`);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, `${values.map((item) => JSON.stringify(item)).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    }
  }
  await mergeTree(path.join(source, "attachments"), path.join(destination, "attachments"), manifest, `${PAYLOAD_ROOT}/acp/attachments`);
}

async function maybeApplySettings(home: string, root: string, manifest: BackupManifest, importCredentials: boolean, password?: string): Promise<void> {
  let credentialFiles: Record<string, unknown> = {};
  if (importCredentials && manifest.credentialsEncrypted) {
    if (!password) throw new Error("A password is required to import API keys.");
    credentialFiles = await decryptCredentials(await fsp.readFile(path.join(root, CREDENTIALS_PATH)), password);
  }
  for (const name of ["settings.json", "settings.desktop.json"]) {
    const source = path.join(root, PAYLOAD_ROOT, name);
    if (!(await exists(source))) continue;
    const metadata = manifest.files.find((file) => file.path === `${PAYLOAD_ROOT}/${name}`);
    const target = path.join(home, name);
    const targetStat = await fsp.stat(target).catch(() => undefined);
    if (targetStat && metadata && targetStat.mtimeMs > metadata.mtimeMs) continue;
    const original = credentialFiles[name];
    if (original) {
      await fsp.writeFile(target, `${JSON.stringify(original, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      continue;
    }
    try {
      const imported = JSON.parse(await fsp.readFile(source, "utf8")) as unknown;
      const existing = await fsp.readFile(target, "utf8").then((raw) => JSON.parse(raw) as unknown).catch(() => undefined);
      await fsp.writeFile(target, `${JSON.stringify(preserveCredentials(imported, existing), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {
      await fsp.copyFile(source, target);
    }
  }
}

async function replaceFile(source: string, destination: string): Promise<void> {
  if (!(await exists(source))) return;
  const temp = `${destination}.restore-${randomBytes(6).toString("hex")}`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.copyFile(source, temp);
  await fsp.rm(`${destination}-wal`, { force: true });
  await fsp.rm(`${destination}-shm`, { force: true });
  await fsp.rename(temp, destination);
}

async function restoreRecovery(settings: PanelSettings, recoveryFile: string): Promise<void> {
  const extracted = await extractArchive(recoveryFile);
  try {
    const home = effectivePanelHome(settings);
    const paths = await loadPanelDbPaths(settings);
    const payload = path.join(extracted.root, PAYLOAD_ROOT);
    await replaceFile(path.join(payload, "catalog.db"), paths.catalogDb);
    await replaceFile(path.join(payload, ".desktop", "desktop.db"), paths.desktopDb);
    for (const relative of ["notes", "acp", ".desktop/scratch"]) {
      const source = path.join(payload, relative);
      const destination = path.join(home, relative);
      await fsp.rm(destination, { recursive: true, force: true });
      if (await exists(source)) await fsp.cp(source, destination, { recursive: true, dereference: false });
    }
  } finally {
    await fsp.rm(extracted.root, { recursive: true, force: true });
  }
}

function assertPathWithin(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Native conversation restore attempted to write outside a configured Agent home.");
}

async function lstatFile(file: string): Promise<import("node:fs").Stats | undefined> {
  try {
    const stat = await fsp.lstat(file);
    if (stat.isSymbolicLink()) throw new Error("Native conversation restore refuses symbolic links.");
    return stat;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

class NativeRecoveryJournal {
  private readonly snapshots = new Map<string, { existed: boolean; snapshot?: string }>();
  private readonly rootPromise = fsp.mkdtemp(path.join(os.tmpdir(), "agent-resume-native-journal-"));

  async capture(target: string): Promise<void> {
    if (this.snapshots.has(target)) return;
    const stat = await lstatFile(target);
    if (!stat) {
      this.snapshots.set(target, { existed: false });
      return;
    }
    if (!stat.isFile()) throw new Error("Native conversation restore refuses to replace a non-file target.");
    const root = await this.rootPromise;
    const snapshot = path.join(root, String(this.snapshots.size));
    await fsp.copyFile(target, snapshot);
    this.snapshots.set(target, { existed: true, snapshot });
  }

  async rollback(): Promise<void> {
    for (const [target, entry] of [...this.snapshots.entries()].reverse()) {
      if (!entry.existed) await fsp.rm(target, { force: true });
      else if (entry.snapshot) await copyAtomically(entry.snapshot, target);
    }
  }

  async dispose(): Promise<void> {
    await fsp.rm(await this.rootPromise, { recursive: true, force: true });
  }
}

async function copyAtomically(source: string, destination: string, mtimeMs?: number): Promise<void> {
  const temp = `${destination}.agent-resume-restore-${randomBytes(6).toString("hex")}`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fsp.copyFile(source, temp);
    if (mtimeMs != null) await fsp.utimes(temp, new Date(mtimeMs), new Date(mtimeMs));
    await fsp.rename(temp, destination);
  } catch (error) {
    await fsp.rm(temp, { force: true });
    throw error;
  }
}

function nativePathParts(manifestPath: string): { provider: Exclude<NativeConversationProvider, "cursor-ide">; relative: string } | undefined {
  const prefix = `${PAYLOAD_ROOT}/${NATIVE_ROOT}/`;
  if (!manifestPath.startsWith(prefix)) return undefined;
  const parts = manifestPath.slice(prefix.length).split("/");
  const provider = parts.shift();
  if (!provider || !NATIVE_PROVIDERS.has(provider as Exclude<NativeConversationProvider, "cursor-ide">) || !parts.length || parts.some((part) => !part || part === "." || part === "..")) return undefined;
  return { provider: provider as Exclude<NativeConversationProvider, "cursor-ide">, relative: parts.join("/") };
}

function jsonlKey(provider: string, value: Record<string, unknown>, raw: string): string {
  const candidates = provider === "codex" ? [value.id, value.thread_id, value.session_id] : [value.sessionId, value.id, value.uuid];
  const key = candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0);
  return typeof key === "string" ? key : `raw:${createHash("sha256").update(raw).digest("hex")}`;
}

function jsonTimestamp(value: Record<string, unknown>): number {
  for (const key of ["updatedAt", "updated_at", "updated_at_ms", "timestamp", "time_updated"]) {
    const raw = value[key];
    const valueMs = typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : NaN;
    if (Number.isFinite(valueMs)) return valueMs;
  }
  return 0;
}

async function mergeNativeJsonl(provider: "codex" | "claude", source: string, destination: string, journal: NativeRecoveryJournal): Promise<void> {
  const lines = async (file: string): Promise<Array<{ raw: string; value: Record<string, unknown> }>> => {
    if (!(await exists(file))) return [];
    return (await fsp.readFile(file, "utf8")).split("\n").flatMap((raw) => {
      if (!raw.trim()) return [];
      try {
        const value = JSON.parse(raw) as unknown;
        return value && typeof value === "object" && !Array.isArray(value) ? [{ raw, value: value as Record<string, unknown> }] : [];
      } catch { return []; }
    });
  };
  const rows = new Map<string, { raw: string; value: Record<string, unknown> }>();
  for (const item of [...await lines(destination), ...await lines(source)]) {
    const key = jsonlKey(provider, item.value, item.raw);
    const current = rows.get(key);
    if (!current || jsonTimestamp(item.value) >= jsonTimestamp(current.value)) rows.set(key, item);
  }
  const output = `${[...rows.values()].map((item) => item.raw).join("\n")}\n`;
  const existing = await fsp.readFile(destination, "utf8").catch(() => "");
  if (existing === output) return;
  await journal.capture(destination);
  const mtime = await fsp.stat(source).then((stat) => stat.mtimeMs).catch(() => undefined);
  const temporary = `${destination}.agent-resume-merge-${randomBytes(6).toString("hex")}`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fsp.writeFile(temporary, output, { encoding: "utf8", mode: 0o600 });
    if (mtime != null) await fsp.utimes(temporary, new Date(mtime), new Date(mtime));
    await fsp.rename(temporary, destination);
  } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

async function restoreNativeFile(source: string, destination: string, metadata: BackupFile, journal: NativeRecoveryJournal, warnings: string[]): Promise<void> {
  const targetStat = await lstatFile(destination);
  if (targetStat) {
    if (targetStat.mtimeMs >= metadata.mtimeMs) {
      const targetHash = await sha256(destination);
      if (targetHash !== metadata.sha256) warnings.push(`Kept newer local native conversation: ${path.basename(destination)}`);
      return;
    }
  }
  await journal.capture(destination);
  await copyAtomically(source, destination, metadata.mtimeMs);
}

async function tableMetadata(db: string, table: string): Promise<Array<{ name: string; pk: number; notnull: number; dflt_value: string | null }>> {
  return runSqliteJson<{ name: string; pk: number; notnull: number; dflt_value: string | null }>(db, `PRAGMA table_info(${sql(table)});`);
}

async function captureOpenCodeJournal(journal: NativeRecoveryJournal, destination: string): Promise<void> {
  await journal.capture(destination);
  await journal.capture(`${destination}-wal`);
  await journal.capture(`${destination}-shm`);
}

const OPENCODE_RESTORE_TABLES = [
  "project", "project_directory", "workspace", "session", "session_context_epoch",
  "session_input", "session_message", "message", "part", "todo"
];
const OPENCODE_SENSITIVE_TABLES = [
  "account", "control_account", "credential", "account_state", "permission", "session_share", "event", "event_sequence"
];

async function sqliteTableNames(db: string): Promise<Set<string>> {
  return new Set((await runSqliteJson<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table';")).map((row) => row.name));
}

/** Remove records that are never portable from an incoming OpenCode database. */
async function sanitizeOpenCodeDatabase(db: string): Promise<void> {
  const names = await sqliteTableNames(db);
  const statements = ["PRAGMA foreign_keys = OFF"];
  for (const table of OPENCODE_SENSITIVE_TABLES) if (names.has(table)) statements.push(`DELETE FROM ${quoteIdentifier(table)}`);
  if (names.has("session")) {
    const sessionColumns = await tableMetadata(db, "session");
    if (sessionColumns.some((column) => column.name === "share_url")) statements.push("UPDATE session SET share_url = NULL");
    if (sessionColumns.some((column) => column.name === "permission")) statements.push("UPDATE session SET permission = NULL");
  }
  statements.push("PRAGMA foreign_keys = ON");
  await runSqlite(db, `${statements.join(";\n")};`);
}

function openCodePrimaryKey(columns: Array<{ name: string; pk: number }>, common: string[]): string[] {
  const keys = columns.filter((column) => column.pk > 0 && common.includes(column.name)).sort((left, right) => left.pk - right.pk).map((column) => column.name);
  return keys.length ? keys : common.includes("id") ? ["id"] : [];
}

function assertOpenCodeCompatibleColumns(table: string, target: Array<{ name: string; notnull: number; dflt_value: string | null; pk: number }>, sourceNames: Set<string>): void {
  for (const column of target) {
    if (sourceNames.has(column.name) || column.dflt_value != null) continue;
    if (column.notnull || column.pk > 0) throw new Error(`OpenCode restore cannot satisfy required ${table}.${column.name} in this local schema.`);
  }
}

async function mergeOpenCodeDatabase(source: string, destination: string, journal?: NativeRecoveryJournal): Promise<void> {
  if (!(await exists(destination))) {
    if (journal) await captureOpenCodeJournal(journal, destination);
    await copyAtomically(source, destination, (await fsp.stat(source)).mtimeMs);
    await sanitizeOpenCodeDatabase(destination);
    return;
  }
  const sourceNames = await sourceTables(destination, source);
  if (!sourceNames.has("session")) throw new Error("OpenCode conversation snapshot has no session table.");
  const targetNames = await sqliteTableNames(destination);
  const statements: string[] = [];
  for (const table of OPENCODE_RESTORE_TABLES) {
    if (!sourceNames.has(table) || !targetNames.has(table)) continue;
    const sourceColumns = await tableMetadata(source, table);
    const targetColumnsForTable = await tableMetadata(destination, table);
    const sourceColumnNames = new Set(sourceColumns.map((column) => column.name));
    assertOpenCodeCompatibleColumns(table, targetColumnsForTable, sourceColumnNames);
    const common = targetColumnsForTable.map((column) => column.name).filter((name) => sourceColumnNames.has(name));
    const primary = openCodePrimaryKey(targetColumnsForTable, common);
    if (!common.length || !primary.length) continue;
    const fields = common.map(quoteIdentifier).join(", ");
    const predicate = primary.map((key) => `target.${quoteIdentifier(key)} = incoming.${quoteIdentifier(key)}`).join(" AND ");
    statements.push(`INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${fields}) SELECT ${fields} FROM incoming.${quoteIdentifier(table)}`);
    const timestamp = ["time_updated", "updated_at_ms", "updated_at", "time_created"].find((name) => common.includes(name));
    const updates = common.filter((name) => !primary.includes(name)).map((name) => `${quoteIdentifier(name)} = (SELECT incoming.${quoteIdentifier(name)} FROM incoming.${quoteIdentifier(table)} AS incoming WHERE ${predicate})`).join(", ");
    if (timestamp && updates) statements.push(`UPDATE ${quoteIdentifier(table)} AS target SET ${updates} WHERE EXISTS (SELECT 1 FROM incoming.${quoteIdentifier(table)} AS incoming WHERE ${predicate} AND incoming.${quoteIdentifier(timestamp)} > target.${quoteIdentifier(timestamp)})`);
  }
  if (!statements.length) return;
  if (journal) await captureOpenCodeJournal(journal, destination);
  await runSqlite(destination, `ATTACH DATABASE ${sql(source)} AS incoming;\nBEGIN IMMEDIATE;\n${statements.map((statement) => `${statement};`).join("\n")}\nCOMMIT;\nDETACH DATABASE incoming;`);
}

async function mergeOpenCodeSnapshots(sources: string[], destination: string, journal: NativeRecoveryJournal): Promise<void> {
  if (!sources.length) return;
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-resume-opencode-merge-"));
  try {
    const normalized = path.join(stage, "opencode.db");
    await copyAtomically(sources[0], normalized, (await fsp.stat(sources[0])).mtimeMs);
    await sanitizeOpenCodeDatabase(normalized);
    for (const source of sources.slice(1)) {
      await mergeOpenCodeDatabase(source, normalized);
      await sanitizeOpenCodeDatabase(normalized);
    }
    await mergeOpenCodeDatabase(normalized, destination, journal);
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
  }
}

function isCompactGrokFile(relative: string): boolean {
  const name = path.posix.basename(relative);
  return name === "summary.json" || name === "chat_history.jsonl";
}

async function mergeNativeConversations(settings: PanelSettings, root: string, manifest: BackupManifest, journal: NativeRecoveryJournal): Promise<string[]> {
  if (!manifest.nativeConversations?.fileCount) return [];
  const homes = resolvePreviewHomes(settings);
  const providerHomes: Record<Exclude<NativeConversationProvider, "cursor-ide">, string> = {
    codex: homes.codexHome,
    claude: homes.claudeHome,
    agy: homes.antigravityHome,
    grok: homes.grokHome,
    opencode: homes.opencodeHome,
    pi: homes.piHome,
    cursor: homes.cursorHome
  };
  const warnings: string[] = [...manifest.nativeConversations.warnings];
  const openCodeSources: string[] = [];
  let ignoredLegacyGrokHistory = false;
  for (const metadata of manifest.files) {
    const parsed = nativePathParts(metadata.path);
    if (!parsed) continue;
    const source = path.join(root, ...metadata.path.split("/"));
    if (!(await exists(source))) throw new Error(`Native conversation file is missing: ${metadata.path}`);
    const home = providerHomes[parsed.provider];
    const destination = path.join(home, ...parsed.relative.split("/"));
    assertPathWithin(home, destination);
    if (parsed.provider === "opencode") {
      if (parsed.relative === "opencode.db" || /^shards\/\d{4}\.db$/.test(parsed.relative)) openCodeSources.push(source);
      else warnings.push("Skipped an unsupported OpenCode native file.");
    } else if (parsed.provider === "grok" && !isCompactGrokFile(parsed.relative)) {
      ignoredLegacyGrokHistory = true;
    } else if (parsed.provider === "codex" && parsed.relative === "session_index.jsonl") {
      await mergeNativeJsonl("codex", source, destination, journal);
    } else if (parsed.provider === "claude" && parsed.relative === "history.jsonl") {
      await mergeNativeJsonl("claude", source, destination, journal);
    } else {
      await restoreNativeFile(source, destination, metadata, journal, warnings);
    }
  }
  if (openCodeSources.length) {
    const destination = path.join(homes.opencodeHome, "opencode.db");
    assertPathWithin(homes.opencodeHome, destination);
    await mergeOpenCodeSnapshots(openCodeSources.sort(), destination, journal);
  }
  if (ignoredLegacyGrokHistory) warnings.push("Ignored historical Grok rewind, update, event, and hunk files from an older backup.");
  return [...new Set(warnings)];
}

function prunePendingImports(): void {
  const now = Date.now();
  for (const [token, item] of pendingImports) {
    if (item.expiresAt > now) continue;
    pendingImports.delete(token);
    void fsp.rm(item.root, { recursive: true, force: true });
  }
}

function previewFromManifest(token: string, manifest: BackupManifest): BackupPreview {
  return {
    importToken: token,
    createdAtMs: manifest.createdAtMs,
    appVersion: manifest.appVersion,
    fileCount: manifest.files.length,
    totalBytes: manifest.files.reduce((sum, item) => sum + item.size, 0),
    credentialsEncrypted: manifest.credentialsEncrypted,
    nativeConversationFileCount: manifest.nativeConversations?.fileCount ?? 0,
    nativeConversationBytes: manifest.nativeConversations?.totalBytes ?? 0,
    providers: manifest.nativeConversations?.providers ?? [],
    warnings: manifest.nativeConversations?.warnings ?? []
  };
}

async function prepareBackupForImport(file: string, password?: string): Promise<BackupPreview> {
  prunePendingImports();
  const extracted = await extractBackupFile(file, password);
  const token = newToken();
  pendingImports.set(token, { ...extracted, expiresAt: Date.now() + 10 * 60 * 1000 });
  return previewFromManifest(token, extracted.manifest);
}

export async function getBackupStorageTargetStatus(): Promise<BackupStorageTargetStatus[]> {
  return Promise.all(Object.values(storageProviders).map((provider) => provider.status()));
}

export async function listIcloudBackups(): Promise<BackupStoredItem[]> {
  return storageProviders["icloud-drive"].list();
}

export async function exportBackup(settings: PanelSettings, destination: string, appVersion: string, options: Omit<BackupCreateOptions, "target">): Promise<BackupResult> {
  if (options.includeCredentials && !options.password) throw new Error("A password is required when including API keys.");
  return withExclusive(async () => {
    await cleanupTemporaryBackups();
    const result = (await createArchive(settings, destination, appVersion, options)).result;
    reportProgress(options.onProgress, "export", "complete", 100);
    return result;
  });
}

export async function exportIcloudBackup(settings: PanelSettings, appVersion: string, options: Omit<BackupCreateOptions, "target">): Promise<BackupResult> {
  if (!options.password) throw new Error("A password is required for an encrypted iCloud backup.");
  return withExclusive(async () => {
    await cleanupTemporaryBackups();
    const provider = storageProviders["icloud-drive"];
    const stage = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-resume-icloud-"));
    try {
      const zip = path.join(stage, "backup.zip");
      const built = await createArchive(settings, zip, appVersion, options);
      reportProgress(options.onProgress, "export", "archiving", 88);
      const stat = await fsp.stat(zip);
      const native = built.manifest.nativeConversations;
      const sourceMachineId = built.manifest.sourceMachineId || await getMachineId();
      const itemId = built.manifest.backupId || backupId();
      const fileName = `agent-resume-${utcFileTime(new Date(built.manifest.createdAtMs))}-${sourceMachineId}-${itemId}.arbak`;
      const storedPath = await provider.publish({
        fileName,
        write: (partial) => encryptArbak(zip, partial, {
          backupId: itemId,
          createdAtMs: built.manifest.createdAtMs,
          sourceMachineId,
          appVersion: built.manifest.appVersion,
          plaintextBytes: stat.size,
          fileCount: built.manifest.files.length,
          nativeConversationFileCount: native?.fileCount ?? 0,
          nativeConversationBytes: native?.totalBytes ?? 0,
          providers: native?.providers ?? []
        }, options.password || "")
      });
      await pruneIcloudBackups(provider, sourceMachineId);
      const header = await readArbakHeader(storedPath);
      reportProgress(options.onProgress, "export", "complete", 100);
      return { ...built.result, file: storedPath, storedItem: storedItemFromHeader(path.basename(storedPath), header.header) };
    } finally {
      await fsp.rm(stage, { recursive: true, force: true });
    }
  });
}

export async function selectBackupForImport(file: string, password?: string): Promise<BackupPreview> {
  return withExclusive(async () => prepareBackupForImport(file, password));
}

export async function selectIcloudBackupForImport(backupIdValue: string, password: string): Promise<BackupPreview> {
  return withExclusive(async () => {
    const file = await storageProviders["icloud-drive"].read(backupIdValue);
    return prepareBackupForImport(file, password);
  });
}

export async function importBackup(settings: PanelSettings, importToken: string, appVersion: string, options: BackupImportOptions): Promise<BackupResult> {
  return withExclusive(async () => {
    reportProgress(options.onProgress, "import", "preparing", 2);
    await cleanupTemporaryBackups();
    prunePendingImports();
    const pending = pendingImports.get(importToken);
    if (!pending || pending.expiresAt <= Date.now()) throw new Error("The selected backup expired. Select it again.");
    pendingImports.delete(importToken);
    const home = effectivePanelHome(settings);
    const recoveryFile = path.join(options.recoveryDir, `before-import-${new Date().toISOString().replaceAll(":", "-")}.zip`);
    await fsp.mkdir(options.recoveryDir, { recursive: true });
    const recovery = await createArchive(settings, recoveryFile, appVersion, { includeCredentials: false, includeNativeConversations: false });
    reportProgress(options.onProgress, "import", "snapshotting", 20);
    const originalSettings = new Map<string, Buffer>();
    for (const name of ["settings.json", "settings.desktop.json"]) {
      const source = path.join(home, name);
      if (await exists(source)) originalSettings.set(name, await fsp.readFile(source));
    }
    const paths = await loadPanelDbPaths(settings);
    const journal = new NativeRecoveryJournal();
    try {
      await ensureExtensionCatalogSchema(paths.catalogDb);
      await ensureDesktopDbSchema(paths.desktopDb);
      reportProgress(options.onProgress, "import", "merging", 40);
      const payload = path.join(pending.root, PAYLOAD_ROOT);
      await mergeDatabase(paths.catalogDb, path.join(payload, "catalog.db"), CATALOG_UPDATED_TABLES, CATALOG_APPEND_TABLES);
      await mergeDatabase(paths.desktopDb, path.join(payload, ".desktop", "desktop.db"), DESKTOP_UPDATED_TABLES, DESKTOP_APPEND_TABLES);
      await mergeTree(path.join(payload, "notes"), path.join(home, "notes"), pending.manifest, `${PAYLOAD_ROOT}/notes`);
      await cleanupRemovedSessionExecutionNotes({ ...paths, panelHome: home, sourceDesktopDbs: [path.join(payload, ".desktop", "desktop.db")] });
      await mergeTree(path.join(payload, ".desktop", "scratch"), path.join(home, ".desktop", "scratch"), pending.manifest, `${PAYLOAD_ROOT}/.desktop/scratch`);
      await mergeAcp(path.join(payload, "acp"), path.join(home, "acp"), pending.manifest);
      reportProgress(options.onProgress, "import", "merging", 65);
      await maybeApplySettings(home, pending.root, pending.manifest, options.includeCredentials, options.password);
      reportProgress(options.onProgress, "import", "collecting", 75);
      const warnings = options.restoreNativeConversations ? await mergeNativeConversations(settings, pending.root, pending.manifest, journal) : pending.manifest.nativeConversations?.fileCount ? ["Native Agent conversations were not restored."] : [];
      reportProgress(options.onProgress, "import", "finalizing", 92);
      const notes = new NotesStore(paths.catalogDb, home);
      await notes.initialize();
      reportProgress(options.onProgress, "import", "complete", 100);
      return { canceled: false, recoveryFile: recovery.result.file, fileCount: pending.manifest.files.length, totalBytes: pending.manifest.files.reduce((sum, item) => sum + item.size, 0), warnings };
    } catch (error) {
      try {
        await journal.rollback();
        await restoreRecovery(settings, recovery.result.file || recoveryFile);
        for (const [name, contents] of originalSettings) await fsp.writeFile(path.join(home, name), contents, { mode: 0o600 });
      } catch (recoveryError) {
        const detail = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
        throw new Error(`Import failed and automatic recovery also failed: ${detail}`);
      }
      throw error;
    } finally {
      await journal.dispose();
      await fsp.rm(pending.root, { recursive: true, force: true });
      const entries = await fsp.readdir(options.recoveryDir, { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[]);
      await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
        const candidate = path.join(options.recoveryDir, entry.name);
        const stat = await fsp.stat(candidate);
        if (stat.mtimeMs < Date.now() - RECOVERY_RETENTION_MS) await fsp.rm(candidate, { force: true });
      }));
    }
  });
}
