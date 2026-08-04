import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../dist/index.js";

/**
 * Regression: mergeSettings used to drop the Notes block, so Settings → Notes
 * saved with a success toast but the provider never landed in
 * settings.desktop.json (always fell back to codex on reload).
 */
test("Notes default session provider persists through saveSettings and loadSettings", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-notes-settings-"));
  try {
    await saveSettings(
      {
        ...structuredClone(DEFAULT_SETTINGS),
        panelHome,
        notes: { defaultSessionProvider: "grok" }
      },
      panelHome
    );

    const loaded = await loadSettings(panelHome);
    assert.equal(loaded.notes?.defaultSessionProvider, "grok");

    // File on disk must contain the block (not only in-memory defaults).
    const raw = JSON.parse(
      await fs.readFile(path.join(panelHome, "settings.desktop.json"), "utf8")
    );
    assert.equal(raw.notes?.defaultSessionProvider, "grok");
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("Notes default session provider rejects non-CLI providers on load", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-notes-settings-"));
  try {
    await saveSettings(
      {
        ...structuredClone(DEFAULT_SETTINGS),
        panelHome,
        notes: { defaultSessionProvider: "chat" }
      },
      panelHome
    );
    const loaded = await loadSettings(panelHome);
    // chat is not a valid CLI Notes provider — must not be accepted.
    assert.equal(loaded.notes?.defaultSessionProvider, undefined);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
