import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  defaultScratchDir,
  migrateLegacyScratchDir,
  resolveScratchBaseDir
} from "../dist/index.js";

test("resolveScratchBaseDir defaults to panelHome/.desktop/scratch", () => {
  const panelHome = "/tmp/panel-home";
  const settings = structuredClone(DEFAULT_SETTINGS);
  assert.equal(resolveScratchBaseDir(settings, panelHome), defaultScratchDir(panelHome));
});

test("resolveScratchBaseDir honors custom workbench.scratchDir", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.workbench = { scratchDir: "~/custom-scratch" };
  assert.equal(resolveScratchBaseDir(settings, "/tmp/panel-home"), path.join(os.homedir(), "custom-scratch"));
});

test("migrateLegacyScratchDir moves legacy scratch into .desktop/scratch", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-scratch-"));
  const legacyDir = path.join(panelHome, "scratch");
  const targetDir = defaultScratchDir(panelHome);
  const settings = structuredClone(DEFAULT_SETTINGS);

  try {
    await fs.mkdir(path.join(legacyDir, "session-1"), { recursive: true });
    await migrateLegacyScratchDir(settings, panelHome);

    await fs.access(targetDir);
    await fs.access(path.join(targetDir, "session-1"));
    await assert.rejects(() => fs.access(legacyDir));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("migrateLegacyScratchDir skips when scratchDir is customized", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-scratch-"));
  const legacyDir = path.join(panelHome, "scratch");
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.workbench = { scratchDir: legacyDir };

  try {
    await fs.mkdir(path.join(legacyDir, "session-1"), { recursive: true });
    await migrateLegacyScratchDir(settings, panelHome);

    await fs.access(path.join(legacyDir, "session-1"));
    await assert.rejects(() => fs.access(defaultScratchDir(panelHome)));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});