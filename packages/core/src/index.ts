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
  EmbeddingSettings,
  MemorySettings,
  DesktopSettings,
  AgentHomesSettings
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

export type { ChatMessage, LlmRuntimeConfig, EmbeddingRuntimeConfig } from "./llm/types";
export {
  normalizeBaseUrl,
  buildChatCompletionsUrl,
  buildEmbeddingsUrl
} from "./llm/types";
export { chatCompletion } from "./llm/chat";
export { embedTexts } from "./llm/embeddings";
export { llmConfigFromSettings, embeddingConfigFromSettings } from "./llm/fromSettings";

export type { MemoryLevel, MemoryEntry, MemoryLink } from "./memory/schema";
export { MEMORY_SCHEMA_SQL } from "./memory/schema";
export {
  listMemoryEntries,
  listMemoryEntriesInRange,
  insertMemoryEntry,
  upsertMemoryJob,
  getMemoryJobStatus
} from "./memory/store";
export { runDailyDigest, localDayRange } from "./memory/daily";
export type { RunDailyDigestOptions, RunDailyDigestResult } from "./memory/daily";
export {
  localDayRange as localDayRangePeriod,
  localWeekRange,
  localMonthRange,
  previousCompleteWeekRange,
  previousCompleteMonthRange
} from "./memory/period";
export type { PeriodRange } from "./memory/period";
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
