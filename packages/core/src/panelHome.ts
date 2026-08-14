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

/** Desktop app settings; Extension keeps using settings.json as an LLM bridge only. */
export function desktopSettingsPath(panelHome: string): string {
  return path.join(panelHome, "settings.desktop.json");
}

/** Desktop-private data directory under the shared panel home. */
export function desktopDataDir(panelHome: string): string {
  return path.join(panelHome, ".desktop");
}

/** Desktop-private SQLite store: `<panelHome>/.desktop/desktop.db`. */
export function desktopDbPath(panelHome: string): string {
  return path.join(desktopDataDir(panelHome), "desktop.db");
}

/** Desktop workbench scratch sessions: `<panelHome>/.desktop/scratch`. */
export function defaultScratchDir(panelHome: string): string {
  return path.join(desktopDataDir(panelHome), "scratch");
}

/** Desktop app error / diagnostic logs: `<panelHome>/.desktop/logs`. */
export function desktopLogsDir(panelHome: string): string {
  return path.join(desktopDataDir(panelHome), "logs");
}

/**
 * Live loopback handle for the Desktop in-app browser MCP
 * (`agent-resume-browser`). Written by Desktop main when the server is up;
 * read by the headless stdio proxy used by TUI/CLI MCP clients.
 */
export function browserMcpEndpointPath(panelHome: string): string {
  return path.join(desktopDataDir(panelHome), "browser-mcp-endpoint.json");
}