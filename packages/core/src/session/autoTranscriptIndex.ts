import { listSessions } from "../catalog/query";
import type { AgentSession } from "../catalog/types";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import type { PanelSettings, SessionTranscriptIndexSettings } from "../settings/types";
import { DEFAULT_SETTINGS } from "../settings/types";
import { escapeSqlLiteral, runSqliteJson } from "../sqlite";
import { clampInt } from "./autoSummary";
import {
  indexSessionTranscript,
  type IndexSessionTranscriptResult
} from "./transcriptIndex";

export const DEFAULT_TX_QUIET_DELAY_MINUTES = 15;
export const DEFAULT_TX_INDEX_CONCURRENCY = 1;
export const DEFAULT_TX_INDEX_MAX_PER_TICK = 3;

export interface ResolvedSessionTranscriptIndexSettings {
  enabled: boolean;
  quietDelayMinutes: number;
  quietDelayMs: number;
  concurrency: number;
  maxPerTick: number;
}

export function resolveSessionTranscriptIndexSettings(
  settings?: PanelSettings | null
): ResolvedSessionTranscriptIndexSettings {
  const defaults = DEFAULT_SETTINGS.sessionTranscriptIndex || {};
  const raw: SessionTranscriptIndexSettings = {
    ...defaults,
    ...(settings?.sessionTranscriptIndex || {})
  };
  const quietDelayMinutes = clampInt(
    raw.quietDelayMinutes,
    DEFAULT_TX_QUIET_DELAY_MINUTES,
    0,
    1440
  );
  return {
    enabled: raw.enabled !== false,
    quietDelayMinutes,
    quietDelayMs: quietDelayMinutes * 60_000,
    concurrency: clampInt(raw.concurrency, DEFAULT_TX_INDEX_CONCURRENCY, 1, 3),
    maxPerTick: clampInt(raw.maxPerTick, DEFAULT_TX_INDEX_MAX_PER_TICK, 1, 20)
  };
}

export interface TranscriptIndexMetaRow {
  provider: string;
  agent_session_id: string;
  source_hash: string;
  embedding_key: string;
  chunk_count: number;
  updated_at_ms: number;
}

export async function listTranscriptIndexMeta(
  desktopDb: string
): Promise<Map<string, TranscriptIndexMetaRow>> {
  const rows = await runSqliteJson<TranscriptIndexMetaRow>(
    desktopDb,
    `SELECT provider, agent_session_id, source_hash, embedding_key, chunk_count, updated_at_ms
     FROM session_transcript_index;`
  ).catch(() => [] as TranscriptIndexMetaRow[]);
  return new Map(rows.map((r) => [`${r.provider}:${r.agent_session_id}`, r]));
}

/**
 * Sessions past quiet delay that may need (re)indexing.
 * Does not load transcripts or compare hashes — that happens at index time (unchanged skip).
 * Prefer sessions with no index row first, then most recently updated.
 */
export function selectTranscriptIndexCandidates(
  sessions: AgentSession[],
  indexMeta: Map<string, TranscriptIndexMetaRow>,
  nowMs: number,
  auto: ResolvedSessionTranscriptIndexSettings
): AgentSession[] {
  const missing: AgentSession[] = [];
  const maybeStale: AgentSession[] = [];

  for (const session of sessions) {
    if (session.provider === "chat") {
      continue;
    }
    const updatedAt = Number(session.updatedAt) || 0;
    if (nowMs < updatedAt + auto.quietDelayMs) {
      continue;
    }
    const key = `${session.provider}:${session.id}`;
    if (!indexMeta.has(key)) {
      missing.push(session);
    } else {
      // Indexed before; re-check at indexSessionTranscript via source_hash.
      // Prefer sessions that updated after last index write.
      const meta = indexMeta.get(key)!;
      if (updatedAt > meta.updated_at_ms) {
        maybeStale.push(session);
      }
    }
  }

  return [...missing, ...maybeStale].slice(0, auto.maxPerTick);
}

export interface RunAutoTranscriptIndexOptions {
  catalogDb: string;
  desktopDb: string;
  settings: PanelSettings;
  panelHome?: string;
  nowMs?: number;
  skipKeys?: Set<string>;
}

export interface RunAutoTranscriptIndexResult {
  skippedReason?: "disabled" | "no_embedding" | "none_eligible";
  candidates: AgentSession[];
  results: Array<{
    key: string;
    result: IndexSessionTranscriptResult;
  }>;
  indexed: number;
  skipped: number;
  failed: number;
}

/**
 * Background batch: index transcripts independent of session_summary.
 */
export async function runAutoTranscriptIndex(
  options: RunAutoTranscriptIndexOptions
): Promise<RunAutoTranscriptIndexResult> {
  const auto = resolveSessionTranscriptIndexSettings(options.settings);
  if (!auto.enabled) {
    return { skippedReason: "disabled", candidates: [], results: [], indexed: 0, skipped: 0, failed: 0 };
  }
  let embOk = false;
  try {
    embOk = Boolean(embeddingConfigFromSettings(options.settings));
  } catch {
    embOk = false;
  }
  if (!embOk) {
    return { skippedReason: "no_embedding", candidates: [], results: [], indexed: 0, skipped: 0, failed: 0 };
  }

  const nowMs = options.nowMs ?? Date.now();
  // Pool larger than maxPerTick so we can skip cooldowns / empty transcripts.
  const poolLimit = Math.max(auto.maxPerTick * 20, 100);
  const sessions = await listSessions(options.catalogDb, poolLimit);
  const indexMeta = await listTranscriptIndexMeta(options.desktopDb);
  let candidates = selectTranscriptIndexCandidates(sessions, indexMeta, nowMs, auto);
  if (options.skipKeys?.size) {
    candidates = candidates.filter((s) => !options.skipKeys!.has(`${s.provider}:${s.id}`));
  }
  if (!candidates.length) {
    return { skippedReason: "none_eligible", candidates: [], results: [], indexed: 0, skipped: 0, failed: 0 };
  }

  const results: RunAutoTranscriptIndexResult["results"] = [];
  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let cursor = 0;
  const concurrency = Math.min(auto.concurrency, candidates.length);

  async function worker(): Promise<void> {
    while (cursor < candidates.length) {
      const index = cursor++;
      const session = candidates[index];
      const key = `${session.provider}:${session.id}`;
      const result = await indexSessionTranscript({
        desktopDb: options.desktopDb,
        settings: options.settings,
        session,
        panelHome: options.panelHome,
        jobKey: `session_tx_auto:${key}`
      });
      results.push({ key, result });
      if (result.indexed) {
        indexed += 1;
      } else if (result.skipped === "embed_failed") {
        failed += 1;
      } else {
        skipped += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return { candidates, results, indexed, skipped, failed };
}

/** Test helper: delete index meta for a session key without wiping other tables. */
export async function hasTranscriptIndexRow(
  desktopDb: string,
  provider: string,
  sessionId: string
): Promise<boolean> {
  const rows = await runSqliteJson<{ n: number }>(
    desktopDb,
    `SELECT COUNT(*) AS n FROM session_transcript_index
     WHERE provider = '${escapeSqlLiteral(provider)}'
       AND agent_session_id = '${escapeSqlLiteral(sessionId)}';`
  );
  return Number(rows[0]?.n) > 0;
}
