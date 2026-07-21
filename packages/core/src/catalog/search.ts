import { escapeSqlLiteral, runSqliteJson } from "../sqlite";
import { GtdStatus, isGtdStatus } from "../gtd/types";
import { AgentProvider, CatalogSessionRow, toAgentSession } from "./types";

export type SessionSearchMatch = "keyword" | "semantic" | "both";

export interface SessionSearchFilters {
  /** Keyword match against title, user_title, project_path, session_summary. Empty = list-only. */
  query?: string;
  provider?: AgentProvider | string;
  /** Substring match on project_path. */
  projectPath?: string;
  gtdStatus?: GtdStatus | string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
  includeHidden?: boolean;
}

export interface SessionSearchHit {
  provider: AgentProvider;
  sessionId: string;
  title: string;
  projectPath: string;
  updatedAtMs: number;
  messageCount?: number;
  model?: string;
  branch?: string;
  gtdStatus?: GtdStatus;
  summaryPreview?: string;
  /** Cosine similarity when match includes semantic. */
  score?: number;
  match?: SessionSearchMatch;
}

export const SESSION_SEARCH_DEFAULT_LIMIT = 20;
export const SESSION_SEARCH_MAX_LIMIT = 50;
export const SESSION_LIST_DEFAULT_LIMIT = 30;
export const SESSION_LIST_MAX_LIMIT = 100;
export const SESSION_SUMMARY_PREVIEW_CHARS = 400;

export function clampSessionSearchLimit(limit?: number): number {
  const raw = Number(limit);
  if (!Number.isFinite(raw) || raw < 1) {
    return SESSION_SEARCH_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(raw), SESSION_SEARCH_MAX_LIMIT);
}

export function clampSessionListLimit(limit?: number): number {
  const raw = Number(limit);
  if (!Number.isFinite(raw) || raw < 1) {
    return SESSION_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(raw), SESSION_LIST_MAX_LIMIT);
}

/** Escape for SQL LIKE: strip % and _ so user input cannot broaden the pattern. */
export function sanitizeLikeFragment(value: string): string {
  return value.replaceAll("%", "").replaceAll("_", "").trim();
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

function buildWhereClauses(filters: SessionSearchFilters): string[] {
  const clauses: string[] = [];
  if (!filters.includeHidden) {
    clauses.push("s.hidden = 0");
  }

  const provider = filters.provider?.trim();
  if (provider) {
    clauses.push(`s.provider = '${escapeSqlLiteral(provider)}'`);
  }

  const projectPath = filters.projectPath?.trim();
  if (projectPath) {
    const frag = sanitizeLikeFragment(projectPath);
    if (frag) {
      clauses.push(`s.project_path LIKE '%${escapeSqlLiteral(frag)}%'`);
    }
  }

  if (filters.fromMs != null && Number.isFinite(filters.fromMs)) {
    clauses.push(`s.updated_at_ms >= ${Math.floor(filters.fromMs)}`);
  }
  if (filters.toMs != null && Number.isFinite(filters.toMs)) {
    clauses.push(`s.updated_at_ms < ${Math.floor(filters.toMs)}`);
  }

  const gtd = filters.gtdStatus?.trim();
  if (gtd && isGtdStatus(gtd)) {
    clauses.push(`g.status = '${escapeSqlLiteral(gtd)}'`);
  }

  const query = filters.query?.trim();
  if (query) {
    const frag = sanitizeLikeFragment(query);
    if (frag) {
      const lit = escapeSqlLiteral(frag);
      clauses.push(
        `(IFNULL(s.title,'') LIKE '%${lit}%' OR IFNULL(s.user_title,'') LIKE '%${lit}%' OR IFNULL(s.project_path,'') LIKE '%${lit}%' OR IFNULL(s.session_summary,'') LIKE '%${lit}%')`
      );
    }
  }

  return clauses;
}

type SearchRow = CatalogSessionRow & { gtd_status?: string | null };

function rowToHit(row: SearchRow, match?: SessionSearchMatch, score?: number): SessionSearchHit {
  const session = toAgentSession(row);
  const hit: SessionSearchHit = {
    provider: session.provider,
    sessionId: session.id,
    title: session.title,
    projectPath: session.projectPath,
    updatedAtMs: session.updatedAt
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
  if (match) {
    hit.match = match;
  }
  if (score != null && Number.isFinite(score)) {
    hit.score = score;
  }
  return hit;
}

/**
 * Keyword / structured search over catalog sessions.
 * When query is empty, acts as a filtered list ordered by recency.
 */
export async function searchCatalogSessions(
  dbPath: string,
  filters: SessionSearchFilters = {}
): Promise<SessionSearchHit[]> {
  const hasQuery = Boolean(filters.query?.trim());
  const limit = hasQuery ? clampSessionSearchLimit(filters.limit) : clampSessionListLimit(filters.limit);
  const where = buildWhereClauses(filters);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await runSqliteJson<SearchRow>(
    dbPath,
    `SELECT s.provider, s.agent_session_id, s.title, s.project_path, s.updated_at_ms, s.archived,
      s.message_count, s.model, s.branch, s.source, s.acp_provider, s.user_title, s.hidden, s.last_synced_at_ms,
      s.session_summary, s.session_summary_language, s.session_summary_at_ms, s.project_id,
      g.status AS gtd_status
     FROM sessions s
     LEFT JOIN session_gtd g
       ON g.provider = s.provider AND g.agent_session_id = s.agent_session_id
     ${whereSql}
     ORDER BY s.updated_at_ms DESC
     LIMIT ${limit};`
  );

  return rows.map((row) => rowToHit(row, hasQuery ? "keyword" : undefined));
}

/** Merge keyword + semantic hits for hybrid search (scheme H). */
export function mergeSessionSearchHits(
  keywordHits: SessionSearchHit[],
  semanticHits: SessionSearchHit[],
  limit: number
): SessionSearchHit[] {
  const map = new Map<string, SessionSearchHit>();

  for (const hit of keywordHits) {
    const key = `${hit.provider}:${hit.sessionId}`;
    map.set(key, { ...hit, match: "keyword" });
  }

  for (const hit of semanticHits) {
    const key = `${hit.provider}:${hit.sessionId}`;
    const existing = map.get(key);
    if (existing) {
      map.set(key, {
        ...existing,
        ...hit,
        title: existing.title || hit.title,
        summaryPreview: existing.summaryPreview || hit.summaryPreview,
        gtdStatus: existing.gtdStatus ?? hit.gtdStatus,
        match: "both",
        score: hit.score ?? existing.score
      });
    } else {
      map.set(key, { ...hit, match: "semantic" });
    }
  }

  const merged = Array.from(map.values());
  merged.sort((a, b) => {
    const rank = (m?: SessionSearchMatch) => (m === "both" ? 0 : m === "semantic" ? 1 : 2);
    const ra = rank(a.match);
    const rb = rank(b.match);
    if (ra !== rb) {
      return ra - rb;
    }
    const sa = a.score;
    const sb = b.score;
    if (sa != null && sb != null && sa !== sb) {
      return sb - sa;
    }
    if (sa != null && sb == null) {
      return -1;
    }
    if (sa == null && sb != null) {
      return 1;
    }
    return b.updatedAtMs - a.updatedAtMs;
  });

  return merged.slice(0, Math.max(1, limit));
}
