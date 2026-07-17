import * as fs from "node:fs/promises";
import * as path from "node:path";
import { defaultScratchDir, desktopDataDir } from "./panelHome";
import { expandHome } from "./pathUtils";
import { effectivePanelHome } from "./settings/store";
import type { PanelSettings } from "./settings/types";

const LEGACY_SCRATCH_DIR_NAME = "scratch";

export function resolveScratchBaseDir(settings: PanelSettings, panelHomeHint?: string): string {
  const custom = settings.workbench?.scratchDir?.trim();
  if (custom) {
    return expandHome(custom);
  }
  return defaultScratchDir(effectivePanelHome(settings, panelHomeHint));
}

/** One-time move of legacy `{panelHome}/scratch` into `{panelHome}/.desktop/scratch`. */
export async function migrateLegacyScratchDir(
  settings: PanelSettings,
  panelHomeHint?: string
): Promise<void> {
  if (settings.workbench?.scratchDir?.trim()) {
    return;
  }

  const panelHome = effectivePanelHome(settings, panelHomeHint);
  const legacyDir = path.join(panelHome, LEGACY_SCRATCH_DIR_NAME);
  const targetDir = defaultScratchDir(panelHome);

  try {
    await fs.access(targetDir);
    return;
  } catch {
    // target missing — continue
  }

  let legacyEntries: string[];
  try {
    legacyEntries = await fs.readdir(legacyDir);
  } catch {
    return;
  }

  if (legacyEntries.length === 0) {
    try {
      await fs.rmdir(legacyDir);
    } catch {
      // ignore
    }
    return;
  }

  await fs.mkdir(desktopDataDir(panelHome), { recursive: true });
  await fs.rename(legacyDir, targetDir);
}