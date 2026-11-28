import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  listAllNotes,
  queryUnifiedSearch,
  searchIndexDbPath,
  syncSearchIndex,
  type SearchDocType,
  type SearchIndexSyncStats,
  type SearchProjectScopeInput,
  type UnifiedSearchHit,
  type UnifiedSearchResult
} from "@agent-resume/core/extension";
import { loadAcpMessages } from "../acp/store";
import {
  loadCatalogSettings,
  queryFilteredSessionsPage,
  type CatalogProjectGroupSummary
} from "../catalog";
import { gtdStatusLabel } from "../gtd/gtdTree";
import { basenameOrPath } from "../history/pathUtils";
import { loadRenameHomes } from "../history/rename/homes";
import type { PreviewMessage, SessionPreviewResult } from "../history/preview";
import { getLlmOutputLanguage } from "../llm/config";
import { relativeTime } from "../util/relativeTime";
import type { SessionTreeProvider } from "../tree/sessionTree";

export const UNIFIED_SEARCH_PAGE_SIZE = 35;

export interface SerializedSearchItem {
  docType: SearchDocType;
  docKey: string;
  provider: string;
  acpProvider?: string;
  id: string;
  title: string;
  projectPath: string;
  projectName: string;
  branch?: string;
  summary?: string;
  snippet?: string;
  matchSource?: UnifiedSearchHit["matchSource"];
  updatedAtLabel: string;
  gtdStatus?: string;
  gtdStatusLabel?: string;
  scope?: string;
  relMdPath?: string;
  filename?: string;
  linkedSessionKey?: string;
}

export interface SerializedSearchColumn {
  items: SerializedSearchItem[];
  total: number;
  hasMore: boolean;
}

export interface SerializedUnifiedSearchResponse {
  sessions: SerializedSearchColumn;
  acp: SerializedSearchColumn;
  notes: SerializedSearchColumn;
  indexedCounts: {
    sessions: number;
    acp: number;
    notes: number;
  };
  queryTimeMs: number;
  usingFallback?: boolean;
}

let scheduledSyncTimer: ReturnType<typeof setTimeout> | undefined;
let activeSyncPromise: Promise<SearchIndexSyncStats> | undefined;

export function syncUnifiedSearchIndexNow(): Promise<SearchIndexSyncStats> {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }
  const catalog = loadCatalogSettings();
  const homes = loadRenameHomes();
  const indexDbPath = searchIndexDbPath(homes.panelHome);

  activeSyncPromise = syncSearchIndex({
    catalogDbPath: catalog.dbPath,
    indexDbPath,
    panelHome: homes.panelHome,
    antigravityHome: homes.antigravityHome,
    opencodeHome: homes.opencodeHome,
    almaHome: homes.almaHome,
    outputLanguage: getLlmOutputLanguage()
  }).finally(() => {
    activeSyncPromise = undefined;
  });

  return activeSyncPromise;
}

export function scheduleUnifiedSearchIndexSync(
  onSynced?: (stats: SearchIndexSyncStats) => void,
  delayMs = 500
): void {
  if (scheduledSyncTimer) {
    clearTimeout(scheduledSyncTimer);
  }
  scheduledSyncTimer = setTimeout(() => {
    scheduledSyncTimer = undefined;
    void syncUnifiedSearchIndexNow()
      .then((stats) => {
        onSynced?.(stats);
      })
      .catch((error) => {
        console.warn("[agent-resume] Search index sync failed:", error);
      });
  }, delayMs);
}

export async function queryUnifiedSearchForPanel(
  tree: SessionTreeProvider,
  params: {
    query?: string;
    matchedGroup?: CatalogProjectGroupSummary;
    projectPath?: string;
    gtdFilter?: string | null;
    columns?: SearchDocType[];
    sessionsOffset?: number;
    acpOffset?: number;
    notesOffset?: number;
    limit?: number;
  }
): Promise<SerializedUnifiedSearchResponse> {
  const homes = loadRenameHomes();
  const indexDbPath = searchIndexDbPath(homes.panelHome);
  const limit = Math.max(1, Math.min(Math.floor(params.limit ?? UNIFIED_SEARCH_PAGE_SIZE), 150));

  const projectScope: SearchProjectScopeInput | undefined = params.projectPath?.trim()
    ? {
        projectPath: params.projectPath.trim(),
        projectId: params.matchedGroup?.projectId,
        candidatePaths: params.matchedGroup?.candidatePaths
      }
    : undefined;

  const result: UnifiedSearchResult = await queryUnifiedSearch({
    indexDbPath,
    query: params.query,
    projectScope,
    gtdFilter: params.gtdFilter,
    columns: params.columns,
    sessionsPage: { offset: params.sessionsOffset ?? 0, limit },
    acpPage: { offset: params.acpOffset ?? 0, limit },
    notesPage: { offset: params.notesOffset ?? 0, limit }
  });

  const totalIndexed =
    result.indexedCounts.sessions + result.indexedCounts.acp + result.indexedCounts.notes;

  // Before the initial background index completes on a fresh DB, serve instant metadata fallback.
  if (totalIndexed === 0) {
    return queryMetadataFallback(tree, params, limit);
  }

  return {
    sessions: serializeColumn(result.sessions, tree),
    acp: serializeColumn(result.acp, tree),
    notes: serializeColumn(result.notes, tree),
    indexedCounts: result.indexedCounts,
    queryTimeMs: result.queryTimeMs
  };
}

function serializeColumn(
  col: UnifiedSearchResult["sessions"],
  tree: SessionTreeProvider
): SerializedSearchColumn {
  return {
    total: col.total,
    hasMore: col.hasMore,
    items: col.items.map((hit) => serializeHit(hit, tree))
  };
}

function serializeHit(hit: UnifiedSearchHit, tree: SessionTreeProvider): SerializedSearchItem {
  const projectPath = hit.projectPath || "";
  const projectName = projectPath
    ? tree.getProjectDisplayName(projectPath)
    : hit.docType === "note" && hit.scope === "library"
      ? "Library"
      : "";
  const gtdLabel = hit.gtdStatus ? gtdStatusLabel(hit.gtdStatus) : undefined;

  return {
    docType: hit.docType,
    docKey: hit.docKey,
    provider: hit.provider,
    ...(hit.acpProvider ? { acpProvider: hit.acpProvider } : {}),
    id: hit.id,
    title: hit.title,
    projectPath,
    projectName: projectName || (projectPath ? basenameOrPath(projectPath) : ""),
    ...(hit.branch ? { branch: hit.branch } : {}),
    ...(hit.summary ? { summary: hit.summary } : {}),
    ...(hit.snippet ? { snippet: hit.snippet } : {}),
    ...(hit.matchSource ? { matchSource: hit.matchSource } : {}),
    updatedAtLabel: relativeTime(hit.updatedAt),
    ...(hit.gtdStatus && gtdLabel ? { gtdStatus: hit.gtdStatus, gtdStatusLabel: gtdLabel } : {}),
    ...(hit.scope ? { scope: hit.scope } : {}),
    ...(hit.relMdPath ? { relMdPath: hit.relMdPath } : {}),
    ...(hit.filename ? { filename: hit.filename } : {}),
    ...(hit.linkedSessionKey ? { linkedSessionKey: hit.linkedSessionKey } : {})
  };
}

async function queryMetadataFallback(
  tree: SessionTreeProvider,
  params: {
    query?: string;
    matchedGroup?: CatalogProjectGroupSummary;
    projectPath?: string;
    gtdFilter?: string | null;
    sessionsOffset?: number;
    acpOffset?: number;
    notesOffset?: number;
  },
  limit: number
): Promise<SerializedUnifiedSearchResponse> {
  const t0 = Date.now();
  const catalog = loadCatalogSettings();
  const outputLanguage = getLlmOutputLanguage();
  const nonChatProviders = [
    "codex",
    "claude",
    "agy",
    "grok",
    "opencode",
    "pi",
    "prime",
    "omp",
    "cursor",
    "cursor-ide",
    "alma"
  ] as const;

  const [sessionsPage, acpPage, allNotes] = await Promise.all([
    queryFilteredSessionsPage(catalog.dbPath, {
      limit,
      offset: params.sessionsOffset ?? 0,
      search: params.query,
      providers: [...nonChatProviders],
      projectPath: params.projectPath,
      projectId: params.matchedGroup?.projectId,
      projectCandidatePaths: params.matchedGroup?.candidatePaths,
      gtdFilter: params.gtdFilter,
      outputLanguage,
      summaryPolicy: "any"
    }),
    queryFilteredSessionsPage(catalog.dbPath, {
      limit,
      offset: params.acpOffset ?? 0,
      search: params.query,
      providers: ["chat"],
      projectPath: params.projectPath,
      projectId: params.matchedGroup?.projectId,
      projectCandidatePaths: params.matchedGroup?.candidatePaths,
      gtdFilter: params.gtdFilter,
      outputLanguage,
      summaryPolicy: "any"
    }),
    listAllNotes(catalog.dbPath)
  ]);

  const q = params.query?.trim().toLowerCase() ?? "";
  const filteredNotes = allNotes.filter((note) => {
    if (note.archivedAtMs != null) return false;
    if (params.projectPath?.trim()) {
      const target = path.resolve(params.projectPath.trim());
      const noteProj = note.projectPath ? path.resolve(note.projectPath) : "";
      if (noteProj !== target) return false;
    }
    if (params.gtdFilter === "untagged" && note.gtdStatus) return false;
    if (params.gtdFilter && params.gtdFilter !== "all" && params.gtdFilter !== "untagged") {
      if (note.gtdStatus !== params.gtdFilter) return false;
    }
    if (!q) return true;
    const hay = [note.title, note.filename, note.contentPreview, note.projectPath]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });

  const nOffset = params.notesOffset ?? 0;
  const noteSlice = filteredNotes.slice(nOffset, nOffset + limit);

  return {
    sessions: {
      total: sessionsPage.total,
      hasMore: (params.sessionsOffset ?? 0) + sessionsPage.sessions.length < sessionsPage.total,
      items: sessionsPage.sessions.map((s) => ({
        docType: "session",
        docKey: `session:${s.provider}:${s.id}`,
        provider: s.provider,
        id: s.id,
        title: s.title,
        projectPath: s.projectPath,
        projectName: tree.getProjectDisplayName(s.projectPath),
        ...(s.branch ? { branch: s.branch } : {}),
        ...(s.sessionSummary ? { summary: s.sessionSummary } : {}),
        updatedAtLabel: relativeTime(s.updatedAt),
        ...(tree.getSessionGtdStatus(s) && tree.getSessionGtdStatusLabel(s)
          ? {
              gtdStatus: tree.getSessionGtdStatus(s),
              gtdStatusLabel: tree.getSessionGtdStatusLabel(s)
            }
          : {})
      }))
    },
    acp: {
      total: acpPage.total,
      hasMore: (params.acpOffset ?? 0) + acpPage.sessions.length < acpPage.total,
      items: acpPage.sessions.map((s) => ({
        docType: "acp",
        docKey: `acp:chat:${s.id}`,
        provider: "chat",
        ...(s.acpProvider ? { acpProvider: s.acpProvider } : {}),
        id: s.id,
        title: s.title,
        projectPath: s.projectPath,
        projectName: tree.getProjectDisplayName(s.projectPath),
        ...(s.sessionSummary ? { summary: s.sessionSummary } : {}),
        updatedAtLabel: relativeTime(s.updatedAt),
        ...(tree.getSessionGtdStatus(s) && tree.getSessionGtdStatusLabel(s)
          ? {
              gtdStatus: tree.getSessionGtdStatus(s),
              gtdStatusLabel: tree.getSessionGtdStatusLabel(s)
            }
          : {})
      }))
    },
    notes: {
      total: filteredNotes.length,
      hasMore: nOffset + noteSlice.length < filteredNotes.length,
      items: noteSlice.map((n) => ({
        docType: "note",
        docKey: `note:${n.noteId}`,
        provider: n.provider || "",
        id: n.noteId,
        title: n.title || n.filename,
        filename: n.filename,
        scope: n.scope,
        relMdPath: n.relMdPath,
        projectPath: n.projectPath || "",
        projectName: n.projectPath ? tree.getProjectDisplayName(n.projectPath) : n.scope,
        ...(n.contentPreview ? { summary: n.contentPreview } : {}),
        updatedAtLabel: relativeTime(n.updatedAtMs),
        ...(n.gtdStatus
          ? { gtdStatus: n.gtdStatus, gtdStatusLabel: gtdStatusLabel(n.gtdStatus) }
          : {})
      }))
    },
    indexedCounts: { sessions: 0, acp: 0, notes: 0 },
    queryTimeMs: Date.now() - t0,
    usingFallback: true
  };
}

export async function loadAcpChatPreview(
  sessionId: string,
  title: string
): Promise<SessionPreviewResult> {
  const homes = loadRenameHomes();
  let messages = await loadAcpMessages(homes.panelHome, sessionId);

  if (!messages.length) {
    // Check legacy proxy/threads/<id>.jsonl if present
    const proxyThread = path.join(homes.panelHome, "proxy", "threads", `${sessionId}.jsonl`);
    try {
      const raw = await fs.readFile(proxyThread, "utf8");
      messages = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
    } catch {
      // missing
    }
  }

  const previewMessages: PreviewMessage[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = typeof m.text === "string" ? m.text.trim() : "";
    const thinking = typeof m.thinking === "string" ? m.thinking.trim() : "";
    if (!text && !thinking) continue;
    previewMessages.push({
      role: m.role,
      text,
      ...(thinking ? { thinking } : {}),
      ...(m.timestamp ? { timestamp: new Date(m.timestamp).toISOString() } : {})
    });
  }

  if (!previewMessages.length) {
    throw new Error("ACP chat transcript is empty or unavailable.");
  }

  const MAX_MESSAGES = 100;
  if (previewMessages.length > MAX_MESSAGES) {
    return {
      title,
      messages: previewMessages.slice(-MAX_MESSAGES),
      truncated: true
    };
  }
  return { title, messages: previewMessages };
}
