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
  settingsPath,
  desktopSettingsPath,
  desktopDataDir,
  desktopDbPath,
  defaultScratchDir,
  desktopLogsDir
} from "./panelHome";
export { resolveScratchBaseDir, migrateLegacyScratchDir } from "./scratchDir";
export type { PanelDbPaths } from "./dbPaths";
export {
  resolvePanelDbPaths,
  resolvePanelDbPathsFromSettings,
  ensurePanelDatabases,
  preparePanelDatabases,
  preparePanelDatabasesFromSettings
} from "./dbPaths";
export { escapeSqlLiteral, runSqlite, runSqliteJson, runSqliteReadOnlyJson } from "./sqlite";

export type {
  PanelSettings,
  LlmSettings,
  ChatLlmSettings,
  EmbeddingSettings,
  ReportSettings,
  SessionSummaryAutoSettings,
  SessionTranscriptIndexSettings,
  SessionEmbeddingIndexSettings,
  DesktopSettings,
  DesktopTheme,
  DesktopVisualThemeId,
  DesktopThemeEffects,
  WorkbenchSettings,
  WorkbenchEditorSettings,
  WorkbenchEditorTabSize,
  WorkbenchEditorAutoSaveDelayMs,
  WorkbenchProjectContextMenuAction,
  WorkbenchNewSessionTarget,
  AcpAgentProvider,
  AcpAutoApprovePermissions,
  AcpAgentLaunchConfig,
  AcpSettings,
  CommitMessageStyle,
  WorkbenchProjectEditor,
  WorkbenchTerminalMode,
  WorkbenchTerminalThemeId,
  WorkbenchTerminalRenderer,
  GhosttyLaunchMode,
  AgentHomesSettings,
  AgentSessionSyncSettings,
  AgentSessionSyncFilters,
  SessionSyncStalePolicy
} from "./settings/types";
export {
  DEFAULT_SETTINGS,
  DEFAULT_WORKBENCH_PROJECT_CONTEXT_MENU,
  ALL_WORKBENCH_PROJECT_CONTEXT_MENU,
  WORKBENCH_TERMINAL_THEME_IDS,
  WORKBENCH_TERMINAL_RENDERERS,
  DESKTOP_VISUAL_THEME_IDS,
  ACP_AGENT_PROVIDERS
} from "./settings/types";
export {
  normalizeWorkbenchProjectContextMenu,
  normalizeWorkbenchTerminalTheme,
  normalizeWorkbenchTerminalRenderer,
  normalizeDesktopVisualTheme,
  normalizeDesktopThemeEffects,
  normalizeDesktopTheme,
  normalizeWorkbenchEditorTheme
} from "./settings/store";
export {
  formatCliNewSessionTarget,
  formatAcpNewSessionTarget,
  parseWorkbenchNewSessionTarget,
  isAcpAgentProvider
} from "./settings/newSessionTarget";
export type { ParsedWorkbenchNewSessionTarget } from "./settings/newSessionTarget";
export {
  parseNoteGtdTasks,
  appendNoteGtdTask,
  updateNoteGtdTask,
  deleteNoteGtdTask
} from "./notes/gtd";
export type { NoteGtdTask } from "./notes/gtd";
export * from "./flow/types";
export { validateFlowDag, chooseReadyFlowNodeId } from "./flow/model";
export { readFlowDefinition, readFlowRun, syncFlowDefinition, validateFlowDefinition, completeFlowNode, writeFlowStatus } from "./flow/runtime";
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
  summaryLanguagesMatch,
  createUiText
} from "./i18n";
export type { UiText } from "./i18n/uiText";
export {
  loadSettings,
  saveSettings,
  effectivePanelHome,
  catalogDbFromSettings
} from "./settings/store";

export type { AgentProvider, AgentSession, CatalogSessionRow } from "./catalog/types";
export { toAgentSession } from "./catalog/types";
export { cleanupRemovedSessionExecutionNotes } from "./catalog/legacyCleanup";
export type { RemovedExecutionNotesCleanupOptions } from "./catalog/legacyCleanup";
export {
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
  ensureCatalogSyncStateDesktop,
  syncStateHasExtendedColumns
} from "./catalog/db";

export { listSessions, listSessionsInRange, listSessionsInRangePage, listAllSessionsInRange, getSessionById, countSessions } from "./catalog/query";
export type { SessionRangeCursor } from "./catalog/query";
export type { SessionCatalogCounts } from "./catalog/query";
export {
  searchCatalogSessions,
  mergeSessionSearchHits,
  clampSessionSearchLimit,
  clampSessionListLimit,
  sanitizeLikeFragment
} from "./catalog/search";
export type {
  SessionSearchFilters,
  SessionSearchHit,
  SessionSearchMatch
} from "./catalog/search";
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
  unhideAllProjectsInCatalog,
  getProjectById,
  listProjectPathVariants,
  mergeProjectsInCatalog,
  splitProjectPathInCatalog
} from "./catalog/projects";
export type { ProjectRow, ResolveProjectCwdResult } from "./catalog/projects";
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
export { testChatLlmConnection, testEmbeddingConnection } from "./llm/testConnection";
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

export type { ReportLevel, ReportEntry, ReportLink } from "./report/schema";
export { REPORT_SCHEMA_SQL } from "./report/schema";
export {
  listReportEntries,
  listReportEntriesInRange,
  insertReportEntry,
  upsertReportJob,
  getReportJobStatus,
  clearReportJobsByStatus,
  listReportLinks,
  getReportEntryById,
  desktopReportDbExists,
  readReportEntries,
  readReportEntriesInRange,
  readReportEntryById
} from "./report/store";
export type { ReportLinkRow } from "./report/store";
export type {
  ReportPeriodType,
  CalendarPeriodRange,
  CalendarCell
} from "./report/calendar";
export {
  dayKeyFromDate,
  dayKeyFromMs,
  isoWeekLabelFromDate,
  viewMonthKey,
  parseDayRange,
  parseWeekRange,
  parseMonthRange,
  rangeForPeriod,
  paddedMonthRange,
  calendarCells,
  periodKeyFromEntry,
  digestIndex,
  isFuturePeriod
} from "./report/calendar";
export {
  estimateDigestRun,
  estimateDailyForSessions,
  estimateHierarchicalCallCount,
  digestCallBudget,
  assertDigestCallBudget,
  DigestBudgetExceededError
} from "./report/digestBudget";
export type {
  DigestGenerationEstimate,
  DigestRunLevel,
  DigestRunTrigger
} from "./report/digestBudget";
export { runDailyDigest, localDayRange, needsDailyDigestRefresh } from "./report/daily";
export type { PeriodDigestRefreshCheck } from "./report/digestRefresh";
export { needsWeeklyDigestRefresh, needsMonthlyDigestRefresh } from "./report/digestRefresh";
export { normalizeDigestMarkdown, digestLanguageLabels } from "./report/prompts";
export type {
  RunDailyDigestOptions,
  RunDailyDigestResult,
  DailyDigestRefreshCheck,
  DailyDigestRefreshReason
} from "./report/daily";
export type {
  DigestLevel,
  DigestProgressPhase,
  DigestProgressEvent,
  DigestProgressCallback,
  DigestProgressSession
} from "./report/progress";
export {
  localDayRange as localDayRangePeriod,
  localWeekRange,
  localMonthRange,
  previousCompleteWeekRange,
  previousCompleteMonthRange,
  listDayLabelsInRange,
  listWeekLabelsInRange
} from "./report/period";
export type { PeriodRange } from "./report/period";
export { ensureDailiesForPeriod } from "./report/ensureDailies";
export type { EnsureDailiesOptions, EnsureLevelStats } from "./report/ensureDailies";
export { ensureWeekliesForPeriod } from "./report/ensureWeeklies";
export type { EnsureWeekliesOptions } from "./report/ensureWeeklies";
export { runWeeklyDigest } from "./report/weekly";
export type { RunWeeklyDigestOptions, RunWeeklyDigestResult } from "./report/weekly";
export { runMonthlyDigest } from "./report/monthly";
export type { RunMonthlyDigestOptions, RunMonthlyDigestResult } from "./report/monthly";
export { searchReportsByEmbedding } from "./report/search";
export type { SearchReportsOptions, ReportSearchHit } from "./report/search";
export { cosineSimilarity, parseEmbeddingJson } from "./report/cosine";

export type { PreviewHomes, PreviewMessage, SessionPreviewResult } from "./transcript/types";
export {
  resolvePreviewHomes,
  DEFAULT_AGENT_HOMES,
  defaultAgentHomeValue,
  agentHomeDiffersFromDefault,
  sanitizeAgentHomes
} from "./transcript/homes";
export type { AgentHomeKey } from "./transcript/homes";
export {
  loadSessionPreview,
  loadSessionSnippet,
  formatTranscript,
  truncateTranscript
} from "./transcript/load";

export type {
  AgentCitation,
  AgentChatOptions,
  AgentChatResult,
  AgentExecutionCapability,
  AgentExecutionKind,
  AgentExecutionSourceKind,
  AgentExecutionStep,
  AgentStreamEvent,
  AgentStreamPhase,
  AgentToolImpact,
  AgentToolTraceStatus,
  AgentToolTraceStep
} from "./agent/types";
export { retrieveAgentContext } from "./agent/retrieve";
export type { RetrieveAgentContextResult, RetrievedDigest } from "./agent/retrieve";
export {
  buildMetaAgentSystemPrompt,
  buildMetaAgentSystemPromptWithTools,
  buildMetaAgentUserPrompt,
  formatNoteSourceBlock,
  formatSessionSourceBlock,
  formatSourceBlock
} from "./agent/prompts";
export { runAgentChat } from "./agent/agentChat";
export {
  appendAgentTurn,
  clearAgentMessages,
  deleteAgentMessagesFromSortOrder,
  listAgentMessages,
  listAgentMessagesForHistory,
  listOlderAgentMessages,
  listRecentAgentMessages,
  listAgentThreads,
  createAgentThread,
  renameAgentThread,
  deleteAgentThread
} from "./agent/agentStore";
export type { AgentChatListResult, AgentChatMessage, AgentThread } from "./agent/agentStore";
export {
  insertAgentNoteAudit,
  listAgentNoteAudit,
  updateAgentNoteAuditStatus
} from "./agent/noteAudit";
export type { AgentNoteAuditEvent, AgentNoteAuditStatus } from "./agent/noteAudit";

export type {
  ActiveGtdStatus,
  GtdStatus,
  GtdEvidence,
  GtdEvidenceQuote,
  GtdProposal,
  GtdApplyItem
} from "./gtd/types";
export { GTD_ACTIVE_STATUSES, GTD_STATUSES, isActiveGtdStatus, isGtdStatus } from "./gtd/types";
export {
  getSessionGtdStatus,
  setSessionGtdStatus,
  clearSessionGtdStatus,
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
  runReportGtdSync,
  previewReportGtdSync,
  applyReportGtdSync
} from "./workflow/runReportGtdSync";
export type {
  RunReportGtdSyncOptions,
  RunReportGtdSyncResult,
  PreviewReportGtdSyncResult,
  ApplyReportGtdSyncOptions,
  ApplyReportGtdSyncResult,
  GtdPreviewItem
} from "./workflow/runReportGtdSync";
export { analyzeReportForGtd } from "./workflow/analyzeGtd";
export { renderSessionTodolistMarkdown } from "./notes/todolist";
export {
  backfillReportDigests,
  previewBackfillReportDigests,
  listActivityPeriods,
  localDateKeyFromMs
} from "./workflow/backfillDigests";
export type {
  BackfillReportDigestsOptions,
  BackfillReportDigestsResult,
  BackfillLevelStats
} from "./workflow/backfillDigests";

export {
  summarizeSessionAction,
  suggestSessionRenameAction,
  autoRenameSessionAction,
  renameSessionAction,
  hideSessionAction,
  hideProjectAction
} from "./session/actions";
export type {
  SessionActionOptions,
  SummarizeSessionResult,
  SuggestSessionRenameResult,
  AutoRenameSessionResult,
  RenameSessionResult
} from "./session/actions";
export {
  suggestCommitMessageFromGitContext,
  buildHeuristicCommitMessage
} from "./git/commitAssist";
export {
  buildCommitMessageSystemPrompt,
  buildCommitMessageUserPrompt,
  normalizeSuggestedCommitMessage,
  normalizeCommitMessageStyle,
  normalizeCustomCommitInstructions,
  DEFAULT_CONVENTIONAL_COMMIT_INSTRUCTIONS
} from "./git/prompts";
export type { CommitMessagePromptOptions } from "./git/prompts";
export { buildResumeCommand, buildNewSessionCommand } from "./terminal/commands";
export type { NewSessionExecutionMode } from "./terminal/commands";
export {
  openProjectInEditor,
  projectEditorLabel,
  resolveProjectEditor
} from "./terminal/projectEditor";
export type { ProjectEditor, ProjectEditorId } from "./terminal/projectEditor";
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
export {
  resolveSessionSummaryAutoSettings,
  listSessionsNeedingSummary,
  selectAutoSummaryCandidates,
  isEligibleForAutoSummary,
  isMissingSummary,
  isStaleSummary,
  runAutoSessionSummaries,
  clampInt,
  DEFAULT_STALE_DELAY_MINUTES,
  DEFAULT_MISSING_DELAY_MINUTES,
  DEFAULT_AUTO_SUMMARY_CONCURRENCY,
  DEFAULT_AUTO_SUMMARY_MAX_PER_TICK
} from "./session/autoSummary";
export type {
  AutoSummaryCandidate,
  AutoSummaryReason,
  ResolvedSessionSummaryAutoSettings,
  RunAutoSessionSummariesOptions,
  RunAutoSessionSummariesResult
} from "./session/autoSummary";
export {
  resolveSessionTranscriptIndexSettings,
  selectTranscriptIndexCandidates,
  listTranscriptIndexMeta,
  runAutoTranscriptIndex,
  DEFAULT_TX_QUIET_DELAY_MINUTES,
  DEFAULT_TX_INDEX_CONCURRENCY,
  DEFAULT_TX_INDEX_MAX_PER_TICK
} from "./session/autoTranscriptIndex";
export type {
  ResolvedSessionTranscriptIndexSettings,
  RunAutoTranscriptIndexOptions,
  RunAutoTranscriptIndexResult,
  TranscriptIndexMetaRow
} from "./session/autoTranscriptIndex";
export {
  resolveSessionEmbeddingIndexSettings,
  selectSessionEmbeddingCandidates,
  listSessionsNeedingEmbedding,
  runAutoSessionEmbeddings,
  DEFAULT_EMB_INDEX_QUIET_DELAY_MINUTES,
  DEFAULT_EMB_INDEX_CONCURRENCY,
  DEFAULT_EMB_INDEX_MAX_PER_TICK
} from "./session/autoEmbeddingIndex";
export type {
  ResolvedSessionEmbeddingIndexSettings,
  SessionEmbeddingCandidate,
  RunAutoSessionEmbeddingsOptions,
  RunAutoSessionEmbeddingsResult
} from "./session/autoEmbeddingIndex";
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
export type { NoteToolContext, NoteMcpResult, NoteRelationshipIndex } from "./mcp/tools";
export type { AgentMcpContext } from "./mcp/server";
export {
  handleSessionSearch,
  handleSessionList,
  handleSessionRead,
  handleSessionReadTranscript,
  handleSessionSetGtd,
  handleSessionResume
} from "./mcp/sessionTools";
export type { SessionToolContext } from "./mcp/sessionTools";
export { NoteMcpClient, convertMcpToolsToOpenAiFormat } from "./mcp/client";
export type { McpToolInfo, McpToolCallResult } from "./mcp/client";
export { runToolLoop } from "./agent/toolLoop";
export type {
  ToolLoopOptions,
  ToolLoopResult,
  TouchedNote,
  TouchedSession,
  NoteOperation,
  SessionOperation
} from "./agent/toolLoop";
export { extractTouchedSessions } from "./agent/toolLoop";
export { resolveMcpServerCommand } from "./agent/mcpConfig";
export type { McpServerCommand } from "./agent/mcpConfig";
export {
  upsertSessionEmbedding,
  backfillSessionEmbeddings,
  listSessionEmbeddingRows,
  buildSessionEmbedText,
  sessionEmbeddingKey
} from "./session/embedStore";
export type {
  UpsertSessionEmbeddingOptions,
  UpsertSessionEmbeddingResult,
  BackfillSessionEmbeddingsOptions,
  BackfillSessionEmbeddingsResult
} from "./session/embedStore";
export { searchSessionsByEmbedding } from "./session/searchByEmbedding";
export type { SearchSessionsByEmbeddingOptions } from "./session/searchByEmbedding";
export {
  chunkTranscriptText,
  rankSessionsByTranscriptChunks,
  searchSessionsByTranscriptEmbedding,
  indexSessionTranscript,
  listTranscriptChunkRows,
  deleteSessionTranscriptIndex,
  transcriptSourceHash
} from "./session/transcriptIndex";
export type {
  TranscriptChunkInput,
  RankableTranscriptChunk,
  RankedTranscriptSession,
  IndexSessionTranscriptOptions,
  IndexSessionTranscriptResult,
  SearchSessionsByTranscriptOptions
} from "./session/transcriptIndex";
export {
  buildNativeConversationArtifacts
} from "./backup/nativeConversations";
export type {
  NativeConversationProvider,
  NativeConversationFile,
  NativeConversationProviderSummary,
  NativeConversationCollection,
  CollectNativeConversationsOptions
} from "./backup/nativeConversations";
