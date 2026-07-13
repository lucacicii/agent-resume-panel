import { ensureCatalogSchema } from "../catalog/db";
import { embedTextsDetailed } from "../llm/embeddings";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { runSqliteJson } from "../sqlite";
import { recordLlmUsage } from "../usage/store";
import { cosineSimilarity, parseEmbeddingJson } from "../memory/cosine";
import { ensureNotesVectorIndex } from "./vectorIndex";
import type { NoteIndexProgressCallback } from "./vectorIndex";

const DEFAULT_LIMIT = 6;
const DEFAULT_CANDIDATE_LIMIT = 10000;
const DEFAULT_MIN_SCORE = 0.15;
const CANDIDATE_PAGE_SIZE = 200;

interface NoteChunkRow {
  chunk_id: string;
  note_id: string;
  rel_md_path: string;
  scope: string;
  title: string | null;
  heading: string | null;
  chunk_index: number;
  content: string;
  embedding_json: string;
  updated_at_ms: number;
}

export interface NoteSearchHit {
  chunkId: string;
  noteId: string;
  relMdPath: string;
  scope: string;
  title?: string;
  heading?: string;
  chunkIndex: number;
  content: string;
  updatedAtMs: number;
  score: number;
}

export async function searchNotesByEmbedding(options: {
  query: string;
  panelHome?: string;
  limit?: number;
  candidateLimit?: number;
  minScore?: number;
  queryVector?: number[];
  onIndexProgress?: NoteIndexProgressCallback;
}): Promise<NoteSearchHit[]> {
  const query = options.query?.trim();
  if (!query) {
    throw new Error("Search query is empty.");
  }
  const settings = await loadSettings(options.panelHome);
  const panelHome = options.panelHome
    ? resolvePanelHome(options.panelHome)
    : effectivePanelHome(settings, options.panelHome);
  const dbPath = options.panelHome
    ? catalogDbPath(panelHome)
    : catalogDbFromSettings(settings, options.panelHome);
  const embedding = embeddingConfigFromSettings(settings);
  if (!embedding) {
    throw new Error(
      "Embedding is not configured. Set embedding.model (and llm/embedding API key) in settings.json."
    );
  }

  await ensureCatalogSchema(dbPath);
  await ensureNotesVectorIndex({
    dbPath,
    panelHome,
    embedding,
    onProgress: options.onIndexProgress
  });

  let queryVector = options.queryVector;
  if (!queryVector) {
    const queryResult = await embedTextsDetailed(embedding, [query.slice(0, 8000)]);
    try {
      await recordLlmUsage(dbPath, {
        kind: "embedding",
        source: "ask",
        jobKey: "notes:query",
        model: queryResult.model,
        usage: queryResult.usage,
        durationMs: queryResult.durationMs,
        ok: true
      });
    } catch {
      // non-fatal
    }
    queryVector = queryResult.vectors[0];
  }
  if (!queryVector) {
    return [];
  }

  const candidateLimit = Math.max(1, Math.min(options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT, 10000));
  const hits: NoteSearchHit[] = [];
  for (let offset = 0; offset < candidateLimit; offset += CANDIDATE_PAGE_SIZE) {
    const pageSize = Math.min(CANDIDATE_PAGE_SIZE, candidateLimit - offset);
    const rows = await runSqliteJson<NoteChunkRow>(
      dbPath,
      `SELECT chunk_id, note_id, rel_md_path, scope, title, heading, chunk_index,
              content, embedding_json, updated_at_ms
       FROM note_chunks
       ORDER BY updated_at_ms DESC, note_id, chunk_index
       LIMIT ${pageSize} OFFSET ${offset};`
    );
    for (const row of rows) {
      const vector = parseEmbeddingJson(row.embedding_json);
      if (!vector) {
        continue;
      }
      const score = cosineSimilarity(queryVector, vector);
      if (score == null || score < (options.minScore ?? DEFAULT_MIN_SCORE)) {
        continue;
      }
      hits.push({
        chunkId: row.chunk_id,
        noteId: row.note_id,
        relMdPath: row.rel_md_path,
        scope: row.scope,
        title: row.title ?? undefined,
        heading: row.heading ?? undefined,
        chunkIndex: row.chunk_index,
        content: row.content,
        updatedAtMs: row.updated_at_ms,
        score
      });
    }
    if (rows.length < pageSize) {
      break;
    }
  }
  hits.sort((a, b) => b.score - a.score);

  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 16));
  const selected: NoteSearchHit[] = [];
  const perNote = new Map<string, number>();
  for (const hit of hits) {
    if ((perNote.get(hit.noteId) ?? 0) >= 2) {
      continue;
    }
    selected.push(hit);
    perNote.set(hit.noteId, (perNote.get(hit.noteId) ?? 0) + 1);
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
}
