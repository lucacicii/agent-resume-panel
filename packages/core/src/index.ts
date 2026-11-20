export {
  expandHome,
  compactPath,
  basenameOrPath,
  normalizeProjectPath,
  toPortableKey,
  expandPortableKey,
  isForeignUserPath
} from "./pathUtils";
export { getMachineId, machineIdFilePath, resetMachineIdCache } from "./machineId";
export {
  DEFAULT_PANEL_HOME,
  resolvePanelHome,
  catalogDbPath,
  settingsPath
} from "./panelHome";
export {
  escapeSqlLiteral,
  runSqlite,
  runSqliteJson,
  runSqliteReadOnlyJson,
  runSqliteTransaction
} from "./sqlite";

export {
  loadNoteGtdMap,
  getNoteGtdStatus,
  setNoteGtdStatus,
  clearNoteGtdStatus
} from "./notes/gtd";
export {
  loadNoteArchiveMap,
  getNoteArchivedAtMs,
  archiveNotes,
  unarchiveNotes
} from "./notes/archive";

export type { UiLocale, UiLanguagePreference } from "./i18n/locales";
export {
  UI_LANGUAGE_SETTING,
  UI_LANGUAGE_AUTO,
  UI_LOCALES,
  UI_LANGUAGE_OPTIONS,
  NATIVE_LOCALE_LABELS,
  normalizeSystemLocale,
  normalizeUiLanguagePreference,
  isUiLocale,
  loadCatalogs,
  setLocalesDir,
  translateKey,
  getCatalogForLocale,
  interpolate,
  resetI18nCache,
  resolveUiLocale,
  OUTPUT_LANGUAGE_AUTO,
  OUTPUT_LANGUAGE_OPTIONS,
  DEFAULT_CATALOG_OUTPUT_LANGUAGE,
  normalizeOutputLanguagePreference,
  resolveEffectiveOutputLanguage,
  normalizeSummaryLanguageTag,
  summaryLanguagesMatch
} from "./i18n";

export type { AgentProvider, AgentSession, CatalogSessionRow } from "./catalog/types";
export { toAgentSession } from "./catalog/types";
export {
  ensureExtensionCatalogSchema,
  resetCatalogSchemaCache
} from "./catalog/db";
export {
  setUserTitleInCatalog,
  setSessionSummaryInCatalog,
  hideSessionsInCatalog,
  unhideAllSessionsInCatalog,
  unhideSessionInCatalog,
  purgeRetiredAlmaCatalog
} from "./catalog/mutations";
export {
  upsertAcpSessionInCatalog,
  deleteAcpSessionFromCatalog,
  syncAcpRecordsIntoCatalog,
  buildAcpTranscriptRefs,
  catalogDbForPanelHome,
  countAcpCatalogSessions
} from "./catalog/acpCatalog";
export type { AcpCatalogRecordInput } from "./catalog/acpCatalog";
export {
  acpSessionsPath,
  acpThreadPath,
  acpStoreLockPath,
  ensureAcpStoreDirs,
  loadAcpSessionRecords,
  getAcpSessionRecord,
  insertAcpSessionRecord,
  updateAcpSessionRecord,
  deleteAcpSessionRecord,
  loadAcpThreadMessages,
  appendAcpThreadMessage
} from "./acp/store";
export type { AcpSessionStoreRecord, AcpThreadStoreMessage } from "./acp/store";
export {
  loadProjectAliasesMap,
  getProjectAliasFromCatalog,
  setProjectAliasInCatalog,
  setProjectAliasById,
  upsertProjectAliasesBatch,
  ensureProjectsCatalogSchema,
  ensureProjectForPath,
  reconcileProjectsFromSessions,
  listProjects,
  resolveProjectCwd,
  resolveProjectCwdForPath,
  setProjectLocalPath,
  setProjectPinnedInCatalog,
  hideProjectInCatalog,
  unhideProjectInCatalog,
  setProjectKeptVisibleInCatalog,
  unhideAllProjectsInCatalog,
  getProjectById,
  listProjectPathVariants,
  mergeProjectsInCatalog,
  splitProjectPathInCatalog,
  tidyProjectsInCatalog,
  moveSessionToProjectInCatalog
} from "./catalog/projects";
export type { ProjectRow, ResolveProjectCwdResult } from "./catalog/projects";

export {
  loadAllAgentSessions,
  syncAgentSessions
} from "./sessionSync";
export type {
  AgentSessionSyncOptions,
  AgentSessionSyncResult,
  AgentSessionProviderSyncResult,
  SessionSyncStalePolicy,
  SyncableAgentProvider
} from "./sessionSync";

export type { PreviewHomes, PreviewMessage, SessionPreviewResult } from "./transcript/types";
export {
  DEFAULT_AGENT_HOMES,
  defaultAgentHomeValue,
  defaultCursorIdeUserDataHome,
  agentHomeDiffersFromDefault,
  sanitizeAgentHomes
} from "./transcript/homes";
export type { AgentHomeKey, AgentHomesSettings } from "./transcript/homes";
export {
  extractPreviewContent,
  extractTextFromContent,
  finalizePreviewMessages,
  isConversationPreviewText,
  isUserOrAssistantRole,
  normalizePreviewText
} from "./transcript/text";
export type { ExtractedPreviewContent, FinalizePreviewOptions } from "./transcript/text";

export type { ActiveGtdStatus, GtdStatus } from "./gtd/types";
export { GTD_ACTIVE_STATUSES, GTD_STATUSES, isActiveGtdStatus, isGtdStatus } from "./gtd/types";
export {
  getSessionGtdStatus,
  setSessionGtdStatus,
  clearSessionGtdStatus,
  loadSessionGtdMap,
  sessionGtdKey
} from "./gtd/store";

export {
  sessionTodolistAbsPath,
  sessionTodolistRelMdPath,
  sessionDirKey,
  sessionNoteRelDir,
  sessionNoteAbsDir,
  NOTES_ROOT_SEGMENT,
  notesRoot,
  absFromRelMdPath,
  relMdPathFromAbs,
  isNotesMarkdownPath,
  ownerRelDir,
  ownerAbsDir,
  noteRelMdPath,
  noteAbsMdPath,
  noteAbsAssetsDir,
  ownerJsonPath,
  serializeOwner,
  parseOwnerJson,
  projectDirKey,
  type NoteScope,
  type NoteOwner,
  type LibraryNoteOwner,
  type ProjectNoteOwner,
  type SessionNoteOwner,
  type NoteOwnerJson,
  LIBRARY_REL_DIR
} from "./notes/paths";
export type { NoteRecord, TaskRecord } from "./notes/catalogNotes";
export {
  listAllNotes,
  getNoteById,
  getNoteByRelPath,
  listSessionNotes,
  listLibraryNotes,
  listProjectNotes,
  listTasks,
  listTaskSessionDetails,
  listTaskSessionLinks,
  listTaskSessionProjects,
  findTaskNoteIdForSession,
  upsertNoteRecord,
  deleteNoteRecord,
  deleteNotesByRelPaths,
  loadSessionNoteFlags,
  loadProjectNoteFlags,
  getCatalogMeta,
  setCatalogMeta,
  listLegacySessionNotes,
  listLegacyProjectNotes,
  type TaskSessionDetail,
  type TaskSessionLink
} from "./notes/catalogNotes";
export { NotesStore, type ImportNotesResult } from "./notes/store";
export type { NoteLink, NoteSubtree, NoteTreeNode } from "./notes/links";
export {
  listAllNoteLinks,
  getParentLink,
  listChildLinks,
  deleteLinksForNote,
  clearParentLink,
  listLinkedChildNoteIds,
  listChildCounts,
  collectDescendantIds,
  wouldCreateCycle,
  setParentLink,
  getNoteSubtree,
  resolveLinkRoot
} from "./notes/links";
export { reconcileNotesIndex, migrateLegacyNotesToDisk } from "./notes/reconcile";
export {
  parseNoteDocument,
  buildNoteDocument,
  extractTitle,
  noteTitle,
  contentPreview,
  workFieldsFromFrontmatter,
  type NoteFrontmatter,
  type NoteWorkFields,
  type ParsedNoteDocument
} from "./notes/frontmatter";
export {
  TASK_KNOWLEDGE_BEGIN,
  TASK_KNOWLEDGE_END,
  UNTITLED_TASK_NAME,
  isTaskFrontmatter,
  taskName,
  taskPromptBody,
  ensureTaskKnowledgeRegion,
  newTaskBody,
  normalizeTaskDocument,
  type NormalizedTaskDocument
} from "./notes/taskNote";
export {
  loadNoteWorkMap,
  setNoteWork,
  clearNoteWork,
  syncNoteWorkFromFrontmatter,
  ensureTaskSessionIndex,
  isWorkNote,
  splitSessionKey
} from "./notes/work";
export {
  localDateString,
  formatNoteFilename,
  nextNoteFilename,
  parseNoteFilename,
  normalizeNoteFilename,
  noteAssetsDirName,
  noteStem,
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
