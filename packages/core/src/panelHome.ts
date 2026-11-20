import * as path from "node:path";
import { expandHome } from "./pathUtils";

export const DEFAULT_PANEL_HOME = "~/.agent-resume-panel";

export function resolvePanelHome(configured?: string): string {
  const raw = (configured?.trim() || DEFAULT_PANEL_HOME).trim();
  return expandHome(raw);
}

export function catalogDbPath(panelHome: string): string {
  return path.join(panelHome, "catalog.db");
}

export function settingsPath(panelHome: string): string {
  return path.join(panelHome, "settings.json");
}
