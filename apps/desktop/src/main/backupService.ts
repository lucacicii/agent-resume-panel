import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, createHash } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { Readable } from "node:stream";
import {
  effectivePanelHome,
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
  NotesStore,
  runSqlite,
  runSqliteJson,
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

const scrypt = promisify(scryptCallback);
const FORMAT_VERSION = 1;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
const MANIFEST_PATH = "manifest.json";
const PAYLOAD_ROOT = "payload";
const CREDENTIALS_PATH = "credentials.enc";
const RECOVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type BackupFile = {
  path: string;
  size: number;
  mtimeMs: number;
  sha256: string;
};

type BackupManifest = {
  formatVersion: number;
  createdAtMs: number;
  appVersion: string;
  credentialsEncrypted: boolean;
  files: BackupFile[];
};

export type BackupPreview = {
  importToken: string;
  createdAtMs: number;
  appVersion: string;
  fileCount: number;
  totalBytes: number;
  credentialsEncrypted: boolean;
};

export type BackupResult = {
  canceled: boolean;
  file?: string;
  fileCount?: number;
  totalBytes?: number;
  recoveryFile?: string;
  warnings?: string[];
};

type PendingImport = { root: string; manifest: BackupManifest; expiresAt: number };
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
  agent_threads: { keys: ["id"], timestamp: "updated_at_ms" },
  session_execution_notes: { keys: ["provider", "agent_session_id"], timestamp: "updated_at_ms" }
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

async function encryptCredentials(value: Record<string, unknown>, password: string): Promise<Buffer> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scrypt(password, salt, 32) as Buffer;
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.from(JSON.stringify({ version: 1, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }), "utf8");
}

async function decryptCredentials(value: Buffer, password: string): Promise<Record<string, unknown>> {
  const payload = JSON.parse(value.toString("utf8")) as { salt: string; iv: string; tag: string; ciphertext: string };
  const key = await scrypt(password, Buffer.from(payload.salt, "base64"), 32) as Buffer;
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
    if (/(api.?key|token|secret|password)/i.test(key)) {
      nextRecord[key] = value;
    } else if (key in nextRecord) {
      nextRecord[key] = preserveCredentials(nextRecord[key], value);
    }
  }
  return nextRecord;
}

async function writeZip(destination: string, files: Array<{ absolute: string; archivePath: string }>, manifest: BackupManifest, credentials?: Buffer): Promise<void> {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const zip = new yazl.ZipFile();
  for (const file of files) zip.addFile(file.absolute, file.archivePath);
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), MANIFEST_PATH);
  if (credentials) zip.addBuffer(credentials, CREDENTIALS_PATH);
  const output = fs.createWriteStream(destination, { flags: "w", mode: 0o600 });
  const done = pipeline(zip.outputStream as Readable, output);
  zip.end();
  await done;
}

async function createArchive(settings: PanelSettings, destination: string, appVersion: string, includeCredentials: boolean, password?: string): Promise<BackupResult> {
  const home = effectivePanelHome(settings);
  const paths = await loadPanelDbPaths(settings);
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-resume-backup-"));
  try {
    const payload = path.join(stage, PAYLOAD_ROOT);
    await snapshotDatabase(paths.catalogDb, path.join(payload, "catalog.db"));
    await snapshotDatabase(paths.desktopDb, path.join(payload, ".desktop", "desktop.db"));
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
        await fsp.writeFile(path.join(payload, name), `${JSON.stringify(stripCredentials(parsed), null, 2)}\n`, "utf8");
      } catch {
        await fsp.copyFile(source, path.join(payload, name));
      }
    }
    const entries = await walk(payload);
    const files: BackupFile[] = await Promise.all(entries.map(async (entry) => {
      const stat = await fsp.stat(entry.absolute);
      return { path: `${PAYLOAD_ROOT}/${entry.relative}`, size: stat.size, mtimeMs: stat.mtimeMs, sha256: await sha256(entry.absolute) };
    }));
    const manifest: BackupManifest = { formatVersion: FORMAT_VERSION, createdAtMs: Date.now(), appVersion, credentialsEncrypted: includeCredentials, files };
    const credentials = includeCredentials ? await encryptCredentials(originals, password || "") : undefined;
    await writeZip(destination, entries.map((entry) => ({ absolute: entry.absolute, archivePath: `${PAYLOAD_ROOT}/${entry.relative}` })), manifest, credentials);
    return { canceled: false, file: destination, fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.size, 0) };
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
  }
}

function safeArchivePath(name: string): string {
  if (!name || name.includes("\\") || path.posix.isAbsolute(name) || name.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Archive contains an unsafe path.");
  if (name !== MANIFEST_PATH && name !== CREDENTIALS_PATH && !name.startsWith(`${PAYLOAD_ROOT}/`)) throw new Error("Archive contains an unexpected file.");
  return name;
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
    if (manifest.formatVersion !== FORMAT_VERSION || !Array.isArray(manifest.files)) throw new Error("Unsupported backup format.");
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
    await fsp.writeFile(path.join(destination, "sessions.jsonl"), `${[...sessions.values()].map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
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
      await fsp.writeFile(target, `${values.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
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
      await fsp.writeFile(target, `${JSON.stringify(original, null, 2)}\n`, "utf8");
      continue;
    }
    try {
      const imported = JSON.parse(await fsp.readFile(source, "utf8")) as unknown;
      const existing = await fsp.readFile(target, "utf8").then((raw) => JSON.parse(raw) as unknown).catch(() => undefined);
      await fsp.writeFile(target, `${JSON.stringify(preserveCredentials(imported, existing), null, 2)}\n`, "utf8");
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

function prunePendingImports(): void {
  const now = Date.now();
  for (const [token, item] of pendingImports) {
    if (item.expiresAt > now) continue;
    pendingImports.delete(token);
    void fsp.rm(item.root, { recursive: true, force: true });
  }
}

export async function exportBackup(settings: PanelSettings, destination: string, appVersion: string, options: { includeCredentials: boolean; password?: string }): Promise<BackupResult> {
  if (options.includeCredentials && !options.password) throw new Error("A password is required when including API keys.");
  return withExclusive(() => createArchive(settings, destination, appVersion, options.includeCredentials, options.password));
}

export async function selectBackupForImport(file: string): Promise<BackupPreview> {
  return withExclusive(async () => {
    prunePendingImports();
    const extracted = await extractArchive(file);
    const token = newToken();
    pendingImports.set(token, { ...extracted, expiresAt: Date.now() + 10 * 60 * 1000 });
    return { importToken: token, createdAtMs: extracted.manifest.createdAtMs, appVersion: extracted.manifest.appVersion, fileCount: extracted.manifest.files.length, totalBytes: extracted.manifest.files.reduce((sum, item) => sum + item.size, 0), credentialsEncrypted: extracted.manifest.credentialsEncrypted };
  });
}

export async function importBackup(settings: PanelSettings, importToken: string, appVersion: string, options: { includeCredentials: boolean; password?: string; recoveryDir: string }): Promise<BackupResult> {
  return withExclusive(async () => {
    prunePendingImports();
    const pending = pendingImports.get(importToken);
    if (!pending || pending.expiresAt <= Date.now()) throw new Error("The selected backup expired. Select it again.");
    pendingImports.delete(importToken);
    const home = effectivePanelHome(settings);
    const recoveryFile = path.join(options.recoveryDir, `before-import-${new Date().toISOString().replaceAll(":", "-")}.zip`);
    await fsp.mkdir(options.recoveryDir, { recursive: true });
    const recovery = await createArchive(settings, recoveryFile, appVersion, false);
    const originalSettings = new Map<string, Buffer>();
    for (const name of ["settings.json", "settings.desktop.json"]) {
      const source = path.join(home, name);
      if (await exists(source)) originalSettings.set(name, await fsp.readFile(source));
    }
    const paths = await loadPanelDbPaths(settings);
    try {
      await ensureExtensionCatalogSchema(paths.catalogDb);
      await ensureDesktopDbSchema(paths.desktopDb);
      const payload = path.join(pending.root, PAYLOAD_ROOT);
      await mergeDatabase(paths.catalogDb, path.join(payload, "catalog.db"), CATALOG_UPDATED_TABLES, CATALOG_APPEND_TABLES);
      await mergeDatabase(paths.desktopDb, path.join(payload, ".desktop", "desktop.db"), DESKTOP_UPDATED_TABLES, DESKTOP_APPEND_TABLES);
      await mergeTree(path.join(payload, "notes"), path.join(home, "notes"), pending.manifest, `${PAYLOAD_ROOT}/notes`);
      await mergeTree(path.join(payload, ".desktop", "scratch"), path.join(home, ".desktop", "scratch"), pending.manifest, `${PAYLOAD_ROOT}/.desktop/scratch`);
      await mergeAcp(path.join(payload, "acp"), path.join(home, "acp"), pending.manifest);
      await maybeApplySettings(home, pending.root, pending.manifest, options.includeCredentials, options.password);
      const notes = new NotesStore(paths.catalogDb, home);
      await notes.initialize();
      return { canceled: false, recoveryFile: recovery.file, fileCount: pending.manifest.files.length, totalBytes: pending.manifest.files.reduce((sum, item) => sum + item.size, 0) };
    } catch (error) {
      try {
        await restoreRecovery(settings, recoveryFile);
        for (const [name, contents] of originalSettings) {
          await fsp.writeFile(path.join(home, name), contents, { mode: 0o600 });
        }
      } catch (recoveryError) {
        const detail = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
        throw new Error(`Import failed and automatic recovery also failed: ${detail}`);
      }
      throw error;
    } finally {
      await fsp.rm(pending.root, { recursive: true, force: true });
      const entries = await fsp.readdir(options.recoveryDir, { withFileTypes: true }).catch(() => []);
      await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
        const candidate = path.join(options.recoveryDir, entry.name);
        const stat = await fsp.stat(candidate);
        if (stat.mtimeMs < Date.now() - RECOVERY_RETENTION_MS) await fsp.rm(candidate, { force: true });
      }));
    }
  });
}
