export { resolvePanelHome } from "./panelHome";
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
export { sanitizeAgentHomes } from "./transcript/homes";
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
export {
  parseNoteDocument,
  buildNoteDocument,
  extractTitle,
  contentPreview
} from "./notes/frontmatter";
export type { NoteFrontmatter, ParsedNoteDocument } from "./notes/frontmatter";
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
