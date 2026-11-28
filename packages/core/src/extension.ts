export { resolvePanelHome, catalogDbPath, searchIndexDbPath } from "./panelHome";
export {
  UI_LANGUAGE_SETTING,
  UI_LANGUAGE_AUTO,
  UI_LOCALES,
  UI_LANGUAGE_OPTIONS,
  NATIVE_LOCALE_LABELS,
  normalizeSystemLocale,
  isUiLocale,
  normalizeUiLanguagePreference,
  loadCatalogs,
  setLocalesDir,
  translateKey,
  getCatalogForLocale,
  resetI18nCache,
  resolveUiLocale,
  OUTPUT_LANGUAGE_AUTO,
  OUTPUT_LANGUAGE_OPTIONS,
  normalizeOutputLanguagePreference,
  resolveEffectiveOutputLanguage,
  summaryLanguagesMatch
} from "./i18n";
export type { UiLocale, UiLanguagePreference } from "./i18n";
export { defaultAlmaHome, sanitizeAgentHomes } from "./transcript/homes";
export { syncAgentSessions } from "./sessionSync";
export type { AgentSessionSyncOptions } from "./sessionSync";
export {
  loadProjectAliasesMap,
  getProjectAliasFromCatalog,
  setProjectAliasInCatalog,
  setProjectAliasById,
  upsertProjectAliasesBatch,
  ensureProjectsCatalogSchema,
  listProjects,
  hideProjectInCatalog,
  unhideAllProjectsInCatalog,
  setProjectPinnedInCatalog,
  setProjectLocalPath,
  reconcileProjectsFromSessions,
  listProjectPathVariants,
  mergeProjectsInCatalog,
  splitProjectPathInCatalog
} from "./catalog/projects";
export type { ProjectRow } from "./catalog/projects";
export { isForeignUserPath, toPortableKey, expandPortableKey } from "./pathUtils";
export {
  NOTES_ROOT_SEGMENT,
  notesRoot,
  projectDirKey,
  sessionDirKey,
  ownerRelDir,
  ownerAbsDir,
  noteRelMdPath,
  noteAbsMdPath,
  noteAbsAssetsDir,
  absFromRelMdPath,
  relMdPathFromAbs,
  isNotesMarkdownPath,
  ownerJsonPath,
  serializeOwner,
  parseOwnerJson
} from "./notes/paths";
export type {
  NoteScope,
  NoteOwner,
  LibraryNoteOwner,
  ProjectNoteOwner,
  SessionNoteOwner,
  NoteOwnerJson
} from "./notes/paths";
export type { NoteRecord } from "./notes/catalogNotes";
export {
  listAllNotes,
  getNoteById,
  getNoteByRelPath,
  listSessionNotes,
  listProjectNotes,
  upsertNoteRecord,
  deleteNoteRecord,
  deleteNotesByRelPaths,
  loadSessionNoteFlags,
  loadProjectNoteFlags,
  getCatalogMeta,
  setCatalogMeta,
  listLegacySessionNotes,
  listLegacyProjectNotes
} from "./notes/catalogNotes";
export { NotesStore } from "./notes/store";
export type { ImportNotesResult } from "./notes/store";
export { reconcileNotesIndex, migrateLegacyNotesToDisk } from "./notes/reconcile";
export { GTD_ACTIVE_STATUSES, GTD_STATUSES, isActiveGtdStatus, isGtdStatus } from "./gtd/types";
export type { ActiveGtdStatus, GtdStatus } from "./gtd/types";
export {
  parseNoteDocument,
  buildNoteDocument,
  extractTitle,
  noteTitle,
  contentPreview
} from "./notes/frontmatter";
export type { NoteFrontmatter, ParsedNoteDocument } from "./notes/frontmatter";
export {
  TASK_KNOWLEDGE_BEGIN,
  TASK_KNOWLEDGE_END,
  UNTITLED_TASK_NAME,
  isTaskFrontmatter,
  taskPromptBody,
  normalizeTaskDocument
} from "./notes/taskNote";
export {
  localDateString,
  formatNoteFilename,
  nextNoteFilename,
  parseNoteFilename,
  noteAssetsDirName,
  noteStem,
  normalizeNoteFilename,
  rewriteAssetReferences,
  uniqueNoteFilename
} from "./notes/naming";
export {
  ensureOwnerDir,
  listMarkdownFilenames,
  writeNewNoteFile,
  readNoteFile,
  deleteNoteFiles,
  renameNoteFiles,
  ensureAssetsDir,
  newNoteId,
  pathExists,
  fileMtimeMs
} from "./notes/fs";

export type { AgentSession, AgentProvider } from "./catalog/types";

/** SQLite runner and catalog schema functions */
export {
  escapeSqlLiteral,
  runSqlite,
  runSqliteJson,
  runSqliteReadOnlyJson,
  runSqliteTransaction
} from "./sqlite";
export {
  ensureExtensionCatalogSchema,
  resetCatalogSchemaCache
} from "./catalog/db";
export {
  AUTO_RENAME_CLAIM_TTL_MS,
  AUTO_RENAME_MAX_ATTEMPTS,
  listBackgroundAutoRenameCandidates,
  claimSessionAutoRename,
  markSessionAutoRenameDone,
  markSessionAutoRenameSkipped,
  markSessionAutoRenameFailed,
  setUserTitleIfUnsetInCatalog
} from "./catalog/autoRenameState";
export type { AutoRenameCandidateQueryOptions } from "./catalog/autoRenameState";
export {
  SEARCH_INDEX_SCHEMA_SQL,
  ensureSearchIndexSchema,
  resetSearchIndexSchemaCache,
  hasInProcessSqlite,
  syncSearchIndex,
  queryUnifiedSearch,
  fuzzySubsequenceScore,
  extractBestSnippet
} from "./search";
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
} from "./search";
