import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_PANEL_HOME, resolvePanelHome, settingsPath } from "../panelHome";
import { DEFAULT_SETTINGS, PanelSettings } from "./types";

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
    llm: {
      ...base.llm,
      ...(partial.llm || {})
    },
    chatLlm,
    embedding: {
      ...base.embedding,
      ...(partial.embedding || {})
    },
    memory: {
      ...base.memory,
      ...(partial.memory || {})
    },
    agentHomes: {
      ...base.agentHomes,
      ...(partial.agentHomes || {})
    },
    desktop: {
      ...base.desktop,
      ...(partial.desktop || {})
    }
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

export async function loadSettings(panelHomeHint?: string): Promise<PanelSettings> {
  const home = resolvePanelHome(panelHomeHint || DEFAULT_PANEL_HOME);
  const file = settingsPath(home);

  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<PanelSettings>;
    return mergeSettings(parsed);
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
  const file = settingsPath(home);
  const toWrite: PanelSettings = {
    ...merged,
    panelHome: merged.panelHome || DEFAULT_PANEL_HOME
  };
  await fs.writeFile(file, `${JSON.stringify(toWrite, null, 2)}\n`, "utf8");
  return file;
}

export function catalogDbFromSettings(settings: PanelSettings, panelHomeHint?: string): string {
  const home = effectivePanelHome(settings, panelHomeHint);
  return path.join(home, "catalog.db");
}
