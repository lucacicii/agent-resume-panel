import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../dist/index.js";

/**
 * Regression: mergeSettings used to drop sessionSummaryAuto / sessionEmbeddingIndex /
 * sessionTranscriptIndex, so Settings → Sessions saved with a success toast but values
 * never landed in settings.desktop.json (always fell back to defaults on reload).
 */
test("session auto settings persist through saveSettings and loadSettings", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-session-auto-settings-"));
  try {
    await saveSettings(
      {
        ...structuredClone(DEFAULT_SETTINGS),
        panelHome,
        sessionSummaryAuto: {
          enabled: false,
          staleDelayMinutes: 120,
          missingDelayMinutes: 15,
          concurrency: 2,
          maxPerTick: 9
        },
        sessionEmbeddingIndex: {
          enabled: false,
          quietDelayMinutes: 7,
          concurrency: 3,
          maxPerTick: 11
        },
        sessionTranscriptIndex: {
          enabled: false,
          quietDelayMinutes: 45,
          concurrency: 2,
          maxPerTick: 4
        }
      },
      panelHome
    );

    const loaded = await loadSettings(panelHome);
    assert.deepEqual(loaded.sessionSummaryAuto, {
      enabled: false,
      staleDelayMinutes: 120,
      missingDelayMinutes: 15,
      concurrency: 2,
      maxPerTick: 9
    });
    assert.deepEqual(loaded.sessionEmbeddingIndex, {
      enabled: false,
      quietDelayMinutes: 7,
      concurrency: 3,
      maxPerTick: 11
    });
    assert.deepEqual(loaded.sessionTranscriptIndex, {
      enabled: false,
      quietDelayMinutes: 45,
      concurrency: 2,
      maxPerTick: 4
    });

    // File on disk must contain the blocks (not only in-memory defaults).
    const raw = JSON.parse(
      await fs.readFile(path.join(panelHome, "settings.desktop.json"), "utf8")
    );
    assert.equal(raw.sessionSummaryAuto?.enabled, false);
    assert.equal(raw.sessionEmbeddingIndex?.maxPerTick, 11);
    assert.equal(raw.sessionTranscriptIndex?.quietDelayMinutes, 45);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("session auto settings deep-merge partial overrides onto defaults", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-session-auto-partial-"));
  try {
    await saveSettings(
      {
        ...structuredClone(DEFAULT_SETTINGS),
        panelHome,
        sessionSummaryAuto: { maxPerTick: 12 },
        sessionEmbeddingIndex: { enabled: false },
        sessionTranscriptIndex: { quietDelayMinutes: 1 }
      },
      panelHome
    );
    const loaded = await loadSettings(panelHome);
    assert.equal(loaded.sessionSummaryAuto?.maxPerTick, 12);
    assert.equal(loaded.sessionSummaryAuto?.enabled, true);
    assert.equal(loaded.sessionSummaryAuto?.staleDelayMinutes, 30);
    assert.equal(loaded.sessionEmbeddingIndex?.enabled, false);
    assert.equal(loaded.sessionEmbeddingIndex?.maxPerTick, 5);
    assert.equal(loaded.sessionTranscriptIndex?.quietDelayMinutes, 1);
    assert.equal(loaded.sessionTranscriptIndex?.enabled, true);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
