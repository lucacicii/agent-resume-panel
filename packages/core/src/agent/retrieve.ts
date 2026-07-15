import { AgentProvider } from "../catalog/types";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { embedTextsDetailed } from "../llm/embeddings";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import { ReportEntry } from "../report/schema";
import { listReportEntries, listReportLinks } from "../report/store";
import { searchReportsByEmbedding } from "../report/search";
import { NoteSearchHit, searchNotesByEmbedding } from "../notes/search";
import type { NoteIndexProgressCallback } from "../notes/vectorIndex";
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

export interface RetrievedDigest {
  entry: ReportEntry;
  score?: number;
}

export interface RetrieveAgentContextResult {
  digests: RetrievedDigest[];
  notes: NoteSearchHit[];
  citations: AgentCitation[];
  fallback: boolean;
  noteMatchTotal?: number;
  catalogDb: string;
  desktopDb: string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[...truncated...]`;
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

  digests = digests.map((d) => ({
    ...d,
    entry: { ...d.entry, content: truncate(d.entry.content, CONTENT_CHARS) }
  }));

  return { digests, notes, citations, fallback, noteMatchTotal, catalogDb, desktopDb };
}