import * as fs from "node:fs/promises";
import * as path from "node:path";
import { acpThreadPath } from "../acp/store";
import { isGtdStatus, type GtdStatus } from "../gtd/types";
import { normalizeProjectPath, toPortableKey, expandHome } from "../pathUtils";
import {
  extractAgyConversationText,
  extractJsonlFilesConversationText,
  extractOpenCodeConversationTextMap,
  loadAgyHistoryFallbackMap,
  parseTranscriptRefsJson,
  resolveAgySessionLogFiles
} from "../search/extract";
import { escapeSqlLiteral, runSqliteReadOnlyJson } from "../sqlite";
import { DEFAULT_AGENT_HOMES } from "../transcript/homes";
import {
  type AgentProvider,
  type AgentSession,
  type CatalogSessionRow,
  toAgentSession
} from "./types";

export interface CatalogSessionWithMeta extends AgentSession {
  gtdStatus?: GtdStatus;
}

export interface CatalogSessionQueryOptions {
  provider?: AgentProvider;
  projectPath?: string;
  gtdStatus?: GtdStatus | "untagged" | "any-tagged";
  search?: string;
  includeHidden?: boolean;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export interface CatalogSessionQueryResult {
  sessions: CatalogSessionWithMeta[];
  total: number;
  hasMore: boolean;
}

export interface CatalogSessionDetail {
  session: CatalogSessionWithMeta;
  transcriptKind?: string;
  transcriptRefsRaw?: string;
}

interface SessionQueryRow extends CatalogSessionRow {
  gtd_status: string | null;
  transcript_kind?: string | null;
  transcript_refs?: string | null;
}

const DEFAULT_QUERY_LIMIT = 30;
const MAX_QUERY_LIMIT = 200;
const DEFAULT_TRANSCRIPT_MAX_CHARS = 32_000;

function sqlLikeContains(columnExpr: string, term: string): string {
  const escaped = escapeSqlLiteral(
    term.toLowerCase().replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
  );
  return `LOWER(COALESCE(${columnExpr}, '')) LIKE '%${escaped}%' ESCAPE '\\'`;
}

function buildSessionWhereClauses(options: CatalogSessionQueryOptions): string[] {
  const clauses: string[] = [];

  if (!options.includeHidden) {
    clauses.push("s.hidden = 0");
  }
  if (options.includeArchived === false) {
    clauses.push("s.archived = 0");
  }
  if (options.provider) {
    clauses.push(`s.provider = '${escapeSqlLiteral(options.provider)}'`);
  }
  if (options.projectPath?.trim()) {
    const normalized = normalizeProjectPath(options.projectPath.trim());
    const portable = toPortableKey(normalized);
    const escapedNorm = escapeSqlLiteral(normalized);
    const projectMatches = [
      `s.project_path = '${escapedNorm}'`,
      `s.native_project_path = '${escapedNorm}'`,
      `s.project_path LIKE '${escapedNorm}/%'`,
      `s.native_project_path LIKE '${escapedNorm}/%'`
    ];
    if (portable && portable !== normalized) {
      const escapedPortable = escapeSqlLiteral(portable);
      projectMatches.push(
        `s.project_path = '${escapedPortable}'`,
        `s.native_project_path = '${escapedPortable}'`,
        `s.project_path LIKE '${escapedPortable}/%'`,
        `s.native_project_path LIKE '${escapedPortable}/%'`
      );
    }
    clauses.push(`(${projectMatches.join(" OR ")})`);
  }

  if (options.gtdStatus === "untagged") {
    clauses.push("(g.status IS NULL OR g.status = '')");
  } else if (options.gtdStatus === "any-tagged") {
    clauses.push("(g.status IS NOT NULL AND g.status != '')");
  } else if (options.gtdStatus) {
    clauses.push(`g.status = '${escapeSqlLiteral(options.gtdStatus)}'`);
  }

  if (options.search?.trim()) {
    const terms = options.search.trim().split(/\s+/).filter(Boolean);
    for (const term of terms) {
      clauses.push(
        `(${[
          sqlLikeContains("s.user_title", term),
          sqlLikeContains("s.title", term),
          sqlLikeContains("s.session_summary", term),
          sqlLikeContains("s.project_path", term),
          sqlLikeContains("s.branch", term),
          sqlLikeContains("s.agent_session_id", term)
        ].join(" OR ")})`
      );
    }
  }

  return clauses;
}

function mapSessionQueryRow(row: SessionQueryRow): CatalogSessionWithMeta {
  const session: CatalogSessionWithMeta = toAgentSession(row);
  if (row.gtd_status && isGtdStatus(row.gtd_status)) {
    session.gtdStatus = row.gtd_status;
  }
  return session;
}

export async function queryCatalogSessions(
  dbPath: string,
  options: CatalogSessionQueryOptions = {}
): Promise<CatalogSessionQueryResult> {
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? DEFAULT_QUERY_LIMIT), MAX_QUERY_LIMIT));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const clauses = buildSessionWhereClauses(options);
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const countRows = await runSqliteReadOnlyJson<{ total: number }>(
    dbPath,
    `SELECT COUNT(*) AS total
     FROM sessions s
     LEFT JOIN session_gtd g
       ON g.provider = s.provider AND g.agent_session_id = s.agent_session_id
     ${whereSql};`
  );
  const total = Number(countRows[0]?.total) || 0;
  if (offset >= total) {
    return { sessions: [], total, hasMore: false };
  }

  const rows = await runSqliteReadOnlyJson<SessionQueryRow>(
    dbPath,
    `SELECT s.provider, s.agent_session_id, s.title, s.project_path, s.updated_at_ms, s.archived,
            s.message_count, s.model, s.branch, s.source, s.acp_provider, s.user_title, s.hidden,
            s.last_synced_at_ms, s.session_summary, s.session_summary_language,
            s.session_summary_at_ms, s.project_id, s.native_project_path, s.last_exit_waiting,
            g.status AS gtd_status
     FROM sessions s
     LEFT JOIN session_gtd g
       ON g.provider = s.provider AND g.agent_session_id = s.agent_session_id
     ${whereSql}
     ORDER BY s.updated_at_ms DESC, s.provider ASC, s.agent_session_id ASC
     LIMIT ${limit} OFFSET ${offset};`
  );

  const sessions = rows.map(mapSessionQueryRow);
  return {
    sessions,
    total,
    hasMore: offset + sessions.length < total
  };
}

export async function getCatalogSessionDetail(
  dbPath: string,
  provider: AgentProvider,
  sessionId: string
): Promise<CatalogSessionDetail | undefined> {
  const rows = await runSqliteReadOnlyJson<SessionQueryRow>(
    dbPath,
    `SELECT s.provider, s.agent_session_id, s.title, s.project_path, s.updated_at_ms, s.archived,
            s.message_count, s.model, s.branch, s.source, s.acp_provider, s.user_title, s.hidden,
            s.last_synced_at_ms, s.session_summary, s.session_summary_language,
            s.session_summary_at_ms, s.project_id, s.native_project_path, s.last_exit_waiting,
            s.transcript_kind, s.transcript_refs,
            g.status AS gtd_status
     FROM sessions s
     LEFT JOIN session_gtd g
       ON g.provider = s.provider AND g.agent_session_id = s.agent_session_id
     WHERE s.provider = '${escapeSqlLiteral(provider)}'
       AND s.agent_session_id = '${escapeSqlLiteral(sessionId)}'
     LIMIT 1;`
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  return {
    session: mapSessionQueryRow(row),
    transcriptKind: row.transcript_kind ?? undefined,
    transcriptRefsRaw: row.transcript_refs ?? undefined
  };
}

export async function readSessionTranscriptText(options: {
  panelHome: string;
  antigravityHome?: string;
  provider: AgentProvider;
  sessionId: string;
  transcriptRefsRaw?: string;
  maxChars?: number;
}): Promise<string> {
  const maxChars = Math.max(500, Math.min(options.maxChars ?? DEFAULT_TRANSCRIPT_MAX_CHARS, 512_000));
  const refs = parseTranscriptRefsJson(options.transcriptRefsRaw);

  if (options.provider === "chat") {
    const threadFile = refs?.threadPath || acpThreadPath(options.panelHome, options.sessionId);
    try {
      await fs.access(threadFile);
      return await extractJsonlFilesConversationText([threadFile], "chat", maxChars);
    } catch {
      return "";
    }
  }

  if (refs?.kind === "sqlite" && refs.dbPath) {
    const map = await extractOpenCodeConversationTextMap(refs.dbPath, [options.sessionId], maxChars);
    return map.get(options.sessionId) ?? "";
  }

  if (options.provider === "agy") {
    const agyHome = options.antigravityHome ?? expandHome(DEFAULT_AGENT_HOMES.antigravityHome);
    const logFiles =
      refs?.paths && refs.paths.length > 0
        ? refs.paths
        : await resolveAgySessionLogFiles(agyHome, options.sessionId);
    if (logFiles.length > 0) {
      const text = await extractAgyConversationText(logFiles, maxChars);
      if (text) {
        return text;
      }
    }
    const fallbackMap = await loadAgyHistoryFallbackMap(agyHome);
    return (fallbackMap.get(options.sessionId) ?? "").slice(0, maxChars);
  }

  if (refs?.paths && refs.paths.length > 0) {
    return extractJsonlFilesConversationText(refs.paths, options.provider, maxChars);
  }

  return "";
}
