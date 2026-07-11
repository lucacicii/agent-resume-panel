export { expandHome, compactPath } from "./pathUtils";
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
  WorkbenchSettings,
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

export type { ChatMessage, LlmRuntimeConfig, EmbeddingRuntimeConfig } from "./llm/types";
export {
  normalizeBaseUrl,
  buildChatCompletionsUrl,
  buildEmbeddingsUrl
} from "./llm/types";
export { chatCompletion, chatCompletionDetailed, chatCompletionStream } from "./llm/chat";
export type { ChatStreamCallbacks } from "./llm/chat";
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
  listRecentAskMessages
} from "./agent/askStore";
export type { AskChatListResult } from "./agent/askStore";
export type { AskChatMessage } from "./agent/askStore";

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
  sessionDirKey
} from "./notes/paths";
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
  autoRenameSessionAction,
  renameSessionAction,
  hideSessionAction
} from "./session/actions";
export type {
  SessionActionOptions,
  SummarizeSessionResult,
  AutoRenameSessionResult,
  RenameSessionResult
} from "./session/actions";
export { buildResumeCommand, buildNewSessionCommand } from "./terminal/commands";
export { openProjectInGhostty, openSessionInGhostty } from "./terminal/ghostty";
export type { GhosttySettings } from "./terminal/ghostty";
export { openProjectInSystemTerminal, openSessionInSystemTerminal } from "./terminal/systemTerminal";
export type { SystemTerminalSettings, SystemTerminalLaunchMode } from "./terminal/systemTerminal";
export { ensureSummariesForSessions } from "./session/ensureSummaries";
export type {
  EnsureSummariesOptions,
  EnsureSummariesResult
} from "./session/ensureSummaries";
export { renameSessionNative } from "./session/rename";
export type { RenameHomes } from "./session/rename";
