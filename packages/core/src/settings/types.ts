import type { AgentProvider } from "../catalog/types";

/** Tool LLM: summarize, rename, digests, and other batch helpers. Prefer a fast, low-cost model. */
export interface LlmSettings {
  baseUrl: string;
  model: string;
  /** Stored in settings.json for v0.1 (prefer keychain later). */
  apiKey?: string;
  outputLanguage?: string;
  maxContextChars?: number;
  /** Timeout for one tool-LLM request; defaults to five minutes. */
  requestTimeoutMs?: number;
}

/**
 * Conversation / Meta-Agent chat model.
 * Omitted fields fall back to the tool `llm` settings.
 */
export interface ChatLlmSettings {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface EmbeddingSettings {
  /** Defaults to llm.baseUrl when omitted. */
  baseUrl?: string;
  model: string;
  /** Defaults to llm.apiKey when omitted. */
  apiKey?: string;
}

export type DesktopTheme = "system" | "light" | "dark";

export interface DesktopSettings {
  windowWidth?: number;
  windowHeight?: number;
  /** UI appearance; default follows OS. */
  theme?: DesktopTheme;
}

export type WorkbenchTerminalMode = "xterm" | "external-system" | "external-ghostty";
export type WorkbenchProjectEditor = "auto" | "vscode" | "vscodium" | "cursor" | "windsurf";

export type WorkbenchCmdTAction = "newSession" | "newTerminal";

export interface WorkbenchSettings {
  /** Scratch directory for temporary new sessions. Default: {panelHome}/scratch */
  scratchDir?: string;
  defaultNewSessionProvider?: AgentProvider;
  /** Workbench ⌘T / Ctrl+T shortcut action. Default newTerminal. */
  cmdTAction?: WorkbenchCmdTAction;
  /** Editor used by the workbench project context menu. Default auto. */
  projectEditor?: WorkbenchProjectEditor;
  terminalMode?: WorkbenchTerminalMode;
  /** How external (system) terminal starts a resumed session. Default executeCommand. */
  externalLaunchMode?: GhosttyLaunchMode;
  externalAutoPasteDelayMs?: number;
}

export type GhosttyLaunchMode = "pasteCommand" | "copyCommand" | "executeCommand";

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

export type SessionSyncStalePolicy = "hide" | "purge";

export interface AgentSessionSyncFilters {
  showArchivedCodex?: boolean;
  showArchivedOpenCode?: boolean;
  showSubagentCodex?: boolean;
  showSubagentGrok?: boolean;
  hideCronAlma?: boolean;
  hideChannelAlma?: boolean;
  showIncognitoAlma?: boolean;
}

export interface AgentSessionSyncSettings extends AgentSessionSyncFilters {
  maxItems?: number;
  stalePolicy?: SessionSyncStalePolicy;
}

export interface MemorySettings {
  /** Scheduled jobs in Desktop; default false. */
  enabled?: boolean;
  /** Prefer session_summary; if missing, load native transcript excerpt. Default true. */
  includeTranscripts?: boolean;
  /** Max sessions included in one daily digest. Default 40. */
  maxSessionsPerDigest?: number;
  /** Max chars of transcript excerpt per session. Default 2500. */
  snippetMaxChars?: number;
  /** Local hour 0–23 for automatic daily job. Default 22. */
  scheduleDailyHour?: number;
  /** Local hour for weekly job (previous ISO week) on Monday. Default 9. */
  scheduleWeeklyHour?: number;
  /** Local hour on day 1 for previous-month job. Default 9. */
  scheduleMonthlyHour?: number;
}

export interface PanelSettings {
  /** Optional override; default ~/.agent-resume-panel. */
  panelHome?: string;
  /** Tool LLM (summarize / rename / digests). */
  llm: LlmSettings;
  /** Conversation model for Ask / Meta-Agent; falls back to llm. */
  chatLlm?: ChatLlmSettings;
  embedding: EmbeddingSettings;
  memory?: MemorySettings;
  agentHomes?: AgentHomesSettings;
  sessionSync?: AgentSessionSyncSettings;
  desktop?: DesktopSettings;
  workbench?: WorkbenchSettings;
  ghosttyExecutable?: string;
  ghosttyLaunchMode?: GhosttyLaunchMode;
  ghosttyAutoPasteDelayMs?: number;
}

export const DEFAULT_SETTINGS: PanelSettings = {
  llm: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    outputLanguage: "zh-CN",
    maxContextChars: 120_000,
    requestTimeoutMs: 300_000
  },
  embedding: {
    model: "text-embedding-3-small"
  },
  memory: {
    enabled: false,
    includeTranscripts: true,
    maxSessionsPerDigest: 40,
    snippetMaxChars: 2500,
    scheduleDailyHour: 22,
    scheduleWeeklyHour: 9,
    scheduleMonthlyHour: 9
  },
  sessionSync: {
    maxItems: 10_000,
    stalePolicy: "hide",
    showArchivedCodex: false,
    showArchivedOpenCode: false,
    showSubagentCodex: false,
    showSubagentGrok: false,
    hideCronAlma: true,
    hideChannelAlma: true,
    showIncognitoAlma: false
  },
  workbench: {
    projectEditor: "auto"
  },
  desktop: {
    theme: "system"
  }
};
