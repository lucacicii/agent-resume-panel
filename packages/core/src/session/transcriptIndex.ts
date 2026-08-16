import { createHash } from "node:crypto";
import { ensureDesktopDbSchema } from "../catalog/db";
import {
  SessionSearchFilters,
  SessionSearchHit,
  SESSION_SUMMARY_PREVIEW_CHARS,
  clampSessionSearchLimit,
  sanitizeLikeFragment
} from "../catalog/search";
import { AgentProvider, AgentSession, CatalogSessionRow, toAgentSession } from "../catalog/types";
import { isGtdStatus } from "../gtd/types";
import { embedTextsDetailed } from "../llm/embeddings";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import { EmbeddingRuntimeConfig } from "../llm/types";
import { cosineSimilarity, parseEmbeddingJson } from "../report/cosine";
import { PanelSettings } from "../settings/types";
import { escapeSqlLiteral, runSqlite, runSqliteJson, runSqliteTransaction } from "../sqlite";
import { formatTranscript, loadSessionPreview } from "../transcript/load";
import { resolvePreviewHomes } from "../transcript/homes";
import { recordLlmUsage } from "../usage/store";
import { sessionEmbeddingKey } from "./embedStore";

const CHUNK_TARGET_CHARS = 1400;
const CHUNK_MAX_CHARS = 1800;
const MAX_CHUNKS_PER_SESSION = 40;
const EMBEDDING_BATCH_SIZE = 16;

export interface TranscriptChunkInput {
  content: string;
  contentHash: string;
  chunkIndex: number;
}

export interface TranscriptChunkVectorRow {
  chunk_id: string;
  provider: string;
  agent_session_id: string;
  chunk_index: number;
  content: string;
  content_hash: string;
  embedding_json: string;
  embedding_key: string;
  source_hash: string;
  updated_at_ms: number;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

/**
 * Split a full session transcript into embeddable chunks (deterministic).
 */
export function chunkTranscriptText(transcript: string): TranscriptChunkInput[] {
  const normalized = transcript.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const blocks: string[] = [];
  for (const para of normalized.split(/\n\n+/)) {
    const trimmed = para.trim();
    if (!trimmed) {
      continue;
    }
    blocks.push(...splitLongBlock(trimmed));
  }

  const packed: string[] = [];
  let current = "";
  const flush = () => {
    const value = current.trim();
    if (value) {
      packed.push(value);
    }
    current = "";
  };

  for (const block of blocks) {
    if (!current) {
      current = block;
    } else if (current.length + 2 + block.length <= CHUNK_MAX_CHARS) {
      current += `\n\n${block}`;
    } else {
      flush();
      current = block;
    }
  }
  flush();

  return packed.slice(0, MAX_CHUNKS_PER_SESSION).map((content, chunkIndex) => ({
    content,
    contentHash: hash(content),
    chunkIndex
  }));
}

export function transcriptSourceHash(transcript: string, embeddingKey: string): string {
  return hash(`${transcript.trim()}\n${embeddingKey}`);
}

export interface RankableTranscriptChunk {
  provider: string;
  sessionId: string;
  content: string;
  vector: number[];
  chunkIndex?: number;
}

export interface RankedTranscriptSession {
  provider: string;
  sessionId: string;
  score: number;
  bestChunkContent: string;
  chunkIndex?: number;
}

/**
 * Pure ranking: max cosine score per session. Used by search and unit tests with fixture vectors.
 */
export function rankSessionsByTranscriptChunks(
  queryVector: number[],
  chunks: RankableTranscriptChunk[],
  options?: { minScore?: number; limit?: number }
): RankedTranscriptSession[] {
  const minScore = options?.minScore ?? 0.15;
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const best = new Map<string, RankedTranscriptSession>();

  for (const chunk of chunks) {
    const score = cosineSimilarity(queryVector, chunk.vector);
    if (score == null || score < minScore) {
      continue;
    }
    const key = `${chunk.provider}:${chunk.sessionId}`;
    const existing = best.get(key);
    if (!existing || score > existing.score) {
      best.set(key, {
        provider: chunk.provider,
        sessionId: chunk.sessionId,
        score,
        bestChunkContent: chunk.content,
        chunkIndex: chunk.chunkIndex
      });
    }
  }

  return Array.from(best.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function truncatePreview(text: string | null | undefined, max = SESSION_SUMMARY_PREVIEW_CHARS): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}\n[...truncated...]`;
}

function sessionPassesFilters(
  row: CatalogSessionRow & { gtd_status?: string | null },
  filters: SessionSearchFilters | undefined
): boolean {
  if (!filters) {
    return row.hidden === 0;
  }
  if (!filters.includeHidden && row.hidden !== 0) {
    return false;
  }
  const provider = filters.provider?.trim();
  if (provider && row.provider !== provider) {
    return false;
  }
  const projectPath = filters.projectPath?.trim();
  if (projectPath) {
    const frag = sanitizeLikeFragment(projectPath).toLowerCase();
    if (frag && !row.project_path.toLowerCase().includes(frag)) {
      return false;
    }
  }
  if (filters.fromMs != null && Number.isFinite(filters.fromMs) && row.updated_at_ms < Math.floor(filters.fromMs)) {
    return false;
  }
  if (filters.toMs != null && Number.isFinite(filters.toMs) && row.updated_at_ms >= Math.floor(filters.toMs)) {
    return false;
  }
  const gtd = filters.gtdStatus?.trim();
  if (gtd && isGtdStatus(gtd) && row.gtd_status !== gtd) {
    return false;
  }
  return true;
}

export async function listTranscriptChunkRows(
  desktopDb: string,
  options?: { embeddingKey?: string; limit?: number }
): Promise<TranscriptChunkVectorRow[]> {
  await ensureDesktopDbSchema(desktopDb);
  const limit = Math.max(1, Math.min(options?.limit ?? 2000, 10_000));
  const key = options?.embeddingKey?.trim();
  const keyClause = key ? `WHERE embedding_key = '${escapeSqlLiteral(key)}'` : "";
  return runSqliteJson<TranscriptChunkVectorRow>(
    desktopDb,
    `SELECT chunk_id, provider, agent_session_id, chunk_index, content, content_hash,
      embedding_json, embedding_key, source_hash, updated_at_ms
     FROM session_transcript_chunks
     ${keyClause}
     ORDER BY updated_at_ms DESC
     LIMIT ${limit};`
  );
}

export interface IndexSessionTranscriptOptions {
  desktopDb: string;
  settings: PanelSettings;
  session: AgentSession;
  /** Full transcript text. When omitted, load via preview homes. */
  transcriptText?: string;
  panelHome?: string;
  jobKey?: string;
  /** Force re-embed even when source_hash matches. */
  force?: boolean;
}

export interface IndexSessionTranscriptResult {
  indexed: boolean;
  skipped?: "no_embedding_config" | "empty_transcript" | "unchanged" | "unsupported" | "embed_failed";
  chunkCount?: number;
  error?: string;
}

/**
 * Index one session's transcript into chunk embeddings (best-effort).
 */
export async function indexSessionTranscript(
  options: IndexSessionTranscriptOptions
): Promise<IndexSessionTranscriptResult> {
  let emb: EmbeddingRuntimeConfig | undefined;
  try {
    emb = embeddingConfigFromSettings(options.settings);
  } catch {
    emb = undefined;
  }
  if (!emb) {
    return { indexed: false, skipped: "no_embedding_config" };
  }

  const provider = options.session.provider;

  await ensureDesktopDbSchema(options.desktopDb);

  let transcript = options.transcriptText?.trim() || "";
  if (!transcript) {
    try {
      const homes = resolvePreviewHomes(options.settings, options.panelHome);
      const preview = await loadSessionPreview(options.session, homes);
      if (!preview.messages?.length) {
        return { indexed: false, skipped: "empty_transcript" };
      }
      // Prefer recent turns for index size; still hash full used text.
      const recent = preview.messages.slice(-40);
      transcript = formatTranscript(recent);
    } catch (error) {
      return {
        indexed: false,
        skipped: "embed_failed",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  if (!transcript.trim()) {
    return { indexed: false, skipped: "empty_transcript" };
  }

  const embKey = sessionEmbeddingKey(emb);
  const sourceHash = transcriptSourceHash(transcript, embKey);

  if (!options.force) {
    const existing = await runSqliteJson<{ source_hash: string; embedding_key: string }>(
      options.desktopDb,
      `SELECT source_hash, embedding_key FROM session_transcript_index
       WHERE provider = '${escapeSqlLiteral(provider)}'
         AND agent_session_id = '${escapeSqlLiteral(options.session.id)}'
       LIMIT 1;`
    );
    if (existing[0]?.source_hash === sourceHash && existing[0]?.embedding_key === embKey) {
      return { indexed: false, skipped: "unchanged" };
    }
  }

  const chunks = chunkTranscriptText(transcript);
  if (!chunks.length) {
    return { indexed: false, skipped: "empty_transcript" };
  }

  try {
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
      const result = await embedTextsDetailed(
        emb,
        batch.map((c) => c.content.slice(0, 8000))
      );
      vectors.push(...result.vectors);
      try {
        await recordLlmUsage(options.desktopDb, {
          kind: "embedding",
          source: "session_transcript_embed",
          jobKey: options.jobKey || `session_tx_embed:${provider}:${options.session.id}`,
          model: result.model,
          usage: result.usage,
          durationMs: result.durationMs,
          ok: true
        });
      } catch {
        // non-fatal
      }
    }

    if (vectors.length !== chunks.length || vectors.some((v) => !v?.length)) {
      return { indexed: false, skipped: "embed_failed", error: "Incomplete embedding batch." };
    }

    const nowMs = Date.now();
    const statements: string[] = [
      `DELETE FROM session_transcript_chunks
       WHERE provider = '${escapeSqlLiteral(provider)}'
         AND agent_session_id = '${escapeSqlLiteral(options.session.id)}';`
    ];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkId = hash(`${provider}:${options.session.id}:${i}:${chunk.contentHash}:${embKey}`);
      statements.push(
        `INSERT INTO session_transcript_chunks (
           chunk_id, provider, agent_session_id, chunk_index, content, content_hash,
           embedding_json, embedding_key, source_hash, updated_at_ms
         ) VALUES (
           '${escapeSqlLiteral(chunkId)}',
           '${escapeSqlLiteral(provider)}',
           '${escapeSqlLiteral(options.session.id)}',
           ${i},
           '${escapeSqlLiteral(chunk.content)}',
           '${escapeSqlLiteral(chunk.contentHash)}',
           '${escapeSqlLiteral(JSON.stringify(vectors[i]))}',
           '${escapeSqlLiteral(embKey)}',
           '${escapeSqlLiteral(sourceHash)}',
           ${nowMs}
         );`
      );
    }

    statements.push(
      `INSERT INTO session_transcript_index (
         provider, agent_session_id, source_hash, embedding_key, chunk_count, updated_at_ms
       ) VALUES (
         '${escapeSqlLiteral(provider)}',
         '${escapeSqlLiteral(options.session.id)}',
         '${escapeSqlLiteral(sourceHash)}',
         '${escapeSqlLiteral(embKey)}',
         ${chunks.length},
         ${nowMs}
       )
       ON CONFLICT(provider, agent_session_id) DO UPDATE SET
         source_hash = excluded.source_hash,
         embedding_key = excluded.embedding_key,
         chunk_count = excluded.chunk_count,
         updated_at_ms = excluded.updated_at_ms;`
    );

    await runSqliteTransaction(options.desktopDb, statements);
    return { indexed: true, chunkCount: chunks.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { indexed: false, skipped: "embed_failed", error: message };
  }
}

export interface SearchSessionsByTranscriptOptions {
  catalogDb: string;
  desktopDb: string;
  settings: PanelSettings;
  query: string;
  filters?: SessionSearchFilters;
  queryVector?: number[];
  limit?: number;
  minScore?: number;
  candidateLimit?: number;
}

/**
 * Semantic search over transcript chunk embeddings; ranks sessions by best chunk score.
 */
export async function searchSessionsByTranscriptEmbedding(
  options: SearchSessionsByTranscriptOptions
): Promise<SessionSearchHit[]> {
  const query = options.query?.trim();
  if (!query) {
    return [];
  }

  let emb: EmbeddingRuntimeConfig | undefined;
  try {
    emb = options.settings ? embeddingConfigFromSettings(options.settings) : undefined;
  } catch {
    emb = undefined;
  }
  if (!emb && !options.queryVector) {
    return [];
  }

  let queryVector = options.queryVector;
  if (!queryVector) {
    if (!emb) {
      return [];
    }
    try {
      const result = await embedTextsDetailed(emb, [query.slice(0, 8000)]);
      queryVector = result.vectors[0];
      try {
        await recordLlmUsage(options.desktopDb, {
          kind: "embedding",
          source: "session_transcript_embed",
          jobKey: "session_search:transcript_query",
          model: result.model,
          usage: result.usage,
          durationMs: result.durationMs,
          ok: true
        });
      } catch {
        // non-fatal
      }
    } catch {
      return [];
    }
  }
  if (!queryVector?.length) {
    return [];
  }

  const embKey = emb ? sessionEmbeddingKey(emb) : undefined;
  const candidateLimit = Math.max(1, Math.min(options.candidateLimit ?? 2000, 10_000));
  const rows = await listTranscriptChunkRows(options.desktopDb, {
    embeddingKey: embKey,
    limit: candidateLimit
  });

  const rankable: RankableTranscriptChunk[] = [];
  for (const row of rows) {
    const vector = parseEmbeddingJson(row.embedding_json);
    if (!vector) {
      continue;
    }
    rankable.push({
      provider: row.provider,
      sessionId: row.agent_session_id,
      content: row.content,
      vector,
      chunkIndex: row.chunk_index
    });
  }

  const ranked = rankSessionsByTranscriptChunks(queryVector, rankable, {
    minScore: options.minScore ?? 0.15,
    limit: Math.max(clampSessionSearchLimit(options.limit) * 3, 20)
  });

  const limit = clampSessionSearchLimit(options.limit);
  const hits: SessionSearchHit[] = [];

  for (const item of ranked) {
    if (hits.length >= limit) {
      break;
    }
    const catalogRows = await runSqliteJson<CatalogSessionRow & { gtd_status?: string | null }>(
      options.catalogDb,
      `SELECT s.provider, s.agent_session_id, s.title, s.project_path, s.updated_at_ms, s.archived,
        s.message_count, s.model, s.branch, s.source, s.acp_provider, s.user_title, s.hidden, s.last_synced_at_ms,
        s.session_summary, s.session_summary_language, s.session_summary_at_ms, s.project_id, s.native_project_path,
        g.status AS gtd_status
       FROM sessions s
       LEFT JOIN session_gtd g
         ON g.provider = s.provider AND g.agent_session_id = s.agent_session_id
       WHERE s.provider = '${escapeSqlLiteral(item.provider)}'
         AND s.agent_session_id = '${escapeSqlLiteral(item.sessionId)}'
       LIMIT 1;`
    );
    const row = catalogRows[0];
    if (!row || !sessionPassesFilters(row, options.filters)) {
      continue;
    }
    const session = toAgentSession(row);
    const hit: SessionSearchHit = {
      provider: session.provider as AgentProvider,
      sessionId: session.id,
      title: session.title,
      projectPath: session.projectPath,
      updatedAtMs: session.updatedAt,
      score: item.score,
      match: "transcript",
      summaryPreview:
        truncatePreview(item.bestChunkContent) || truncatePreview(session.sessionSummary)
    };
    if (session.messageCount != null) {
      hit.messageCount = session.messageCount;
    }
    if (session.model) {
      hit.model = session.model;
    }
    if (session.branch) {
      hit.branch = session.branch;
    }
    if (row.gtd_status && isGtdStatus(row.gtd_status)) {
      hit.gtdStatus = row.gtd_status;
    }
    hits.push(hit);
  }

  return hits;
}

/** Delete transcript index rows for a session (e.g. tests / hide cleanup). */
export async function deleteSessionTranscriptIndex(
  desktopDb: string,
  provider: string,
  sessionId: string
): Promise<void> {
  await ensureDesktopDbSchema(desktopDb);
  await runSqlite(
    desktopDb,
    `DELETE FROM session_transcript_chunks
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(sessionId)}';
     DELETE FROM session_transcript_index
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(sessionId)}';`
  );
}
