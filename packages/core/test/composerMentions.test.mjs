import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  matchMentionForCwd,
  DEFAULT_WORKBENCH_MENTION_SOURCES,
  normalizeWorkbenchComposerMentions,
  normalizeWorkbenchMentionSources,
  resolveMention,
  saveSettings
} from "../dist/index.js";

test("normalizeWorkbenchComposerMentions expands home, strips @, and dedupes ids", () => {
  const home = os.homedir();
  const mentions = normalizeWorkbenchComposerMentions([
    { id: "@Anfeng", cwd: "~/work/c" },
    { id: "anfeng", cwd: "/other" },
    { id: "bad id", cwd: "/tmp" },
    { id: "empty", cwd: "   " },
    { cwd: "/tmp/x" }
  ]);
  assert.deepEqual(mentions, [{ id: "Anfeng", cwd: path.join(home, "work", "c") }]);
});

test("resolveMention and matchMentionForCwd are case-insensitive on id and exact on cwd", () => {
  const mentions = normalizeWorkbenchComposerMentions([
    { id: "anfeng", cwd: "/work/c" },
    { id: "other", cwd: "/work/d" }
  ]);
  assert.equal(resolveMention(mentions, "@ANFENG")?.id, "anfeng");
  assert.equal(resolveMention(mentions, "missing"), null);
  assert.equal(matchMentionForCwd(mentions, "/work/c")?.id, "anfeng");
  assert.equal(matchMentionForCwd(mentions, "/work/c/src"), null);
  assert.equal(matchMentionForCwd(mentions, "/work/a"), null);
});

test("normalizeWorkbenchMentionSources keeps the four named kinds and defaults projects off", () => {
  assert.deepEqual(normalizeWorkbenchMentionSources(undefined), DEFAULT_WORKBENCH_MENTION_SOURCES);
  assert.equal(DEFAULT_WORKBENCH_MENTION_SOURCES.projects, false);
  assert.equal(DEFAULT_WORKBENCH_MENTION_SOURCES.workspaces, true);

  // Only the keys the type knows survive; junk and non-booleans fall back to
  // the default rather than becoming an `undefined` the composer would read.
  assert.deepEqual(
    normalizeWorkbenchMentionSources({ workspaces: false, projects: true, notes: "yes", extra: 1 }),
    { workspaces: false, tasks: true, notes: true, sessions: true, projects: true }
  );
  assert.deepEqual(normalizeWorkbenchMentionSources(null), DEFAULT_WORKBENCH_MENTION_SOURCES);
});

test("composer mentions persist through settings load/save", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-mentions-"));
  try {
    await saveSettings(
      {
        ...structuredClone(DEFAULT_SETTINGS),
        panelHome,
        workbench: {
          composerMentions: [
            { id: "@anfeng", cwd: path.join(panelHome, "c") }
          ],
          composerMentionSources: { workspaces: true, tasks: false, notes: true, sessions: true, projects: true }
        }
      },
      panelHome
    );
    const loaded = await loadSettings(panelHome);
    assert.deepEqual(loaded.workbench.composerMentions, [
      { id: "anfeng", cwd: path.join(panelHome, "c") }
    ]);
    assert.deepEqual(loaded.workbench.composerMentionSources, {
      workspaces: true,
      tasks: false,
      notes: true,
      sessions: true,
      projects: true
    });

    await saveSettings(
      {
        ...loaded,
        workbench: { ...loaded.workbench, composerMentions: [] }
      },
      panelHome
    );
    const emptied = await loadSettings(panelHome);
    assert.deepEqual(emptied.workbench.composerMentions, []);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
