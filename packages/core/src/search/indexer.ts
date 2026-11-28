import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseStringListJson } from "../notes/work";
import { runSqliteJson } from "../sqlite";
import {
  deleteSearchDocsByKeys,
  ensureSearchIndexSchema,
  querySearchSql,
  upsertSearchDocsBatch
} from "./db";
import {
  DEFAULT_MAX_BODY_CHARS,
  extractAgyConversationText,
  extractJsonlFilesConversationText,
  extractNoteBodyText,
  extractOpenCodeConversationTextMap,
  loadAgyHistoryFallbackMap,
  parseTranscriptRefsJson,
  resolveAgySessionLogFiles,
  statSignature
} from "./extract";
import type { SearchDocRowInput, SearchIndexSyncStats, SyncSearchIndexOptions } from "./types";

interface CatalogSessionSyncRow {
  provider: string;
  agent_session_id: string;
  title: string;
  user_title: string | null;
  project_path: string;
  project_id: string | null;
  updated_at_ms: number;
  archived: number;
  branch: string | null;
  acp_provider: string | null;
  transcript_kind: string | null;
  transcript_refs: string | null;
  session_summary: string | null;
  gtd_status: string | null;
  message_count: number | null;
}

interface CatalogNoteSyncRow {
  note_id: string;
  scope: string;
  provider: string | null;
  agent_session_id: string | null;
  project_path: string | null;
  filename: string;
  rel_md_path: string;
  title: string | null;
  content_preview: string | null;
  updated_at_ms: number;
  gtd_status: string | null;
  next_action: string | null;
  decision: string | null;
  projects_json: string | null;
  primary_project: string | null;
  archived_at_ms: number | null;
}

const syncInFlight = new Map<string, Promise<SearchIndexSyncStats>>();
const CONCURRENCY = 16;

export function syncSearchIndex(options: SyncSearchIndexOptions): Promise<SearchIndexSyncStats> {
  const key = `${path.resolve(options.catalogDbPath)}\0${path.resolve(options.indexDbPath)}`;
  const existing = syncInFlight.get(key);
  if (existing) {
    return existing;
  }
  const task = performSyncSearchIndex(options).finally(() => {
    syncInFlight.delete(key);
  });
  syncInFlight.set(key, task);
  return task;
}

async function performSyncSearchIndex(
  options: SyncSearchIndexOptions
): Promise<SearchIndexSyncStats> {
  const startMs = Date.now();
  const maxBodyChars = options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;

  await ensureSearchIndexSchema(options.indexDbPath);

  const [sessionRows, noteRows, existingSigs] = await Promise.all([
    loadCatalogSessionsForIndex(options.catalogDbPath),
    loadCatalogNotesForIndex(options.catalogDbPath),
    loadExistingSignatures(options.indexDbPath)
  ]);

  const sessionMetaByKey = new Map<string, { projectPath: string; projectId: string }>();
  for (const s of sessionRows) {
    sessionMetaByKey.set(`${s.provider}:${s.agent_session_id}`, {
      projectPath: s.project_path || "",
      projectId: s.project_id || ""
    });
  }

  const activeKeys = new Set<string>();
  const pendingUpserts: SearchDocRowInput[] = [];
  let skippedDocs = 0;

  let indexedSessions = 0;
  let indexedAcp = 0;
  let indexedNotes = 0;

  // Group dirty opencode sessions so we query opencode.db in one batched pass.
  const dirtyOpenCodeByDb = new Map<
    string,
    Array<{ row: CatalogSessionSyncRow; docKey: string; sig: string }>
  >();
  let agyHistoryFallback: Map<string, string> | undefined;

  // Process sessions & ACP chats with bounded concurrency
  await mapWithConcurrency(sessionRows, CONCURRENCY, async (row) => {
    const isAcp = row.provider === "chat";
    const docType = isAcp ? "acp" : "session";
    const docKey = `${docType}:${row.provider}:${row.agent_session_id}`;
    activeKeys.add(docKey);
    if (isAcp) indexedAcp++;
    else indexedSessions++;

    const displayTitle = (row.user_title?.trim() || row.title || row.agent_session_id).trim();
    const summary = (row.session_summary ?? "").trim();
    const projectPath = (row.project_path ?? "").trim();
    const projectId = (row.project_id ?? "").trim();
    const branch = (row.branch ?? "").trim();
    const gtdStatus = (row.gtd_status ?? "").trim();
    const acpProvider = isAcp ? (row.acp_provider ?? "").trim() : "";

    const refs = parseTranscriptRefsJson(row.transcript_refs);
    const metaSig = `${displayTitle}\0${summary}\0${projectPath}\0${projectId}\0${branch}\0${gtdStatus}\0${acpProvider}\0${row.archived ? 1 : 0}\0${row.updated_at_ms}`;

    let fileSig = "";
    let agyLogs: string[] = [];
    let jsonlPaths: string[] = [];

    if (row.provider === "agy") {
      agyLogs = await resolveAgySessionLogFiles(options.antigravityHome, row.agent_session_id);
      if (agyLogs.length > 0) {
        fileSig = await statSignature(agyLogs);
      } else {
        fileSig = `agy-history:${row.updated_at_ms}`;
      }
    } else if (refs?.kind === "sqlite" && refs.dbPath) {
      fileSig = `sqlite:${refs.dbPath}:${row.updated_at_ms}:${row.message_count ?? ""}`;
    } else if (refs?.kind === "jsonl" && Array.isArray(refs.paths)) {
      jsonlPaths = refs.paths;
      fileSig = await statSignature(jsonlPaths);
    } else if ((refs?.kind === "acp" || refs?.kind === "proxy") && refs.threadPath) {
      jsonlPaths = [refs.threadPath];
      fileSig = await statSignature(jsonlPaths);
    } else {
      fileSig = `meta-only`;
    }

    const fullSig = `${metaSig}\0${fileSig}`;
    if (existingSigs.get(docKey) === fullSig) {
      skippedDocs++;
      return;
    }

    if (refs?.kind === "sqlite" && refs.dbPath) {
      const list = dirtyOpenCodeByDb.get(refs.dbPath) ?? [];
      list.push({ row, docKey, sig: fullSig });
      dirtyOpenCodeByDb.set(refs.dbPath, list);
      return;
    }

    let body = "";
    if (row.provider === "agy") {
      if (agyLogs.length > 0) {
        body = await extractAgyConversationText(agyLogs, maxBodyChars);
      } else {
        if (!agyHistoryFallback) {
          agyHistoryFallback = await loadAgyHistoryFallbackMap(options.antigravityHome);
        }
        body = agyHistoryFallback.get(row.agent_session_id) ?? "";
      }
    } else if (jsonlPaths.length > 0) {
      body = await extractJsonlFilesConversationText(jsonlPaths, row.provider, maxBodyChars);
    }

    pendingUpserts.push({
      docType,
      docKey,
      provider: row.provider,
      acpProvider,
      itemId: row.agent_session_id,
      title: displayTitle,
      summary,
      projectPath,
      projectId,
      projectsText: "",
      branch,
      gtdStatus,
      scope: "",
      relMdPath: "",
      filename: "",
      linkedSessionKey: "",
      body,
      updatedAtMs: Number(row.updated_at_ms) || 0,
      archived: row.archived ? 1 : 0,
      sourceSig: fullSig
    });
  });

  // Batch extract dirty OpenCode sessions
  for (const [opencodeDbPath, entries] of dirtyOpenCodeByDb.entries()) {
    const ids = entries.map((e) => e.row.agent_session_id);
    const bodyMap = await extractOpenCodeConversationTextMap(opencodeDbPath, ids, maxBodyChars);
    for (const { row, docKey, sig } of entries) {
      const displayTitle = (row.user_title?.trim() || row.title || row.agent_session_id).trim();
      pendingUpserts.push({
        docType: "session",
        docKey,
        provider: row.provider,
        acpProvider: "",
        itemId: row.agent_session_id,
        title: displayTitle,
        summary: (row.session_summary ?? "").trim(),
        projectPath: (row.project_path ?? "").trim(),
        projectId: (row.project_id ?? "").trim(),
        projectsText: "",
        branch: (row.branch ?? "").trim(),
        gtdStatus: (row.gtd_status ?? "").trim(),
        scope: "",
        relMdPath: "",
        filename: "",
        linkedSessionKey: "",
        body: bodyMap.get(row.agent_session_id) ?? "",
        updatedAtMs: Number(row.updated_at_ms) || 0,
        archived: row.archived ? 1 : 0,
        sourceSig: sig
      });
    }
  }

  // Process Notes
  await mapWithConcurrency(noteRows, CONCURRENCY, async (note) => {
    const docKey = `note:${note.note_id}`;
    activeKeys.add(docKey);
    indexedNotes++;

    const linkedKey =
      note.provider && note.agent_session_id ? `${note.provider}:${note.agent_session_id}` : "";
    const linkedSession = linkedKey ? sessionMetaByKey.get(linkedKey) : undefined;
    const resolvedProjectPath = (
      note.project_path?.trim() ||
      linkedSession?.projectPath ||
      note.primary_project?.trim() ||
      ""
    ).trim();
    const resolvedProjectId = linkedSession?.projectId ?? "";
    const extraProjects = parseStringListJson(note.projects_json) ?? [];
    const projectsText = [resolvedProjectPath, ...extraProjects].filter(Boolean).join("\n");

    const title = (note.title?.trim() || note.filename).trim();
    const summary = [
      note.content_preview?.trim(),
      note.next_action?.trim() ? `Next: ${note.next_action.trim()}` : "",
      note.decision?.trim() ? `Decision: ${note.decision.trim()}` : ""
    ]
      .filter(Boolean)
      .join(" · ");
    const gtdStatus = (note.gtd_status ?? "").trim();

    const absPath = path.join(options.panelHome, note.rel_md_path);
    const fileSig = await statSignature([absPath]);
    const fullSig = `${title}\0${summary}\0${resolvedProjectPath}\0${resolvedProjectId}\0${projectsText}\0${gtdStatus}\0${note.updated_at_ms}\0${note.archived_at_ms ?? ""}\0${fileSig}`;

    if (existingSigs.get(docKey) === fullSig) {
      skippedDocs++;
      return;
    }

    const body = await extractNoteBodyText(absPath, maxBodyChars);

    pendingUpserts.push({
      docType: "note",
      docKey,
      provider: note.provider ?? "",
      acpProvider: "",
      itemId: note.note_id,
      title,
      summary,
      projectPath: resolvedProjectPath,
      projectId: resolvedProjectId,
      projectsText,
      branch: "",
      gtdStatus,
      scope: note.scope,
      relMdPath: note.rel_md_path,
      filename: note.filename,
      linkedSessionKey: linkedKey,
      body,
      updatedAtMs: Number(note.updated_at_ms) || 0,
      archived: note.archived_at_ms != null ? 1 : 0,
      sourceSig: fullSig
    });
  });

  // Delete stale docs no longer in catalog
  const staleKeys: string[] = [];
  for (const key of existingSigs.keys()) {
    if (!activeKeys.has(key)) {
      staleKeys.push(key);
    }
  }

  if (staleKeys.length > 0) {
    await deleteSearchDocsByKeys(options.indexDbPath, staleKeys);
  }
  if (pendingUpserts.length > 0) {
    await upsertSearchDocsBatch(options.indexDbPath, pendingUpserts);
  }

  return {
    totalDocs: activeKeys.size,
    indexedSessions,
    indexedAcp,
    indexedNotes,
    updatedDocs: pendingUpserts.length,
    deletedDocs: staleKeys.length,
    skippedDocs,
    durationMs: Date.now() - startMs
  };
}

async function loadCatalogSessionsForIndex(catalogDbPath: string): Promise<CatalogSessionSyncRow[]> {
  try {
    return await runSqliteJson<CatalogSessionSyncRow>(
      catalogDbPath,
      `SELECT s.provider, s.agent_session_id, s.title, s.user_title, s.project_path, s.project_id,
              s.updated_at_ms, s.archived, s.branch, s.acp_provider, s.transcript_kind,
              s.transcript_refs, s.session_summary, s.message_count, g.status AS gtd_status
       FROM sessions s
       LEFT JOIN session_gtd g ON g.provider = s.provider AND g.agent_session_id = s.agent_session_id
       WHERE s.hidden = 0;`
    );
  } catch {
    return [];
  }
}

async function loadCatalogNotesForIndex(catalogDbPath: string): Promise<CatalogNoteSyncRow[]> {
  try {
    return await runSqliteJson<CatalogNoteSyncRow>(
      catalogDbPath,
      `SELECT n.note_id, n.scope, n.provider, n.agent_session_id, n.project_path,
              n.filename, n.rel_md_path, n.title, n.content_preview, n.updated_at_ms,
              g.status AS gtd_status, w.next_action, w.decision, w.projects_json,
              w.primary_project, a.archived_at_ms
       FROM notes n
       LEFT JOIN note_gtd g ON g.note_id = n.note_id
       LEFT JOIN note_work w ON w.note_id = n.note_id
       LEFT JOIN note_archive a ON a.note_id = n.note_id;`
    );
  } catch {
    return [];
  }
}

async function loadExistingSignatures(indexDbPath: string): Promise<Map<string, string>> {
  const rows = await querySearchSql<{ doc_key: string; source_sig: string }>(
    indexDbPath,
    "SELECT doc_key, source_sig FROM search_docs;"
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.doc_key, row.source_sig || "");
  }
  return map;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (!items.length) return;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}
