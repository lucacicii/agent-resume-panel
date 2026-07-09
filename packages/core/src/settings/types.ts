export interface LlmSettings {
  baseUrl: string;
  model: string;
  /** Stored in settings.json for v0.1 (prefer keychain later). */
  apiKey?: string;
  outputLanguage?: string;
  maxContextChars?: number;
}

export interface EmbeddingSettings {
  /** Defaults to llm.baseUrl when omitted. */
  baseUrl?: string;
  model: string;
  /** Defaults to llm.apiKey when omitted. */
  apiKey?: string;
}

export interface DesktopSettings {
  windowWidth?: number;
  windowHeight?: number;
}

/** Agent CLI data homes (same defaults as the VS Code extension). */
export interface AgentHomesSettings {
  codexHome?: string;
  claudeHome?: string;
  antigravityHome?: string;
  grokHome?: string;
  almaDataDir?: string;
  opencodeHome?: string;
  piHome?: string;
}

export interface MemorySettings {
  /** Scheduled jobs; default false (manual only in v0.1). */
  enabled?: boolean;
  /** Prefer session_summary; if missing, load native transcript excerpt. Default true. */
  includeTranscripts?: boolean;
  /** Max sessions included in one daily digest. Default 40. */
  maxSessionsPerDigest?: number;
  /** Max chars of transcript excerpt per session. Default 2500. */
  snippetMaxChars?: number;
}

export interface PanelSettings {
  /** Optional override; default ~/.agent-resume-panel. */
  panelHome?: string;
  llm: LlmSettings;
  embedding: EmbeddingSettings;
  memory?: MemorySettings;
  agentHomes?: AgentHomesSettings;
  desktop?: DesktopSettings;
}

export const DEFAULT_SETTINGS: PanelSettings = {
  llm: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    outputLanguage: "zh-CN",
    maxContextChars: 120_000
  },
  embedding: {
    model: "text-embedding-3-small"
  },
  memory: {
    enabled: false,
    includeTranscripts: true,
    maxSessionsPerDigest: 40,
    snippetMaxChars: 2500
  }
};
