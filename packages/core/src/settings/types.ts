import type { AgentProvider } from "../catalog/types";
import type { UiLanguagePreference } from "../i18n/locales";

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
export type WorkbenchEditorTabSize = 2 | 4 | 8;
export type WorkbenchEditorAutoSaveDelayMs = 300 | 600 | 1000 | 2000;

export interface WorkbenchEditorSettings {
  /** Whether project text files can be edited in the embedded editor. Default true. */
  editable?: boolean;
  /** Embedded editor font size in pixels (11–24). Default 13. */
  fontSize?: number;
  /** Wrap long lines in the embedded editor. Default false. */
  wordWrap?: boolean;
  /** Tab display and indentation width. Default 4. */
  tabSize?: WorkbenchEditorTabSize;
  /** Delay before automatically saving a changed file. Default 600ms. */
  autoSaveDelayMs?: WorkbenchEditorAutoSaveDelayMs;
}

export interface WorkbenchSettings {
  /** Scratch directory for temporary new sessions. Default: {panelHome}/.desktop/scratch */
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
  /** Max directory depth when scanning for nested Git repos (1–10). Default 6. */
  gitNestedScanMaxDepth?: number;
  /** Directory names to skip while scanning for nested Git repos. Empty uses built-in defaults. */
  gitNestedScanIgnoreDirs?: string[];
  /** Max nested Git repos to collect per scan. Default 32. */
  gitNestedScanMaxRepos?: number;
  /** Embedded Workbench file editor preferences. */
  editor?: WorkbenchEditorSettings;
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

export type SessionSyncStalePolicy = "off" | "purge";

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

export interface ReportSettings {
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
  /** Desktop UI language; auto follows the OS locale. */
  uiLanguage?: UiLanguagePreference;
  /** Tool LLM (summarize / rename / digests). */
  llm: LlmSettings;
  /** Conversation model for Agent / Meta-Agent; falls back to llm. */
  chatLlm?: ChatLlmSettings;
  embedding: EmbeddingSettings;
  report?: ReportSettings;
  agentHomes?: AgentHomesSettings;
  sessionSync?: AgentSessionSyncSettings;
  desktop?: DesktopSettings;
  workbench?: WorkbenchSettings;
  ghosttyExecutable?: string;
  ghosttyLaunchMode?: GhosttyLaunchMode;
  ghosttyAutoPasteDelayMs?: number;
}

export const DEFAULT_SETTINGS: PanelSettings = {
  uiLanguage: "en",
  llm: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    outputLanguage: "auto",
    maxContextChars: 120_000,
    requestTimeoutMs: 300_000
  },
  embedding: {
    model: "text-embedding-3-small"
  },
  report: {
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
    stalePolicy: "off",
    showArchivedCodex: false,
    showArchivedOpenCode: false,
    showSubagentCodex: false,
    showSubagentGrok: false,
    hideCronAlma: true,
    hideChannelAlma: true,
    showIncognitoAlma: false
  },
  workbench: {
    projectEditor: "auto",
    editor: {
      editable: true,
      fontSize: 13,
      wordWrap: false,
      tabSize: 4,
      autoSaveDelayMs: 600
    }
  },
  desktop: {
    theme: "system"
  }
};
