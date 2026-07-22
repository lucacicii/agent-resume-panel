import { ensureDesktopDbSchema } from "../catalog/db";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import type { PanelSettings, SessionEmbeddingIndexSettings } from "../settings/types";
import { DEFAULT_SETTINGS } from "../settings/types";
import { runSqliteJson } from "../sqlite";
import { clampInt } from "./autoSummary";
import {
  buildSessionEmbedText,
  sessionEmbedContentHash,
  sessionEmbeddingKey,
  upsertSessionEmbedding,
  type UpsertSessionEmbeddingResult
} from "./embedStore";

export const DEFAULT_EMB_INDEX_QUIET_DELAY_MINUTES = 0;
export const DEFAULT_EMB_INDEX_CONCURRENCY = 2;
export const DEFAULT_EMB_INDEX_MAX_PER_TICK = 5;

export interface ResolvedSessionEmbeddingIndexSettings {
  enabled: boolean;
  quietDelayMinutes: number;
  quietDelayMs: number;
  concurrency: number;
  maxPerTick: number;
}

export function resolveSessionEmbeddingIndexSettings(
  settings?: PanelSettings | null
): ResolvedSessionEmbeddingIndexSettings {
  const defaults = DEFAULT_SETTINGS.sessionEmbeddingIndex || {};
  const raw: SessionEmbeddingIndexSettings = {
    ...defaults,
    ...(settings?.sessionEmbeddingIndex || {})
  };
  const quietDelayMinutes = clampInt(
    raw.quietDelayMinutes,
    DEFAULT_EMB_INDEX_QUIET_DELAY_MINUTES,
    0,
    1440
  );
  return {
    enabled: raw.enabled !== false,
    quietDelayMinutes,
    quietDelayMs: quietDelayMinutes * 60_000,
    concurrency: clampInt(raw.concurrency, DEFAULT_EMB_INDEX_CONCURRENCY, 1, 4),
    maxPerTick: clampInt(raw.maxPerTick, DEFAULT_EMB_INDEX_MAX_PER_TICK, 1, 50)
  };
}

export interface SessionEmbeddingCandidate {
  provider: string;
  sessionId: string;
  title: string;
  summary: string;
  summaryAtMs: number;
  updatedAtMs: number;
  reason: "missing" | "key_mismatch" | "hash_mismatch";
}

/**
 * Pure selection for tests: filter/order candidates after SQL fetch.
 */
export function selectSessionEmbeddingCandidates(
  rows: SessionEmbeddingCandidate[],
  nowMs: number,
  auto: ResolvedSessionEmbeddingIndexSettings
): SessionEmbeddingCandidate[] {
  const eligible = rows.filter((row) => {
    const anchor = row.summaryAtMs > 0 ? row.summaryAtMs : row.updatedAtMs;
    return nowMs >= anchor + auto.quietDelayMs;
  });
  const missing = eligible.filter((r) => r.reason === "missing");
  const rest = eligible.filter((r) => r.reason !== "missing");
  return [...missing, ...rest].slice(0, auto.maxPerTick);
}

/**
 * List sessions that have a summary but need (re)embedding under the current model key.
 */
export async function listSessionsNeedingEmbedding(
  catalogDb: string,
  desktopDb: string,
  settings: PanelSettings,
  poolLimit = 200
): Promise<SessionEmbeddingCandidate[]> {
  const emb = embeddingConfigFromSettings(settings);
  if (!emb) {
    return [];
  }
  await ensureDesktopDbSchema(desktopDb);
  const embKey = sessionEmbeddingKey(emb);
  const limit = Math.max(1, Math.min(poolLimit, 2000));

  // Catalog and desktop are separate files — fetch summary rows then join embeddings in JS.
  const summaryRows = await runSqliteJson<{
    provider: string;
    agent_session_id: string;
    title: string;
    user_title: string | null;
    session_summary: string;
    session_summary_at_ms: number | null;
    updated_at_ms: number;
  }>(
    catalogDb,
    `SELECT provider, agent_session_id, title, user_title, session_summary,
      session_summary_at_ms, updated_at_ms
     FROM sessions
     WHERE hidden = 0
       AND session_summary IS NOT NULL
       AND TRIM(session_summary) != ''
     ORDER BY updated_at_ms DESC
     LIMIT ${limit};`
  );

  const embRows = await runSqliteJson<{
    provider: string;
    agent_session_id: string;
    content_hash: string;
    embedding_key: string;
  }>(
    desktopDb,
    `SELECT provider, agent_session_id, content_hash, embedding_key FROM session_embeddings;`
  ).catch(() => [] as Array<{
    provider: string;
    agent_session_id: string;
    content_hash: string;
    embedding_key: string;
  }>);

  const embMap = new Map<
    string,
    { provider: string; agent_session_id: string; content_hash: string; embedding_key: string }
  >();
  for (const r of embRows) {
    embMap.set(`${r.provider}:${r.agent_session_id}`, r);
  }

  const out: SessionEmbeddingCandidate[] = [];
  for (const row of summaryRows) {
    const title = (row.user_title?.trim() || row.title || row.agent_session_id).trim();
    const summary = row.session_summary.trim();
    const key = `${row.provider}:${row.agent_session_id}`;
    const embRow = embMap.get(key);
    const expectedHash = sessionEmbedContentHash(
      buildSessionEmbedText(title, summary),
      embKey
    );

    let reason: SessionEmbeddingCandidate["reason"] | null = null;
    if (!embRow) {
      reason = "missing";
    } else if (embRow.embedding_key !== embKey) {
      reason = "key_mismatch";
    } else if (embRow.content_hash !== expectedHash) {
      reason = "hash_mismatch";
    }
    if (!reason) {
      continue;
    }

    out.push({
      provider: row.provider,
      sessionId: row.agent_session_id,
      title,
      summary,
      summaryAtMs: Number(row.session_summary_at_ms) || 0,
      updatedAtMs: Number(row.updated_at_ms) || 0,
      reason
    });
  }
  return out;
}

export interface RunAutoSessionEmbeddingsOptions {
  catalogDb: string;
  desktopDb: string;
  settings: PanelSettings;
  nowMs?: number;
  skipKeys?: Set<string>;
}

export interface RunAutoSessionEmbeddingsResult {
  skippedReason?: "disabled" | "no_embedding" | "none_eligible";
  candidates: SessionEmbeddingCandidate[];
  results: Array<{ key: string; result: UpsertSessionEmbeddingResult }>;
  embedded: number;
  skipped: number;
  failed: number;
}

/**
 * Background batch: embed title+summary for sessions that already have summaries.
 */
export async function runAutoSessionEmbeddings(
  options: RunAutoSessionEmbeddingsOptions
): Promise<RunAutoSessionEmbeddingsResult> {
  const auto = resolveSessionEmbeddingIndexSettings(options.settings);
  if (!auto.enabled) {
    return {
      skippedReason: "disabled",
      candidates: [],
      results: [],
      embedded: 0,
      skipped: 0,
      failed: 0
    };
  }
  if (!embeddingConfigFromSettings(options.settings)) {
    return {
      skippedReason: "no_embedding",
      candidates: [],
      results: [],
      embedded: 0,
      skipped: 0,
      failed: 0
    };
  }

  const nowMs = options.nowMs ?? Date.now();
  const pool = await listSessionsNeedingEmbedding(
    options.catalogDb,
    options.desktopDb,
    options.settings,
    Math.max(auto.maxPerTick * 20, 100)
  );
  let candidates = selectSessionEmbeddingCandidates(pool, nowMs, auto);
  if (options.skipKeys?.size) {
    candidates = candidates.filter(
      (c) => !options.skipKeys!.has(`${c.provider}:${c.sessionId}`)
    );
  }
  if (!candidates.length) {
    return {
      skippedReason: "none_eligible",
      candidates: [],
      results: [],
      embedded: 0,
      skipped: 0,
      failed: 0
    };
  }

  const results: RunAutoSessionEmbeddingsResult["results"] = [];
  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  let cursor = 0;
  const concurrency = Math.min(auto.concurrency, candidates.length);

  async function worker(): Promise<void> {
    while (cursor < candidates.length) {
      const index = cursor++;
      const c = candidates[index];
      const key = `${c.provider}:${c.sessionId}`;
      const result = await upsertSessionEmbedding({
        desktopDb: options.desktopDb,
        settings: options.settings,
        provider: c.provider,
        sessionId: c.sessionId,
        title: c.title,
        summary: c.summary,
        jobKey: `session_embed:auto:${key}`
      });
      results.push({ key, result });
      if (result.embedded) {
        embedded += 1;
      } else if (result.skipped === "embed_failed") {
        failed += 1;
      } else {
        skipped += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { candidates, results, embedded, skipped, failed };
}
