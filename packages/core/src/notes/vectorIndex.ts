import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { ensureDesktopDbSchema, ensureExtensionCatalogSchema } from "../catalog/db";
import { embedTextsDetailed } from "../llm/embeddings";
import { EmbeddingRuntimeConfig } from "../llm/types";
import { escapeSqlLiteral, runSqliteJson, runSqliteTransaction } from "../sqlite";
import { recordLlmUsage } from "../usage/store";
import { listAllNotes, NoteRecord } from "./catalogNotes";
import { parseNoteDocument } from "./frontmatter";
import { absFromRelMdPath } from "./paths";
import { createUiText } from "../i18n/uiText";
import { loadSettings } from "../settings/store";
import { reconcileNotesIndex } from "./reconcile";

const CHUNK_TARGET_CHARS = 1400;
const CHUNK_MAX_CHARS = 1800;
const MAX_CHUNKS_PER_NOTE = 80;
const EMBEDDING_BATCH_SIZE = 24;

export type NoteIndexProgressPhase = "scanning" | "indexing" | "embedding" | "complete" | "error";

export interface NoteIndexProgressEvent {
  phase: NoteIndexProgressPhase;
  message: string;
  current?: number;
  total?: number;
  noteTitle?: string;
  chunkCurrent?: number;
  chunkTotal?: number;
}

export type NoteIndexProgressCallback = (event: NoteIndexProgressEvent) => void | Promise<void>;

const indexTasks = new Map<
  string,
  {
    promise: Promise<{ indexedNotes: number; indexedChunks: number }>;
    listeners: Set<NoteIndexProgressCallback>;
  }
>();

interface NoteVectorIndexRow {
  note_id: string;
  rel_md_path: string;
  scope: string;
  title: string | null;
  source_mtime_ms: number;
  content_hash: string;
  embedding_key: string;
}

export interface NoteChunkInput {
  heading?: string;
  content: string;
  contentHash: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function embeddingKey(config: EmbeddingRuntimeConfig): string {
  return hash(`${config.baseUrl}\n${config.model}`);
}

function splitLongBlock(block: string): string[] {
  if (block.length <= CHUNK_MAX_CHARS) {
    return [block];
  }
  const parts: string[] = [];
  let remaining = block;
  while (remaining.length > CHUNK_MAX_CHARS) {
    let end = remaining.lastIndexOf("\n", CHUNK_MAX_CHARS);
    if (end < CHUNK_TARGET_CHARS / 2) {
      end = remaining.lastIndexOf("。", CHUNK_MAX_CHARS);
    }
    if (end < CHUNK_TARGET_CHARS / 2) {
      end = remaining.lastIndexOf(". ", CHUNK_MAX_CHARS);
      if (end >= CHUNK_TARGET_CHARS / 2) {
        end += 1;
      }
    }
    if (end < CHUNK_TARGET_CHARS / 2) {
      end = CHUNK_MAX_CHARS;
    }
    parts.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts.filter(Boolean);
}

export function chunkNoteMarkdown(body: string): NoteChunkInput[] {
  const sections: Array<{ heading?: string; blocks: string[] }> = [];
  let current: { heading?: string; blocks: string[] } = { blocks: [] };
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const value = paragraph.join("\n").trim();
    if (value) {
      current.blocks.push(...splitLongBlock(value));
    }
    paragraph = [];
  };
  const flushSection = () => {
    flushParagraph();
    if (current.blocks.length) {
      sections.push(current);
    }
  };

  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flushSection();
      current = { heading: heading[2].trim(), blocks: [] };
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushSection();

  const chunks: NoteChunkInput[] = [];
  for (const section of sections) {
    let packed = "";
    const pushPacked = () => {
      const content = packed.trim();
      if (content) {
        chunks.push({ heading: section.heading, content, contentHash: hash(content) });
      }
      packed = "";
    };
    for (const block of section.blocks) {
      if (!packed) {
        packed = block;
      } else if (packed.length + 2 + block.length <= CHUNK_MAX_CHARS) {
        packed += `\n\n${block}`;
      } else {
        pushPacked();
        packed = block;
      }
    }
    pushPacked();
  }
  return chunks.slice(0, MAX_CHUNKS_PER_NOTE);
}

async function indexRows(dbPath: string): Promise<Map<string, NoteVectorIndexRow>> {
  const rows = await runSqliteJson<NoteVectorIndexRow>(
    dbPath,
    "SELECT note_id, rel_md_path, scope, title, source_mtime_ms, content_hash, embedding_key FROM note_vector_index;"
  );
  return new Map(rows.map((row) => [row.note_id, row]));
}

async function embedChunks(
  dbPath: string,
  config: EmbeddingRuntimeConfig,
  note: NoteRecord,
  chunks: NoteChunkInput[],
  noteCurrent: number,
  noteTotal: number,
  onProgress: NoteIndexProgressCallback | undefined,
  pt: (key: string, ...args: (string | number)[]) => string
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const result = await embedTextsDetailed(
      config,
      batch.map((chunk) => [note.title || note.filename, chunk.heading, chunk.content].filter(Boolean).join("\n"))
    );
    vectors.push(...result.vectors);
    await onProgress?.({
      phase: "embedding",
      message: pt(
        "desktop.notes.generatingVectors",
        Math.min(i + batch.length, chunks.length),
        chunks.length
      ),
      current: noteCurrent,
      total: noteTotal,
      noteTitle: note.title || note.filename,
      chunkCurrent: Math.min(i + batch.length, chunks.length),
      chunkTotal: chunks.length
    });
    try {
      await recordLlmUsage(dbPath, {
        kind: "embedding",
        source: "ask",
        jobKey: `notes:${note.noteId}`,
        model: result.model,
        usage: result.usage,
        durationMs: result.durationMs,
        ok: true
      });
    } catch {
      // Usage accounting must not invalidate a completed index batch.
    }
  }
  return vectors;
}

async function replaceNoteChunks(
  dbPath: string,
  note: NoteRecord,
  sourceMtimeMs: number,
  bodyHash: string,
  key: string,
  chunks: NoteChunkInput[],
  vectors: number[][]
): Promise<void> {
  if (chunks.length !== vectors.length) {
    throw new Error(`Embedding count mismatch for note ${note.noteId}.`);
  }
  const statements = [`DELETE FROM note_chunks WHERE note_id = '${escapeSqlLiteral(note.noteId)}'`];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkId = hash(`${note.noteId}\n${i}\n${chunk.contentHash}`);
    statements.push(
      `INSERT INTO note_chunks (
         chunk_id, note_id, rel_md_path, scope, title, heading, chunk_index,
         content, content_hash, embedding_json, updated_at_ms
       ) VALUES (
         '${chunkId}',
         '${escapeSqlLiteral(note.noteId)}',
         '${escapeSqlLiteral(note.relMdPath)}',
         '${escapeSqlLiteral(note.scope)}',
         ${note.title ? `'${escapeSqlLiteral(note.title)}'` : "NULL"},
         ${chunk.heading ? `'${escapeSqlLiteral(chunk.heading)}'` : "NULL"},
         ${i},
         '${escapeSqlLiteral(chunk.content)}',
         '${chunk.contentHash}',
         '${escapeSqlLiteral(JSON.stringify(vectors[i]))}',
         ${Math.floor(note.updatedAtMs)}
       )`
    );
  }
  statements.push(
    `INSERT INTO note_vector_index (
       note_id, rel_md_path, scope, title, source_mtime_ms, content_hash, embedding_key, indexed_at_ms
     ) VALUES (
       '${escapeSqlLiteral(note.noteId)}',
       '${escapeSqlLiteral(note.relMdPath)}',
       '${escapeSqlLiteral(note.scope)}',
       ${note.title ? `'${escapeSqlLiteral(note.title)}'` : "NULL"},
       ${Math.floor(sourceMtimeMs)},
       '${bodyHash}',
       '${key}',
       ${Date.now()}
     ) ON CONFLICT(note_id) DO UPDATE SET
       rel_md_path = excluded.rel_md_path,
       scope = excluded.scope,
       title = excluded.title,
       source_mtime_ms = excluded.source_mtime_ms,
       content_hash = excluded.content_hash,
       embedding_key = excluded.embedding_key,
       indexed_at_ms = excluded.indexed_at_ms`
  );
  await runSqliteTransaction(dbPath, statements);
}

async function runNotesVectorIndex(options: {
  catalogDb: string;
  desktopDb: string;
  panelHome: string;
  embedding: EmbeddingRuntimeConfig;
  onProgress?: NoteIndexProgressCallback;
  systemLocale?: string;
}): Promise<{ indexedNotes: number; indexedChunks: number }> {
  const settings = await loadSettings(options.panelHome);
  const pt = createUiText(settings, options.systemLocale);
  await options.onProgress?.({ phase: "scanning", message: pt("desktop.notes.scanningNotes") });
  await ensureExtensionCatalogSchema(options.catalogDb);
  await ensureDesktopDbSchema(options.desktopDb);
  await reconcileNotesIndex(options.catalogDb, options.panelHome);
  const notes = await listAllNotes(options.catalogDb);
  const existing = await indexRows(options.desktopDb);
  const currentIds = new Set(notes.map((note) => note.noteId));
  const staleIds = [...existing.keys()].filter((noteId) => !currentIds.has(noteId));
  if (staleIds.length) {
    const ids = staleIds.map((id) => `'${escapeSqlLiteral(id)}'`).join(", ");
    await runSqliteTransaction(options.desktopDb, [
      `DELETE FROM note_chunks WHERE note_id IN (${ids})`,
      `DELETE FROM note_vector_index WHERE note_id IN (${ids})`
    ]);
  }

  const key = embeddingKey(options.embedding);
  const pendingNotes = notes.filter((note) => {
    const state = existing.get(note.noteId);
    const sourceMtimeMs = Math.floor(note.fsMtimeMs ?? note.updatedAtMs);
    const metadataMatches =
      state?.rel_md_path === note.relMdPath &&
      state?.scope === note.scope &&
      (state?.title ?? undefined) === note.title;
    return !(
      state &&
      metadataMatches &&
      state.source_mtime_ms === sourceMtimeMs &&
      state.embedding_key === key
    );
  });
  let indexedNotes = 0;
  let indexedChunks = 0;
  for (let noteIndex = 0; noteIndex < pendingNotes.length; noteIndex++) {
    const note = pendingNotes[noteIndex];
    try {
      await options.onProgress?.({
        phase: "indexing",
        message: pt("desktop.notes.indexingProgress", noteIndex + 1, pendingNotes.length),
        current: noteIndex,
        total: pendingNotes.length,
        noteTitle: note.title || note.filename
      });
      const sourceMtimeMs = Math.floor(note.fsMtimeMs ?? note.updatedAtMs);
      const state = existing.get(note.noteId);

      const raw = await fs.readFile(absFromRelMdPath(options.panelHome, note.relMdPath), "utf8");
      const body = parseNoteDocument(raw).body.trim();
      const bodyHash = hash(body);
      if (state && state.content_hash === bodyHash && state.embedding_key === key) {
        await runSqliteTransaction(options.desktopDb, [
          `UPDATE note_chunks SET
             rel_md_path = '${escapeSqlLiteral(note.relMdPath)}',
             scope = '${escapeSqlLiteral(note.scope)}',
             title = ${note.title ? `'${escapeSqlLiteral(note.title)}'` : "NULL"},
             updated_at_ms = ${Math.floor(note.updatedAtMs)}
           WHERE note_id = '${escapeSqlLiteral(note.noteId)}'`,
          `UPDATE note_vector_index SET
             rel_md_path = '${escapeSqlLiteral(note.relMdPath)}',
             scope = '${escapeSqlLiteral(note.scope)}',
             title = ${note.title ? `'${escapeSqlLiteral(note.title)}'` : "NULL"},
             source_mtime_ms = ${sourceMtimeMs},
             indexed_at_ms = ${Date.now()}
           WHERE note_id = '${escapeSqlLiteral(note.noteId)}'`
        ]);
        continue;
      }

      const chunks = chunkNoteMarkdown(body);
      const vectors = chunks.length
        ? await embedChunks(
            options.desktopDb,
            options.embedding,
            note,
            chunks,
            noteIndex,
            pendingNotes.length,
            options.onProgress,
            pt
          )
        : [];
      await replaceNoteChunks(
        options.desktopDb,
        note,
        sourceMtimeMs,
        bodyHash,
        key,
        chunks,
        vectors
      );
      indexedNotes += 1;
      indexedChunks += chunks.length;
    } catch {
      // Keep existing chunks searchable when one note cannot be read or embedded.
    }
    await options.onProgress?.({
      phase: "indexing",
      message: pt("desktop.notes.indexingProgress", noteIndex + 1, pendingNotes.length),
      current: noteIndex + 1,
      total: pendingNotes.length,
      noteTitle: note.title || note.filename
    });
  }
  await options.onProgress?.({
    phase: "complete",
    message: indexedNotes
      ? pt("desktop.notes.indexComplete", indexedNotes, indexedChunks)
      : pt("desktop.notes.indexUpToDate"),
    current: pendingNotes.length,
    total: pendingNotes.length
  });
  return { indexedNotes, indexedChunks };
}

export async function ensureNotesVectorIndex(options: {
  catalogDb: string;
  desktopDb: string;
  panelHome: string;
  embedding: EmbeddingRuntimeConfig;
  onProgress?: NoteIndexProgressCallback;
  systemLocale?: string;
}): Promise<{ indexedNotes: number; indexedChunks: number }> {
  const key = `${options.catalogDb}\n${options.desktopDb}\n${embeddingKey(options.embedding)}`;
  const existing = indexTasks.get(key);
  if (existing) {
    if (options.onProgress) {
      existing.listeners.add(options.onProgress);
    }
    return existing.promise;
  }

  const listeners = new Set<NoteIndexProgressCallback>();
  if (options.onProgress) {
    listeners.add(options.onProgress);
  }
  const notify: NoteIndexProgressCallback = async (event) => {
    await Promise.allSettled([...listeners].map((listener) => Promise.resolve(listener(event))));
  };
  const promise = runNotesVectorIndex({ ...options, onProgress: notify }).finally(() => {
    indexTasks.delete(key);
  });
  indexTasks.set(key, { promise, listeners });
  return promise;
}
