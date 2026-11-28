import type { AgentProvider } from "../catalog/types";
import type { GtdStatus } from "../gtd/types";
import type { NoteScope } from "../notes/paths";

export type SearchDocType = "session" | "acp" | "note";

export interface SearchProjectScopeInput {
  projectPath?: string;
  projectId?: string;
  candidatePaths?: string[];
  expandedRoots?: string[];
  portableRoots?: string[];
}

export interface SearchPageSpec {
  offset?: number;
  limit?: number;
}

export interface UnifiedSearchRequest {
  indexDbPath: string;
  query?: string;
  projectScope?: SearchProjectScopeInput;
  gtdFilter?: string | null;
  sessionsPage?: SearchPageSpec;
  acpPage?: SearchPageSpec;
  notesPage?: SearchPageSpec;
  /** Optional subset of columns to query (defaults to all three in parallel). */
  columns?: SearchDocType[];
}

export interface UnifiedSearchHit {
  docType: SearchDocType;
  docKey: string;
  provider: string;
  acpProvider?: string;
  id: string;
  title: string;
  summary?: string;
  projectPath: string;
  projectId?: string;
  branch?: string;
  gtdStatus?: GtdStatus;
  scope?: NoteScope;
  relMdPath?: string;
  filename?: string;
  linkedSessionKey?: string;
  updatedAt: number;
  archived?: boolean;
  /** Context snippet extracted around a matched term in body/summary. */
  snippet?: string;
  /** Which field primarily drove the match. */
  matchSource?: "title" | "summary" | "project" | "branch" | "filename" | "body" | "fuzzy";
  score: number;
}

export interface UnifiedSearchColumnResult {
  items: UnifiedSearchHit[];
  total: number;
  hasMore: boolean;
}

export interface UnifiedSearchResult {
  sessions: UnifiedSearchColumnResult;
  acp: UnifiedSearchColumnResult;
  notes: UnifiedSearchColumnResult;
  indexedCounts: {
    sessions: number;
    acp: number;
    notes: number;
  };
  queryTimeMs: number;
}

export interface SyncSearchIndexOptions {
  catalogDbPath: string;
  indexDbPath: string;
  panelHome: string;
  antigravityHome: string;
  opencodeHome?: string;
  outputLanguage?: string;
  /** Optional cap for body text stored per document (chars). Default 512_000. */
  maxBodyChars?: number;
}

export interface SearchIndexSyncStats {
  totalDocs: number;
  indexedSessions: number;
  indexedAcp: number;
  indexedNotes: number;
  updatedDocs: number;
  deletedDocs: number;
  skippedDocs: number;
  durationMs: number;
}

export interface SearchDocRowInput {
  docType: SearchDocType;
  docKey: string;
  provider: string;
  acpProvider: string;
  itemId: string;
  title: string;
  summary: string;
  projectPath: string;
  projectId: string;
  projectsText: string;
  branch: string;
  gtdStatus: string;
  scope: string;
  relMdPath: string;
  filename: string;
  linkedSessionKey: string;
  body: string;
  updatedAtMs: number;
  archived: number;
  sourceSig: string;
}

export type _UnusedAgentProviderRef = AgentProvider;
