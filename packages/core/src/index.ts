export { expandHome, compactPath, basenameOrPath, normalizeProjectPath } from "./pathUtils";
export {
  DEFAULT_PANEL_HOME,
  resolvePanelHome,
  catalogDbPath,
  settingsPath
} from "./panelHome";
export { escapeSqlLiteral, runSqlite, runSqliteJson } from "./sqlite";

export type {
  PanelSettings,
  LlmSettings,
  ChatLlmSettings,
  EmbeddingSettings,
  MemorySettings,
  DesktopSettings,
  DesktopTheme,
  WorkbenchSettings,
  WorkbenchProjectEditor,
  WorkbenchTerminalMode,
  GhosttyLaunchMode,
  AgentHomesSettings,
  AgentSessionSyncSettings,
  AgentSessionSyncFilters,
  SessionSyncStalePolicy
} from "./settings/types";
export { DEFAULT_SETTINGS } from "./settings/types";
export {
  loadSettings,
  saveSettings,
  effectivePanelHome,
  catalogDbFromSettings
} from "./settings/store";

export type { AgentProvider, AgentSession, CatalogSessionRow } from "./catalog/types";
export { toAgentSession } from "./catalog/types";
export { ensureCatalogSchema } from "./catalog/db";
export { listSessions, listSessionsInRange, getSessionById } from "./catalog/query";
export { setUserTitleInCatalog, setSessionSummaryInCatalog, hideSessionsInCatalog } from "./catalog/mutations";
export {
  loadProjectAliasesMap,
  getProjectAliasFromCatalog,
  setProjectAliasInCatalog,
  upsertProjectAliasesBatch
} from "./catalog/projects";
export {
  loadAllAgentSessions,
  syncAgentSessions,
  sessionSyncOptionsFromSettings
} from "./sessionSync";
export type {
  AgentSessionSyncOptions,
  AgentSessionSyncResult,
  AgentSessionProviderSyncResult,
  SyncableAgentProvider
} from "./sessionSync";

export type { ChatMessage, LlmRuntimeConfig, EmbeddingRuntimeConfig, ToolCall, ToolDefinition } from "./llm/types";
export {
  normalizeBaseUrl,
  buildChatCompletionsUrl,
  buildEmbeddingsUrl
} from "./llm/types";
export { chatCompletion, chatCompletionDetailed, chatCompletionStream, chatCompletionWithTools } from "./llm/chat";
export type { ChatStreamCallbacks, LlmToolCallResult } from "./llm/chat";
export type { LlmCallResult } from "./llm/chat";
export { embedTexts, embedTextsDetailed } from "./llm/embeddings";
export type { EmbedCallResult } from "./llm/embeddings";
export {
  llmConfigFromSettings,
  chatLlmConfigFromSettings,
  embeddingConfigFromSettings
} from "./llm/fromSettings";
export {
  recordLlmUsage,
  listLlmUsageEvents,
  listScheduleRuns,
  getUsageSummary,
  startScheduleRun,
  finishScheduleRun
} from "./usage/store";
export type {
  LlmUsageEvent,
  LlmUsageKind,
  LlmUsageSource,
  ScheduleRunLog,
  TokenUsage,
  UsageSummary
} from "./usage/types";

export type { MemoryLevel, MemoryEntry, MemoryLink } from "./memory/schema";
export { MEMORY_SCHEMA_SQL } from "./memory/schema";
export {
  listMemoryEntries,
  listMemoryEntriesInRange,
  insertMemoryEntry,
  upsertMemoryJob,
  getMemoryJobStatus,
  listMemoryLinks,
  getMemoryEntryById
} from "./memory/store";
export type { MemoryLinkRow } from "./memory/store";
export { runDailyDigest, localDayRange, needsDailyDigestRefresh } from "./memory/daily";
export type { PeriodDigestRefreshCheck } from "./memory/digestRefresh";
export { needsWeeklyDigestRefresh, needsMonthlyDigestRefresh } from "./memory/digestRefresh";
export { normalizeDigestMarkdown, digestLanguageLabels } from "./memory/prompts";
export type {
  RunDailyDigestOptions,
  RunDailyDigestResult,
  DailyDigestRefreshCheck,
  DailyDigestRefreshReason
} from "./memory/daily";
export type {
  DigestLevel,
  DigestProgressPhase,
  DigestProgressEvent,
  DigestProgressCallback,
  DigestProgressSession
} from "./memory/progress";
export {
  localDayRange as localDayRangePeriod,
  localWeekRange,
  localMonthRange,
  previousCompleteWeekRange,
  previousCompleteMonthRange,
  listDayLabelsInRange,
  listWeekLabelsInRange
} from "./memory/period";
export type { PeriodRange } from "./memory/period";
export { ensureDailiesForPeriod } from "./memory/ensureDailies";
export type { EnsureDailiesOptions, EnsureLevelStats } from "./memory/ensureDailies";
export { ensureWeekliesForPeriod } from "./memory/ensureWeeklies";
export type { EnsureWeekliesOptions } from "./memory/ensureWeeklies";
export { runWeeklyDigest } from "./memory/weekly";
export type { RunWeeklyDigestOptions, RunWeeklyDigestResult } from "./memory/weekly";
export { runMonthlyDigest } from "./memory/monthly";
export type { RunMonthlyDigestOptions, RunMonthlyDigestResult } from "./memory/monthly";
export { searchMemoryByEmbedding } from "./memory/search";
export type { SearchMemoryOptions, MemorySearchHit } from "./memory/search";
export { cosineSimilarity, parseEmbeddingJson } from "./memory/cosine";

export type { PreviewHomes, PreviewMessage, SessionPreviewResult } from "./transcript/types";
export { resolvePreviewHomes, DEFAULT_AGENT_HOMES, defaultAlmaDataDir } from "./transcript/homes";
export {
  loadSessionPreview,
  loadSessionSnippet,
  formatTranscript,
  truncateTranscript
} from "./transcript/load";

export type {
  AgentCitation,
  AskMetaAgentOptions,
  AskMetaAgentResult,
  AskStreamEvent,
  AskStreamPhase
} from "./agent/types";
export { retrieveAgentContext } from "./agent/retrieve";
export type { RetrieveAgentContextResult, RetrievedDigest } from "./agent/retrieve";
export { askMetaAgent } from "./agent/ask";
export {
  appendAskTurn,
  clearAskMessages,
  listAskMessages,
  listAskMessagesForHistory,
  listOlderAskMessages,
  listRecentAskMessages,
  listAskThreads,
  createAskThread,
  renameAskThread,
  deleteAskThread
} from "./agent/askStore";
export type { AskChatListResult, AskChatMessage, AskThread } from "./agent/askStore";
export {
  insertAskNoteAudit,
  listAskNoteAudit,
  updateAskNoteAuditStatus
} from "./agent/noteAudit";
export type { AskNoteAuditEvent, AskNoteAuditStatus } from "./agent/noteAudit";

export type { GtdStatus, GtdProposal, GtdApplyItem } from "./gtd/types";
export { GTD_STATUSES, isGtdStatus } from "./gtd/types";
export {
  getSessionGtdStatus,
  setSessionGtdStatus,
  loadSessionGtdMap,
  sessionGtdKey
} from "./gtd/store";
export { writeSessionTodolistMd } from "./notes/todolist";
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
export type { NoteRecord } from "./notes/catalogNotes";
export {
  listAllNotes,
  getNoteById,
  getNoteByRelPath,
  listSessionNotes,
  listLibraryNotes,
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
export { NotesStore, type ImportNotesResult } from "./notes/store";
export { ensureNotesVectorIndex, chunkNoteMarkdown } from "./notes/vectorIndex";
export type {
  NoteIndexProgressCallback,
  NoteIndexProgressEvent,
  NoteIndexProgressPhase
} from "./notes/vectorIndex";
export { searchNotesByEmbedding } from "./notes/search";
export { extractExactNoteSearchTerms, isNotesOnlyQuery } from "./notes/search";
export {
  normalizeLlmNoteSearchPlan,
  planNoteSearchDeterministically,
  shouldAnalyzeNoteSearchWithLlm
} from "./notes/queryPlan";
export type {
  NoteSearchField,
  NoteSearchMode,
  NoteSearchOperator,
  NoteSearchPlan
} from "./notes/queryPlan";
export type { NoteSearchHit } from "./notes/search";
export { reconcileNotesIndex, migrateLegacyNotesToDisk } from "./notes/reconcile";
export {
  parseNoteDocument,
  buildNoteDocument,
  extractTitle,
  contentPreview,
  type NoteFrontmatter,
  type ParsedNoteDocument
} from "./notes/frontmatter";
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
export {
  runMemoryGtdSync,
  previewMemoryGtdSync,
  applyMemoryGtdSync
} from "./workflow/runMemoryGtdSync";
export type {
  RunMemoryGtdSyncOptions,
  RunMemoryGtdSyncResult,
  PreviewMemoryGtdSyncResult,
  ApplyMemoryGtdSyncOptions,
  ApplyMemoryGtdSyncResult,
  GtdPreviewItem
} from "./workflow/runMemoryGtdSync";
export { analyzeMemoryForGtd } from "./workflow/analyzeGtd";
export { renderSessionTodolistMarkdown } from "./notes/todolist";
export {
  backfillMemoryDigests,
  previewBackfillMemoryDigests,
  listActivityPeriods,
  localDateKeyFromMs
} from "./workflow/backfillDigests";
export type {
  BackfillMemoryDigestsOptions,
  BackfillMemoryDigestsResult,
  BackfillLevelStats
} from "./workflow/backfillDigests";

export {
  summarizeSessionAction,
  suggestSessionRenameAction,
  autoRenameSessionAction,
  renameSessionAction,
  hideSessionAction
} from "./session/actions";
export type {
  SessionActionOptions,
  SummarizeSessionResult,
  SuggestSessionRenameResult,
  AutoRenameSessionResult,
  RenameSessionResult
} from "./session/actions";
export { buildResumeCommand, buildNewSessionCommand } from "./terminal/commands";
export {
  openProjectInEditor,
  projectEditorLabel,
  resolveProjectEditor
} from "./terminal/projectEditor";
export type { ProjectEditor, ProjectEditorId } from "./terminal/projectEditor";
export { buildAlmaActivateCommand, openAlmaThreadInApp } from "./terminal/alma";
export { openProjectInGhostty, openSessionInGhostty } from "./terminal/ghostty";
export type { GhosttySettings } from "./terminal/ghostty";
export {
  openProjectInSystemTerminal,
  openSessionInSystemTerminal
} from "./terminal/systemTerminal";
export type { SystemTerminalSettings, SystemTerminalLaunchMode } from "./terminal/systemTerminal";
export {
  openChatGptAppSession,
  openChatGptAppProject,
  openChatGptDeepLink,
  buildChatGptThreadUrl,
  buildChatGptNewTaskUrl,
  CHATGPT_APP_URL_SCHEME
} from "./terminal/chatgptApp";
export { ensureSummariesForSessions } from "./session/ensureSummaries";
export type {
  EnsureSummariesOptions,
  EnsureSummariesResult
} from "./session/ensureSummaries";
export { renameSessionNative } from "./session/rename";
export type { RenameHomes } from "./session/rename";

// MCP server and tool-calling support
export {
  createNoteMcpServer,
  createNoteToolContext,
  runStdioServer,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION
} from "./mcp/server";
export type { NoteToolContext } from "./mcp/tools";
export { NoteMcpClient, convertMcpToolsToOpenAiFormat } from "./mcp/client";
export type { McpToolInfo, McpToolCallResult } from "./mcp/client";
export { runToolLoop } from "./agent/toolLoop";
export type { ToolLoopOptions, ToolLoopResult, TouchedNote, NoteOperation } from "./agent/toolLoop";
export { resolveMcpServerCommand } from "./agent/mcpConfig";
export type { McpServerCommand } from "./agent/mcpConfig";
