import { DEFAULT_PANEL_HOME, resolvePanelHome } from "../panelHome";
import { expandHome } from "../pathUtils";
import { PanelSettings } from "../settings/types";
import { PreviewHomes } from "./types";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_AGENT_HOMES = {
  codexHome: "~/.codex",
  claudeHome: "~/.claude",
  antigravityHome: "~/.gemini",
  grokHome: "~/.grok",
  opencodeHome: "~/.local/share/opencode",
  piHome: "~/.pi/agent",
  cursorHome: "~/.cursor"
} as const;

export type AgentHomeKey = keyof typeof DEFAULT_AGENT_HOMES;

export function defaultAgentHomeValue(key: AgentHomeKey): string {
  return DEFAULT_AGENT_HOMES[key];
}

export function agentHomeDiffersFromDefault(key: AgentHomeKey, value?: string): boolean {
  const raw = value?.trim();
  if (!raw) {
    return false;
  }
  return expandHome(raw) !== expandHome(DEFAULT_AGENT_HOMES[key]);
}

export function sanitizeAgentHomes(homes?: PanelSettings["agentHomes"]): PanelSettings["agentHomes"] {
  if (!homes) {
    return undefined;
  }

  const out: NonNullable<PanelSettings["agentHomes"]> = {};
  for (const key of Object.keys(DEFAULT_AGENT_HOMES) as AgentHomeKey[]) {
    const raw = homes[key]?.trim();
    if (raw && agentHomeDiffersFromDefault(key, raw)) {
      out[key] = raw;
    }
  }
  const cursorIdeUserDataHome = homes.cursorIdeUserDataHome?.trim();
  if (cursorIdeUserDataHome) {
    out.cursorIdeUserDataHome = cursorIdeUserDataHome;
  }

  return Object.keys(out).length ? out : undefined;
}

export function defaultCursorIdeUserDataHome(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor", "User");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Cursor", "User");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Cursor", "User");
}

export function resolvePreviewHomes(settings: PanelSettings, panelHomeHint?: string): PreviewHomes {
  const homes = settings.agentHomes || {};
  const panelHome = resolvePanelHome(panelHomeHint || settings.panelHome || DEFAULT_PANEL_HOME);

  return {
    panelHome,
    codexHome: expandHome(homes.codexHome?.trim() || DEFAULT_AGENT_HOMES.codexHome),
    claudeHome: expandHome(homes.claudeHome?.trim() || DEFAULT_AGENT_HOMES.claudeHome),
    antigravityHome: expandHome(homes.antigravityHome?.trim() || DEFAULT_AGENT_HOMES.antigravityHome),
    grokHome: expandHome(homes.grokHome?.trim() || DEFAULT_AGENT_HOMES.grokHome),
    opencodeHome: expandHome(homes.opencodeHome?.trim() || DEFAULT_AGENT_HOMES.opencodeHome),
    piHome: expandHome(homes.piHome?.trim() || DEFAULT_AGENT_HOMES.piHome),
    cursorHome: expandHome(homes.cursorHome?.trim() || DEFAULT_AGENT_HOMES.cursorHome),
    cursorIdeUserDataHome: expandHome(homes.cursorIdeUserDataHome?.trim() || defaultCursorIdeUserDataHome())
  };
}
