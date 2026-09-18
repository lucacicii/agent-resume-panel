import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  buildMentionPrompt,
  loadSettings,
  matchMentionForCwd,
  normalizeWorkbenchComposerMentions,
  resolveMention,
  saveSettings
} from "../dist/index.js";

test("normalizeWorkbenchComposerMentions expands home, strips @, and dedupes ids", () => {
  const home = os.homedir();
  const mentions = normalizeWorkbenchComposerMentions([
    {
      id: "@Anfeng",
      cwd: "~/work/c",
      roots: [
        { path: path.join(home, "work", "a"), role: "reference" },
        { path: "~/work/c", role: "work" },
        { path: "", role: "reference" },
        { path: path.join(home, "work", "a"), role: "reference" }
      ]
    },
    { id: "anfeng", cwd: "/other", roots: [] },
    { id: "bad id", cwd: "/tmp", roots: [] },
    { id: "empty", cwd: "   ", roots: [] },
    { cwd: "/tmp/x", roots: [] }
  ]);
  assert.deepEqual(mentions, [
    {
      id: "Anfeng",
      cwd: path.join(home, "work", "c"),
      roots: [
        { path: path.join(home, "work", "c"), role: "work" },
        { path: path.join(home, "work", "a"), role: "reference" }
      ]
    }
  ]);
});

test("resolveMention and matchMentionForCwd are case-insensitive on id and exact on cwd", () => {
  const mentions = normalizeWorkbenchComposerMentions([
    { id: "anfeng", cwd: "/work/c", roots: [{ path: "/work/a", role: "reference" }] },
    { id: "other", cwd: "/work/d", roots: [] }
  ]);
  assert.equal(resolveMention(mentions, "@ANFENG")?.id, "anfeng");
  assert.equal(resolveMention(mentions, "missing"), null);
  assert.equal(matchMentionForCwd(mentions, "/work/c")?.id, "anfeng");
  assert.equal(matchMentionForCwd(mentions, "/work/c/src"), null);
  assert.equal(matchMentionForCwd(mentions, "/work/a"), null);
});

test("buildMentionPrompt lists work cwd and reference roots", () => {
  const mention = normalizeWorkbenchComposerMentions([
    {
      id: "anfeng",
      cwd: "/work/c",
      roots: [
        { path: "/work/a", role: "reference" },
        { path: "/work/b", role: "reference" }
      ]
    }
  ])[0];
  assert.equal(
    buildMentionPrompt(mention),
    [
      "[Workspace anfeng]",
      "Work cwd (write here only): /work/c",
      "Reference (read only):",
      "- /work/a",
      "- /work/b"
    ].join("\n")
  );
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
            {
              id: "@anfeng",
              cwd: path.join(panelHome, "c"),
              roots: [{ path: path.join(panelHome, "a"), role: "reference" }]
            }
          ]
        }
      },
      panelHome
    );
    const loaded = await loadSettings(panelHome);
    assert.deepEqual(loaded.workbench.composerMentions, [
      {
        id: "anfeng",
        cwd: path.join(panelHome, "c"),
        roots: [
          { path: path.join(panelHome, "c"), role: "work" },
          { path: path.join(panelHome, "a"), role: "reference" }
        ]
      }
    ]);

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
