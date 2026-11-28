import * as fs from "node:fs";
import * as path from "node:path";
import type { GtdStatus } from "../gtd/types";
import { isGtdStatus } from "../gtd/types";
import type { NoteScope } from "../notes/paths";
import { escapeSqlLiteral } from "../sqlite";
import { ensureSearchIndexSchema, querySearchSql } from "./db";
import type {
  SearchDocType,
  SearchProjectScopeInput,
  UnifiedSearchColumnResult,
  UnifiedSearchHit,
  UnifiedSearchRequest,
  UnifiedSearchResult
} from "./types";

interface SearchDocMetaRow {
  id: number;
  doc_type: SearchDocType;
  doc_key: string;
  provider: string;
  acp_provider: string;
  item_id: string;
  title: string;
  summary: string;
  project_path: string;
  project_id: string;
  projects_text: string;
  branch: string;
  gtd_status: string;
  scope: string;
  rel_md_path: string;
  filename: string;
  linked_session_key: string;
  updated_at_ms: number;
  archived: number;
}

interface SearchDocBodyRow {
  id: number;
  body: string;
}

const DEFAULT_PAGE_LIMIT = 40;
const FUZZY_SCAN_CAP = 2_500;

export async function queryUnifiedSearch(
  request: UnifiedSearchRequest
): Promise<UnifiedSearchResult> {
  const t0 = Date.now();
  const columns: SearchDocType[] = request.columns?.length
    ? request.columns
    : ["session", "acp", "note"];

  await ensureSearchIndexSchema(request.indexDbPath);

  const countRows = await querySearchSql<{ doc_type: SearchDocType; cnt: number }>(
    request.indexDbPath,
    "SELECT doc_type, COUNT(*) AS cnt FROM search_docs GROUP BY doc_type;"
  );
  const indexedCounts = { sessions: 0, acp: 0, notes: 0 };
  for (const r of countRows) {
    if (r.doc_type === "session") indexedCounts.sessions = Number(r.cnt) || 0;
    else if (r.doc_type === "acp") indexedCounts.acp = Number(r.cnt) || 0;
    else if (r.doc_type === "note") indexedCounts.notes = Number(r.cnt) || 0;
  }

  const rawQuery = request.query?.trim() ?? "";
  const emptyCol: UnifiedSearchColumnResult = { items: [], total: 0, hasMore: false };

  const results = await Promise.all(
    columns.map(async (docType) => {
      const page =
        docType === "session"
          ? request.sessionsPage
          : docType === "acp"
            ? request.acpPage
            : request.notesPage;
      const offset = Math.max(0, Math.floor(page?.offset ?? 0));
      const limit = Math.max(1, Math.min(Math.floor(page?.limit ?? DEFAULT_PAGE_LIMIT), 200));
      const res = await querySingleColumn(
        request.indexDbPath,
        docType,
        rawQuery,
        request.projectScope,
        request.gtdFilter,
        offset,
        limit
      );
      return [docType, res] as const;
    })
  );

  const byType = new Map<SearchDocType, UnifiedSearchColumnResult>(results);
  return {
    sessions: byType.get("session") ?? emptyCol,
    acp: byType.get("acp") ?? emptyCol,
    notes: byType.get("note") ?? emptyCol,
    indexedCounts,
    queryTimeMs: Date.now() - t0
  };
}

async function querySingleColumn(
  indexDbPath: string,
  docType: SearchDocType,
  rawQuery: string,
  projectScope: SearchProjectScopeInput | undefined,
  gtdFilter: string | null | undefined,
  offset: number,
  limit: number
): Promise<UnifiedSearchColumnResult> {
  const baseFilters = buildBaseFilters("d", docType, projectScope, gtdFilter);
  const baseWhere = baseFilters.join(" AND ");

  if (!rawQuery) {
    const countRows = await querySearchSql<{ total: number }>(
      indexDbPath,
      `SELECT COUNT(*) AS total FROM search_docs d WHERE ${baseWhere};`
    );
    const total = Number(countRows[0]?.total) || 0;
    if (offset >= total) {
      return { items: [], total, hasMore: false };
    }

    const rows = await querySearchSql<SearchDocMetaRow>(
      indexDbPath,
      `SELECT d.id, d.doc_type, d.doc_key, d.provider, d.acp_provider, d.item_id,
              d.title, d.summary, d.project_path, d.project_id, d.projects_text,
              d.branch, d.gtd_status, d.scope, d.rel_md_path, d.filename,
              d.linked_session_key, d.updated_at_ms, d.archived
       FROM search_docs d
       WHERE ${baseWhere}
       ORDER BY d.updated_at_ms DESC, d.doc_key ASC
       LIMIT ${limit} OFFSET ${offset};`
    );

    const items = rows.map((row) => toSearchHit(row, 0, undefined, undefined));
    return {
      items,
      total,
      hasMore: offset + items.length < total
    };
  }

  const terms = rawQuery.split(/\s+/).filter(Boolean);
  const trigramTerms = terms.filter((t) => [...t].length >= 3);
  const shortTerms = terms.filter((t) => [...t].length < 3);

  const exactClauses = [...baseFilters];
  let joinFts = "";

  if (trigramTerms.length > 0) {
    joinFts = "JOIN search_docs_fts fts ON fts.rowid = d.id";
    const ftsExpr = trigramTerms.map(escapeFtsTrigramTerm).join(" ");
    exactClauses.push(`search_docs_fts MATCH '${escapeSqlLiteral(ftsExpr)}'`);
  }

  for (const term of shortTerms) {
    const like = `%${escapeSqlLiteral(escapeLike(term))}%`;
    exactClauses.push(
      `(d.title LIKE '${like}' ESCAPE '\\' COLLATE NOCASE
        OR d.summary LIKE '${like}' ESCAPE '\\' COLLATE NOCASE
        OR d.project_path LIKE '${like}' ESCAPE '\\' COLLATE NOCASE
        OR d.branch LIKE '${like}' ESCAPE '\\' COLLATE NOCASE
        OR d.filename LIKE '${like}' ESCAPE '\\' COLLATE NOCASE
        OR d.body LIKE '${like}' ESCAPE '\\' COLLATE NOCASE)`
    );
  }

  const exactRows = await querySearchSql<SearchDocMetaRow>(
    indexDbPath,
    `SELECT d.id, d.doc_type, d.doc_key, d.provider, d.acp_provider, d.item_id,
            d.title, d.summary, d.project_path, d.project_id, d.projects_text,
            d.branch, d.gtd_status, d.scope, d.rel_md_path, d.filename,
            d.linked_session_key, d.updated_at_ms, d.archived
     FROM search_docs d
     ${joinFts}
     WHERE ${exactClauses.join(" AND ")}
     ORDER BY d.updated_at_ms DESC
     LIMIT 500;`
  );

  const scoredCandidates = new Map<
    number,
    { row: SearchDocMetaRow; score: number; matchSource: UnifiedSearchHit["matchSource"] }
  >();

  for (const row of exactRows) {
    const scored = scoreMetadataHit(row, rawQuery, terms, true);
    scoredCandidates.set(row.id, {
      row,
      score: scored.score,
      matchSource: scored.matchSource
    });
  }

  // Fuzzy subsequence expansion on metadata when exact hits are sparse or single/multi-token
  if (scoredCandidates.size < offset + limit) {
    const fuzzyPool = await querySearchSql<SearchDocMetaRow>(
      indexDbPath,
      `SELECT d.id, d.doc_type, d.doc_key, d.provider, d.acp_provider, d.item_id,
              d.title, d.summary, d.project_path, d.project_id, d.projects_text,
              d.branch, d.gtd_status, d.scope, d.rel_md_path, d.filename,
              d.linked_session_key, d.updated_at_ms, d.archived
       FROM search_docs d
       WHERE ${baseWhere}
       ORDER BY d.updated_at_ms DESC
       LIMIT ${FUZZY_SCAN_CAP};`
    );

    const compactQuery = rawQuery.replace(/\s+/g, "").toLowerCase();
    if (compactQuery.length >= 2) {
      for (const row of fuzzyPool) {
        if (scoredCandidates.has(row.id)) {
          continue;
        }
        const metaTarget = [
          row.title,
          row.filename,
          row.summary,
          row.branch,
          path.basename(row.project_path || ""),
          row.provider,
          row.acp_provider
        ]
          .filter(Boolean)
          .join(" ");
        const fz = fuzzySubsequenceScore(compactQuery, metaTarget);
        if (fz > 0) {
          scoredCandidates.set(row.id, {
            row,
            score: 10 + fz,
            matchSource: "fuzzy"
          });
        }
      }
    }
  }

  const sorted = [...scoredCandidates.values()].sort(
    (a, b) => b.score - a.score || b.row.updated_at_ms - a.row.updated_at_ms
  );

  const total = sorted.length;
  if (offset >= total) {
    return { items: [], total, hasMore: false };
  }

  const pageSlice = sorted.slice(offset, offset + limit);

  // Fetch body text ONLY for the visible page slice to build clean match snippets
  const bodyIds = pageSlice
    .filter((entry) => entry.matchSource === "body")
    .map((entry) => entry.row.id);

  const bodyById = new Map<number, string>();
  if (bodyIds.length > 0) {
    const bodyRows = await querySearchSql<SearchDocBodyRow>(
      indexDbPath,
      `SELECT id, body FROM search_docs WHERE id IN (${bodyIds.join(",")});`
    );
    for (const br of bodyRows) {
      bodyById.set(br.id, br.body || "");
    }
  }

  const items = pageSlice.map((entry) => {
    let snippet: string | undefined;
    if (entry.matchSource === "body") {
      const body = bodyById.get(entry.row.id) ?? "";
      snippet = extractBestSnippet(body, terms);
    } else if (entry.row.summary) {
      snippet = entry.row.summary;
    }
    return toSearchHit(entry.row, entry.score, entry.matchSource, snippet);
  });

  return {
    items,
    total,
    hasMore: offset + items.length < total
  };
}

function buildBaseFilters(
  alias: string,
  docType: SearchDocType,
  projectScope: SearchProjectScopeInput | undefined,
  gtdFilter: string | null | undefined
): string[] {
  const clauses: string[] = [`${alias}.doc_type = '${escapeSqlLiteral(docType)}'`];

  if (docType === "note") {
    // Keep archived notes out of default search results unless specifically needed
    clauses.push(`${alias}.archived = 0`);
  }

  if (projectScope?.projectPath?.trim()) {
    const paths = new Set<string>([
      projectScope.projectPath.trim(),
      path.resolve(projectScope.projectPath.trim()),
      ...(projectScope.candidatePaths ?? []),
      ...(projectScope.expandedRoots ?? [])
    ]);
    try {
      const real = fs.realpathSync(projectScope.projectPath.trim());
      if (real) paths.add(real);
    } catch {
      // ignore realpath failures
    }
    const cleanPaths = [...paths].map((p) => p.trim()).filter(Boolean);
    const orParts: string[] = [];
    if (projectScope.projectId?.trim()) {
      orParts.push(`${alias}.project_id = '${escapeSqlLiteral(projectScope.projectId.trim())}'`);
    }
    if (cleanPaths.length > 0) {
      const exactList = cleanPaths.map((p) => `'${escapeSqlLiteral(p)}'`).join(", ");
      orParts.push(`${alias}.project_path IN (${exactList})`);
      if (docType === "note") {
        for (const p of cleanPaths) {
          const like = `%${escapeSqlLiteral(escapeLike(p))}%`;
          orParts.push(`${alias}.projects_text LIKE '${like}' ESCAPE '\\' COLLATE NOCASE`);
        }
      }
    }
    if (orParts.length > 0) {
      clauses.push(`(${orParts.join(" OR ")})`);
    }
  }

  if (gtdFilter === "untagged") {
    clauses.push(`${alias}.gtd_status = ''`);
  } else if (gtdFilter && gtdFilter !== "all") {
    clauses.push(`${alias}.gtd_status = '${escapeSqlLiteral(gtdFilter)}'`);
  }

  return clauses;
}

function scoreMetadataHit(
  row: SearchDocMetaRow,
  rawQuery: string,
  terms: string[],
  matchedBodyFallback: boolean
): { score: number; matchSource: UnifiedSearchHit["matchSource"] } {
  const qLower = rawQuery.toLowerCase();
  const titleLower = (row.title || "").toLowerCase();
  const filenameLower = (row.filename || "").toLowerCase();
  const summaryLower = (row.summary || "").toLowerCase();
  const branchLower = (row.branch || "").toLowerCase();
  const projectLower = (row.project_path || "").toLowerCase();

  let score = 0;
  let matchSource: UnifiedSearchHit["matchSource"] = matchedBodyFallback ? "body" : "title";

  if (titleLower === qLower || filenameLower === qLower) {
    score += 200;
    matchSource = titleLower === qLower ? "title" : "filename";
  } else if (titleLower.startsWith(qLower) || filenameLower.startsWith(qLower)) {
    score += 140;
    matchSource = titleLower.startsWith(qLower) ? "title" : "filename";
  } else if (titleLower.includes(qLower)) {
    score += 100;
    matchSource = "title";
  } else if (filenameLower.includes(qLower)) {
    score += 90;
    matchSource = "filename";
  } else if (terms.every((t) => titleLower.includes(t.toLowerCase()))) {
    score += 80;
    matchSource = "title";
  } else if (summaryLower.includes(qLower) || terms.every((t) => summaryLower.includes(t.toLowerCase()))) {
    score += 60;
    matchSource = "summary";
  } else if (branchLower.includes(qLower)) {
    score += 45;
    matchSource = "branch";
  } else if (projectLower.includes(qLower)) {
    score += 40;
    matchSource = "project";
  } else {
    score += 25;
    matchSource = "body";
  }

  // Slight bonus if multiple fields match individual terms
  for (const t of terms) {
    const tl = t.toLowerCase();
    if (titleLower.includes(tl)) score += 12;
    if (summaryLower.includes(tl)) score += 6;
  }

  return { score, matchSource };
}

export function fuzzySubsequenceScore(needleLower: string, haystackRaw: string): number {
  const haystack = haystackRaw.toLowerCase();
  let ni = 0;
  let score = 0;
  let consecutive = 0;
  let prevMatchIndex = -2;

  for (let hi = 0; hi < haystack.length && ni < needleLower.length; hi++) {
    if (haystack[hi] === needleLower[ni]) {
      score += 2;
      if (hi === prevMatchIndex + 1) {
        consecutive++;
        score += 3 + Math.min(consecutive, 5);
      } else {
        consecutive = 0;
      }
      if (hi === 0 || /[\s/_.\-:]/.test(haystack[hi - 1])) {
        score += 4;
      }
      prevMatchIndex = hi;
      ni++;
    }
  }

  if (ni < needleLower.length) {
    return 0;
  }
  return score;
}

export function extractBestSnippet(body: string, terms: string[], windowRadius = 48): string | undefined {
  if (!body) {
    return undefined;
  }
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  const lower = normalized.toLowerCase();

  let bestIndex = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx >= 0 && (bestIndex < 0 || idx < bestIndex)) {
      bestIndex = idx;
    }
  }

  if (bestIndex < 0) {
    return normalized.slice(0, windowRadius * 2 + 20) + (normalized.length > windowRadius * 2 + 20 ? "…" : "");
  }

  const start = Math.max(0, bestIndex - windowRadius);
  const end = Math.min(normalized.length, bestIndex + windowRadius * 2);
  let slice = normalized.slice(start, end).trim();
  if (start > 0) slice = `…${slice}`;
  if (end < normalized.length) slice = `${slice}…`;
  return slice;
}

function toSearchHit(
  row: SearchDocMetaRow,
  score: number,
  matchSource: UnifiedSearchHit["matchSource"],
  snippet: string | undefined
): UnifiedSearchHit {
  return {
    docType: row.doc_type,
    docKey: row.doc_key,
    provider: row.provider,
    ...(row.acp_provider ? { acpProvider: row.acp_provider } : {}),
    id: row.item_id,
    title: row.title || row.filename || row.item_id,
    ...(row.summary ? { summary: row.summary } : {}),
    projectPath: row.project_path,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.branch ? { branch: row.branch } : {}),
    ...(row.gtd_status && isGtdStatus(row.gtd_status) ? { gtdStatus: row.gtd_status as GtdStatus } : {}),
    ...(row.scope ? { scope: row.scope as NoteScope } : {}),
    ...(row.rel_md_path ? { relMdPath: row.rel_md_path } : {}),
    ...(row.filename ? { filename: row.filename } : {}),
    ...(row.linked_session_key ? { linkedSessionKey: row.linked_session_key } : {}),
    updatedAt: Number(row.updated_at_ms) || 0,
    ...(row.archived ? { archived: true } : {}),
    ...(snippet ? { snippet } : {}),
    ...(matchSource ? { matchSource } : {}),
    score
  };
}

function escapeFtsTrigramTerm(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
