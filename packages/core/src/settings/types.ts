import type { AgentProvider } from "../catalog/types";
import {
  DEFAULT_CONVENTIONAL_COMMIT_INSTRUCTIONS,
  type CommitMessageStyle
} from "../git/prompts";
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
/** Official visual theme packages bundled with the Desktop renderer. */
export type DesktopVisualThemeId = "classic" | "cyberpunk" | "dos";
export const DESKTOP_VISUAL_THEME_IDS: readonly DesktopVisualThemeId[] = [
  "classic",
  "cyberpunk",
  "dos"
] as const;
/** Decorative effects preference. The OS reduced-motion preference always wins at runtime. */
export type DesktopThemeEffects = "full" | "reduced";

export interface DesktopSettings {
  windowWidth?: number;
  windowHeight?: number;
  /** UI appearance; default follows OS. */
  theme?: DesktopTheme;
  /** Theme package controlling the visual language; defaults to Classic. */
  visualTheme?: DesktopVisualThemeId;
  /** User preference for decorative effects; system reduced motion overrides it. */
  themeEffects?: DesktopThemeEffects;
  /** @deprecated Replaced by alwaysAllowAgentNonDestructiveOperations. */
  alwaysAllowAgentWriteOperations?: boolean;
  /** Allow classified write, launch, exec, and outbound-network actions without per-call confirmation. */
  alwaysAllowAgentNonDestructiveOperations?: boolean;
}

/** Notes-specific desktop behavior. */
export interface NotesSettings {
  /** Global shortcut used to create a new Library Note window. Empty disables it. */
  newStandaloneNoteShortcut?: string;
}

export type WorkbenchTerminalMode = "xterm" | "external-system" | "external-ghostty";
/** Built-in embedded xterm color presets (desktop Workbench). */
export type WorkbenchTerminalThemeId =
  | "follow-app"
  | "default-dark"
  | "default-light"
  | "solarized-dark"
  | "solarized-light"
  | "one-dark"
  | "dracula";
export const WORKBENCH_TERMINAL_THEME_IDS: readonly WorkbenchTerminalThemeId[] = [
  "follow-app",
  "default-dark",
  "default-light",
  "solarized-dark",
  "solarized-light",
  "one-dark",
  "dracula"
] as const;
/**
 * Embedded xterm accelerated renderer.
 * - webgl: prefer WebGL, fall back to Canvas on failure/context loss (default)
 * - canvas: force Canvas 2D (more stable for some CJK / GPU drivers)
 */
export type WorkbenchTerminalRenderer = "webgl" | "canvas";
export const WORKBENCH_TERMINAL_RENDERERS: readonly WorkbenchTerminalRenderer[] = [
  "webgl",
  "canvas"
] as const;
export type WorkbenchProjectEditor = "auto" | "vscode" | "vscodium" | "cursor" | "windsurf";

export type WorkbenchCmdTAction = "newSession" | "newTerminal";
export type WorkbenchEditorTabSize = 2 | 4 | 8;
export type WorkbenchEditorAutoSaveDelayMs = 300 | 600 | 1000 | 2000;
export type { CommitMessageStyle } from "../git/prompts";

/** Project row context-menu actions (Workbench). */
export type WorkbenchProjectContextMenuAction =
  | "pin"
  | "newSession"
  | "editor"
  | "note"
  | "rename"
  | "setLocalPath"
  | "copyPath"
  | "reveal"
  | "merge"
  | "split"
  | "remove";

/** Default project context menu items (shown when setting is unset). */
export const DEFAULT_WORKBENCH_PROJECT_CONTEXT_MENU: WorkbenchProjectContextMenuAction[] = [
  "newSession",
  "note",
  "reveal",
  "remove"
];

export const ALL_WORKBENCH_PROJECT_CONTEXT_MENU: WorkbenchProjectContextMenuAction[] = [
  "pin",
  "newSession",
  "editor",
  "note",
  "rename",
  "setLocalPath",
  "copyPath",
  "reveal",
  "merge",
  "split",
  "remove"
];

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

/**
 * Workbench "New session" target.
 * CLI and ACP share provider names; the channel prefix disambiguates launch path.
 * Examples: `cli:codex`, `acp:claude`.
 */
export type WorkbenchNewSessionTarget = string;

export type AcpAgentProvider = "codex" | "claude" | "grok" | "opencode" | "pi";

export const ACP_AGENT_PROVIDERS: readonly AcpAgentProvider[] = [
  "claude",
  "codex",
  "grok",
  "opencode",
  "pi"
] as const;

export type AcpAutoApprovePermissions = "ask" | "allowAll";

export interface AcpAgentLaunchConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Shared panel-home ACP settings (Desktop Workbench; optional for extension later). */
export interface AcpSettings {
  autoApprovePermissions?: AcpAutoApprovePermissions;
  agents?: Partial<Record<AcpAgentProvider, AcpAgentLaunchConfig>>;
  /**
   * Experimental: map Grok Build proprietary ACP session meta into model + thinking toolbar options.
   * Default false (opt-in). Disable when official ACP configOptions/modes cover Grok.
   */
  experimentalGrokVendorUi?: boolean;
}

export interface WorkbenchSettings {
  /** Scratch directory for temporary new sessions. Default: {panelHome}/.desktop/scratch */
  scratchDir?: string;
  /**
   * Legacy CLI-only default agent. Prefer `defaultNewSessionTarget`.
   * Still written for older readers as the CLI provider when target is CLI.
   */
  defaultNewSessionProvider?: AgentProvider;
  /**
   * Composite default for Workbench new session: `cli:{provider}` or `acp:{provider}`.
   * An explicit empty string means prompt for a target each time.
   * When unset, falls back to `cli:{defaultNewSessionProvider || "codex"}`.
   */
  defaultNewSessionTarget?: WorkbenchNewSessionTarget;
  /** Launch normal CLI Workbench sessions with provider-specific YOLO flags. Default false. */
  newSessionYolo?: boolean;
  /** Workbench ⌘T / Ctrl+T shortcut action. Default newTerminal. */
  cmdTAction?: WorkbenchCmdTAction;
  /** Editor used by the workbench project context menu. Default auto. */
  projectEditor?: WorkbenchProjectEditor;
  terminalMode?: WorkbenchTerminalMode;
  /** Embedded xterm color preset. `follow-app` follows the active visual theme. */
  terminalTheme?: WorkbenchTerminalThemeId;
  /** Workbench CodeMirror scheme. `follow-app` is the default. */
  editorTheme?: "follow-app" | "light" | "dark";
  /** Embedded xterm GPU renderer. Default webgl (Canvas fallback on failure). */
  terminalRenderer?: WorkbenchTerminalRenderer;
  /** How external (system) terminal starts a resumed session. Default executeCommand. */
  externalLaunchMode?: GhosttyLaunchMode;
  externalAutoPasteDelayMs?: number;
  /** Max directory depth when scanning for nested Git repos (1–10). Default 6. */
  gitNestedScanMaxDepth?: number;
  /** Directory names to skip while scanning for nested Git repos. Empty uses built-in defaults. */
  gitNestedScanIgnoreDirs?: string[];
  /** Max nested Git repos to collect per scan. Default 32. */
  gitNestedScanMaxRepos?: number;
  /** AI-generated Git commit message format. Default Conventional Commits. */
  gitCommitMessageStyle?: CommitMessageStyle;
  /** Format rules used when gitCommitMessageStyle is custom. */
  gitCommitCustomInstructions?: string;
  /** Embedded Workbench file editor preferences. */
  editor?: WorkbenchEditorSettings;
  /**
   * Enabled project context-menu actions.
   * When unset, defaults to newSession, note, reveal, remove.
   */
  projectContextMenu?: WorkbenchProjectContextMenuAction[];
}

export type GhosttyLaunchMode = "pasteCommand" | "copyCommand" | "executeCommand";

/** Agent CLI data homes (same defaults as the VS Code extension). */
export interface AgentHomesSettings {
  codexHome?: string;
  claudeHome?: string;
  antigravityHome?: string;
  grokHome?: string;
  opencodeHome?: string;
  piHome?: string;
  /** Cursor CLI data root, containing chats/ and projects/. */
  cursorHome?: string;
  /** Cursor IDE User data directory. Empty uses the platform default. */
  cursorIdeUserDataHome?: string;
}

export type SessionSyncStalePolicy = "off" | "purge";

export interface AgentSessionSyncFilters {
  showArchivedCodex?: boolean;
  showArchivedOpenCode?: boolean;
  showSubagentCodex?: boolean;
  showSubagentGrok?: boolean;
  showArchivedCursorIde?: boolean;
  showSubagentCursorIde?: boolean;
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
  /** @deprecated Report generation now covers every session. */
  maxSessionsPerDigest?: number;
  /** Maximum estimated LLM calls before manual approval is required. Default 100. */
  maxDigestLlmCalls?: number;
  /** Max chars of transcript excerpt per session. Default 2500. */
  snippetMaxChars?: number;
  /** Local hour 0–23 for automatic daily job. Default 22. */
  scheduleDailyHour?: number;
  /** Local hour for weekly job (previous ISO week) on Monday. Default 9. */
  scheduleWeeklyHour?: number;
  /** Local hour on day 1 for previous-month job. Default 9. */
  scheduleMonthlyHour?: number;
}

/**
 * Desktop-only: auto-generate / refresh session_summary after sync.
 * Delays are relative to each session's last updated_at_ms (quiet period).
 */
export interface SessionSummaryAutoSettings {
  /** Master switch. Default true (still no-ops without tool LLM). */
  enabled?: boolean;
  /** Minutes after last update before re-summarizing a session that already has a summary. Default 30. */
  staleDelayMinutes?: number;
  /** Minutes after last update before first summary when missing. Default 0. */
  missingDelayMinutes?: number;
  /** Parallel LLM calls per tick. Default 1. */
  concurrency?: number;
  /** Max sessions to summarize per scan. Default 5. */
  maxPerTick?: number;
}

/**
 * Desktop-only: background transcript-chunk embeddings (independent of session_summary).
 * Quiet delay is relative to each session's updated_at_ms.
 */
export interface SessionTranscriptIndexSettings {
  /** Master switch. Default true (no-ops without embedding config). */
  enabled?: boolean;
  /** Minutes after last session update before (re)indexing transcript. Default 15. */
  quietDelayMinutes?: number;
  /** Parallel sessions per tick. Default 1. */
  concurrency?: number;
  /** Max sessions to index per scan. Default 3. */
  maxPerTick?: number;
}

/**
 * Desktop-only: background session_embeddings for rows that already have session_summary.
 * Does not generate summaries — only embeds title+summary text.
 */
export interface SessionEmbeddingIndexSettings {
  /** Master switch. Default true (no-ops without embedding config). */
  enabled?: boolean;
  /**
   * Minutes after session_summary_at_ms (fallback updated_at) before (re)embedding.
   * Default 0 so existing summaries backfill immediately.
   */
  quietDelayMinutes?: number;
  /** Parallel embed jobs per tick. Default 2. */
  concurrency?: number;
  /** Max sessions to embed per scan. Default 5. */
  maxPerTick?: number;
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
  /** Auto session_summary generation (Desktop main process). */
  sessionSummaryAuto?: SessionSummaryAutoSettings;
  /** Auto session_embeddings for sessions that already have summaries. */
  sessionEmbeddingIndex?: SessionEmbeddingIndexSettings;
  /** Auto transcript-chunk index (Desktop main; independent of summaries). */
  sessionTranscriptIndex?: SessionTranscriptIndexSettings;
  agentHomes?: AgentHomesSettings;
  sessionSync?: AgentSessionSyncSettings;
  desktop?: DesktopSettings;
  notes?: NotesSettings;
  workbench?: WorkbenchSettings;
  /** ACP Chat launch + permission preferences (Desktop Workbench visual chat). */
  acp?: AcpSettings;
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
    maxDigestLlmCalls: 100,
    snippetMaxChars: 2500,
    scheduleDailyHour: 22,
    scheduleWeeklyHour: 9,
    scheduleMonthlyHour: 9
  },
  sessionSummaryAuto: {
    enabled: true,
    staleDelayMinutes: 30,
    missingDelayMinutes: 0,
    concurrency: 1,
    maxPerTick: 5
  },
  sessionEmbeddingIndex: {
    enabled: true,
    quietDelayMinutes: 0,
    concurrency: 2,
    maxPerTick: 5
  },
  sessionTranscriptIndex: {
    enabled: true,
    quietDelayMinutes: 15,
    concurrency: 1,
    maxPerTick: 3
  },
  sessionSync: {
    maxItems: 10_000,
    stalePolicy: "off",
    showArchivedCodex: false,
    showArchivedOpenCode: false,
    showSubagentCodex: false,
    showSubagentGrok: false,
    showArchivedCursorIde: false,
    showSubagentCursorIde: false
  },
  workbench: {
    projectEditor: "auto",
    newSessionYolo: false,
    terminalTheme: "follow-app",
    editorTheme: "follow-app",
    terminalRenderer: "webgl",
    gitCommitMessageStyle: "conventional",
    gitCommitCustomInstructions: DEFAULT_CONVENTIONAL_COMMIT_INSTRUCTIONS,
    projectContextMenu: [...DEFAULT_WORKBENCH_PROJECT_CONTEXT_MENU],
    editor: {
      editable: true,
      fontSize: 13,
      wordWrap: false,
      tabSize: 4,
      autoSaveDelayMs: 600
    }
  },
  desktop: {
    theme: "system",
    visualTheme: "classic",
    themeEffects: "full",
    alwaysAllowAgentWriteOperations: false,
    alwaysAllowAgentNonDestructiveOperations: false
  },
  notes: {
    newStandaloneNoteShortcut: "CommandOrControl+D"
  }
};
