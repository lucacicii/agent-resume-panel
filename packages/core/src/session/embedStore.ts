import { createHash } from "node:crypto";
import { ensureDesktopDbSchema } from "../catalog/db";
import { AgentProvider } from "../catalog/types";
import { embedTextsDetailed } from "../llm/embeddings";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import { EmbeddingRuntimeConfig } from "../llm/types";
import { PanelSettings } from "../settings/types";
import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";
import { recordLlmUsage } from "../usage/store";

const EMBED_TEXT_MAX = 8000;
const SUMMARY_PREVIEW_STORE = 400;

export interface UpsertSessionEmbeddingOptions {
  desktopDb: string;
  settings: PanelSettings;
  provider: AgentProvider | string;
  sessionId: string;
  title: string;
  summary: string;
  /** Usage job key prefix. */
  jobKey?: string;
}

export interface UpsertSessionEmbeddingResult {
  embedded: boolean;
  skipped?: "no_embedding_config" | "empty_summary" | "unchanged" | "embed_failed";
  error?: string;
}

export interface SessionEmbeddingRow {
  provider: string;
  agent_session_id: string;
  title: string | null;
  summary_preview: string | null;
  embedding_json: string;
  content_hash: string;
  embedding_key: string;
  updated_at_ms: number;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sessionEmbeddingKey(config: EmbeddingRuntimeConfig): string {
  return hash(`${config.baseUrl}\n${config.model}`);
}

export function buildSessionEmbedText(title: string, summary: string): string {
  const text = `${title.trim()}\n${summary.trim()}`.trim();
  if (text.length <= EMBED_TEXT_MAX) {
    return text;
  }
  return text.slice(0, EMBED_TEXT_MAX);
}

export function sessionEmbedContentHash(embedText: string, embeddingKey: string): string {
  return hash(`${embedText}\n${embeddingKey}`);
}

async function getExistingHash(
  desktopDb: string,
  provider: string,
  sessionId: string
): Promise<{ content_hash: string; embedding_key: string } | undefined> {
  const rows = await runSqliteJson<{ content_hash: string; embedding_key: string }>(
    desktopDb,
    `SELECT content_hash, embedding_key FROM session_embeddings
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(sessionId)}'
     LIMIT 1;`
  );
  return rows[0];
}

/**
 * Best-effort: embed title+summary into desktop.db session_embeddings.
 * Failures do not throw when called from summarize hooks (return skipped/error).
 */
export async function upsertSessionEmbedding(
  options: UpsertSessionEmbeddingOptions
): Promise<UpsertSessionEmbeddingResult> {
  const summary = options.summary?.trim();
  if (!summary) {
    return { embedded: false, skipped: "empty_summary" };
  }

  const emb = embeddingConfigFromSettings(options.settings);
  if (!emb) {
    return { embedded: false, skipped: "no_embedding_config" };
  }

  const provider = String(options.provider).trim();
  const sessionId = String(options.sessionId).trim();
  if (!provider || !sessionId) {
    return { embedded: false, skipped: "empty_summary" };
  }

  await ensureDesktopDbSchema(options.desktopDb);

  const title = options.title?.trim() || sessionId;
  const embedText = buildSessionEmbedText(title, summary);
  const embKey = sessionEmbeddingKey(emb);
  const contentHash = sessionEmbedContentHash(embedText, embKey);

  const existing = await getExistingHash(options.desktopDb, provider, sessionId);
  if (existing?.content_hash === contentHash && existing.embedding_key === embKey) {
    return { embedded: false, skipped: "unchanged" };
  }

  try {
    const result = await embedTextsDetailed(emb, [embedText]);
    const vector = result.vectors[0];
    if (!vector?.length) {
      return { embedded: false, skipped: "embed_failed", error: "Empty embedding vector." };
    }

    try {
      await recordLlmUsage(options.desktopDb, {
        kind: "embedding",
        source: "session_embed",
        jobKey: options.jobKey || `session_embed:${provider}:${sessionId}`,
        model: result.model,
        usage: result.usage,
        durationMs: result.durationMs,
        ok: true
      });
    } catch {
      // non-fatal
    }

    const preview =
      summary.length <= SUMMARY_PREVIEW_STORE
        ? summary
        : `${summary.slice(0, SUMMARY_PREVIEW_STORE)}\n[...truncated...]`;
    const nowMs = Date.now();
    const embeddingJson = JSON.stringify(vector);

    await runSqlite(
      options.desktopDb,
      `INSERT INTO session_embeddings (
         provider, agent_session_id, title, summary_preview, embedding_json,
         content_hash, embedding_key, updated_at_ms
       ) VALUES (
         '${escapeSqlLiteral(provider)}',
         '${escapeSqlLiteral(sessionId)}',
         '${escapeSqlLiteral(title)}',
         '${escapeSqlLiteral(preview)}',
         '${escapeSqlLiteral(embeddingJson)}',
         '${escapeSqlLiteral(contentHash)}',
         '${escapeSqlLiteral(embKey)}',
         ${nowMs}
       )
       ON CONFLICT(provider, agent_session_id) DO UPDATE SET
         title = excluded.title,
         summary_preview = excluded.summary_preview,
         embedding_json = excluded.embedding_json,
         content_hash = excluded.content_hash,
         embedding_key = excluded.embedding_key,
         updated_at_ms = excluded.updated_at_ms;`
    );

    return { embedded: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await recordLlmUsage(options.desktopDb, {
        kind: "embedding",
        source: "session_embed",
        jobKey: options.jobKey || `session_embed:${provider}:${sessionId}`,
        ok: false,
        error: message.slice(0, 500)
      });
    } catch {
      // ignore
    }
    return { embedded: false, skipped: "embed_failed", error: message };
  }
}

export async function listSessionEmbeddingRows(
  desktopDb: string,
  options?: { embeddingKey?: string; limit?: number }
): Promise<SessionEmbeddingRow[]> {
  await ensureDesktopDbSchema(desktopDb);
  const limit = Math.max(1, Math.min(options?.limit ?? 500, 2000));
  const key = options?.embeddingKey?.trim();
  const keyClause = key ? `WHERE embedding_key = '${escapeSqlLiteral(key)}'` : "";
  return runSqliteJson<SessionEmbeddingRow>(
    desktopDb,
    `SELECT provider, agent_session_id, title, summary_preview, embedding_json,
      content_hash, embedding_key, updated_at_ms
     FROM session_embeddings
     ${keyClause}
     ORDER BY updated_at_ms DESC
     LIMIT ${limit};`
  );
}

export interface BackfillSessionEmbeddingsOptions {
  catalogDb: string;
  desktopDb: string;
  settings: PanelSettings;
  /** Max sessions to process. Default 100. */
  limit?: number;
  concurrency?: number;
}

export interface BackfillSessionEmbeddingsResult {
  processed: number;
  embedded: number;
  skipped: number;
  failed: number;
}

/**
 * Index sessions that already have session_summary but missing/stale embeddings.
 */
export async function backfillSessionEmbeddings(
  options: BackfillSessionEmbeddingsOptions
): Promise<BackfillSessionEmbeddingsResult> {
  const emb = embeddingConfigFromSettings(options.settings);
  if (!emb) {
    return { processed: 0, embedded: 0, skipped: 0, failed: 0 };
  }

  await ensureDesktopDbSchema(options.desktopDb);
  const limit = Math.max(1, Math.min(options.limit ?? 100, 2000));
  const embKey = sessionEmbeddingKey(emb);

  const rows = await runSqliteJson<{
    provider: string;
    agent_session_id: string;
    title: string;
    user_title: string | null;
    session_summary: string;
  }>(
    options.catalogDb,
    `SELECT s.provider, s.agent_session_id, s.title, s.user_title, s.session_summary
     FROM sessions s
     WHERE s.hidden = 0
       AND s.session_summary IS NOT NULL
       AND TRIM(s.session_summary) != ''
     ORDER BY s.updated_at_ms DESC
     LIMIT ${limit};`
  );

  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 4));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const index = cursor++;
      const row = rows[index];
      const title = (row.user_title?.trim() || row.title || row.agent_session_id).trim();
      const result = await upsertSessionEmbedding({
        desktopDb: options.desktopDb,
        settings: options.settings,
        provider: row.provider,
        sessionId: row.agent_session_id,
        title,
        summary: row.session_summary,
        jobKey: `session_embed:backfill:${row.provider}:${row.agent_session_id}`
      });
      if (result.embedded) {
        embedded += 1;
      } else if (result.skipped === "embed_failed") {
        failed += 1;
      } else {
        skipped += 1;
      }
    }
  }

  // Touch embKey so unused-var lint is quiet if tree-shaken; used for future filter.
  void embKey;

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return { processed: rows.length, embedded, skipped, failed };
}
