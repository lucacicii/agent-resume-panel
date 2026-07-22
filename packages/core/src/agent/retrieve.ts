import {
  mergeSessionSearchHits,
  searchCatalogSessions,
  type SessionSearchHit
} from "../catalog/search";
import { AgentProvider } from "../catalog/types";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { embedTextsDetailed } from "../llm/embeddings";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import { ReportEntry } from "../report/schema";
import { listReportEntries, listReportLinks } from "../report/store";
import { searchReportsByEmbedding } from "../report/search";
import { NoteSearchHit, searchNotesByEmbedding } from "../notes/search";
import type { NoteIndexProgressCallback } from "../notes/vectorIndex";
import { searchSessionsByEmbedding } from "../session/searchByEmbedding";
import { searchSessionsByTranscriptEmbedding } from "../session/transcriptIndex";
import type { PanelSettings } from "../settings/types";
import { recordLlmUsage } from "../usage/store";
import { AgentCitation } from "./types";
import { resolveNoteSearchPlan } from "./noteIntent";
import { effectivePanelHome, loadSettings } from "../settings/store";
import { resolvePanelHome } from "../panelHome";

const DEFAULT_LIMIT = 8;
const CONTENT_CHARS = 2000;
const DEFAULT_NOTE_LIMIT = 6;
const EXACT_NOTE_LIMIT = 50;
const NOTE_CONTEXT_CHARS = 8000;
const EXACT_NOTE_CONTEXT_CHARS = 18000;
const DEFAULT_SESSION_LIMIT = 6;
const MAX_SESSION_LIMIT = 12;
const SESSION_CONTEXT_CHARS = 4000;
const SESSION_PREVIEW_CHARS = 600;

export interface RetrievedDigest {
  entry: ReportEntry;
  score?: number;
}

export interface RetrieveAgentContextResult {
  digests: RetrievedDigest[];
  notes: NoteSearchHit[];
  sessions: SessionSearchHit[];
  citations: AgentCitation[];
  fallback: boolean;
  noteMatchTotal?: number;
  /** Which context searches ran for this request. */
  executedSearches: {
    reports: boolean;
    notes: boolean;
    sessions: boolean;
  };
  catalogDb: string;
  desktopDb: string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[...truncated...]`;
}

/** Significant tokens for keyword fallback when full-phrase LIKE misses. */
function keywordTokens(query: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of query.split(/[\s,./;:|!?()[\]{}"'`]+/u)) {
    const token = raw.replace(/^[^\p{L}\p{N}_-]+|[^\p{L}\p{N}_-]+$/gu, "");
    if (token.length < 3) {
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tokens.push(token);
    if (tokens.length >= 6) {
      break;
    }
  }
  return tokens;
}

/**
 * Hybrid session search for Ask retrieval (keyword + summary/transcript embeddings).
 * Mirrors session_search tool logic, with token fallback for natural-language questions.
 */
async function searchSessionsForAsk(options: {
  query: string;
  catalogDb: string;
  desktopDb: string;
  settings: PanelSettings;
  queryVector?: number[];
  limit: number;
}): Promise<SessionSearchHit[]> {
  const query = options.query.trim();
  if (!query) {
    return [];
  }
  const limit = Math.max(1, Math.min(options.limit, MAX_SESSION_LIMIT));
  const filters = { query, limit: limit * 2 };

  let keywordHits = await searchCatalogSessions(options.catalogDb, filters);
  // Full-query LIKE is phrase-based; natural-language Ask queries often miss. Fall back to tokens.
  if (!keywordHits.length) {
    const tokens = keywordTokens(query);
    let tokenMerged: SessionSearchHit[] = [];
    for (const token of tokens) {
      const hits = await searchCatalogSessions(options.catalogDb, {
        query: token,
        limit: limit * 2
      });
      tokenMerged = mergeSessionSearchHits(tokenMerged, hits, limit * 2);
    }
    keywordHits = tokenMerged;
  }

  let summaryHits: SessionSearchHit[] = [];
  let transcriptHits: SessionSearchHit[] = [];
  const hasEmbedding = Boolean(options.queryVector || embeddingConfigFromSettings(options.settings));
  if (hasEmbedding) {
    try {
      summaryHits = await searchSessionsByEmbedding({
        catalogDb: options.catalogDb,
        desktopDb: options.desktopDb,
        settings: options.settings,
        query,
        filters: { ...filters, limit: limit * 2 },
        limit: limit * 2,
        queryVector: options.queryVector
      });
    } catch {
      summaryHits = [];
    }
    try {
      transcriptHits = await searchSessionsByTranscriptEmbedding({
        catalogDb: options.catalogDb,
        desktopDb: options.desktopDb,
        settings: options.settings,
        query,
        filters: { ...filters, limit: limit * 2 },
        limit: limit * 2,
        queryVector: options.queryVector
      });
    } catch {
      transcriptHits = [];
    }
  }

  const semanticHits = mergeSessionSearchHits(summaryHits, transcriptHits, limit * 2);
  return mergeSessionSearchHits(keywordHits, semanticHits, limit);
}

export async function retrieveAgentContext(options: {
  query: string;
  panelHome?: string;
  limit?: number;
  onNoteIndexProgress?: NoteIndexProgressCallback;
}): Promise<RetrieveAgentContextResult> {
  const settings = await loadSettings(options.panelHome);
  const panelHome = options.panelHome
    ? resolvePanelHome(options.panelHome)
    : effectivePanelHome(settings, options.panelHome);
  const paths = await preparePanelDatabasesFromSettings(options.panelHome);
  const catalogDb = paths.catalogDb;
  const desktopDb = paths.desktopDb;

  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 16));
  let digests: RetrievedDigest[] = [];
  let notes: NoteSearchHit[] = [];
  let sessions: SessionSearchHit[] = [];
  let fallback = false;
  let noteMatchTotal: number | undefined;
  let queryVector: number[] | undefined;
  const noteSearchPlan = await resolveNoteSearchPlan({
    query: options.query,
    settings,
    catalogDb,
    desktopDb
  });
  const exactNoteSearch = noteSearchPlan.mode === "exact";
  const notesOnly = noteSearchPlan.notesOnly;

  const embedding = embeddingConfigFromSettings(settings);
  if (embedding && !(exactNoteSearch && notesOnly)) {
    try {
      const result = await embedTextsDetailed(embedding, [options.query.slice(0, 8000)]);
      queryVector = result.vectors[0];
      try {
        await recordLlmUsage(desktopDb, {
          kind: "embedding",
          source: "ask",
          jobKey: "ask:query",
          model: result.model,
          usage: result.usage,
          durationMs: result.durationMs,
          ok: true
        });
      } catch {
        // non-fatal
      }
    } catch {
      queryVector = undefined;
    }
  }

  if (!notesOnly) {
    try {
      if (!queryVector) {
        throw new Error("Query embedding is unavailable.");
      }
      const hits = await searchReportsByEmbedding({
        panelHome: options.panelHome,
        query: options.query,
        limit,
        queryVector
      });
      if (hits.length) {
        digests = hits.map((h) => ({ entry: h.entry, score: h.score }));
      } else {
        fallback = true;
      }
    } catch {
      fallback = true;
    }

    if (!digests.length) {
      fallback = true;
      const dailies = await listReportEntries(desktopDb, { level: "daily", limit: Math.ceil(limit / 2) });
      const weeklies = await listReportEntries(desktopDb, { level: "weekly", limit: Math.ceil(limit / 2) });
      const merged = [...dailies, ...weeklies].sort((a, b) => b.periodStartMs - a.periodStartMs);
      digests = merged.slice(0, limit).map((entry) => ({ entry }));
    }
  }

  try {
    if (!queryVector && !exactNoteSearch) {
      throw new Error("Query embedding is unavailable.");
    }
    const hits = await searchNotesByEmbedding({
      panelHome: options.panelHome,
      query: options.query,
      limit: exactNoteSearch ? EXACT_NOTE_LIMIT : DEFAULT_NOTE_LIMIT,
      queryVector,
      onIndexProgress: options.onNoteIndexProgress,
      plan: noteSearchPlan
    });
    noteMatchTotal = exactNoteSearch ? (hits[0]?.exactMatchTotal ?? 0) : undefined;
    let remaining = exactNoteSearch ? EXACT_NOTE_CONTEXT_CHARS : NOTE_CONTEXT_CHARS;
    for (const hit of hits) {
      if (remaining <= 0) {
        break;
      }
      const maxContent = hit.matchType === "exact" ? 500 : CONTENT_CHARS;
      const content = truncate(hit.content, Math.min(maxContent, remaining));
      notes.push({ ...hit, content });
      remaining -= content.length;
    }
  } catch {
    // Notes are an optional source; Memory retrieval should still answer independently.
  }

  if (!notesOnly) {
    try {
      const sessionLimit = Math.max(1, Math.min(DEFAULT_SESSION_LIMIT, MAX_SESSION_LIMIT));
      const hits = await searchSessionsForAsk({
        query: options.query,
        catalogDb,
        desktopDb,
        settings,
        queryVector,
        limit: sessionLimit
      });
      let remaining = SESSION_CONTEXT_CHARS;
      for (const hit of hits) {
        if (remaining <= 0) {
          break;
        }
        const preview = truncate(hit.summaryPreview || hit.title || "", Math.min(SESSION_PREVIEW_CHARS, remaining));
        sessions.push({
          ...hit,
          summaryPreview: preview || undefined
        });
        remaining -= preview.length;
      }
    } catch {
      // Sessions are an optional source; report/note retrieval still answers independently.
    }
  }

  const citations: AgentCitation[] = [];
  for (let i = 0; i < digests.length; i++) {
    const { entry, score } = digests[i];
    const links = await listReportLinks(desktopDb, entry.id);
    const first = links.find((l) => l.provider && l.agentSessionId);
    citations.push({
      source: "report",
      index: i + 1,
      reportId: entry.id,
      level: entry.level,
      title: entry.title || entry.id,
      score,
      periodStartMs: entry.periodStartMs,
      contentPreview: truncate(entry.content, 600),
      session: first
        ? {
            provider: first.provider as AgentProvider,
            id: first.agentSessionId as string,
            projectPath: first.projectPath || ""
          }
        : undefined
    });
  }

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    citations.push({
      source: "note",
      index: i + 1,
      noteId: note.noteId,
      relMdPath: note.relMdPath,
      scope: note.scope,
      heading: note.heading,
      level: "note",
      title: note.title || note.relMdPath,
      score: note.score,
      periodStartMs: note.updatedAtMs,
      contentPreview: truncate(note.content, 600)
    });
  }

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    citations.push({
      source: "session",
      index: i + 1,
      level: "session",
      title: session.title || session.sessionId,
      score: session.score,
      periodStartMs: session.updatedAtMs,
      contentPreview: truncate(session.summaryPreview || session.title || "", SESSION_PREVIEW_CHARS),
      session: {
        provider: session.provider,
        id: session.sessionId,
        projectPath: session.projectPath || ""
      }
    });
  }

  digests = digests.map((d) => ({
    ...d,
    entry: { ...d.entry, content: truncate(d.entry.content, CONTENT_CHARS) }
  }));

  return {
    digests,
    notes,
    sessions,
    citations,
    fallback,
    noteMatchTotal,
    executedSearches: { reports: !notesOnly, notes: true, sessions: !notesOnly },
    catalogDb,
    desktopDb
  };
}
