import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../dist/index.js";

test("desktop visual theme defaults, migration, and invalid values normalize safely", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-desktop-theme-"));
  try {
    await fs.writeFile(path.join(panelHome, "settings.desktop.json"), JSON.stringify({
      ...DEFAULT_SETTINGS,
      panelHome,
      desktop: { theme: "light", visualTheme: "dos", themeEffects: "invalid" },
      workbench: { terminalTheme: "default-dark", editorTheme: "invalid" }
    }), "utf8");
    const migrated = await loadSettings(panelHome);
    assert.equal(migrated.desktop?.visualTheme, "dos");
    assert.equal(migrated.desktop?.theme, "dark");
    assert.equal(migrated.desktop?.themeEffects, "full");
    assert.equal(migrated.workbench?.terminalTheme, "follow-app");
    assert.equal(migrated.workbench?.editorTheme, "follow-app");

    await saveSettings({ ...migrated, desktop: { ...migrated.desktop, visualTheme: "invalid" } }, panelHome);
    const fallback = await loadSettings(panelHome);
    assert.equal(fallback.desktop?.visualTheme, "classic");
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
