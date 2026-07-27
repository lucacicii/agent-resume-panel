import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentSession, AgentProvider } from "./catalog/types";
import {
  ensureCatalogSyncStateDesktop,
  ensureExtensionCatalogSchema,
  syncStateHasExtendedColumns
} from "./catalog/db";
import { syncAcpRecordsIntoCatalog, type AcpCatalogRecordInput } from "./catalog/acpCatalog";
import { purgeRetiredAlmaCatalog } from "./catalog/mutations";
import { reconcileProjectsFromSessions } from "./catalog/projects";
import { escapeSqlLiteral, runSqliteJson, runSqliteReadOnlyJson, runSqliteTransaction } from "./sqlite";
import { AgentHomesSettings, PanelSettings, SessionSyncStalePolicy } from "./settings/types";
import { catalogDbFromSettings } from "./settings/store";
import { agentHomeDiffersFromDefault, AgentHomeKey, resolvePreviewHomes } from "./transcript/homes";
import { candidateAgyRoots } from "./transcript/agyRoots";
import { listJsonlFiles, findFilesByName } from "./transcript/fs";
import { findCursorTranscriptFile, listCursorChatMetas } from "./transcript/cursor";

export type SyncableAgentProvider = Exclude<AgentProvider, "chat">;

export type CatalogSchemaMode = "extension" | "desktop";

export interface AgentSessionSyncOptions {
  dbPath: string;
  panelHome: string;
  /** Desktop sync uses the full schema; extension paths stay on the frozen subset. */
  catalogSchema?: CatalogSchemaMode;
  codexHome: string;
  claudeHome: string;
  antigravityHome: string;
  grokHome: string;
  opencodeHome: string;
  piHome: string;
  cursorHome: string;
  cursorIdeUserDataHome: string;
  configuredAgentHomes?: AgentHomesSettings;
  maxItems: number;
  stalePolicy: SessionSyncStalePolicy;
  showArchivedCodex: boolean;
  showArchivedOpenCode: boolean;
  showSubagentCodex: boolean;
  showSubagentGrok: boolean;
  showArchivedCursorIde: boolean;
  showSubagentCursorIde: boolean;
}

export interface AgentSessionProviderSyncResult {
  provider: SyncableAgentProvider;
  status: "ok" | "warning" | "error";
  sessionCount: number;
  warning?: string;
  syncedAt: number;
}

export interface AgentSessionSyncResult {
  sessions: AgentSession[];
  sessionCount: number;
  providers: AgentSessionProviderSyncResult[];
  warnings: string[];
  syncedAt: number;
}

interface LoadedSession extends AgentSession {
  transcriptKind?: string;
  transcriptRefs?: string;
}

interface ProviderLoadResult {
  provider: SyncableAgentProvider;
  sessions: LoadedSession[];
  warning?: string;
  failed?: boolean;
}

const PROVIDERS: SyncableAgentProvider[] = ["codex", "claude", "agy", "grok", "opencode", "pi", "cursor", "cursor-ide"];
const textCache = new Map<string, { mtimeMs: number; size: number; value: string }>();
const listCache = new Map<string, { expiresAt: number; value: string[] }>();
const syncTasks = new Map<string, Promise<AgentSessionSyncResult>>();
const BATCH_SIZE = 80;

export function sessionSyncOptionsFromSettings(
  settings: PanelSettings,
  overrides: Partial<AgentSessionSyncOptions> = {}
): AgentSessionSyncOptions {
  const homes = resolvePreviewHomes(settings);
  const sync = settings.sessionSync || {};
  return {
    dbPath: catalogDbFromSettings(settings),
    ...homes,
    configuredAgentHomes: settings.agentHomes,
    maxItems: clamp(sync.maxItems ?? 10_000, 1, 50_000),
    stalePolicy: normalizeStalePolicy(sync.stalePolicy),
    showArchivedCodex: sync.showArchivedCodex === true,
    showArchivedOpenCode: sync.showArchivedOpenCode === true,
    showSubagentCodex: sync.showSubagentCodex === true,
    showSubagentGrok: sync.showSubagentGrok === true,
    showArchivedCursorIde: sync.showArchivedCursorIde === true,
    showSubagentCursorIde: sync.showSubagentCursorIde === true,
    catalogSchema: "desktop",
    ...overrides
  };
}

export async function loadAllAgentSessions(options: AgentSessionSyncOptions): Promise<AgentSessionSyncResult> {
  const syncedAt = Date.now();
  const settled = await Promise.all(
    PROVIDERS.map(async (provider) => {
      try {
        return await loadProvider(provider, options);
      } catch (error) {
        return {
          provider,
          sessions: [],
          warning: `${label(provider)} scan failed. ${formatError(error)}`,
          failed: true
        };
      }
    })
  );
  const sessions = settled
    .flatMap((item) => item.sessions)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, options.maxItems);
  const providers = settled.map((item) => ({
    provider: item.provider,
    status: "failed" in item && item.failed ? "error" as const : item.warning ? "warning" as const : "ok" as const,
    sessionCount: sessions.filter((session) => session.provider === item.provider).length,
    warning: item.warning,
    syncedAt
  }));
  return {
    sessions,
    sessionCount: sessions.length,
    providers,
    warnings: providers.flatMap((item) => item.warning ? [item.warning] : []),
    syncedAt
  };
}

export function syncAgentSessions(options: AgentSessionSyncOptions): Promise<AgentSessionSyncResult> {
  const key = `${options.dbPath}\0${JSON.stringify(options)}`;
  const existing = syncTasks.get(key);
  if (existing) return existing;
  const task = performSync(options).finally(() => syncTasks.delete(key));
  syncTasks.set(key, task);
  return task;
}

async function performSync(options: AgentSessionSyncOptions): Promise<AgentSessionSyncResult> {
  await ensureExtensionCatalogSchema(options.dbPath);
  if (options.catalogSchema === "desktop") {
    await ensureCatalogSyncStateDesktop(options.dbPath);
  }
  const result = await loadAllAgentSessions(options);
  const loaded = result.sessions as LoadedSession[];
  for (const providerResult of result.providers) {
    const providerSessions = loaded.filter((session) => session.provider === providerResult.provider);
    if (providerResult.status !== "error") {
      await upsertProvider(options.dbPath, providerResult.provider, providerSessions, result.syncedAt);
      await applyProviderStalePolicy(options.dbPath, providerResult.provider, options.stalePolicy, result.syncedAt);
    }
    await writeSyncState(options.dbPath, providerResult);
  }
  // Alma support removed: hard-delete leftover Alma catalog rows and Alma-only projects.
  await purgeRetiredAlmaCatalog(options.dbPath);

  // ACP chats: dual-index into catalog from panelHome/acp JSONL (messages stay file-backed).
  try {
    const acpRecords = await loadAcpCatalogRecords(options.panelHome, options.maxItems);
    const acpCount = await syncAcpRecordsIntoCatalog(
      options.dbPath,
      options.panelHome,
      acpRecords,
      result.syncedAt
    );
    if (acpCount > 0) {
      result.sessionCount += acpCount;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.warnings.push(`ACP catalog sync failed. ${message}`);
  }

  try {
    await reconcileProjectsFromSessions(options.dbPath);
  } catch (error) {
    // Project reconcile must not fail session sync; surface via warning list.
    const message = error instanceof Error ? error.message : String(error);
    result.warnings.push(`Project reconcile failed. ${message}`);
  }
  return result;
}

/** Read panelHome/acp/sessions.jsonl into catalog upsert inputs. */
async function loadAcpCatalogRecords(panelHome: string, maxItems: number): Promise<AcpCatalogRecordInput[]> {
  const file = path.join(panelHome, "acp", "sessions.jsonl");
  if (!(await fileExists(file))) {
    return [];
  }
  let raw = "";
  try {
    raw = await readCachedText(file);
  } catch {
    return [];
  }
  const byId = new Map<string, AcpCatalogRecordInput>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as {
        id?: string;
        title?: string;
        projectPath?: string;
        provider?: string;
        updatedAt?: number;
        messageCount?: number;
      };
      if (!row.id) continue;
      byId.set(row.id, {
        id: row.id,
        title: row.title || row.id,
        projectPath: row.projectPath || panelHome,
        acpProvider: row.provider || "claude",
        updatedAt: Number(row.updatedAt) || Date.now(),
        messageCount: row.messageCount,
        model: row.provider || undefined
      });
    } catch {
      /* skip malformed */
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, maxItems));
}

async function loadProvider(provider: SyncableAgentProvider, options: AgentSessionSyncOptions): Promise<ProviderLoadResult> {
  const home = providerHome(provider, options);
  if (!await fileExists(home)) {
    const configured = isConfiguredAgentHome(provider, options);
    return {
      provider,
      sessions: [],
      warning: configured ? `${label(provider)} data directory not found at ${home}.` : undefined,
      failed: false
    };
  }
  switch (provider) {
    case "codex": return loadCodex(options);
    case "claude": return { provider, sessions: await loadClaude(options.claudeHome, options.maxItems) };
    case "agy": return { provider, sessions: await loadAgy(options.antigravityHome, options.maxItems) };
    case "grok": return { provider, sessions: await loadGrok(options.grokHome, options.maxItems, options.showSubagentGrok) };
    case "opencode": return loadOpenCode(options);
    case "pi": return { provider, sessions: await loadPi(options.piHome, options.maxItems) };
    case "cursor": return { provider, sessions: await loadCursor(options.cursorHome, options.maxItems) };
    case "cursor-ide": return { provider, sessions: await loadCursorIde(options) };
  }
}

async function upsertProvider(dbPath: string, provider: SyncableAgentProvider, sessions: LoadedSession[], syncTime: number): Promise<void> {
  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    await runSqliteTransaction(dbPath, sessions.slice(i, i + BATCH_SIZE).map((session) => `INSERT INTO sessions (
      provider, agent_session_id, title, project_path, updated_at_ms, archived, message_count, model, branch,
      source, hidden, last_synced_at_ms, transcript_kind, transcript_refs
    ) VALUES (${sql(session.provider)}, ${sql(session.id)}, ${sql(session.title)}, ${sql(session.projectPath)},
      ${Math.floor(session.updatedAt || 0)}, ${session.archived ? 1 : 0}, ${numberOrNull(session.messageCount)},
      ${nullable(session.model)}, ${nullable(session.branch)}, ${nullable(session.source)}, 0, ${syncTime},
      ${nullable(session.transcriptKind)}, ${nullable(session.transcriptRefs)})
    ON CONFLICT(provider, agent_session_id) DO UPDATE SET
      title=excluded.title, project_path=excluded.project_path, updated_at_ms=excluded.updated_at_ms,
      archived=excluded.archived, message_count=excluded.message_count, model=excluded.model,
      branch=excluded.branch, source=excluded.source, last_synced_at_ms=excluded.last_synced_at_ms,
      transcript_kind=excluded.transcript_kind, transcript_refs=excluded.transcript_refs`));
  }
}

function normalizeStalePolicy(value: SessionSyncStalePolicy | "hide" | undefined): SessionSyncStalePolicy {
  return value === "purge" ? "purge" : "off";
}

async function applyProviderStalePolicy(dbPath: string, provider: SyncableAgentProvider, policy: SessionSyncStalePolicy, syncTime: number): Promise<void> {
  // Cursor's local stores are intentionally version-gated and may omit history
  // while the app is running. Never let a partial read purge prior catalog rows.
  if (policy !== "purge" || provider === "cursor" || provider === "cursor-ide") {
    return;
  }
  const where = `provider=${sql(provider)} AND (last_synced_at_ms IS NULL OR last_synced_at_ms < ${syncTime})`;
  await runSqliteTransaction(dbPath, [`DELETE FROM sessions WHERE ${where}`]);
}

async function writeSyncState(dbPath: string, result: AgentSessionProviderSyncResult): Promise<void> {
  const extended = await syncStateHasExtendedColumns(dbPath);
  if (extended) {
    await runSqliteTransaction(dbPath, [`INSERT INTO sync_state(provider,last_sync_at_ms,status,session_count,warning)
      VALUES(${sql(result.provider)},${result.syncedAt},${sql(result.status)},${result.sessionCount},${nullable(result.warning)})
      ON CONFLICT(provider) DO UPDATE SET last_sync_at_ms=excluded.last_sync_at_ms,status=excluded.status,
      session_count=excluded.session_count,warning=excluded.warning`]);
    return;
  }

  await runSqliteTransaction(dbPath, [`INSERT INTO sync_state(provider,last_sync_at_ms)
    VALUES(${sql(result.provider)},${result.syncedAt})
    ON CONFLICT(provider) DO UPDATE SET last_sync_at_ms=excluded.last_sync_at_ms`]);
}

async function loadCodex(options: AgentSessionSyncOptions): Promise<ProviderLoadResult> {
  const dbFiles = (await safeReadDir(options.codexHome)).filter((name) => /^state_\d+\.sqlite$/.test(name));
  const stats = await Promise.all(dbFiles.map(async (name) => ({ file: path.join(options.codexHome, name), mtime: await mtime(path.join(options.codexHome, name)) })));
  const dbPath = stats.sort((a, b) => b.mtime - a.mtime)[0]?.file;
  if (!dbPath) {
    const rows = await readCachedJsonLinesSafe<{ id?: string; thread_name?: string; updated_at?: string }>(path.join(options.codexHome, "session_index.jsonl"));
    return { provider: "codex", warning: rows.length ? "Codex state database was not found; used session_index.jsonl." : "Codex state database and session index were not found.", failed: !rows.length,
      sessions: rows.filter((row) => row.id).slice(-options.maxItems).map((row) => session("codex", row.id!, row.thread_name || row.id!, os.homedir(), Date.parse(row.updated_at || "") || 0)) };
  }
  const clauses = [!options.showArchivedCodex ? "archived=0" : "", !options.showSubagentCodex ? "(source IS NULL OR instr(source,'subagent')=0)" : ""].filter(Boolean);
  const rows = await runSqliteJson<any>(dbPath, `SELECT id,title,cwd,updated_at_ms,updated_at,model,git_branch,archived,source,preview,first_user_message FROM threads ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY coalesce(updated_at_ms,updated_at*1000) DESC LIMIT ${options.maxItems}`);
  const rollouts = await cachedFiles(`codex:${options.codexHome}`, async () => [...await listJsonlFiles(path.join(options.codexHome, "sessions")), ...await listJsonlFiles(path.join(options.codexHome, "archived_sessions"))]);
  return { provider: "codex", sessions: rows.filter((row) => row.id).map((row) => {
    const files = rollouts.filter((file) => path.basename(file).includes(row.id));
    return session("codex", row.id, first(row.title, row.preview, row.first_user_message, row.id), first(row.cwd, os.homedir()), Number(row.updated_at_ms ?? ((row.updated_at || 0) * 1000)), {
      model: row.model || undefined, branch: row.git_branch || undefined, source: row.source || undefined, archived: !!row.archived,
      transcriptKind: files.length ? "jsonl" : "unavailable", transcriptRefs: JSON.stringify(files.length ? { kind: "jsonl", paths: files } : { kind: "unavailable", reason: "Codex rollout file not indexed" })
    });
  }) };
}

async function loadClaude(home: string, maxItems: number): Promise<LoadedSession[]> {
  const byId = new Map<string, LoadedSession>();
  for (const row of await readCachedJsonLinesSafe<any>(path.join(home, "history.jsonl"))) if (row.sessionId) mergeLatest(byId, session("claude", row.sessionId, clean(row.display) || row.sessionId, row.project || os.homedir(), Number(row.timestamp || 0), { source: "history" }));
  const files = await cachedFiles(`claude:${home}`, () => listJsonlFiles(path.join(home, "projects")));
  for (const file of files) {
    const rows = await readCachedJsonLines<any>(file); let id = path.basename(file, ".jsonl"), title = "", cwd = "", updated = 0, branch: string | undefined, model: string | undefined;
    for (const row of rows) { id = row.sessionId || id; cwd = row.cwd || cwd; branch = row.gitBranch || branch; model = row.version || model; updated = Math.max(updated, Date.parse(row.timestamp || "") || 0); if (!title && row.type === "ai-title") title = row.aiTitle || ""; if (!title && row.type === "user") title = contentText(row.message?.content); }
    mergeLatest(byId, session("claude", id, clean(title) || id, cwd || claudePath(file), updated, { branch, model, source: "project", transcriptKind: "jsonl", transcriptRefs: JSON.stringify({ kind: "jsonl", paths: [file] }) }));
  }
  return [...byId.values()].sort(byUpdated).slice(0, maxItems);
}

async function loadAgy(home: string, maxItems: number): Promise<LoadedSession[]> {
  const byId = new Map<string, LoadedSession>();
  for (const root of candidateAgyRoots(home)) {
    const historyPath = path.join(root, "history.jsonl");
    for (const row of await readCachedJsonLinesSafe<any>(historyPath)) if (row.conversationId) mergeLatest(byId, session("agy", row.conversationId, clean(row.display) || row.conversationId, row.workspace || os.homedir(), Number(row.timestamp || 0), { source: "history", transcriptKind: "jsonl", transcriptRefs: JSON.stringify({ kind: "jsonl", paths: [historyPath] }) }));
    try { const last = JSON.parse(await readCachedText(path.join(root, "cache", "last_conversations.json"))) as Record<string,string>; for (const [cwd,id] of Object.entries(last)) if (id && !byId.has(id)) byId.set(id, session("agy", id, path.basename(cwd) || id, cwd, await newestMtime([path.join(root,"conversations",`${id}.db`),path.join(root,"conversations",`${id}.pb`)]), { source: "last_conversations", transcriptKind: "unavailable", transcriptRefs: JSON.stringify({ kind: "unavailable", reason: "Antigravity metadata only" }) })); } catch { /* optional cache */ }
  }
  return [...byId.values()].sort(byUpdated).slice(0, maxItems);
}

async function loadGrok(home: string, maxItems: number, showSubagents: boolean): Promise<LoadedSession[]> {
  const summaries = await cachedFiles(`grok:${home}`, () => findFilesByName(path.join(home, "sessions"), "summary.json"));
  const out: LoadedSession[] = [];
  for (const file of summaries) try { const row = JSON.parse(await readCachedText(file)); const title = clean(row.generated_title) || clean(row.session_summary); if (!title && (row.num_chat_messages || 0) <= 1) continue; if (!showSubagents && row.session_kind === "subagent") continue; const id = row.info?.id || path.basename(path.dirname(file)); const chat = path.join(path.dirname(file), "chat_history.jsonl"); const exists = await fileExists(chat); out.push(session("grok", id, title || id, row.info?.cwd || await grokCwd(file) || os.homedir(), Date.parse(row.updated_at || row.last_active_at || "") || await mtime(file), { model: row.current_model_id, branch: row.head_branch, messageCount: row.num_chat_messages, source: "summary", transcriptKind: exists ? "jsonl" : "unavailable", transcriptRefs: JSON.stringify(exists ? { kind: "jsonl", paths: [chat] } : { kind: "unavailable", reason: "Grok chat history not found" }) })); } catch { /* skip malformed summary */ }
  return out.sort(byUpdated).slice(0, maxItems);
}

async function loadOpenCode(options: AgentSessionSyncOptions): Promise<ProviderLoadResult> {
  const dbPath = path.join(options.opencodeHome, "opencode.db");
  if (!await fileExists(dbPath)) return { provider: "opencode", sessions: [], warning: `OpenCode database not found at ${dbPath}.`, failed: true };
  const rows = await runSqliteJson<any>(dbPath, `SELECT id,directory,title,time_updated,time_archived,model FROM session ${options.showArchivedOpenCode ? "" : "WHERE time_archived IS NULL"} ORDER BY time_updated DESC LIMIT ${options.maxItems}`);
  return { provider: "opencode", sessions: rows.filter((row) => row.id).map((row) => session("opencode", row.id, clean(row.title) || row.id, row.directory || os.homedir(), Number(row.time_updated || 0), { archived: row.time_archived != null, model: parseOpenCodeModel(row.model), source: "sqlite", transcriptKind: "sqlite", transcriptRefs: JSON.stringify({ kind: "sqlite", dbPath, dialect: "opencode", sessionId: row.id }) })) };
}

async function loadCursor(home: string, maxItems: number): Promise<LoadedSession[]> {
  const chats = await listCursorChatMetas(home, maxItems);
  return Promise.all(chats.map(async (chat) => {
    const transcript = await findCursorTranscriptFile(home, chat.id);
    return session("cursor", chat.id, clean(chat.title) || chat.id, chat.cwd || os.homedir(), chat.updatedAt, {
      source: "cursor-cli-meta-v1",
      archived: false,
      transcriptKind: transcript ? "jsonl" : "unavailable",
      transcriptRefs: JSON.stringify(transcript
        ? { kind: "jsonl", paths: [transcript] }
        : { kind: "unavailable", reason: "Cursor CLI transcript not found" })
    });
  }));
}

interface CursorIdeHeaderRow {
  id?: string;
  workspaceId?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  recency?: number;
  archived?: number;
  subagent?: number;
  title?: string;
  subtitle?: string;
}

async function loadCursorIde(options: AgentSessionSyncOptions): Promise<LoadedSession[]> {
  const dbPath = path.join(options.cursorIdeUserDataHome, "globalStorage", "state.vscdb");
  const columns = await runSqliteReadOnlyJson<{ name?: string }>(dbPath, "PRAGMA table_info(composerHeaders);");
  const expected = new Set(["composerId", "workspaceId", "createdAt", "lastUpdatedAt", "recency", "isArchived", "isSubagent", "value"]);
  if (!expected.size || ![...expected].every((name) => columns.some((column) => column.name === name))) {
    throw new Error("Cursor IDE composerHeaders schema is unsupported.");
  }
  const clauses = [
    "composerId <> 'empty-state-draft'",
    !options.showArchivedCursorIde ? "coalesce(isArchived,0)=0" : "",
    !options.showSubagentCursorIde ? "coalesce(isSubagent,0)=0" : ""
  ].filter(Boolean);
  const rows = await runSqliteReadOnlyJson<CursorIdeHeaderRow>(dbPath, `SELECT
      composerId AS id, workspaceId, createdAt, lastUpdatedAt, recency,
      isArchived AS archived, isSubagent AS subagent,
      json_extract(value, '$.name') AS title,
      json_extract(value, '$.subtitle') AS subtitle
    FROM composerHeaders
    WHERE ${clauses.join(" AND ")}
    ORDER BY coalesce(lastUpdatedAt,recency,createdAt) DESC
    LIMIT ${options.maxItems}`);
  return Promise.all(rows.filter((row) => row.id).map(async (row) => {
    const workspacePath = await cursorIdeWorkspacePath(options.cursorIdeUserDataHome, row.workspaceId);
    const updatedAt = Number(row.lastUpdatedAt || row.recency || row.createdAt || 0);
    return session("cursor-ide", row.id!, clean(row.title) || clean(row.subtitle) || row.id!, workspacePath || os.homedir(), updatedAt, {
      archived: !!row.archived,
      source: workspacePath ? "cursor-ide-header" : "cursor-ide-header-only",
      transcriptKind: "unavailable",
      transcriptRefs: JSON.stringify({ kind: "unavailable", reason: "Cursor IDE stores conversation bodies outside its supported local header index." })
    });
  }));
}

async function cursorIdeWorkspacePath(userDataHome: string, workspaceId?: string): Promise<string | undefined> {
  if (!workspaceId || path.basename(workspaceId) !== workspaceId || workspaceId === "empty-window") {
    return undefined;
  }
  const workspaceFile = path.join(userDataHome, "workspaceStorage", workspaceId, "workspace.json");
  try {
    const raw = JSON.parse(await fs.readFile(workspaceFile, "utf8")) as { folder?: unknown; workspace?: unknown };
    const uri = typeof raw.folder === "string" ? raw.folder : typeof raw.workspace === "string" ? raw.workspace : undefined;
    return uri?.startsWith("file:") ? fileURLToPath(uri) : undefined;
  } catch {
    return undefined;
  }
}

async function loadPi(home: string, maxItems: number): Promise<LoadedSession[]> {
  const files = await cachedFiles(`pi:${home}`, () => listJsonlFiles(path.join(home, "sessions"))); const out: LoadedSession[] = [];
  for (const file of files) { const rows = await readCachedJsonLines<any>(file); const header = rows[0]; if (header?.type !== "session" || !header.id) continue; let title = "", firstUser = "", count = 0, updated = Date.parse(header.timestamp || "") || 0; for (const row of rows.slice(1)) { updated = Math.max(updated, Date.parse(row.timestamp || "") || 0); if (row.type === "session_info" && row.name) title = row.name; if (row.type === "message" && row.message?.role === "user") { count++; firstUser ||= contentText(row.message.content); } } out.push(session("pi", header.id, clean(title) || clean(firstUser) || header.id, header.cwd || os.homedir(), updated || await mtime(file), { messageCount: count || undefined, source: "jsonl", transcriptKind: "jsonl", transcriptRefs: JSON.stringify({ kind: "jsonl", paths: [file] }) })); }
  return out.sort(byUpdated).slice(0, maxItems);
}

function session(provider: SyncableAgentProvider, id: string, title: string, projectPath: string, updatedAt: number, extra: Partial<LoadedSession> = {}): LoadedSession { return { provider, id, title: clean(title) || id, projectPath: projectPath || os.homedir(), updatedAt, ...extra }; }
function mergeLatest(map: Map<string, LoadedSession>, next: LoadedSession): void { const old = map.get(next.id); if (!old || next.updatedAt >= old.updatedAt) map.set(next.id, { ...old, ...next, title: clean(next.title) || old?.title || next.id, projectPath: next.projectPath || old?.projectPath || os.homedir() }); }
function contentText(value: unknown): string { if (typeof value === "string") return value; if (Array.isArray(value)) return value.map((part) => typeof part === "string" ? part : part?.text || "").join(" "); return ""; }
function clean(value?: string): string { return (value || "").replace(/\s+/g, " ").trim().slice(0, 180); }
function first(...values: Array<string | undefined | null>): string { return values.find((value) => value?.trim())?.trim() || "Untitled"; }
function byUpdated(a: AgentSession, b: AgentSession): number { return b.updatedAt - a.updatedAt; }
function label(provider: SyncableAgentProvider): string {
  if (provider === "agy") return "Antigravity";
  if (provider === "cursor") return "Cursor CLI";
  if (provider === "cursor-ide") return "Cursor IDE";
  return provider[0].toUpperCase() + provider.slice(1);
}
function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, Math.floor(value))); }
function sql(value: string): string { return `'${escapeSqlLiteral(value)}'`; }
function nullable(value: string | undefined | null): string { return value == null ? "NULL" : sql(value); }
function numberOrNull(value: number | undefined): string { return value == null || !Number.isFinite(value) ? "NULL" : String(Math.floor(value)); }
async function safeReadDir(dir: string): Promise<string[]> { try { return await fs.readdir(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
async function fileExists(file: string): Promise<boolean> { try { await fs.access(file); return true; } catch { return false; } }
async function mtime(file: string): Promise<number> { try { return (await fs.stat(file)).mtimeMs; } catch { return 0; } }
async function newestMtime(files: string[]): Promise<number> { return Math.max(...await Promise.all(files.map(mtime))); }
async function readCachedText(file: string): Promise<string> { const stat = await fs.stat(file); const cached = textCache.get(file); if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value; const value = await fs.readFile(file, "utf8"); textCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value }); return value; }
async function readCachedJsonLines<T>(file: string): Promise<T[]> { const raw = await readCachedText(file); const out: T[] = []; for (const line of raw.split(/\r?\n/)) { if (!line.trim()) continue; try { out.push(JSON.parse(line) as T); } catch { /* partial trailing row */ } } return out; }
async function readCachedJsonLinesSafe<T>(file: string): Promise<T[]> { try { return await readCachedJsonLines<T>(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
async function cachedFiles(key: string, load: () => Promise<string[]>): Promise<string[]> { const cached = listCache.get(key); if (cached && cached.expiresAt > Date.now()) return cached.value; const value = await load(); listCache.set(key, { expiresAt: Date.now() + 10_000, value }); return value; }
function claudePath(file: string): string { const dir = path.basename(path.dirname(file)); return dir.startsWith("-") ? `/${dir.slice(1).replaceAll("-", "/")}` : os.homedir(); }
async function grokCwd(summaryFile: string): Promise<string> { const group = path.dirname(path.dirname(summaryFile)); try { return (await readCachedText(path.join(group, ".cwd"))).trim(); } catch { try { return decodeURIComponent(path.basename(group)); } catch { return path.basename(group); } } }
function parseOpenCodeModel(raw?: string): string | undefined { if (!raw) return undefined; try { const value = JSON.parse(raw); return value.id && value.providerID ? `${value.providerID}/${value.id}` : value.id || value.providerID || raw; } catch { return raw; } }
function providerHome(provider: SyncableAgentProvider, options: AgentSessionSyncOptions): string { switch (provider) { case "codex": return options.codexHome; case "claude": return options.claudeHome; case "agy": return options.antigravityHome; case "grok": return options.grokHome; case "opencode": return options.opencodeHome; case "pi": return options.piHome; case "cursor": return options.cursorHome; case "cursor-ide": return options.cursorIdeUserDataHome; } }
function agentHomeSettingKey(provider: Exclude<SyncableAgentProvider, "cursor-ide">): keyof AgentHomesSettings { switch (provider) { case "codex": return "codexHome"; case "claude": return "claudeHome"; case "agy": return "antigravityHome"; case "grok": return "grokHome"; case "opencode": return "opencodeHome"; case "pi": return "piHome"; case "cursor": return "cursorHome"; } }
function isConfiguredAgentHome(provider: SyncableAgentProvider, options: AgentSessionSyncOptions): boolean {
  if (provider === "cursor-ide") {
    return Boolean(options.configuredAgentHomes?.cursorIdeUserDataHome?.trim());
  }
  const key = agentHomeSettingKey(provider) as AgentHomeKey;
  return agentHomeDiffersFromDefault(key, options.configuredAgentHomes?.[key]);
}
