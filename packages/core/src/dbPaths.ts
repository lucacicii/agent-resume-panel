import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ensureCatalogSyncStateDesktop, ensureDesktopDbSchema, ensureExtensionCatalogSchema } from "./catalog/db";
import { desktopDbPath } from "./panelHome";
import type { PanelSettings } from "./settings/types";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "./settings/store";

export interface PanelDbPaths {
  catalogDb: string;
  desktopDb: string;
}

export function resolvePanelDbPaths(settings: PanelSettings, panelHomeHint?: string): PanelDbPaths {
  const panelHome = effectivePanelHome(settings, panelHomeHint);
  return {
    catalogDb: catalogDbFromSettings(settings, panelHomeHint),
    desktopDb: desktopDbPath(panelHome)
  };
}

export async function resolvePanelDbPathsFromSettings(panelHome?: string): Promise<PanelDbPaths> {
  const settings = await loadSettings(panelHome);
  return resolvePanelDbPaths(settings, panelHome);
}

export async function ensurePanelDatabases(paths: PanelDbPaths): Promise<void> {
  await fs.mkdir(path.dirname(paths.desktopDb), { recursive: true });
  await ensureExtensionCatalogSchema(paths.catalogDb);
  await ensureCatalogSyncStateDesktop(paths.catalogDb);
  await ensureDesktopDbSchema(paths.desktopDb);
}

export async function preparePanelDatabases(
  settings: PanelSettings,
  panelHomeHint?: string
): Promise<PanelDbPaths> {
  const paths = resolvePanelDbPaths(settings, panelHomeHint);
  await ensurePanelDatabases(paths);
  return paths;
}

export async function preparePanelDatabasesFromSettings(panelHome?: string): Promise<PanelDbPaths> {
  const settings = await loadSettings(panelHome);
  return preparePanelDatabases(settings, panelHome);
}