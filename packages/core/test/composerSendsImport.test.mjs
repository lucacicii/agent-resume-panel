import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  desktopDbPath,
  ensureDesktopDbSchema,
  importComposerSendsForSession,
  listComposerSends,
  shouldImportComposerSendText
} from "../dist/index.js";

const PI_SESSION_ROOT = path.join(os.tmpdir(), `agent-resume-import-pi-${Date.now()}`);
const PI_SESSION_DIR = path.join(PI_SESSION_ROOT, "sessions");

function piJsonlPath(sessionId) {
  return path.join(PI_SESSION_DIR, `${sessionId}.jsonl`);
}

function piSession(sessionId, cwd) {
  return {
    provider: "pi",
    id: sessionId,
    title: "test session",
    projectPath: cwd,
    updatedAt: 1
  };
}

test("shouldImportComposerSendText filters noise and short commands", () => {
  assert.equal(shouldImportComposerSendText("fix the login button"), true);
  assert.equal(shouldImportComposerSendText("git status"), true, "user-typed shell command is a legit send");
  assert.equal(shouldImportComposerSendText("/new"), false);
  assert.equal(shouldImportComposerSendText("<tool_use id=x>"), false);
  assert.equal(shouldImportComposerSendText("a"), false);
  assert.equal(shouldImportComposerSendText("运行"), true);
});

test("imports user messages from pi jsonl into composer sends (idempotent)", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-import-"));
  const desktopDb = desktopDbPath(panelHome);
  const sessionId = "01test-0000-0000-0000-000000000000";
  const cwd = "/work/app";
  await fs.mkdir(PI_SESSION_DIR, { recursive: true });
  const homes = {
    panelHome,
    piHome: PI_SESSION_ROOT,
    primeHome: os.tmpdir()
  };
  const session = piSession(sessionId, cwd);
  try {
    await ensureDesktopDbSchema(desktopDb);
    // pi jsonl: header + a couple user messages + assistant rows + noise.
    const header = { type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00Z", cwd };
    const user1 = {
      type: "message",
      id: "m1",
      timestamp: "2026-01-01T00:00:01Z",
      message: { role: "user", content: [{ type: "text", text: "fix the login button" }] }
    };
    const assistant = {
      type: "message",
      id: "m2",
      timestamp: "2026-01-01T00:00:02Z",
      message: { role: "assistant", content: [{ type: "text", text: "sure, doing it" }] }
    };
    const userNoise = {
      type: "message",
      id: "m3",
      timestamp: "2026-01-01T00:00:03Z",
      message: { role: "user", content: [{ type: "text", text: "/new" }] }
    };
    const user2 = {
      type: "message",
      id: "m4",
      timestamp: "2026-01-01T00:00:04Z",
      message: { role: "user", content: [{ type: "text", text: "git commit -m wip" }] }
    };
    const lines = [header, user1, assistant, userNoise, user2].map((row) => JSON.stringify(row)).join("\n");
    await fs.writeFile(piJsonlPath(sessionId), `${lines}\n`, "utf8");

    const first = await importComposerSendsForSession(desktopDb, session, homes);
    assert.equal(first.imported, 2, "user1 + user2 should import");
    assert.ok(first.skipped >= 1, "noise rows skipped");
    assert.ok(first.found >= 3, "all user rows counted");

    const rows = await listComposerSends(desktopDb, { agentSessionId: sessionId, limit: 50 });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.text).sort(), ["fix the login button", "git commit -m wip"]);
    for (const row of rows) {
      assert.equal(row.agentSessionId, sessionId);
      assert.equal(row.provider, "pi");
      assert.equal(row.projectPath, cwd);
    }

    // Idempotent: second run imports nothing new.
    const second = await importComposerSendsForSession(desktopDb, session, homes);
    assert.equal(second.imported, 0, "no duplicates");
    const after = await listComposerSends(desktopDb, { agentSessionId: sessionId, limit: 50 });
    assert.equal(after.length, 2);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
    await fs.rm(PI_SESSION_ROOT, { recursive: true, force: true });
  }
});
