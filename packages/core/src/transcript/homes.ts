import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_PANEL_HOME, resolvePanelHome } from "../panelHome";
import { expandHome } from "../pathUtils";
import { PanelSettings } from "../settings/types";
import { PreviewHomes } from "./types";

export function defaultAlmaDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "alma");
  }
  return path.join(os.homedir(), ".config", "alma");
}

export const DEFAULT_AGENT_HOMES = {
  codexHome: "~/.codex",
  claudeHome: "~/.claude",
  antigravityHome: "~/.gemini",
  grokHome: "~/.grok",
  almaDataDir: defaultAlmaDataDir(),
  opencodeHome: "~/.local/share/opencode",
  piHome: "~/.pi/agent"
} as const;

export function resolvePreviewHomes(settings: PanelSettings, panelHomeHint?: string): PreviewHomes {
  const homes = settings.agentHomes || {};
  const panelHome = resolvePanelHome(panelHomeHint || settings.panelHome || DEFAULT_PANEL_HOME);

  return {
    panelHome,
    codexHome: expandHome(homes.codexHome?.trim() || DEFAULT_AGENT_HOMES.codexHome),
    claudeHome: expandHome(homes.claudeHome?.trim() || DEFAULT_AGENT_HOMES.claudeHome),
    antigravityHome: expandHome(homes.antigravityHome?.trim() || DEFAULT_AGENT_HOMES.antigravityHome),
    grokHome: expandHome(homes.grokHome?.trim() || DEFAULT_AGENT_HOMES.grokHome),
    almaDataDir: expandHome(homes.almaDataDir?.trim() || DEFAULT_AGENT_HOMES.almaDataDir),
    opencodeHome: expandHome(homes.opencodeHome?.trim() || DEFAULT_AGENT_HOMES.opencodeHome),
    piHome: expandHome(homes.piHome?.trim() || DEFAULT_AGENT_HOMES.piHome)
  };
}
