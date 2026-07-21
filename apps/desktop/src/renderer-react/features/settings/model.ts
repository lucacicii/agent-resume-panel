import type { PanelSettings, WorkbenchProjectContextMenuAction } from "@agent-resume/core";

/** Keep in sync with packages/core WorkbenchProjectContextMenuAction. */
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

export const DEFAULT_WORKBENCH_PROJECT_CONTEXT_MENU: WorkbenchProjectContextMenuAction[] = [
  "newSession",
  "note",
  "reveal",
  "remove"
];

const PROJECT_MENU_SET = new Set<string>(ALL_WORKBENCH_PROJECT_CONTEXT_MENU);

export function normalizeProjectContextMenu(
  value: WorkbenchProjectContextMenuAction[] | undefined | null
): WorkbenchProjectContextMenuAction[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_WORKBENCH_PROJECT_CONTEXT_MENU];
  }
  const seen = new Set<WorkbenchProjectContextMenuAction>();
  const output: WorkbenchProjectContextMenuAction[] = [];
  for (const entry of value) {
    if (!PROJECT_MENU_SET.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    output.push(entry);
  }
  return output;
}

export type UiLanguageValue = "auto" | "en" | "zh-cn" | "ja";

export interface GeneralDraft {
  uiLanguage: UiLanguageValue;
  desktopTheme: "system" | "light" | "dark";
}

export interface ModelsDraft {
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  llmLang: UiLanguageValue;
  chatBaseUrl: string;
  chatModel: string;
  chatApiKey: string;
  embBaseUrl: string;
  embModel: string;
  embApiKey: string;
}

export interface SessionsDraft {
  maxItems: number;
  stalePolicy: "off" | "purge";
  showArchivedCodex: boolean;
  showSubagentCodex: boolean;
  showArchivedOpenCode: boolean;
  showSubagentGrok: boolean;
  /** Auto-generate session_summary after sync / quiet period. */
  summaryAutoEnabled: boolean;
  /** Minutes after last session update before re-summarizing (stale). Default 30. */
  summaryStaleDelayMinutes: number;
  /** Minutes after last update before first summary when missing. Default 0. */
  summaryMissingDelayMinutes: number;
  summaryAutoConcurrency: number;
  summaryAutoMaxPerTick: number;
}

export interface WorkbenchDraft {
  scratchDir: string;
  defaultProvider: "codex" | "claude" | "grok" | "agy" | "opencode" | "pi";
  projectEditor: "auto" | "vscode" | "vscodium" | "cursor" | "windsurf";
  terminalMode: "xterm" | "external-system";
  externalLaunchMode: "executeCommand" | "pasteCommand" | "copyCommand";
  cmdTAction: "newTerminal" | "newSession";
  editorEditable: boolean;
  editorFontSize: number;
  editorWordWrap: boolean;
  editorTabSize: 2 | 4 | 8;
  editorAutoSaveDelayMs: 300 | 600 | 1000 | 2000;
  gitCommitMessageStyle: "conventional" | "gitmoji" | "custom";
  gitCommitCustomInstructions: string;
  gitNestedScanMaxDepth: number;
  gitNestedScanIgnoreDirs: string;
  /** Enabled Workbench project context-menu actions. */
  projectContextMenu: WorkbenchProjectContextMenuAction[];
}

export interface ReportDraft {
  enabled: boolean;
  dailyHour: number;
  weeklyHour: number;
  monthlyHour: number;
}

export interface StorageDraft {
  panelHome: string;
  codexHome: string;
  claudeHome: string;
  antigravityHome: string;
  grokHome: string;
  opencodeHome: string;
  piHome: string;
}

const UI_LANGUAGES = new Set<UiLanguageValue>(["auto", "en", "zh-cn", "ja"]);

export function normalizeOutputLanguage(value: string | undefined): UiLanguageValue {
  const normalized = String(value ?? "").trim();
  if (UI_LANGUAGES.has(normalized as UiLanguageValue)) return normalized as UiLanguageValue;
  if (["English"].includes(normalized)) return "en";
  if (["Chinese", "zh-CN", "zh_CN", "zh"].includes(normalized)) return "zh-cn";
  if (["Japanese"].includes(normalized)) return "ja";
  return "auto";
}

export function generalDraftFromSettings(settings: PanelSettings): GeneralDraft {
  return {
    uiLanguage: normalizeOutputLanguage(settings.uiLanguage),
    desktopTheme: settings.desktop?.theme || "system"
  };
}

export function modelsDraftFromSettings(settings: PanelSettings): ModelsDraft {
  const toolBase = settings.llm?.baseUrl || "";
  const toolModel = settings.llm?.model || "";
  const toolKey = settings.llm?.apiKey || "";
  return {
    llmBaseUrl: toolBase,
    llmModel: toolModel,
    llmApiKey: toolKey,
    llmLang: normalizeOutputLanguage(settings.llm?.outputLanguage),
    chatBaseUrl: settings.chatLlm?.baseUrl?.trim() || toolBase,
    chatModel: settings.chatLlm?.model?.trim() || toolModel,
    chatApiKey: settings.chatLlm?.apiKey?.trim() || toolKey,
    embBaseUrl: settings.embedding?.baseUrl || "",
    embModel: settings.embedding?.model || "text-embedding-3-small",
    embApiKey: settings.embedding?.apiKey || ""
  };
}

function clampDraftInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function sessionsDraftFromSettings(settings: PanelSettings): SessionsDraft {
  const source = settings.sessionSync;
  const auto = settings.sessionSummaryAuto;
  return {
    maxItems: Math.max(1, Math.min(50_000, Number(source?.maxItems) || 10_000)),
    stalePolicy: source?.stalePolicy === "purge" ? "purge" : "off",
    showArchivedCodex: Boolean(source?.showArchivedCodex),
    showSubagentCodex: Boolean(source?.showSubagentCodex),
    showArchivedOpenCode: Boolean(source?.showArchivedOpenCode),
    showSubagentGrok: Boolean(source?.showSubagentGrok),
    summaryAutoEnabled: auto?.enabled !== false,
    summaryStaleDelayMinutes: clampDraftInt(auto?.staleDelayMinutes, 30, 0, 1440),
    summaryMissingDelayMinutes: clampDraftInt(auto?.missingDelayMinutes, 0, 0, 1440),
    summaryAutoConcurrency: clampDraftInt(auto?.concurrency, 1, 1, 3),
    summaryAutoMaxPerTick: clampDraftInt(auto?.maxPerTick, 5, 1, 50)
  };
}

export function generalPatch(settings: PanelSettings, draft: GeneralDraft): Partial<PanelSettings> {
  return { uiLanguage: draft.uiLanguage, desktop: { ...settings.desktop, theme: draft.desktopTheme } };
}

export function modelsPatch(settings: PanelSettings, draft: ModelsDraft): Partial<PanelSettings> {
  return {
    llm: {
      ...settings.llm,
      baseUrl: draft.llmBaseUrl.trim(),
      model: draft.llmModel.trim(),
      apiKey: draft.llmApiKey,
      outputLanguage: draft.llmLang
    },
    chatLlm: {
      ...settings.chatLlm,
      baseUrl: draft.chatBaseUrl.trim() || undefined,
      model: draft.chatModel.trim() || undefined,
      apiKey: draft.chatApiKey || undefined
    },
    embedding: {
      ...settings.embedding,
      baseUrl: draft.embBaseUrl.trim() || undefined,
      model: draft.embModel.trim() || "text-embedding-3-small",
      apiKey: draft.embApiKey || undefined
    }
  };
}

export function sessionsPatch(settings: PanelSettings, draft: SessionsDraft): Partial<PanelSettings> {
  return {
    sessionSummaryAuto: {
      ...settings.sessionSummaryAuto,
      enabled: draft.summaryAutoEnabled,
      staleDelayMinutes: clampDraftInt(draft.summaryStaleDelayMinutes, 30, 0, 1440),
      missingDelayMinutes: clampDraftInt(draft.summaryMissingDelayMinutes, 0, 0, 1440),
      concurrency: clampDraftInt(draft.summaryAutoConcurrency, 1, 1, 3),
      maxPerTick: clampDraftInt(draft.summaryAutoMaxPerTick, 5, 1, 50)
    },
    sessionSync: {
      ...settings.sessionSync,
      maxItems: Math.max(1, Math.min(50_000, Number(draft.maxItems) || 10_000)),
      stalePolicy: draft.stalePolicy,
      showArchivedCodex: draft.showArchivedCodex,
      showSubagentCodex: draft.showSubagentCodex,
      showArchivedOpenCode: draft.showArchivedOpenCode,
      showSubagentGrok: draft.showSubagentGrok
    }
  };
}

function numberInRange(value: number | undefined, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number(value) || fallback)));
}

export function workbenchDraftFromSettings(settings: PanelSettings): WorkbenchDraft {
  const workbench = settings.workbench;
  const editor = workbench?.editor;
  const provider = workbench?.defaultNewSessionProvider;
  return {
    scratchDir: workbench?.scratchDir || "",
    defaultProvider: provider === "claude" || provider === "grok" || provider === "agy" || provider === "opencode" || provider === "pi" ? provider : "codex",
    projectEditor: workbench?.projectEditor === "vscode" || workbench?.projectEditor === "vscodium" || workbench?.projectEditor === "cursor" || workbench?.projectEditor === "windsurf" ? workbench.projectEditor : "auto",
    terminalMode: workbench?.terminalMode === "external-system" || workbench?.terminalMode === "external-ghostty" ? "external-system" : "xterm",
    externalLaunchMode: workbench?.externalLaunchMode === "pasteCommand" || workbench?.externalLaunchMode === "copyCommand" ? workbench.externalLaunchMode : "executeCommand",
    cmdTAction: workbench?.cmdTAction === "newSession" ? "newSession" : "newTerminal",
    editorEditable: editor?.editable !== false,
    editorFontSize: numberInRange(editor?.fontSize, 13, 11, 24),
    editorWordWrap: editor?.wordWrap === true,
    editorTabSize: editor?.tabSize === 2 || editor?.tabSize === 8 ? editor.tabSize : 4,
    editorAutoSaveDelayMs: editor?.autoSaveDelayMs === 300 || editor?.autoSaveDelayMs === 1000 || editor?.autoSaveDelayMs === 2000 ? editor.autoSaveDelayMs : 600,
    gitCommitMessageStyle: workbench?.gitCommitMessageStyle === "gitmoji" || workbench?.gitCommitMessageStyle === "custom" ? workbench.gitCommitMessageStyle : "conventional",
    gitCommitCustomInstructions: workbench?.gitCommitCustomInstructions || "",
    gitNestedScanMaxDepth: numberInRange(workbench?.gitNestedScanMaxDepth, 6, 1, 10),
    gitNestedScanIgnoreDirs: Array.isArray(workbench?.gitNestedScanIgnoreDirs) ? workbench.gitNestedScanIgnoreDirs.join("\n") : "",
    projectContextMenu: normalizeProjectContextMenu(
      workbench?.projectContextMenu ?? DEFAULT_WORKBENCH_PROJECT_CONTEXT_MENU
    )
  };
}

export function workbenchPatch(settings: PanelSettings, draft: WorkbenchDraft): Partial<PanelSettings> {
  return {
    workbench: {
      ...settings.workbench,
      scratchDir: draft.scratchDir.trim() || undefined,
      defaultNewSessionProvider: draft.defaultProvider,
      projectEditor: draft.projectEditor,
      terminalMode: draft.terminalMode,
      externalLaunchMode: draft.externalLaunchMode,
      cmdTAction: draft.cmdTAction,
      editor: {
        editable: draft.editorEditable,
        fontSize: numberInRange(draft.editorFontSize, 13, 11, 24),
        wordWrap: draft.editorWordWrap,
        tabSize: draft.editorTabSize,
        autoSaveDelayMs: draft.editorAutoSaveDelayMs
      },
      gitCommitMessageStyle: draft.gitCommitMessageStyle,
      gitCommitCustomInstructions: draft.gitCommitCustomInstructions,
      gitNestedScanMaxDepth: numberInRange(draft.gitNestedScanMaxDepth, 6, 1, 10),
      gitNestedScanIgnoreDirs: draft.gitNestedScanIgnoreDirs.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean),
      projectContextMenu: normalizeProjectContextMenu(draft.projectContextMenu)
    }
  };
}

export function reportDraftFromSettings(settings: PanelSettings): ReportDraft {
  const report = settings.report;
  return {
    enabled: report?.enabled === true,
    dailyHour: numberInRange(report?.scheduleDailyHour, 22, 0, 23),
    weeklyHour: numberInRange(report?.scheduleWeeklyHour, 9, 0, 23),
    monthlyHour: numberInRange(report?.scheduleMonthlyHour, 9, 0, 23)
  };
}

export function reportPatch(settings: PanelSettings, draft: ReportDraft): Partial<PanelSettings> {
  return {
    report: {
      ...settings.report,
      enabled: draft.enabled,
      includeTranscripts: true,
      maxSessionsPerDigest: 40,
      snippetMaxChars: 2500,
      scheduleDailyHour: numberInRange(draft.dailyHour, 22, 0, 23),
      scheduleWeeklyHour: numberInRange(draft.weeklyHour, 9, 0, 23),
      scheduleMonthlyHour: numberInRange(draft.monthlyHour, 9, 0, 23)
    }
  };
}

const AGENT_HOME_DEFAULTS = {
  codexHome: "~/.codex",
  claudeHome: "~/.claude",
  antigravityHome: "~/.gemini",
  grokHome: "~/.grok",
  opencodeHome: "~/.local/share/opencode",
  piHome: "~/.pi/agent"
} as const;

export function storageDraftFromSettings(settings: PanelSettings): StorageDraft {
  return {
    panelHome: settings.panelHome || "",
    ...Object.fromEntries(Object.entries(AGENT_HOME_DEFAULTS).map(([key, fallback]) => [key, settings.agentHomes?.[key as keyof typeof AGENT_HOME_DEFAULTS] || fallback])) as Omit<StorageDraft, "panelHome">
  };
}

export function storagePatch(settings: PanelSettings, draft: StorageDraft): Partial<PanelSettings> {
  const agentHomes = Object.fromEntries(Object.entries(AGENT_HOME_DEFAULTS).flatMap(([key, fallback]) => {
    const value = draft[key as keyof typeof AGENT_HOME_DEFAULTS].trim();
    return value && value !== fallback ? [[key, value]] : [];
  }));
  return {
    panelHome: draft.panelHome.trim() || undefined,
    agentHomes: Object.keys(agentHomes).length ? agentHomes : undefined
  };
}
