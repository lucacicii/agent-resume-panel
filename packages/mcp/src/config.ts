import * as fs from "node:fs";
import {
  DEFAULT_AGENT_HOMES,
  catalogDbPath,
  expandHome,
  resolvePanelHome,
  searchIndexDbPath,
  settingsPath
} from "@agent-resume/core";

export interface McpResolvedPaths {
  panelHome: string;
  catalogDbPath: string;
  searchIndexDbPath: string;
  antigravityHome: string;
  opencodeHome: string;
}

interface PanelSettingsSubset {
  panelHome?: unknown;
  catalogDbPath?: unknown;
  antigravityHome?: unknown;
  opencodeHome?: unknown;
}

function readJsonFileSync(filePath: string): PanelSettingsSubset {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as PanelSettingsSubset) : {};
  } catch {
    return {};
  }
}

export function resolveMcpPaths(explicitPanelHome?: string): McpResolvedPaths {
  const defaultHome = resolvePanelHome();
  const rootSettings = readJsonFileSync(settingsPath(defaultHome));
  const settingsPanelHome =
    typeof rootSettings.panelHome === "string" && rootSettings.panelHome.trim()
      ? rootSettings.panelHome.trim()
      : undefined;

  const panelHome = resolvePanelHome(
    explicitPanelHome?.trim() ||
      process.env.AGENT_RESUME_PANEL_HOME?.trim() ||
      settingsPanelHome
  );

  const localSettings =
    panelHome === defaultHome ? rootSettings : readJsonFileSync(settingsPath(panelHome));

  const customCatalogDb =
    typeof localSettings.catalogDbPath === "string" && localSettings.catalogDbPath.trim()
      ? expandHome(localSettings.catalogDbPath.trim())
      : undefined;

  const customAgyHome =
    typeof localSettings.antigravityHome === "string" && localSettings.antigravityHome.trim()
      ? expandHome(localSettings.antigravityHome.trim())
      : undefined;

  const customOpenCodeHome =
    typeof localSettings.opencodeHome === "string" && localSettings.opencodeHome.trim()
      ? expandHome(localSettings.opencodeHome.trim())
      : undefined;

  return {
    panelHome,
    catalogDbPath: customCatalogDb || catalogDbPath(panelHome),
    searchIndexDbPath: searchIndexDbPath(panelHome),
    antigravityHome: customAgyHome || expandHome(DEFAULT_AGENT_HOMES.antigravityHome),
    opencodeHome: customOpenCodeHome || expandHome(DEFAULT_AGENT_HOMES.opencodeHome)
  };
}
