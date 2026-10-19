import * as os from "node:os";
import * as path from "node:path";
import { toPortableKey } from "@agent-resume/core/extension";
import { isFavoriteProject } from "../favorites/projectFavorites";
import { AgentSession } from "../history/types";
import { runSqliteJson } from "../history/sqlite";
import { LlmOutputLanguage } from "../llm/languages";
import { ProjectSessionSortMode } from "../tree/projectSessionSort";
import { GtdStatus, GTD_STATUSES } from "./gtd";
import { CatalogSessionRow, CatalogSettings, SessionSummaryPolicy, toAgentSession } from "./types";

export interface CatalogProjectGroupSummary {
  groupKey: string;
  projectPath: string;
  projectId?: string;
  sessionCount: number;
  latestUpdatedAt: number;
  favorited: boolean;
  candidatePaths: string[];
}

export interface CatalogSessionsPage {
  sessions: AgentSession[];
  total: number;
}

export interface CatalogSearchPageRequest {
  limit?: number;
  offset?: number;
  search?: string;
  projectPath?: string;
  projectCandidatePaths?: string[];
  projectId?: string;
  gtdFilter?: string | null;
  providers?: string[];
  olderThanMs?: number;
  outputLanguage?: LlmOutputLanguage;
  summaryPolicy?: SessionSummaryPolicy;
}

export async function querySidebarSessions(
  catalog: CatalogSettings,
  maxItems: number,
  outputLanguage?: LlmOutputLanguage
): Promise<AgentSession[]> {
  const limit = catalog.sidebarMode === "full" ? Math.max(maxItems, catalog.syncMaxItems) : maxItems;
  return queryVisibleSessions(catalog.dbPath, limit, outputLanguage);
}

export async function queryCatalogSessions(
  catalog: CatalogSettings,
  outputLanguage?: LlmOutputLanguage,
  summaryPolicy: SessionSummaryPolicy = "match"
): Promise<AgentSession[]> {
  return queryVisibleSessions(catalog.dbPath, catalog.syncMaxItems, outputLanguage, summaryPolicy);
}

export async function queryVisibleSessionCount(
  dbPath: string,
  maxCap?: number
): Promise<number> {
  const rows = await runSqliteJson<{ total: number }>(
    dbPath,
    `SELECT COUNT(*) AS total FROM sessions WHERE hidden = 0;`
  );
  const raw = Number(rows[0]?.total) || 0;
  return maxCap != null && Number.isFinite(maxCap) ? Math.min(raw, Math.max(1, Math.floor(maxCap))) : raw;
}

export async function queryRecentSessionsPage(
  dbPath: string,
  options: {
    limit: number;
    offset?: number;
    maxCap?: number;
    outputLanguage?: LlmOutputLanguage;
    summaryPolicy?: SessionSummaryPolicy;
  }
): Promise<CatalogSessionsPage> {
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const total = await queryVisibleSessionCount(dbPath, options.maxCap);
  const remaining = Math.max(0, total - offset);
  const limit = Math.max(0, Math.min(Math.floor(options.limit), remaining, 5_000));
  if (limit <= 0) {
    return { sessions: [], total };
  }
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms, project_id, native_project_path
     FROM sessions
     WHERE hidden = 0
     ORDER BY updated_at_ms DESC, provider ASC, agent_session_id ASC
     LIMIT ${limit} OFFSET ${offset};`
  );
  return {
    sessions: rows.map((row) => toAgentSession(row, options.outputLanguage, options.summaryPolicy ?? "match")),
    total
  };
}

export async function queryProjectGroupSummaries(
  dbPath: string,
  favoriteProjects: string[] = []
): Promise<CatalogProjectGroupSummary[]> {
  const rows = await runSqliteJson<{
    project_id: string | null;
    project_path: string;
    cnt: number;
    max_u: number;
  }>(
    dbPath,
    `SELECT project_id, project_path, COUNT(*) AS cnt, MAX(updated_at_ms) AS max_u
     FROM sessions
     WHERE hidden = 0
     GROUP BY project_id, project_path
     ORDER BY max_u DESC;`
  );

  const groups = new Map<
    string,
    {
      groupKey: string;
      projectPath: string;
      projectId?: string;
      sessionCount: number;
      latestUpdatedAt: number;
      candidatePaths: Set<string>;
    }
  >();

  for (const row of rows) {
    const rawPath = row.project_path?.trim() || os.homedir();
    const resolvedPath = path.resolve(rawPath);
    const projectId = row.project_id?.trim() || undefined;
    const groupKey = projectId ? `id:${projectId}` : `key:${toPortableKey(resolvedPath)}`;
    const count = Number(row.cnt) || 0;
    const latest = Number(row.max_u) || 0;
    const existing = groups.get(groupKey);
    if (!existing) {
      groups.set(groupKey, {
        groupKey,
        projectPath: resolvedPath,
        projectId,
        sessionCount: count,
        latestUpdatedAt: latest,
        candidatePaths: new Set([rawPath, resolvedPath])
      });
    } else {
      existing.sessionCount += count;
      if (latest > existing.latestUpdatedAt) {
        existing.latestUpdatedAt = latest;
        existing.projectPath = resolvedPath;
      }
      existing.candidatePaths.add(rawPath);
      existing.candidatePaths.add(resolvedPath);
    }
  }

  return [...groups.values()]
    .map((group) => {
      const candidatePaths = [...group.candidatePaths];
      const favorited =
        isFavoriteProject(favoriteProjects, group.projectPath) ||
        candidatePaths.some((candidate) => isFavoriteProject(favoriteProjects, candidate));
      return {
        groupKey: group.groupKey,
        projectPath: group.projectPath,
        projectId: group.projectId,
        sessionCount: group.sessionCount,
        latestUpdatedAt: group.latestUpdatedAt,
        favorited,
        candidatePaths
      };
    })
    .sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt || a.projectPath.localeCompare(b.projectPath));
}

export async function queryProjectSessionsPage(
  dbPath: string,
  options: {
    projectPath: string;
    projectId?: string;
    candidatePaths?: string[];
    sortMode?: ProjectSessionSortMode;
    limit: number;
    offset?: number;
    outputLanguage?: LlmOutputLanguage;
    summaryPolicy?: SessionSummaryPolicy;
  }
): Promise<CatalogSessionsPage> {
  const where = buildProjectScopeWhere("sessions", options);
  const orderBy = buildProjectOrderBy(options.sortMode ?? "updatedDesc");
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.max(1, Math.min(Math.floor(options.limit), 5_000));

  const countRows = await runSqliteJson<{ total: number }>(
    dbPath,
    `SELECT COUNT(*) AS total FROM sessions WHERE hidden = 0 AND (${where});`
  );
  const total = Number(countRows[0]?.total) || 0;
  if (offset >= total) {
    return { sessions: [], total };
  }

  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms, project_id, native_project_path
     FROM sessions
     WHERE hidden = 0 AND (${where})
     ORDER BY ${orderBy}
     LIMIT ${limit} OFFSET ${offset};`
  );

  return {
    sessions: rows.map((row) => toAgentSession(row, options.outputLanguage, options.summaryPolicy ?? "match")),
    total
  };
}

export async function queryGtdCountsFromCatalog(dbPath: string): Promise<Record<GtdStatus, number>> {
  const counts = Object.fromEntries(GTD_STATUSES.map((status) => [status, 0])) as Record<GtdStatus, number>;
  const rows = await runSqliteJson<{ status: string; cnt: number }>(
    dbPath,
    `SELECT g.status AS status, COUNT(*) AS cnt
     FROM session_gtd g
     INNER JOIN sessions s
       ON s.provider = g.provider AND s.agent_session_id = g.agent_session_id
     WHERE s.hidden = 0
     GROUP BY g.status;`
  );
  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status as GtdStatus] = Number(row.cnt) || 0;
    }
  }
  return counts;
}

export async function queryGtdSessionsPage(
  dbPath: string,
  options: {
    status: GtdStatus;
    limit: number;
    offset?: number;
    outputLanguage?: LlmOutputLanguage;
    summaryPolicy?: SessionSummaryPolicy;
  }
): Promise<CatalogSessionsPage> {
  const statusLit = escapeSql(options.status);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.max(1, Math.min(Math.floor(options.limit), 5_000));

  const countRows = await runSqliteJson<{ total: number }>(
    dbPath,
    `SELECT COUNT(*) AS total
     FROM sessions s
     INNER JOIN session_gtd g
       ON s.provider = g.provider AND s.agent_session_id = g.agent_session_id
     WHERE s.hidden = 0 AND g.status = '${statusLit}';`
  );
  const total = Number(countRows[0]?.total) || 0;
  if (offset >= total) {
    return { sessions: [], total };
  }

  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT s.provider, s.agent_session_id, s.title, s.project_path, s.updated_at_ms, s.archived,
      s.message_count, s.model, s.branch, s.source, s.acp_provider, s.user_title, s.hidden, s.last_synced_at_ms,
      s.session_summary, s.session_summary_language, s.session_summary_at_ms, s.project_id, s.native_project_path
     FROM sessions s
     INNER JOIN session_gtd g
       ON s.provider = g.provider AND s.agent_session_id = g.agent_session_id
     WHERE s.hidden = 0 AND g.status = '${statusLit}'
     ORDER BY s.updated_at_ms DESC, s.provider ASC, s.agent_session_id ASC
     LIMIT ${limit} OFFSET ${offset};`
  );

  return {
    sessions: rows.map((row) => toAgentSession(row, options.outputLanguage, options.summaryPolicy ?? "match")),
    total
  };
}

export async function querySessionsByKeys(
  dbPath: string,
  keys: Array<{ provider: string; id: string }>,
  outputLanguage?: LlmOutputLanguage
): Promise<AgentSession[]> {
  if (!keys.length) {
    return [];
  }
  const clauses = keys
    .slice(0, 500)
    .map((key) => `(provider = '${escapeSql(key.provider)}' AND agent_session_id = '${escapeSql(key.id)}')`)
    .join(" OR ");
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms, project_id, native_project_path
     FROM sessions
     WHERE hidden = 0 AND (${clauses});`
  );
  return rows.map((row) => toAgentSession(row, outputLanguage, "any"));
}

export async function queryFilteredSessionsPage(
  dbPath: string,
  request: CatalogSearchPageRequest = {}
): Promise<CatalogSessionsPage> {
  const limit = Math.max(1, Math.min(Math.floor(request.limit ?? 100), 1_000));
  const offset = Math.max(0, Math.floor(request.offset ?? 0));
  const where = buildFilteredSessionsWhere("s", request);

  const countRows = await runSqliteJson<{ total: number }>(
    dbPath,
    `SELECT COUNT(*) AS total FROM sessions s WHERE ${where};`
  );
  const total = Number(countRows[0]?.total) || 0;
  if (offset >= total) {
    return { sessions: [], total };
  }

  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT s.provider, s.agent_session_id, s.title, s.project_path, s.updated_at_ms, s.archived,
      s.message_count, s.model, s.branch, s.source, s.acp_provider, s.user_title, s.hidden, s.last_synced_at_ms,
      s.session_summary, s.session_summary_language, s.session_summary_at_ms, s.project_id, s.native_project_path
     FROM sessions s
     WHERE ${where}
     ORDER BY s.updated_at_ms DESC, s.provider ASC, s.agent_session_id ASC
     LIMIT ${limit} OFFSET ${offset};`
  );

  return {
    sessions: rows.map((row) =>
      toAgentSession(row, request.outputLanguage, request.summaryPolicy ?? "any")
    ),
    total
  };
}

export async function queryManagerStats(dbPath: string): Promise<{
  total: number;
  withSummary: number;
  byProvider: Record<string, number>;
}> {
  const providerRows = await runSqliteJson<{ provider: string; cnt: number; summary_cnt: number }>(
    dbPath,
    `SELECT provider,
       COUNT(*) AS cnt,
       SUM(CASE WHEN TRIM(IFNULL(session_summary, '')) != '' THEN 1 ELSE 0 END) AS summary_cnt
     FROM sessions
     WHERE hidden = 0
     GROUP BY provider;`
  );
  const byProvider: Record<string, number> = {};
  let total = 0;
  let withSummary = 0;
  for (const row of providerRows) {
    const count = Number(row.cnt) || 0;
    byProvider[row.provider] = count;
    total += count;
    withSummary += Number(row.summary_cnt) || 0;
  }
  return { total, withSummary, byProvider };
}

export async function querySessionById(
  dbPath: string,
  provider: AgentSession["provider"],
  id: string
): Promise<AgentSession | undefined> {
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms, project_id
     FROM sessions
     WHERE provider = '${escapeSql(provider)}' AND agent_session_id = '${escapeSql(id)}' AND hidden = 0
     LIMIT 1;`
  );

  const row = rows[0];
  return row ? toAgentSession(row) : undefined;
}

export async function getSessionSummaryFromCatalog(
  dbPath: string,
  provider: AgentSession["provider"],
  sessionId: string,
  language: LlmOutputLanguage
): Promise<string | undefined> {
  const rows = await runSqliteJson<Pick<CatalogSessionRow, "session_summary" | "session_summary_language">>(
    dbPath,
    `SELECT session_summary, session_summary_language
     FROM sessions
     WHERE provider = '${escapeSql(provider)}' AND agent_session_id = '${escapeSql(sessionId)}'
     LIMIT 1;`
  );

  const row = rows[0];
  if (!row?.session_summary?.trim() || row.session_summary_language !== language) {
    return undefined;
  }

  return row.session_summary.trim();
}

async function queryVisibleSessions(
  dbPath: string,
  limit: number,
  outputLanguage?: LlmOutputLanguage,
  summaryPolicy: SessionSummaryPolicy = "match"
): Promise<AgentSession[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50_000));
  const rows = await runSqliteJson<CatalogSessionRow>(
    dbPath,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms, project_id
     FROM sessions
     WHERE hidden = 0
     ORDER BY updated_at_ms DESC
     LIMIT ${safeLimit};`
  );

  return rows.map((row) => toAgentSession(row, outputLanguage, summaryPolicy));
}

function buildProjectScopeWhere(
  alias: string,
  options: { projectPath: string; projectId?: string; candidatePaths?: string[] }
): string {
  const paths = new Set<string>([
    options.projectPath,
    path.resolve(options.projectPath),
    ...(options.candidatePaths ?? [])
  ]);
  const pathList = [...paths]
    .filter(Boolean)
    .map((p) => `'${escapeSql(p)}'`)
    .join(", ");
  const pathClause = pathList ? `${alias}.project_path IN (${pathList})` : "0";
  if (options.projectId?.trim()) {
    return `${alias}.project_id = '${escapeSql(options.projectId.trim())}' OR ${pathClause}`;
  }
  return pathClause;
}

function buildProjectOrderBy(sortMode: ProjectSessionSortMode): string {
  switch (sortMode) {
    case "updatedAsc":
      return "updated_at_ms ASC, provider ASC, agent_session_id ASC";
    case "titleAsc":
      return "COALESCE(NULLIF(TRIM(user_title), ''), title, agent_session_id) COLLATE NOCASE ASC, updated_at_ms DESC";
    case "titleDesc":
      return "COALESCE(NULLIF(TRIM(user_title), ''), title, agent_session_id) COLLATE NOCASE DESC, updated_at_ms DESC";
    case "updatedDesc":
    default:
      return "updated_at_ms DESC, provider ASC, agent_session_id ASC";
  }
}

function buildFilteredSessionsWhere(alias: string, request: CatalogSearchPageRequest): string {
  const clauses: string[] = [`${alias}.hidden = 0`];
  if (request.projectPath?.trim()) {
    clauses.push(
      `(${buildProjectScopeWhere(alias, {
        projectPath: request.projectPath.trim(),
        projectId: request.projectId,
        candidatePaths: request.projectCandidatePaths
      })})`
    );
  }
  if (request.providers && request.providers.length > 0) {
    const list = request.providers.map((p) => `'${escapeSql(p)}'`).join(", ");
    clauses.push(`${alias}.provider IN (${list})`);
  }
  if (request.olderThanMs != null && Number.isFinite(request.olderThanMs)) {
    clauses.push(`${alias}.updated_at_ms <= ${Math.floor(request.olderThanMs)}`);
  }
  if (request.gtdFilter === "untagged") {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM session_gtd g WHERE g.provider = ${alias}.provider AND g.agent_session_id = ${alias}.agent_session_id)`
    );
  } else if (request.gtdFilter && request.gtdFilter !== "all") {
    clauses.push(
      `EXISTS (SELECT 1 FROM session_gtd g WHERE g.provider = ${alias}.provider AND g.agent_session_id = ${alias}.agent_session_id AND g.status = '${escapeSql(request.gtdFilter)}')`
    );
  }
  const q = request.search?.trim();
  if (q) {
    const like = `%${escapeSql(q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_"))}%`;
    clauses.push(
      `(${alias}.title LIKE '${like}' ESCAPE '\\' COLLATE NOCASE
        OR ${alias}.user_title LIKE '${like}' ESCAPE '\\' COLLATE NOCASE
        OR ${alias}.session_summary LIKE '${like}' ESCAPE '\\' COLLATE NOCASE
        OR ${alias}.provider LIKE '${like}' ESCAPE '\\' COLLATE NOCASE
        OR ${alias}.project_path LIKE '${like}' ESCAPE '\\' COLLATE NOCASE
        OR ${alias}.branch LIKE '${like}' ESCAPE '\\' COLLATE NOCASE
        OR ${alias}.agent_session_id LIKE '${like}' ESCAPE '\\' COLLATE NOCASE)`
    );
  }
  return clauses.join(" AND ");
}

function escapeSql(value: string): string {
  return value.replaceAll("'", "''");
}