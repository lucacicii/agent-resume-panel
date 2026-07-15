import * as fs from "node:fs/promises";
import { ensureCatalogSchema } from "../catalog/db";
import { embedTextsDetailed } from "../llm/embeddings";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { runSqliteJson } from "../sqlite";
import { recordLlmUsage } from "../usage/store";
import { cosineSimilarity, parseEmbeddingJson } from "../report/cosine";
import { listAllNotes } from "./catalogNotes";
import { parseNoteDocument } from "./frontmatter";
import { absFromRelMdPath } from "./paths";
import {
  NoteSearchPlan,
  planNoteSearchDeterministically
} from "./queryPlan";
import { reconcileNotesIndex } from "./reconcile";
import { ensureNotesVectorIndex } from "./vectorIndex";
import type { NoteIndexProgressCallback } from "./vectorIndex";

const DEFAULT_LIMIT = 6;
const DEFAULT_EXACT_LIMIT = 50;
const MAX_EXACT_LIMIT = 200;
const DEFAULT_CANDIDATE_LIMIT = 10000;
const DEFAULT_MIN_SCORE = 0.15;
const CANDIDATE_PAGE_SIZE = 200;
const EXACT_EXCERPT_CHARS = 360;

interface NoteChunkRow {
  chunk_id: string;
  note_id: string;
  rel_md_path: string;
  scope: string;
  project_path: string | null;
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
  projectPath?: string;
  title?: string;
  heading?: string;
  chunkIndex: number;
  content: string;
  updatedAtMs: number;
  score: number;
  matchType?: "exact" | "semantic";
  matchedTerms?: string[];
  exactMatchTotal?: number;
}

export function isNotesOnlyQuery(query: string): boolean {
  return planNoteSearchDeterministically(query).notesOnly;
}

export function extractExactNoteSearchTerms(query: string): string[] {
  const plan = planNoteSearchDeterministically(query);
  return plan.mode === "exact" ? plan.terms : [];
}

function rowToHit(row: NoteChunkRow, score: number): NoteSearchHit {
  return {
    chunkId: row.chunk_id,
    noteId: row.note_id,
    relMdPath: row.rel_md_path,
    scope: row.scope,
    projectPath: row.project_path ?? undefined,
    title: row.title ?? undefined,
    heading: row.heading ?? undefined,
    chunkIndex: row.chunk_index,
    content: row.content,
    updatedAtMs: row.updated_at_ms,
    score
  };
}

function exactExcerpt(content: string, terms: string[]): string {
  const lowerTerms = terms.map((term) => term.toLowerCase());
  const matchingLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const lower = line.toLowerCase();
      return lowerTerms.some((term) => lower.includes(term));
    });
  const excerpt = [...new Set(matchingLines)].join("\n").trim();
  if (excerpt) {
    return excerpt.slice(0, EXACT_EXCERPT_CHARS);
  }
  const lower = content.toLowerCase();
  const firstIndex = lowerTerms.reduce((best, term) => {
    const index = lower.indexOf(term);
    return index >= 0 && (best < 0 || index < best) ? index : best;
  }, -1);
  if (firstIndex < 0) {
    return content.slice(0, EXACT_EXCERPT_CHARS);
  }
  const start = Math.max(0, firstIndex - 120);
  return content.slice(start, start + EXACT_EXCERPT_CHARS).trim();
}

function exactNoteExcerpt(
  note: { title?: string; filename: string; relMdPath: string },
  body: string,
  plan: NoteSearchPlan
): string {
  const bodyExcerpt = exactExcerpt(body, plan.terms);
  const lowerBody = body.toLocaleLowerCase();
  if (plan.terms.some((term) => lowerBody.includes(term.toLocaleLowerCase()))) {
    return bodyExcerpt;
  }
  const metadata: string[] = [];
  if (plan.fields.includes("title") && note.title) metadata.push(`title: ${note.title}`);
  if (plan.fields.includes("filename")) metadata.push(`filename: ${note.filename}`);
  if (plan.fields.includes("path")) metadata.push(`path: ${note.relMdPath}`);
  return metadata.join("\n").slice(0, EXACT_EXCERPT_CHARS) || bodyExcerpt;
}

async function searchExactNotesFromDisk(
  dbPath: string,
  panelHome: string,
  plan: NoteSearchPlan,
  limit: number
): Promise<NoteSearchHit[]> {
  await reconcileNotesIndex(dbPath, panelHome);
  const notes = await listAllNotes(dbPath);
  const lowerTerms = plan.terms.map((term) => term.toLocaleLowerCase());
  const hits: NoteSearchHit[] = [];
  let totalMatches = 0;
  for (const note of notes) {
    try {
      const raw = await fs.readFile(absFromRelMdPath(panelHome, note.relMdPath), "utf8");
      const body = parseNoteDocument(raw).body;
      const fieldValues = plan.fields.map((field) => {
        if (field === "content") return body;
        if (field === "title") return note.title || "";
        if (field === "filename") return note.filename;
        return note.relMdPath;
      });
      const haystack = fieldValues
        .filter(Boolean)
        .join("\n")
        .toLocaleLowerCase();
      const matches = lowerTerms.map((term) => haystack.includes(term));
      if (plan.operator === "all" ? !matches.every(Boolean) : !matches.some(Boolean)) {
        continue;
      }
      totalMatches += 1;
      if (hits.length < limit) {
        hits.push({
          chunkId: `exact:${note.noteId}`,
          noteId: note.noteId,
          relMdPath: note.relMdPath,
          scope: note.scope,
          projectPath: note.projectPath,
          title: note.title,
          chunkIndex: 0,
          content: exactNoteExcerpt(note, body, plan),
          updatedAtMs: note.updatedAtMs,
          score: 1,
          matchType: "exact",
          matchedTerms: plan.terms
        });
      }
    } catch {
      // A temporarily unreadable note should not prevent other exact matches.
    }
  }
  for (const hit of hits) {
    hit.exactMatchTotal = totalMatches;
  }
  return hits;
}

export async function searchNotesByEmbedding(options: {
  query: string;
  panelHome?: string;
  limit?: number;
  candidateLimit?: number;
  minScore?: number;
  queryVector?: number[];
  onIndexProgress?: NoteIndexProgressCallback;
  plan?: NoteSearchPlan;
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
  await ensureCatalogSchema(dbPath);
  const plan = options.plan ?? planNoteSearchDeterministically(query);
  if (plan.mode === "exact") {
    const exactLimit = Math.max(1, Math.min(options.limit ?? DEFAULT_EXACT_LIMIT, MAX_EXACT_LIMIT));
    return searchExactNotesFromDisk(dbPath, panelHome, plan, exactLimit);
  }

  const embedding = embeddingConfigFromSettings(settings);
  if (!embedding) {
    throw new Error(
      "Embedding is not configured. Set embedding.model (and llm/embedding API key) in settings.json."
    );
  }
  await ensureNotesVectorIndex({
    dbPath,
    panelHome,
    embedding,
    onProgress: options.onIndexProgress
  });

  let queryVector = options.queryVector;
  if (!queryVector) {
    const queryResult = await embedTextsDetailed(embedding, [plan.semanticQuery.slice(0, 8000)]);
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
      `SELECT c.chunk_id, c.note_id, c.rel_md_path, c.scope, c.title, c.heading, c.chunk_index,
              c.content, c.embedding_json, c.updated_at_ms, n.project_path
       FROM note_chunks c LEFT JOIN notes n ON c.note_id = n.note_id
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
      hits.push({ ...rowToHit(row, score), matchType: "semantic" });
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
