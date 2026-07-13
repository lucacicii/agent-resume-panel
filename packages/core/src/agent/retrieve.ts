import { AgentProvider } from "../catalog/types";
import { ensureCatalogSchema } from "../catalog/db";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { embedTextsDetailed } from "../llm/embeddings";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import { MemoryEntry } from "../memory/schema";
import { listMemoryEntries, listMemoryLinks } from "../memory/store";
import { searchMemoryByEmbedding } from "../memory/search";
import { NoteSearchHit, searchNotesByEmbedding } from "../notes/search";
import type { NoteIndexProgressCallback } from "../notes/vectorIndex";
import { recordLlmUsage } from "../usage/store";
import { AgentCitation } from "./types";

const DEFAULT_LIMIT = 8;
const CONTENT_CHARS = 2000;
const DEFAULT_NOTE_LIMIT = 6;
const NOTE_CONTEXT_CHARS = 8000;

export interface RetrievedDigest {
  entry: MemoryEntry;
  score?: number;
}

export interface RetrieveAgentContextResult {
  digests: RetrievedDigest[];
  notes: NoteSearchHit[];
  citations: AgentCitation[];
  fallback: boolean;
  dbPath: string;
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
  const dbPath = options.panelHome
    ? catalogDbPath(panelHome)
    : catalogDbFromSettings(settings, options.panelHome);

  await ensureCatalogSchema(dbPath);

  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 16));
  let digests: RetrievedDigest[] = [];
  let notes: NoteSearchHit[] = [];
  let fallback = false;
  let queryVector: number[] | undefined;

  const embedding = embeddingConfigFromSettings(settings);
  if (embedding) {
    try {
      const result = await embedTextsDetailed(embedding, [options.query.slice(0, 8000)]);
      queryVector = result.vectors[0];
      try {
        await recordLlmUsage(dbPath, {
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

  try {
    if (!queryVector) {
      throw new Error("Query embedding is unavailable.");
    }
    const hits = await searchMemoryByEmbedding({
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
    const dailies = await listMemoryEntries(dbPath, { level: "daily", limit: Math.ceil(limit / 2) });
    const weeklies = await listMemoryEntries(dbPath, { level: "weekly", limit: Math.ceil(limit / 2) });
    const merged = [...dailies, ...weeklies].sort((a, b) => b.periodStartMs - a.periodStartMs);
    digests = merged.slice(0, limit).map((entry) => ({ entry }));
  }

  try {
    if (!queryVector) {
      throw new Error("Query embedding is unavailable.");
    }
    const hits = await searchNotesByEmbedding({
      panelHome: options.panelHome,
      query: options.query,
      limit: DEFAULT_NOTE_LIMIT,
      queryVector,
      onIndexProgress: options.onNoteIndexProgress
    });
    let remaining = NOTE_CONTEXT_CHARS;
    for (const hit of hits) {
      if (remaining <= 0) {
        break;
      }
      const content = truncate(hit.content, Math.min(CONTENT_CHARS, remaining));
      notes.push({ ...hit, content });
      remaining -= content.length;
    }
  } catch {
    // Notes are an optional source; Memory retrieval should still answer independently.
  }

  const citations: AgentCitation[] = [];
  for (let i = 0; i < digests.length; i++) {
    const { entry, score } = digests[i];
    const links = await listMemoryLinks(dbPath, entry.id);
    const first = links.find((l) => l.provider && l.agentSessionId);
    citations.push({
      source: "memory",
      index: i + 1,
      memoryId: entry.id,
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

  // Truncate digests for prompt packing (mutate copy content only in ask)
  digests = digests.map((d) => ({
    ...d,
    entry: { ...d.entry, content: truncate(d.entry.content, CONTENT_CHARS) }
  }));

  return { digests, notes, citations, fallback, dbPath };
}
