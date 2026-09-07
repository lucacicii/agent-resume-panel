import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../dist/index.js";

test("desktop theme defaults and invalid values normalize to system/light/dark", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-desktop-theme-"));
  try {
    await fs.writeFile(path.join(panelHome, "settings.desktop.json"), JSON.stringify({
      ...DEFAULT_SETTINGS,
      panelHome,
      desktop: { theme: "invalid" },
      workbench: { terminalTheme: "default-dark", editorTheme: "invalid" }
    }), "utf8");
    const migrated = await loadSettings(panelHome);
    assert.equal(migrated.desktop?.theme, "system");
    assert.equal(migrated.workbench?.terminalTheme, "follow-app");
    assert.equal(migrated.workbench?.editorTheme, "follow-app");

    await saveSettings({ ...migrated, desktop: { ...migrated.desktop, theme: "dark" } }, panelHome);
    const saved = await loadSettings(panelHome);
    assert.equal(saved.desktop?.theme, "dark");
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
