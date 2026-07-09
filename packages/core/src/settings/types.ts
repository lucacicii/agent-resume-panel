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

export interface MemorySettings {
  /** Scheduled jobs; default false (manual only in v0.1). */
  enabled?: boolean;
}

export interface DesktopSettings {
  windowWidth?: number;
  windowHeight?: number;
}

export interface PanelSettings {
  /** Optional override; default ~/.agent-resume-panel. */
  panelHome?: string;
  llm: LlmSettings;
  embedding: EmbeddingSettings;
  memory?: MemorySettings;
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
    enabled: false
  }
};
