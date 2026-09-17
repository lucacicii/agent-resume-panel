import {
  preparePanelDatabases,
  type PanelDbPaths,
  type PanelSettings
} from "@agent-resume/core";
import { loadSettings } from "@agent-resume/core";

export async function loadPanelDbPaths(settings?: PanelSettings): Promise<PanelDbPaths> {
  const resolved = settings ?? (await loadSettings());
  return preparePanelDatabases(resolved);
}

