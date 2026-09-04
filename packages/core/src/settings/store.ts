import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  DEFAULT_PANEL_HOME,
  desktopSettingsPath,
  resolvePanelHome,
  settingsPath
} from "../panelHome";
import { sanitizeAgentHomes } from "../transcript/homes";
import { migrateLegacyModelSettings, normalizeProviderPool } from "../providers/migrate";
import {
  ALL_WORKBENCH_PROJECT_CONTEXT_MENU,
  DEFAULT_DESKTOP_BROWSER_SETTINGS,
  DEFAULT_SETTINGS,
  DEFAULT_WORKBENCH_PROJECT_CONTEXT_MENU,
  DESKTOP_VISUAL_THEME_IDS,
  PanelSettings,
  WORKBENCH_TERMINAL_THEME_IDS,
  WORKBENCH_TERMINAL_RENDERERS,
  WORKBENCH_TERMINAL_ENGINES,
  WorkbenchProjectContextMenuAction,
  type DesktopTheme,
  type DesktopThemeEffects,
  type DesktopVisualThemeId,
  type WorkbenchComposerSlashPhrase,
  type WorkbenchTerminalEngine,
  type WorkbenchTerminalRenderer,
  type WorkbenchTerminalThemeId
} from "./types";
import {
  normalizeCommitMessageStyle,
  normalizeCustomCommitInstructions
} from "../git/prompts";

type LegacyPanelSettings = Partial<PanelSettings> & { memory?: PanelSettings["report"] };
const WORKBENCH_EDITOR_TAB_SIZES = new Set([2, 4, 8]);
const WORKBENCH_EDITOR_SAVE_DELAYS = new Set([300, 600, 1000, 2000]);
const PROJECT_MENU_ACTIONS = new Set<string>(ALL_WORKBENCH_PROJECT_CONTEXT_MENU);
const TERMINAL_THEME_IDS = new Set<string>(WORKBENCH_TERMINAL_THEME_IDS);
const TERMINAL_RENDERERS = new Set<string>(WORKBENCH_TERMINAL_RENDERERS);
const TERMINAL_ENGINES = new Set<string>(WORKBENCH_TERMINAL_ENGINES);
const VISUAL_THEME_IDS = new Set<string>(DESKTOP_VISUAL_THEME_IDS);

export function normalizeDesktopVisualTheme(value: string | undefined | null): DesktopVisualThemeId {
  return value && VISUAL_THEME_IDS.has(value)
    ? value as DesktopVisualThemeId
    : "classic";
}

export function normalizeDesktopThemeEffects(value: string | undefined | null): DesktopThemeEffects {
  return value === "reduced" ? "reduced" : "full";
}

export function normalizeDesktopTheme(value: string | undefined | null, visualTheme: DesktopVisualThemeId): DesktopTheme {
  if (visualTheme === "cyberpunk" || visualTheme === "dos") return "dark";
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function normalizeWorkbenchEditorTheme(value: string | undefined | null): "follow-app" | "light" | "dark" {
  return value === "light" || value === "dark" ? value : "follow-app";
}

export function normalizeWorkbenchTerminalTheme(
  value: string | undefined | null
): WorkbenchTerminalThemeId {
  if (value === "default-dark") return "follow-app";
  if (value && TERMINAL_THEME_IDS.has(value)) {
    return value as WorkbenchTerminalThemeId;
  }
  return DEFAULT_SETTINGS.workbench?.terminalTheme ?? "follow-app";
}

export function normalizeWorkbenchTerminalRenderer(
  value: string | undefined | null
): WorkbenchTerminalRenderer {
  if (value && TERMINAL_RENDERERS.has(value)) {
    return value as WorkbenchTerminalRenderer;
  }
  return DEFAULT_SETTINGS.workbench?.terminalRenderer ?? "webgl";
}

export function normalizeWorkbenchTerminalEngine(
  value: string | undefined | null
): WorkbenchTerminalEngine {
  if (value && TERMINAL_ENGINES.has(value)) {
    return value as WorkbenchTerminalEngine;
  }
  return DEFAULT_SETTINGS.workbench?.terminalEngine ?? "xterm";
}

export function normalizeWorkbenchProjectContextMenu(
  value: WorkbenchProjectContextMenuAction[] | undefined | null
): WorkbenchProjectContextMenuAction[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_WORKBENCH_PROJECT_CONTEXT_MENU];
  }
  const seen = new Set<WorkbenchProjectContextMenuAction>();
  const output: WorkbenchProjectContextMenuAction[] = [];
  for (const entry of value) {
    if (!PROJECT_MENU_ACTIONS.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    output.push(entry);
  }
  // Empty explicit array is allowed (hide all); only fall back when unset/invalid.
  return output;
}

const COMPOSER_SLASH_TRIGGER = /^[A-Za-z0-9_-]{1,40}$/;
const COMPOSER_SLASH_PHRASE_MAX = 4000;
const COMPOSER_SLASH_DESCRIPTION_MAX = 200;
const COMPOSER_SLASH_PHRASES_MAX = 100;

export function normalizeWorkbenchComposerSlashPhrases(
  value: WorkbenchComposerSlashPhrase[] | undefined | null
): WorkbenchComposerSlashPhrase[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: WorkbenchComposerSlashPhrase[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const trigger = String(entry.trigger ?? "").trim().replace(/^\/+/, "");
    const phrase = String(entry.phrase ?? "");
    if (!COMPOSER_SLASH_TRIGGER.test(trigger) || !phrase.trim()) continue;
    const key = trigger.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const description = String(entry.description ?? "").trim();
    const item: WorkbenchComposerSlashPhrase = {
      trigger,
      phrase: phrase.slice(0, COMPOSER_SLASH_PHRASE_MAX)
    };
    if (description) item.description = description.slice(0, COMPOSER_SLASH_DESCRIPTION_MAX);
    output.push(item);
    if (output.length >= COMPOSER_SLASH_PHRASES_MAX) break;
  }
  return output;
}

function normalizeWorkbenchTranscriptFontSize(value: number | undefined): number {
  const fallback = DEFAULT_SETTINGS.workbench?.transcriptFontSize ?? 14;
  const fontSize = Math.round(Number(value ?? fallback));
  return Math.min(24, Math.max(11, Number.isFinite(fontSize) ? fontSize : fallback));
}

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
  if (partial.desktop && "autoSessionExecutionNotes" in partial.desktop) {
    const { autoSessionExecutionNotes: _removed, ...desktop } = partial.desktop as typeof partial.desktop & { autoSessionExecutionNotes?: boolean };
    partial = { ...partial, desktop };
  }
  if (
    partial.desktop?.alwaysAllowAgentNonDestructiveOperations === undefined &&
    partial.desktop?.alwaysAllowAgentWriteOperations !== undefined
  ) {
    partial = {
      ...partial,
      desktop: {
        ...partial.desktop,
        alwaysAllowAgentNonDestructiveOperations: partial.desktop.alwaysAllowAgentWriteOperations
      }
    };
  }
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
  }  const chatLlm =
    partial.chatLlm || base.chatLlm
      ? {
          ...(base.chatLlm || {}),
          ...(partial.chatLlm || {})
        }
      : undefined;

  return normalizeProviderPool({
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
    providers: partial.providers,
    modelSelections: partial.modelSelections,
    llmOptions: partial.llmOptions,
    report: {
      ...base.report,
      ...(partial.report || {})
    },
    // Desktop session auto jobs (summary / embeddings / transcript index / tagging).
    // Must be merged or Settings → Sessions saves report success but never persist.
    sessionSummaryAuto: {
      ...base.sessionSummaryAuto,
      ...(partial.sessionSummaryAuto || {})
    },
    sessionEmbeddingIndex: {
      ...base.sessionEmbeddingIndex,
      ...(partial.sessionEmbeddingIndex || {})
    },
    sessionTranscriptIndex: {
      ...base.sessionTranscriptIndex,
      ...(partial.sessionTranscriptIndex || {})
    },
    autoTagging: {
      ...base.autoTagging,
      ...(partial.autoTagging || {})
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
      ...(partial.desktop || {}),
      visualTheme: normalizeDesktopVisualTheme(partial.desktop?.visualTheme ?? base.desktop?.visualTheme),
      themeEffects: normalizeDesktopThemeEffects(partial.desktop?.themeEffects ?? base.desktop?.themeEffects),
      theme: normalizeDesktopTheme(
        partial.desktop?.theme ?? base.desktop?.theme,
        normalizeDesktopVisualTheme(partial.desktop?.visualTheme ?? base.desktop?.visualTheme)
      ),
      browser: {
        ...DEFAULT_DESKTOP_BROWSER_SETTINGS,
        ...base.desktop?.browser,
        ...(partial.desktop?.browser || {}),
        defaultPolicy: {
          ...DEFAULT_DESKTOP_BROWSER_SETTINGS.defaultPolicy,
          ...base.desktop?.browser?.defaultPolicy,
          ...(partial.desktop?.browser?.defaultPolicy || {}),
          allowHosts: [
            ...(partial.desktop?.browser?.defaultPolicy?.allowHosts
              ?? base.desktop?.browser?.defaultPolicy?.allowHosts
              ?? DEFAULT_DESKTOP_BROWSER_SETTINGS.defaultPolicy.allowHosts)
          ],
          blockHosts: [
            ...(partial.desktop?.browser?.defaultPolicy?.blockHosts
              ?? base.desktop?.browser?.defaultPolicy?.blockHosts
              ?? DEFAULT_DESKTOP_BROWSER_SETTINGS.defaultPolicy.blockHosts)
          ]
        },
        chromeCookieImport: {
          ...DEFAULT_DESKTOP_BROWSER_SETTINGS.chromeCookieImport,
          ...base.desktop?.browser?.chromeCookieImport,
          ...(partial.desktop?.browser?.chromeCookieImport || {})
        }
      }
    },
    notes: {
      ...base.notes,
      ...(partial.notes || {})
    },
    workbench: {
      ...base.workbench,
      ...(partial.workbench || {}),
      terminalTheme: normalizeWorkbenchTerminalTheme(
        partial.workbench?.terminalTheme ?? base.workbench?.terminalTheme
      ),
      terminalEngine: normalizeWorkbenchTerminalEngine(
        partial.workbench?.terminalEngine ?? base.workbench?.terminalEngine
      ),
      terminalRenderer: normalizeWorkbenchTerminalRenderer(
        partial.workbench?.terminalRenderer ?? base.workbench?.terminalRenderer
      ),
      editorTheme: normalizeWorkbenchEditorTheme(
        partial.workbench?.editorTheme ?? base.workbench?.editorTheme
      ),
      gitCommitMessageStyle: normalizeCommitMessageStyle(partial.workbench?.gitCommitMessageStyle),
      gitCommitCustomInstructions: normalizeCustomCommitInstructions(
        partial.workbench?.gitCommitCustomInstructions
      ),
      projectContextMenu: normalizeWorkbenchProjectContextMenu(
        partial.workbench?.projectContextMenu ?? base.workbench?.projectContextMenu
      ),
      composerSlashPhrases: normalizeWorkbenchComposerSlashPhrases(
        partial.workbench?.composerSlashPhrases ?? base.workbench?.composerSlashPhrases
      ),
      transcriptFontSize: normalizeWorkbenchTranscriptFontSize(
        partial.workbench?.transcriptFontSize ?? base.workbench?.transcriptFontSize
      ),
      editor: normalizeWorkbenchEditorSettings(partial.workbench?.editor)
    },
    // Desktop ACP (permissions, launch overrides, experimental vendor UI).
    // Must merge or Workbench ACP toggles never persist across save/reload.
    acp: mergeAcpSettings(base.acp, partial.acp),
    im: {
      smartRoutingEnabled: partial.im?.smartRoutingEnabled ?? base.im?.smartRoutingEnabled ?? true
    },
    ghosttyExecutable: partial.ghosttyExecutable?.trim() || base.ghosttyExecutable,
    ghosttyLaunchMode: partial.ghosttyLaunchMode || base.ghosttyLaunchMode,
    ghosttyAutoPasteDelayMs: partial.ghosttyAutoPasteDelayMs ?? base.ghosttyAutoPasteDelayMs
  });
}

function mergeAcpSettings(
  base: PanelSettings["acp"] | undefined,
  partial: PanelSettings["acp"] | undefined
): PanelSettings["acp"] | undefined {
  if (!base && !partial) return undefined;
  const agents = {
    ...(base?.agents || {}),
    ...(partial?.agents || {})
  };
  const merged = {
    ...(base || {}),
    ...(partial || {}),
    ...(Object.keys(agents).length ? { agents } : {})
  };
  // Drop empty agents object noise.
  if (merged.agents && !Object.keys(merged.agents).length) {
    delete merged.agents;
  }
  return Object.keys(merged).length ? merged : undefined;
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

  const merged = migrateLegacyModelSettings(mergeSettings(legacy));
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
    const merged = migrateLegacyModelSettings(mergeSettings(parsed));
    const effectiveHome = resolvePanelHome(merged.panelHome?.trim() || home);
    if (!panelHomeHint && effectiveHome !== home) {
      return loadSettings(effectiveHome);
    }
    return merged;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return migrateLegacyModelSettings(mergeSettings(null));
    }
    throw error;
  }
}

export async function saveSettings(settings: PanelSettings, panelHomeHint?: string): Promise<string> {
  const merged = migrateLegacyModelSettings(mergeSettings(settings));
  const home = resolvePanelHome(
    panelHomeHint?.trim() || merged.panelHome?.trim() || DEFAULT_PANEL_HOME
  );
  await fs.mkdir(home, { recursive: true });
  const file = desktopSettingsPath(home);
  // Provider pool is the source of truth; legacy llm/chatLlm/embedding no longer persist.
  const { llm: _llm, chatLlm: _chatLlm, embedding: _embedding, ...toWrite } = merged;
  const payload = {
    ...toWrite,
    panelHome: merged.panelHome || DEFAULT_PANEL_HOME,
    agentHomes: sanitizeAgentHomes(merged.agentHomes)
  };
  await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

export function catalogDbFromSettings(settings: PanelSettings, panelHomeHint?: string): string {
  const home = effectivePanelHome(settings, panelHomeHint);
  return path.join(home, "catalog.db");
}
