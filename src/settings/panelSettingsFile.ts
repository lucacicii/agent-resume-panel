import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { sanitizeAgentHomes } from "@agent-resume/core";
import { expandHome } from "../history/pathUtils";

/** Mirrors packages/core PanelSettings LLM fields used by Desktop. */
export interface PanelSettingsFile {
  panelHome?: string;
  llm: {
    baseUrl: string;
    model: string;
    apiKey?: string;
    outputLanguage?: string;
    maxContextChars?: number;
  };
  /** Conversation model; omitted fields fall back to llm at runtime. */
  chatLlm?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
  embedding: {
    baseUrl?: string;
    model: string;
    apiKey?: string;
  };
  report?: {
    enabled?: boolean;
    includeTranscripts?: boolean;
    maxSessionsPerDigest?: number;
    snippetMaxChars?: number;
  };
  agentHomes?: {
    codexHome?: string;
    claudeHome?: string;
    antigravityHome?: string;
    grokHome?: string;
    almaDataDir?: string;
    opencodeHome?: string;
    piHome?: string;
  };
  desktop?: Record<string, unknown>;
}

const DEFAULT_PANEL_HOME = "~/.agent-resume-panel";

export function resolveExtensionPanelHome(): string {
  const configured = vscode.workspace.getConfiguration("agentResume").get<string>("panelHome", DEFAULT_PANEL_HOME);
  return expandHome(configured?.trim() || DEFAULT_PANEL_HOME);
}

export function panelSettingsFilePath(panelHome?: string): string {
  return path.join(panelHome ?? resolveExtensionPanelHome(), "settings.json");
}

function defaultFile(): PanelSettingsFile {
  return {
    panelHome: DEFAULT_PANEL_HOME,
    llm: {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      outputLanguage: "auto",
      maxContextChars: 120_000
    },
    embedding: {
      model: "text-embedding-3-small"
    },
    report: {
      enabled: false,
      includeTranscripts: true,
      maxSessionsPerDigest: 40,
      snippetMaxChars: 2500
    }
  };
}

function mergeFile(partial: Partial<PanelSettingsFile> | null | undefined): PanelSettingsFile {
  const base = defaultFile();
  if (!partial || typeof partial !== "object") {
    return base;
  }

  return {
    panelHome: partial.panelHome?.trim() || base.panelHome,
    llm: { ...base.llm, ...(partial.llm || {}) },
    chatLlm:
      partial.chatLlm || base.chatLlm
        ? { ...(base.chatLlm || {}), ...(partial.chatLlm || {}) }
        : undefined,
    embedding: { ...base.embedding, ...(partial.embedding || {}) },
    report: { ...base.report, ...(partial.report || {}) },
    agentHomes: { ...base.agentHomes, ...(partial.agentHomes || {}) },
    desktop: { ...base.desktop, ...(partial.desktop || {}) }
  };
}

type LegacyPanelSettingsFile = Partial<PanelSettingsFile> & {
  memory?: PanelSettingsFile["report"];
};

function migrateLegacyPanelFile(partial: LegacyPanelSettingsFile): Partial<PanelSettingsFile> {
  if (partial.memory && !partial.report) {
    const { memory, ...rest } = partial;
    return { ...rest, report: memory };
  }
  return partial;
}

function parseFile(raw: string): PanelSettingsFile {
  try {
    return mergeFile(migrateLegacyPanelFile(JSON.parse(raw) as LegacyPanelSettingsFile));
  } catch {
    return defaultFile();
  }
}

export function loadPanelSettingsFileSync(panelHome?: string): PanelSettingsFile {
  const file = panelSettingsFilePath(panelHome);
  try {
    const raw = fs.readFileSync(file, "utf8");
    return parseFile(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultFile();
    }
    throw error;
  }
}

export async function loadPanelSettingsFile(panelHome?: string): Promise<PanelSettingsFile> {
  const file = panelSettingsFilePath(panelHome);
  try {
    const raw = await fsPromises.readFile(file, "utf8");
    return parseFile(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultFile();
    }
    throw error;
  }
}

export async function savePanelSettingsFile(
  settings: PanelSettingsFile,
  panelHome?: string
): Promise<string> {
  const home = panelHome ?? resolveExtensionPanelHome();
  await fsPromises.mkdir(home, { recursive: true });
  const file = panelSettingsFilePath(home);
  const merged = mergeFile(settings);
  const toWrite: PanelSettingsFile = {
    ...merged,
    panelHome: merged.panelHome || DEFAULT_PANEL_HOME
  };
  await fsPromises.writeFile(file, `${JSON.stringify(toWrite, null, 2)}\n`, "utf8");
  return file;
}

/** True when VS Code has an explicit user/workspace value for this key. */
export function hasExplicitVsCodeSetting(key: string): boolean {
  const config = vscode.workspace.getConfiguration("agentResume");
  const inspected = config.inspect(key);
  if (!inspected) {
    return false;
  }
  return (
    inspected.globalValue !== undefined ||
    inspected.workspaceValue !== undefined ||
    inspected.workspaceFolderValue !== undefined
  );
}

/**
 * Prefer explicit VS Code setting; otherwise use panel settings.json value; else default.
 */
export function readLlmSettingWithPanelFallback<T>(
  key: string,
  panelValue: T | undefined,
  defaultValue: T
): T {
  if (hasExplicitVsCodeSetting(key)) {
    const config = vscode.workspace.getConfiguration("agentResume");
    const value = config.get<T>(key);
    return value === undefined ? defaultValue : value;
  }

  if (panelValue !== undefined && panelValue !== null && String(panelValue).trim() !== "") {
    return panelValue;
  }

  const config = vscode.workspace.getConfiguration("agentResume");
  const value = config.get<T>(key);
  return value === undefined ? defaultValue : value;
}

export async function upsertPanelLlmFields(input: {
  baseUrl?: string;
  model?: string;
  outputLanguage?: string;
  maxContextChars?: number;
  apiKey?: string | null;
  clearApiKey?: boolean;
}): Promise<string> {
  const home = resolveExtensionPanelHome();
  const current = await loadPanelSettingsFile(home);

  if (input.baseUrl !== undefined) {
    current.llm.baseUrl = input.baseUrl.trim() || current.llm.baseUrl;
  }
  if (input.model !== undefined) {
    current.llm.model = input.model.trim() || current.llm.model;
  }
  if (input.outputLanguage !== undefined) {
    current.llm.outputLanguage = input.outputLanguage.trim() || current.llm.outputLanguage;
  }
  if (input.maxContextChars !== undefined && Number.isFinite(input.maxContextChars)) {
    current.llm.maxContextChars = input.maxContextChars;
  }
  if (input.clearApiKey) {
    delete current.llm.apiKey;
  } else if (input.apiKey !== undefined && input.apiKey !== null) {
    const trimmed = input.apiKey.trim();
    if (trimmed) {
      current.llm.apiKey = trimmed;
    }
  }

  // Keep agent homes aligned with extension defaults when missing
  const config = vscode.workspace.getConfiguration("agentResume");
  current.agentHomes = sanitizeAgentHomes({
    codexHome: config.get<string>("codexHome", "~/.codex"),
    claudeHome: config.get<string>("claudeHome", "~/.claude"),
    antigravityHome: config.get<string>("antigravityHome", "~/.gemini"),
    grokHome: config.get<string>("grokHome", "~/.grok"),
    almaDataDir: config.get<string>("almaDataDir", "~/Library/Application Support/alma"),
    opencodeHome: config.get<string>("opencodeHome", "~/.local/share/opencode"),
    piHome: config.get<string>("piHome", "~/.pi/agent"),
    ...current.agentHomes
  });

  current.panelHome = config.get<string>("panelHome", DEFAULT_PANEL_HOME);

  return savePanelSettingsFile(current, home);
}
