import {
  SessionSearchFilters,
  SessionSearchHit,
  SESSION_SUMMARY_PREVIEW_CHARS,
  clampSessionSearchLimit,
  sanitizeLikeFragment
} from "../catalog/search";
import { AgentProvider, CatalogSessionRow, toAgentSession } from "../catalog/types";
import { isGtdStatus } from "../gtd/types";
import { embedTextsDetailed } from "../llm/embeddings";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import { PanelSettings } from "../settings/types";
import { cosineSimilarity, parseEmbeddingJson } from "../report/cosine";
import { escapeSqlLiteral, runSqliteJson } from "../sqlite";
import { recordLlmUsage } from "../usage/store";
import { listSessionEmbeddingRows, sessionEmbeddingKey } from "./embedStore";

export interface SearchSessionsByEmbeddingOptions {
  catalogDb: string;
  desktopDb: string;
  settings: PanelSettings;
  query: string;
  filters?: SessionSearchFilters;
  /** Precomputed query vector (tests / shared pipeline). */
  queryVector?: number[];
  limit?: number;
  minScore?: number;
  /** Max embedding rows to scan. Default 500. */
  candidateLimit?: number;
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

/**
 * Semantic search over session summary embeddings (desktop.db), joined to catalog metadata.
 * Returns empty array when embedding is not configured or index is empty.
 */
export async function searchSessionsByEmbedding(
  options: SearchSessionsByEmbeddingOptions
): Promise<SessionSearchHit[]> {
  const query = options.query?.trim();
  if (!query) {
    return [];
  }

  let emb: ReturnType<typeof embeddingConfigFromSettings>;
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
          source: "session_embed",
          jobKey: "session_search:query",
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

  // When injecting queryVector in tests without embedding config, scan all keys.
  const embKey = emb ? sessionEmbeddingKey(emb) : undefined;
  const candidateLimit = Math.max(1, Math.min(options.candidateLimit ?? 500, 2000));
  const rows = await listSessionEmbeddingRows(options.desktopDb, {
    embeddingKey: embKey,
    limit: candidateLimit
  });

  const minScore = options.minScore ?? 0.15;
  const limit = clampSessionSearchLimit(options.limit);
  const scored: Array<{ provider: string; sessionId: string; score: number }> = [];

  for (const row of rows) {
    const vector = parseEmbeddingJson(row.embedding_json);
    if (!vector) {
      continue;
    }
    const score = cosineSimilarity(queryVector, vector);
    if (score == null || score < minScore) {
      continue;
    }
    scored.push({ provider: row.provider, sessionId: row.agent_session_id, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(limit * 3, limit));
  if (!top.length) {
    return [];
  }

  const hits: SessionSearchHit[] = [];
  for (const item of top) {
    if (hits.length >= limit) {
      break;
    }
    const catalogRows = await runSqliteJson<CatalogSessionRow & { gtd_status?: string | null }>(
      options.catalogDb,
      `SELECT s.provider, s.agent_session_id, s.title, s.project_path, s.updated_at_ms, s.archived,
        s.message_count, s.model, s.branch, s.source, s.acp_provider, s.user_title, s.hidden, s.last_synced_at_ms,
        s.session_summary, s.session_summary_language, s.session_summary_at_ms, s.project_id,
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
      match: "semantic"
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
    const preview = truncatePreview(session.sessionSummary);
    if (preview) {
      hit.summaryPreview = preview;
    }
    if (row.gtd_status && isGtdStatus(row.gtd_status)) {
      hit.gtdStatus = row.gtd_status;
    }
    hits.push(hit);
  }

  return hits;
}
