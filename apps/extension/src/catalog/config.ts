import * as path from "node:path";
import * as vscode from "vscode";
import { expandHome } from "../history/pathUtils";
import { CatalogSettings, CatalogSidebarMode, CatalogStalePolicy } from "./types";

function normalizeCatalogStalePolicy(value: string | undefined): CatalogStalePolicy {
  return value === "purge" ? "purge" : "off";
}

export function loadCatalogSettings(config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("agentResume")): CatalogSettings {
  const panelHome = expandHome(config.get<string>("panelHome", "~/.agent-resume-panel"));
  const defaultDbPath = path.join(panelHome, "catalog.db");
  const configuredPath = config.get<string>("catalog.dbPath", "").trim();
  const dbPath = expandHome(configuredPath || defaultDbPath);

  return {
    dbPath,
    syncMaxItems: config.get<number>("catalog.syncMaxItems", 10_000),
    stalePolicy: normalizeCatalogStalePolicy(config.get<string>("catalog.stalePolicy", "off")),
    sidebarMode: config.get<CatalogSidebarMode>("catalog.sidebarMode", "legacy")
  };
}