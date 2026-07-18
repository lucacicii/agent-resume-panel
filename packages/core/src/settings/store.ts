import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  DEFAULT_PANEL_HOME,
  desktopSettingsPath,
  resolvePanelHome,
  settingsPath
} from "../panelHome";
import { sanitizeAgentHomes } from "../transcript/homes";
import { DEFAULT_SETTINGS, PanelSettings } from "./types";
import {
  normalizeCommitMessageStyle,
  normalizeCustomCommitInstructions
} from "../git/prompts";

type LegacyPanelSettings = Partial<PanelSettings> & { memory?: PanelSettings["report"] };
const WORKBENCH_EDITOR_TAB_SIZES = new Set([2, 4, 8]);
const WORKBENCH_EDITOR_SAVE_DELAYS = new Set([300, 600, 1000, 2000]);

function normalizeWorkbenchEditorSettings(
  settings: NonNullable<PanelSettings["workbench"]>["editor"]
) {
  const defaults = DEFAULT_SETTINGS.workbench?.editor;
  const fontSize = Math.round(Number(settings?.fontSize ?? defaults?.fontSize ?? 13));
  const tabSize = Number(settings?.tabSize ?? defaults?.tabSize ?? 4);
  const autoSaveDelayMs = Number(
    settings?.autoSaveDelayMs ?? defaults?.autoSaveDelayMs ?? 600
  );
  return {
    editable: settings?.editable !== false,
    fontSize: Math.min(24, Math.max(11, Number.isFinite(fontSize) ? fontSize : 13)),
    wordWrap: settings?.wordWrap === true,
    tabSize: WORKBENCH_EDITOR_TAB_SIZES.has(tabSize) ? (tabSize as 2 | 4 | 8) : 4,
    autoSaveDelayMs: WORKBENCH_EDITOR_SAVE_DELAYS.has(autoSaveDelayMs)
      ? (autoSaveDelayMs as 300 | 600 | 1000 | 2000)
      : 600
  };
}

function migrateLegacySettings(partial: LegacyPanelSettings): Partial<PanelSettings> {
  if (partial.memory && !partial.report) {
    const { memory, ...rest } = partial;
    return { ...rest, report: memory };
  }
  return partial;
}

function mergeSettings(partial: Partial<PanelSettings> | null | undefined): PanelSettings {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (!partial || typeof partial !== "object") {
    return base;
  }

  const chatLlm =
    partial.chatLlm || base.chatLlm
      ? {
          ...(base.chatLlm || {}),
          ...(partial.chatLlm || {})
        }
      : undefined;

  return {
    panelHome: partial.panelHome?.trim() || base.panelHome,
    uiLanguage: partial.uiLanguage,
    llm: {
      ...base.llm,
      ...(partial.llm || {})
    },
    chatLlm,
    embedding: {
      ...base.embedding,
      ...(partial.embedding || {})
    },
    report: {
      ...base.report,
      ...(partial.report || {})
    },
    agentHomes: sanitizeAgentHomes({
      ...base.agentHomes,
      ...(partial.agentHomes || {})
    }),
    sessionSync: {
      ...base.sessionSync,
      ...(partial.sessionSync || {})
    },
    desktop: {
      ...base.desktop,
      ...(partial.desktop || {})
    },
    workbench: {
      ...base.workbench,
      ...(partial.workbench || {}),
      gitCommitMessageStyle: normalizeCommitMessageStyle(partial.workbench?.gitCommitMessageStyle),
      gitCommitCustomInstructions: normalizeCustomCommitInstructions(
        partial.workbench?.gitCommitCustomInstructions
      ),
      editor: normalizeWorkbenchEditorSettings(partial.workbench?.editor)
    },
    ghosttyExecutable: partial.ghosttyExecutable?.trim() || base.ghosttyExecutable,
    ghosttyLaunchMode: partial.ghosttyLaunchMode || base.ghosttyLaunchMode,
    ghosttyAutoPasteDelayMs: partial.ghosttyAutoPasteDelayMs ?? base.ghosttyAutoPasteDelayMs
  };
}

/**
 * Resolve effective panel home.
 * If settings live under default home and set panelHome, use that for catalog/db.
 * When loading, prefer path under the given override, else default home.
 */
export function effectivePanelHome(settings: PanelSettings, loadFrom?: string): string {
  if (settings.panelHome?.trim()) {
    return resolvePanelHome(settings.panelHome);
  }
  if (loadFrom) {
    return resolvePanelHome(loadFrom);
  }
  return resolvePanelHome(DEFAULT_PANEL_HOME);
}

async function readSettingsFile(file: string): Promise<Partial<PanelSettings> | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return migrateLegacySettings(JSON.parse(raw) as LegacyPanelSettings);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * One-time import from legacy shared settings.json when settings.desktop.json is missing.
 * Leaves settings.json intact for the VS Code extension LLM bridge.
 */
async function migrateLegacySharedSettings(home: string): Promise<Partial<PanelSettings> | null> {
  const desktopFile = desktopSettingsPath(home);
  try {
    await fs.access(desktopFile);
    return null;
  } catch {
    // continue
  }

  const legacy = await readSettingsFile(settingsPath(home));
  if (!legacy) {
    return null;
  }

  const merged = mergeSettings(legacy);
  await fs.mkdir(home, { recursive: true });
  const toWrite: PanelSettings = {
    ...merged,
    panelHome: merged.panelHome || DEFAULT_PANEL_HOME,
    agentHomes: sanitizeAgentHomes(merged.agentHomes)
  };
  await fs.writeFile(desktopFile, `${JSON.stringify(toWrite, null, 2)}\n`, "utf8");
  return legacy;
}

export async function loadSettings(panelHomeHint?: string): Promise<PanelSettings> {
  const home = resolvePanelHome(panelHomeHint || DEFAULT_PANEL_HOME);
  const file = desktopSettingsPath(home);

  await migrateLegacySharedSettings(home);

  try {
    const parsed = await readSettingsFile(file);
    const merged = mergeSettings(parsed);
    const effectiveHome = resolvePanelHome(merged.panelHome?.trim() || home);
    if (!panelHomeHint && effectiveHome !== home) {
      return loadSettings(effectiveHome);
    }
    return merged;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return mergeSettings(null);
    }
    throw error;
  }
}

export async function saveSettings(settings: PanelSettings, panelHomeHint?: string): Promise<string> {
  const merged = mergeSettings(settings);
  const home = resolvePanelHome(
    panelHomeHint?.trim() || merged.panelHome?.trim() || DEFAULT_PANEL_HOME
  );
  await fs.mkdir(home, { recursive: true });
  const file = desktopSettingsPath(home);
  const toWrite: PanelSettings = {
    ...merged,
    panelHome: merged.panelHome || DEFAULT_PANEL_HOME,
    agentHomes: sanitizeAgentHomes(merged.agentHomes)
  };
  await fs.writeFile(file, `${JSON.stringify(toWrite, null, 2)}\n`, "utf8");
  return file;
}

export function catalogDbFromSettings(settings: PanelSettings, panelHomeHint?: string): string {
  const home = effectivePanelHome(settings, panelHomeHint);
  return path.join(home, "catalog.db");
}
