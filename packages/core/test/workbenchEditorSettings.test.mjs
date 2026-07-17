import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../dist/index.js";

test("workbench editor settings keep backward-compatible defaults", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-editor-settings-"));
  try {
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), panelHome, workbench: {} }, panelHome);
    const loaded = await loadSettings(panelHome);
    assert.deepEqual(loaded.workbench.editor, {
      editable: true,
      fontSize: 13,
      wordWrap: false,
      tabSize: 4,
      autoSaveDelayMs: 600
    });
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("workbench editor settings normalize persisted values", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-editor-settings-"));
  try {
    await saveSettings(
      {
        ...structuredClone(DEFAULT_SETTINGS),
        panelHome,
        workbench: {
          editor: {
            editable: false,
            fontSize: 99,
            wordWrap: true,
            tabSize: 3,
            autoSaveDelayMs: 750
          }
        }
      },
      panelHome
    );
    const loaded = await loadSettings(panelHome);
    assert.deepEqual(loaded.workbench.editor, {
      editable: false,
      fontSize: 24,
      wordWrap: true,
      tabSize: 4,
      autoSaveDelayMs: 600
    });
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("workbench editor settings deep-merge partial preferences", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-editor-settings-"));
  try {
    await saveSettings(
      {
        ...structuredClone(DEFAULT_SETTINGS),
        panelHome,
        workbench: { editor: { fontSize: 16 } }
      },
      panelHome
    );
    const loaded = await loadSettings(panelHome);
    assert.deepEqual(loaded.workbench.editor, {
      editable: true,
      fontSize: 16,
      wordWrap: false,
      tabSize: 4,
      autoSaveDelayMs: 600
    });
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
