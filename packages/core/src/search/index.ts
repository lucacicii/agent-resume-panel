export type {
  SearchDocType,
  SearchProjectScopeInput,
  SearchPageSpec,
  UnifiedSearchRequest,
  UnifiedSearchHit,
  UnifiedSearchColumnResult,
  UnifiedSearchResult,
  SyncSearchIndexOptions,
  SearchIndexSyncStats
} from "./types";
export {
  SEARCH_INDEX_SCHEMA_SQL,
  ensureSearchIndexSchema,
  resetSearchIndexSchemaCache,
  hasInProcessSqlite
} from "./db";
export { syncSearchIndex } from "./indexer";
export {
  queryUnifiedSearch,
  fuzzySubsequenceScore,
  extractBestSnippet
} from "./query";
