export { expandHome, compactPath } from "./pathUtils";
export {
  DEFAULT_PANEL_HOME,
  resolvePanelHome,
  catalogDbPath,
  settingsPath
} from "./panelHome";
export { escapeSqlLiteral, runSqlite, runSqliteJson } from "./sqlite";

export type { PanelSettings, LlmSettings, EmbeddingSettings, MemorySettings, DesktopSettings } from "./settings/types";
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
export { listMemoryEntries, insertMemoryEntry, upsertMemoryJob } from "./memory/store";
export { runDailyDigest, localDayRange } from "./memory/daily";
export type { RunDailyDigestOptions, RunDailyDigestResult } from "./memory/daily";
