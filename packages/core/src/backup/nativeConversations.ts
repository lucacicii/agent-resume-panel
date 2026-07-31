import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { PanelSettings } from "../settings/types";
import { resolvePreviewHomes } from "../transcript/homes";
import { candidateAgyRoots } from "../transcript/agyRoots";
import { escapeSqlLiteral, runSqlite, runSqliteJson, runSqliteReadOnlyJson } from "../sqlite";

export type NativeConversationProvider =
  | "codex"
  | "claude"
  | "agy"
  | "grok"
  | "opencode"
  | "pi"
  | "cursor"
  | "cursor-ide";

export interface NativeConversationFile {
  relativePath: string;
  absolutePath: string;
  provider: Exclude<NativeConversationProvider, "cursor-ide">;
  size: number;
  mtimeMs: number;
  sha256: string;
}

export interface NativeConversationProviderSummary {
  provider: NativeConversationProvider;
  fileCount: number;
  totalBytes: number;
  /** Native artifact strategy. Omitted by legacy v1/v2 archives. */
  strategy?: string;
  /** Bytes examined from the provider home before exclusions. */
  sourceBytes?: number;
  /** Historical/nonportable bytes deliberately left out of the artifact. */
  excludedBytes?: number;
}

export interface NativeConversationCollection {
  files: NativeConversationFile[];
  providers: NativeConversationProviderSummary[];
  warnings: string[];
}

export interface CollectNativeConversationsOptions {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  opencodeShardTargetBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_OPENCODE_SHARD_TARGET_BYTES = 448 * 1024 * 1024;
const SUPPORTED: Array<Exclude<NativeConversationProvider, "cursor-ide">> = [
  "codex", "claude", "agy", "grok", "opencode", "pi", "cursor"
];
const OPEN_CODE_KEEP_DATA = new Set([
  "project", "project_directory", "workspace", "session", "session_context_epoch",
  "session_input", "session_message", "message", "part", "todo",
  "migration", "data_migration", "__drizzle_migrations"
]);
const OPEN_CODE_SENSITIVE = new Set([
  "account", "control_account", "credential", "account_state", "permission", "session_share", "event", "event_sequence"
]);

type SqlColumn = { name: string; notnull?: number; dflt_value?: string | null; pk?: number };
type OpenCodeSlice = { sessionIds: string[]; messageIds?: Array<{ id: string; timeCreated: number }> };

function sql(value: string): string { return `'${escapeSqlLiteral(value)}'`; }
function quote(value: string): string { return `"${value.replaceAll('"', '""')}"`; }

function toPortableRelative(value: string): string {
  const relative = value.split(path.sep).join("/");
  if (!relative || relative.startsWith("/") || relative.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Native conversation collection produced an unsafe relative path.");
  }
  return relative;
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  const input = await fs.open(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally { await input.close(); }
  return hash.digest("hex");
}

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

async function filesBelow(root: string, include: (relativePath: string) => boolean, maxDepth = 20): Promise<Array<{ absolute: string; relative: string }>> {
  const output: Array<{ absolute: string; relative: string }> = [];
  const rootResolved = path.resolve(root);
  async function visit(directory: string, prefix: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let rows: import("node:fs").Dirent[];
    try { rows = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const row of rows) {
      if (row.isSymbolicLink()) continue;
      const absolute = path.join(directory, row.name);
      const relative = prefix ? path.posix.join(prefix, row.name) : row.name;
      if (!path.resolve(absolute).startsWith(`${rootResolved}${path.sep}`) && path.resolve(absolute) !== rootResolved) throw new Error("Native conversation file escaped its configured Agent home.");
      if (row.isDirectory()) await visit(absolute, relative, depth + 1);
      else if (row.isFile() && include(relative)) output.push({ absolute, relative: toPortableRelative(relative) });
    }
  }
  await visit(rootResolved, "", 0);
  return output;
}

function isAntigravityConversationFile(relative: string): boolean {
  const lower = relative.toLowerCase();
  return lower === "history.jsonl" || (/conversation|history/.test(lower) && /\.(?:jsonl|db|sqlite|sqlite3|pb)$/i.test(lower));
}
function isGrokConversationFile(relative: string): boolean {
  const base = path.posix.basename(relative);
  return base === "summary.json" || base === "chat_history.jsonl";
}
function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
function providerLabel(provider: NativeConversationProvider): string {
  if (provider === "agy") return "Antigravity";
  if (provider === "cursor") return "Cursor CLI";
  if (provider === "cursor-ide") return "Cursor IDE";
  if (provider === "opencode") return "OpenCode";
  return provider[0].toUpperCase() + provider.slice(1);
}

async function addFiles(files: NativeConversationFile[], provider: Exclude<NativeConversationProvider, "cursor-ide">, root: string, candidates: Array<{ absolute: string; relative: string }>, limits: Required<Pick<CollectNativeConversationsOptions, "maxFileBytes" | "maxTotalBytes">>): Promise<void> {
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const candidate of candidates.sort((a, b) => a.relative.localeCompare(b.relative))) {
    const stat = await fs.stat(candidate.absolute);
    if (!stat.isFile()) continue;
    if (stat.size > limits.maxFileBytes) throw new Error(`${providerLabel(provider)} conversation data exceeds the ${formatBytes(limits.maxFileBytes)} per-file limit (${formatBytes(stat.size)}): ${candidate.relative}`);
    const relative = toPortableRelative(path.relative(root, candidate.absolute));
    if (files.some((file) => file.provider === provider && file.relativePath === relative)) continue;
    if (total + stat.size > limits.maxTotalBytes) throw new Error(`${providerLabel(provider)} conversation data would exceed the native backup limit.`);
    files.push({ provider, absolutePath: candidate.absolute, relativePath: relative, size: stat.size, mtimeMs: stat.mtimeMs, sha256: await hashFile(candidate.absolute) });
    total += stat.size;
  }
}

async function tableNames(db: string): Promise<Set<string>> {
  const rows = await runSqliteReadOnlyJson<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table';");
  return new Set(rows.map((row) => row.name));
}
async function columns(db: string, table: string): Promise<SqlColumn[]> {
  return runSqliteReadOnlyJson<SqlColumn>(db, `PRAGMA table_info(${sql(table)});`);
}
function hasColumn(rows: SqlColumn[], name: string): boolean { return rows.some((row) => row.name === name); }
function csv(values: string[]): string { return values.map(sql).join(", "); }

async function compactOpenCodeDatabase(source: string, destination: string, options: { includeArchived: boolean }): Promise<void> {
  await fs.rm(destination, { force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  // VACUUM INTO takes a single consistent SQLite snapshot without changing the source DB.
  await runSqlite(source, `VACUUM INTO ${sql(destination)};`);
  const names = await tableNames(destination);
  if (!names.has("session")) throw new Error("OpenCode schema has no session table.");
  const sessionColumns = await columns(destination, "session");
  if (!hasColumn(sessionColumns, "id")) throw new Error("OpenCode session table has no id column.");
  const archiveColumn = hasColumn(sessionColumns, "time_archived") ? "time_archived" : hasColumn(sessionColumns, "archived") ? "archived" : undefined;
  const sessionPredicate = options.includeArchived || !archiveColumn
    ? "1 = 1"
    : archiveColumn === "archived" ? "COALESCE(archived, 0) = 0" : `${quote(archiveColumn)} IS NULL`;
  const deleteStatements: string[] = [
    "PRAGMA foreign_keys = OFF",
    "CREATE TEMP TABLE _agent_resume_kept_session (id TEXT PRIMARY KEY)",
    `INSERT INTO _agent_resume_kept_session (id) SELECT id FROM session WHERE ${sessionPredicate}`
  ];
  const deleteBySession = ["part", "message", "todo", "session_message", "session_input", "session_context_epoch"];
  for (const table of deleteBySession) if (names.has(table)) deleteStatements.push(`DELETE FROM ${quote(table)} WHERE session_id NOT IN (SELECT id FROM _agent_resume_kept_session)`);
  deleteStatements.push("DELETE FROM session WHERE id NOT IN (SELECT id FROM _agent_resume_kept_session)");
  if (names.has("workspace") && hasColumn(sessionColumns, "workspace_id")) deleteStatements.push("DELETE FROM workspace WHERE id NOT IN (SELECT DISTINCT workspace_id FROM session WHERE workspace_id IS NOT NULL)");
  if (names.has("project") && hasColumn(sessionColumns, "project_id")) deleteStatements.push("DELETE FROM project WHERE id NOT IN (SELECT DISTINCT project_id FROM session)");
  if (names.has("project_directory")) deleteStatements.push("DELETE FROM project_directory WHERE project_id NOT IN (SELECT id FROM project)");
  for (const table of names) {
    if (table.startsWith("sqlite_") || OPEN_CODE_KEEP_DATA.has(table)) continue;
    deleteStatements.push(`DELETE FROM ${quote(table)}`);
  }
  if (hasColumn(sessionColumns, "share_url")) deleteStatements.push("UPDATE session SET share_url = NULL");
  if (hasColumn(sessionColumns, "permission")) deleteStatements.push("UPDATE session SET permission = NULL");
  deleteStatements.push("DROP TABLE _agent_resume_kept_session", "PRAGMA foreign_keys = ON");
  await runSqlite(destination, `${deleteStatements.join(";\n")};`);
  await runSqlite(destination, "VACUUM;");
}

async function sessionRows(db: string): Promise<Array<{ id: string; time_updated?: number; bytes: number }>> {
  const names = await tableNames(db);
  const sessionCols = await columns(db, "session");
  const timestamp = hasColumn(sessionCols, "time_updated") ? quote("time_updated") : hasColumn(sessionCols, "updated_at_ms") ? quote("updated_at_ms") : "0";
  const dataTerms: string[] = [];
  for (const table of ["session", "message", "part", "todo", "session_message", "session_input", "session_context_epoch"]) {
    if (!names.has(table)) continue;
    const cols = await columns(db, table);
    const source = table === "session" ? "s" : "x";
    const relation = table === "session" ? "s.id" : "x.session_id = s.id";
    const textColumns = cols.filter((column) => /^(data|content|prompt|baseline|snapshot|metadata|summary_diffs|revert)$/i.test(column.name)).map((column) => `COALESCE(length(${source}.${quote(column.name)}), 0)`);
    if (textColumns.length) dataTerms.push(`(SELECT COALESCE(SUM(${textColumns.join(" + ")}), 0) FROM ${quote(table)} AS ${source} WHERE ${relation})`);
  }
  const expression = dataTerms.length ? dataTerms.join(" + ") : "0";
  return runSqliteJson<{ id: string; time_updated?: number; bytes: number }>(db, `SELECT s.id, ${timestamp === "0" ? "0" : `s.${timestamp}`} AS time_updated, (${expression}) AS bytes FROM session AS s ORDER BY ${timestamp === "0" ? "0" : `s.${timestamp}`} ASC, s.id ASC;`);
}

async function hasOversizedOpenCodeRow(db: string, sessionId: string, maxBytes: number): Promise<boolean> {
  const names = await tableNames(db);
  for (const table of ["session", "message", "part", "session_message", "session_input", "session_context_epoch", "todo"]) {
    if (!names.has(table)) continue;
    const cols = await columns(db, table);
    const text = cols.find((column) => /^(data|content|prompt|baseline|snapshot|metadata)$/i.test(column.name));
    if (!text) continue;
    const predicate = table === "session" ? `id = ${sql(sessionId)}` : `session_id = ${sql(sessionId)}`;
    const rows = await runSqliteJson<{ largest: number }>(db, `SELECT COALESCE(MAX(length(${quote(text.name)})), 0) AS largest FROM ${quote(table)} WHERE ${predicate};`);
    if (Number(rows[0]?.largest || 0) > maxBytes) return true;
  }
  return false;
}

async function messageGroups(db: string, sessionId: string, target: number): Promise<OpenCodeSlice[]> {
  const names = await tableNames(db);
  if (!names.has("message")) return [];
  const rows = await runSqliteJson<{ id: string; time_created: number; bytes: number }>(db, `SELECT m.id, m.time_created, COALESCE(length(m.data), 0) + COALESCE((SELECT SUM(length(p.data)) FROM part AS p WHERE p.message_id = m.id), 0) AS bytes FROM message AS m WHERE m.session_id = ${sql(sessionId)} ORDER BY m.time_created ASC, m.id ASC;`);
  const groups: OpenCodeSlice[] = [];
  let ids: Array<{ id: string; timeCreated: number }> = [];
  let size = 0;
  for (const row of rows) {
    const next = Math.max(1, Number(row.bytes || 0));
    if (ids.length && size + next > target) { groups.push({ sessionIds: [sessionId], messageIds: ids }); ids = []; size = 0; }
    ids.push({ id: row.id, timeCreated: Number(row.time_created || 0) }); size += next;
  }
  if (ids.length) groups.push({ sessionIds: [sessionId], messageIds: ids });
  return groups;
}

async function buildOpenCodeShard(source: string, destination: string, slice: OpenCodeSlice): Promise<number> {
  await fs.rm(destination, { force: true });
  await runSqlite(source, `VACUUM INTO ${sql(destination)};`);
  const names = await tableNames(destination);
  const statements = ["PRAGMA foreign_keys = OFF", "CREATE TEMP TABLE _agent_resume_selected_session (id TEXT PRIMARY KEY)"];
  for (const id of slice.sessionIds) statements.push(`INSERT INTO _agent_resume_selected_session VALUES (${sql(id)})`);
  for (const table of ["part", "message", "todo", "session_message", "session_input", "session_context_epoch"]) if (names.has(table)) statements.push(`DELETE FROM ${quote(table)} WHERE session_id NOT IN (SELECT id FROM _agent_resume_selected_session)`);
  if (slice.messageIds && names.has("message")) {
    statements.push(`CREATE TEMP TABLE _agent_resume_selected_message (id TEXT PRIMARY KEY)`);
    for (const message of slice.messageIds) statements.push(`INSERT INTO _agent_resume_selected_message VALUES (${sql(message.id)})`);
    statements.push("DELETE FROM message WHERE id NOT IN (SELECT id FROM _agent_resume_selected_message)");
    if (names.has("part")) statements.push("DELETE FROM part WHERE message_id NOT IN (SELECT id FROM _agent_resume_selected_message)");
    const earliest = Math.min(...slice.messageIds.map((message) => message.timeCreated));
    const latest = Math.max(...slice.messageIds.map((message) => message.timeCreated));
    if (names.has("session_message")) statements.push(`DELETE FROM session_message WHERE session_id IN (SELECT id FROM _agent_resume_selected_session) AND (time_created < ${earliest} OR time_created > ${latest})`);
    if (names.has("session_input")) statements.push(`DELETE FROM session_input WHERE session_id IN (SELECT id FROM _agent_resume_selected_session) AND (time_created < ${earliest} OR time_created > ${latest})`);
    statements.push("DROP TABLE _agent_resume_selected_message");
  }
  statements.push("DELETE FROM session WHERE id NOT IN (SELECT id FROM _agent_resume_selected_session)");
  const sessionColumns = await columns(destination, "session");
  if (names.has("workspace") && hasColumn(sessionColumns, "workspace_id")) statements.push("DELETE FROM workspace WHERE id NOT IN (SELECT DISTINCT workspace_id FROM session WHERE workspace_id IS NOT NULL)");
  if (names.has("project") && hasColumn(sessionColumns, "project_id")) statements.push("DELETE FROM project WHERE id NOT IN (SELECT DISTINCT project_id FROM session)");
  if (names.has("project_directory")) statements.push("DELETE FROM project_directory WHERE project_id NOT IN (SELECT id FROM project)");
  for (const table of names) if (!table.startsWith("sqlite_") && !OPEN_CODE_KEEP_DATA.has(table)) statements.push(`DELETE FROM ${quote(table)}`);
  statements.push("DROP TABLE _agent_resume_selected_session", "PRAGMA foreign_keys = ON");
  await runSqlite(destination, `${statements.join(";\n")};`);
  await runSqlite(destination, "VACUUM;");
  return (await fs.stat(destination)).size;
}

async function materializeOpenCodeSlices(source: string, slice: OpenCodeSlice, target: number, maximum: number, stage: string, warnings: string[]): Promise<string[]> {
  const scratch = path.join(stage, `candidate-${createHash("sha1").update(JSON.stringify(slice)).digest("hex")}.db`);
  const size = await buildOpenCodeShard(source, scratch, slice);
  if (size <= maximum) return [scratch];
  await fs.rm(scratch, { force: true });
  if (slice.messageIds && slice.messageIds.length > 1) {
    const midpoint = Math.ceil(slice.messageIds.length / 2);
    return [
      ...await materializeOpenCodeSlices(source, { sessionIds: slice.sessionIds, messageIds: slice.messageIds.slice(0, midpoint) }, target, maximum, stage, warnings),
      ...await materializeOpenCodeSlices(source, { sessionIds: slice.sessionIds, messageIds: slice.messageIds.slice(midpoint) }, target, maximum, stage, warnings)
    ];
  }
  if (slice.sessionIds.length > 1) {
    const midpoint = Math.ceil(slice.sessionIds.length / 2);
    return [
      ...await materializeOpenCodeSlices(source, { sessionIds: slice.sessionIds.slice(0, midpoint) }, target, maximum, stage, warnings),
      ...await materializeOpenCodeSlices(source, { sessionIds: slice.sessionIds.slice(midpoint) }, target, maximum, stage, warnings)
    ];
  }
  if (!slice.messageIds && slice.sessionIds.length === 1) {
    const groups = await messageGroups(source, slice.sessionIds[0], target);
    if (groups.length > 1) {
      const result: string[] = [];
      for (const group of groups) result.push(...await materializeOpenCodeSlices(source, group, target, maximum, stage, warnings));
      return result;
    }
  }
  warnings.push(`Skipped OpenCode session ${slice.sessionIds.join(", ")}: one SQLite record cannot fit within the ${formatBytes(maximum)} limit.`);
  return [];
}

async function buildOpenCodeArtifacts(home: string, destinationRoot: string, limits: Required<CollectNativeConversationsOptions>, files: NativeConversationFile[], warnings: string[]): Promise<NativeConversationProviderSummary> {
  const source = path.join(home, "opencode.db");
  const sourceStat = await fs.stat(source);
  const providerRoot = path.join(destinationRoot, "opencode");
  await fs.mkdir(destinationRoot, { recursive: true });
  const stage = await fs.mkdtemp(path.join(destinationRoot, ".opencode-stage-"));
  try {
    const compact = path.join(stage, "compact.db");
    await compactOpenCodeDatabase(source, compact, { includeArchived: false });
    const compactSize = (await fs.stat(compact)).size;
    const output: Array<{ absolute: string; relative: string }> = [];
    if (compactSize <= limits.maxFileBytes) {
      await fs.mkdir(providerRoot, { recursive: true });
      const target = path.join(providerRoot, "opencode.db");
      await fs.rename(compact, target);
      output.push({ absolute: target, relative: "opencode.db" });
    } else {
      const rows = await sessionRows(compact);
      const valid = [] as typeof rows;
      for (const row of rows) {
        if (await hasOversizedOpenCodeRow(compact, row.id, limits.maxFileBytes)) warnings.push(`Skipped OpenCode session ${row.id}: one SQLite record exceeds the ${formatBytes(limits.maxFileBytes)} limit.`);
        else valid.push(row);
      }
      const groups: OpenCodeSlice[] = [];
      let current: string[] = [];
      let estimated = 0;
      for (const row of valid) {
        const weight = Math.max(1, Number(row.bytes || 0));
        if (current.length && estimated + weight > limits.opencodeShardTargetBytes) { groups.push({ sessionIds: current }); current = []; estimated = 0; }
        current.push(row.id); estimated += weight;
      }
      if (current.length) groups.push({ sessionIds: current });
      const shards: string[] = [];
      for (const group of groups) shards.push(...await materializeOpenCodeSlices(compact, group, limits.opencodeShardTargetBytes, limits.maxFileBytes, stage, warnings));
      await fs.mkdir(path.join(providerRoot, "shards"), { recursive: true });
      for (const [index, shard] of shards.entries()) {
        const name = `${String(index + 1).padStart(4, "0")}.db`;
        const target = path.join(providerRoot, "shards", name);
        await fs.rename(shard, target);
        if ((await fs.stat(target)).size > limits.maxFileBytes) throw new Error(`OpenCode shard exceeds the ${formatBytes(limits.maxFileBytes)} limit: ${name}`);
        output.push({ absolute: target, relative: `shards/${name}` });
      }
    }
    await addFiles(files, "opencode", providerRoot, output, limits);
    const totalBytes = output.length ? (await Promise.all(output.map(async (item) => (await fs.stat(item.absolute)).size))).reduce((sum, value) => sum + value, 0) : 0;
    return { provider: "opencode", fileCount: output.length, totalBytes, strategy: "compact-current-v2", sourceBytes: sourceStat.size, excludedBytes: Math.max(0, sourceStat.size - totalBytes) };
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}

/**
 * Build provider artifacts directly into `destinationRoot`.
 * OpenCode is materialized as a compact, unarchived current-state SQLite snapshot;
 * Grok keeps only final summary/chat files. The source Agent homes are never altered.
 */
export async function buildNativeConversationArtifacts(settings: PanelSettings, destinationRoot: string, options: CollectNativeConversationsOptions = {}): Promise<NativeConversationCollection> {
  const homes = resolvePreviewHomes(settings);
  const limits: Required<CollectNativeConversationsOptions> = {
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    opencodeShardTargetBytes: Math.min(options.opencodeShardTargetBytes ?? DEFAULT_OPENCODE_SHARD_TARGET_BYTES, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)
  };
  const files: NativeConversationFile[] = [];
  const warnings = ["Cursor IDE conversation bodies are not included; Cursor User Data is intentionally not copied."];
  const providerSummaries = new Map<NativeConversationProvider, NativeConversationProviderSummary>();
  const copyProvider = async (provider: Exclude<NativeConversationProvider, "cursor-ide">, home: string, candidates: Array<{ absolute: string; relative: string }>, strategy = "canonical-v1", sourceBytes?: number) => {
    try {
      const before = files.length;
      const targetRoot = path.join(destinationRoot, provider);
      for (const candidate of candidates) {
        const target = path.join(targetRoot, ...candidate.relative.split("/"));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(candidate.absolute, target);
        const stat = await fs.stat(candidate.absolute);
        await fs.utimes(target, stat.atime, stat.mtime);
      }
      await addFiles(files, provider, targetRoot, (await filesBelow(targetRoot, () => true)).map((item) => ({ absolute: item.absolute, relative: item.relative })), limits);
      const added = files.slice(before).filter((file) => file.provider === provider);
      const totalBytes = added.reduce((sum, file) => sum + file.size, 0);
      providerSummaries.set(provider, { provider, fileCount: added.length, totalBytes, strategy, sourceBytes: sourceBytes ?? totalBytes, excludedBytes: Math.max(0, (sourceBytes ?? totalBytes) - totalBytes) });
    } catch (error) {
      warnings.push(`${providerLabel(provider)} native conversation backup skipped: ${error instanceof Error ? error.message : String(error)}`);
      providerSummaries.set(provider, { provider, fileCount: 0, totalBytes: 0, strategy, sourceBytes: sourceBytes ?? 0, excludedBytes: sourceBytes ?? 0 });
    }
  };

  await copyProvider("codex", homes.codexHome, [
    ...(await filesBelow(path.join(homes.codexHome, "sessions"), (relative) => relative.endsWith(".jsonl")).then((items) => items.map((item) => ({ absolute: item.absolute, relative: path.posix.join("sessions", item.relative) })))),
    ...(await filesBelow(path.join(homes.codexHome, "archived_sessions"), (relative) => relative.endsWith(".jsonl")).then((items) => items.map((item) => ({ absolute: item.absolute, relative: path.posix.join("archived_sessions", item.relative) })))),
    ...(await exists(path.join(homes.codexHome, "session_index.jsonl")) ? [{ absolute: path.join(homes.codexHome, "session_index.jsonl"), relative: "session_index.jsonl" }] : [])
  ]);
  await copyProvider("claude", homes.claudeHome, [
    ...(await filesBelow(path.join(homes.claudeHome, "projects"), (relative) => relative.endsWith(".jsonl")).then((items) => items.map((item) => ({ absolute: item.absolute, relative: path.posix.join("projects", item.relative) })))),
    ...(await exists(path.join(homes.claudeHome, "history.jsonl")) ? [{ absolute: path.join(homes.claudeHome, "history.jsonl"), relative: "history.jsonl" }] : [])
  ]);
  const agyRoot = (await Promise.all(candidateAgyRoots(homes.antigravityHome).map(async (root) => ({ root, available: await exists(root) })))).find((item) => item.available)?.root;
  await copyProvider("agy", homes.antigravityHome, agyRoot ? await filesBelow(agyRoot, isAntigravityConversationFile, 10) : []);

  const grokAll = await filesBelow(path.join(homes.grokHome, "sessions"), () => true, 12);
  const grokCandidates = grokAll.filter((item) => isGrokConversationFile(item.relative)).map((item) => ({ absolute: item.absolute, relative: path.posix.join("sessions", item.relative) }));
  const grokSourceBytes = (await Promise.all(grokAll.map(async (item) => (await fs.stat(item.absolute)).size))).reduce((sum, value) => sum + value, 0);
  await copyProvider("grok", homes.grokHome, grokCandidates, "final-chat-v2", grokSourceBytes);

  try { if (await exists(path.join(homes.opencodeHome, "opencode.db"))) providerSummaries.set("opencode", await buildOpenCodeArtifacts(homes.opencodeHome, destinationRoot, limits, files, warnings)); else providerSummaries.set("opencode", { provider: "opencode", fileCount: 0, totalBytes: 0, strategy: "compact-current-v2", sourceBytes: 0, excludedBytes: 0 }); }
  catch (error) { warnings.push(`OpenCode native conversation backup skipped: ${error instanceof Error ? error.message : String(error)}`); providerSummaries.set("opencode", { provider: "opencode", fileCount: 0, totalBytes: 0, strategy: "compact-current-v2", sourceBytes: 0, excludedBytes: 0 }); }

  await copyProvider("pi", homes.piHome, await filesBelow(path.join(homes.piHome, "sessions"), (relative) => relative.endsWith(".jsonl"), 12).then((items) => items.map((item) => ({ absolute: item.absolute, relative: path.posix.join("sessions", item.relative) }))));
  await copyProvider("cursor", homes.cursorHome, [
    ...(await filesBelow(path.join(homes.cursorHome, "chats"), (relative) => relative.endsWith("meta.json"), 12).then((items) => items.map((item) => ({ absolute: item.absolute, relative: path.posix.join("chats", item.relative) })))),
    ...(await filesBelow(path.join(homes.cursorHome, "projects"), (relative) => relative.includes("agent-transcripts/") && relative.endsWith(".jsonl"), 14).then((items) => items.map((item) => ({ absolute: item.absolute, relative: path.posix.join("projects", item.relative) }))))
  ]);

  const providers = [...SUPPORTED.map((provider) => providerSummaries.get(provider) || { provider, fileCount: 0, totalBytes: 0 }), { provider: "cursor-ide" as const, fileCount: 0, totalBytes: 0, strategy: "excluded-v1", sourceBytes: 0, excludedBytes: 0 }];
  return { files, providers, warnings: [...new Set(warnings)] };
}

