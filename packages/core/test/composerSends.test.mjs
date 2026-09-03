import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendComposerSend,
  desktopDbPath,
  ensureDesktopDbSchema,
  listComposerSends,
  runSqliteJson
} from "../dist/index.js";

test("composer sends are append-only and survive listing by pane or session", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-composer-"));
  const desktopDb = desktopDbPath(panelHome);
  try {
    await ensureDesktopDbSchema(desktopDb);
    const first = await appendComposerSend(desktopDb, {
      paneKey: "terminal:1",
      projectPath: "/work/app",
      sessionKey: "codex:session-1",
      provider: "codex",
      agentSessionId: "session-1",
      text: "inspect src"
    });
    assert.equal(first.text, "inspect src");
    await appendComposerSend(desktopDb, {
      paneKey: "terminal:1",
      projectPath: "/work/app",
      sessionKey: "codex:session-1",
      provider: "codex",
      agentSessionId: "session-1",
      text: "run tests"
    });
    const byPane = await listComposerSends(desktopDb, { paneKey: "terminal:1", limit: 8 });
    assert.equal(byPane.length, 2);
    assert.equal(byPane[0].text, "run tests");
    assert.equal(byPane[1].text, "inspect src");
    const bySession = await listComposerSends(desktopDb, { sessionKey: "codex:session-1", limit: 8 });
    assert.equal(bySession.length, 2);
    const rows = await runSqliteJson(
      desktopDb,
      "SELECT COUNT(*) AS n FROM workbench_composer_sends;"
    );
    assert.equal(rows[0].n, 2);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("composer send rejects empty text and does not insert a row", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-composer-"));
  const desktopDb = desktopDbPath(panelHome);
  try {
    await ensureDesktopDbSchema(desktopDb);
    await assert.rejects(
      () => appendComposerSend(desktopDb, {
        paneKey: "terminal:1",
        projectPath: "/work/app",
        text: "   "
      }),
      /requires text/
    );
    const rows = await runSqliteJson(
      desktopDb,
      "SELECT COUNT(*) AS n FROM workbench_composer_sends;"
    );
    assert.equal(rows[0].n, 0);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
