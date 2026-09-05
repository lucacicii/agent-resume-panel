import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupImportedComposerSends,
  desktopDbPath,
  ensureDesktopDbSchema,
  filterComposerImportCandidates,
  importComposerSendsForSession,
  isComposerSendNoise,
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
  assert.equal(shouldImportComposerSendText("$ node apps/desktop/scripts/dev.mjs --fresh"), false);
  assert.equal(shouldImportComposerSendText("[dev] running initial build..."), false);
  assert.equal(shouldImportComposerSendText("copied locales → dist/locales"), false);
  assert.equal(shouldImportComposerSendText('✘ [ERROR] Could not resolve "node:fs/promises"'), false);
  assert.equal(shouldImportComposerSendText("<local-command-caveat>system note</local-command-caveat>"), false);
  assert.equal(shouldImportComposerSendText("commit(中文) and push"), true);
  assert.equal(shouldImportComposerSendText("执行"), true);
});

test("isComposerSendNoise drops build echoes and keeps natural instructions", () => {
  assert.equal(isComposerSendNoise("Settings → Workbench 没看到 Composer slash phrases"), false);
  assert.equal(isComposerSendNoise("$ node ../../scripts/run-tsc.mjs --cwd . -p ./"), true);
  assert.equal(isComposerSendNoise("copied shellIntegration → dist/main/shellIntegration"), true);
  assert.equal(isComposerSendNoise("37 │ const fs = __importStar(require(\"node:fs/promises\"));"), true);
  assert.equal(isComposerSendNoise('The package "node:fs/promises" wasn\'t found on the file system'), true);
  assert.equal(isComposerSendNoise("will remove this error."), true);
  assert.equal(isComposerSendNoise("../../packages/core/dist/catalog/acpCatalog.js:44:34:\n44 │ const x = 1;"), true);
  assert.equal(isComposerSendNoise("╵             ~~~~~~~~~~~~~~~~~~"), true);
});

test("filterComposerImportCandidates drops sub-2s terminal bursts but keeps outliers", () => {
  const base = 1788499769000;
  const rows = [
    { text: "Settings → Workbench 没看到  Composer slash phrases", createdAtMs: base - 20 * 60000 },
    { text: "$ node apps/desktop/scripts/dev.mjs --fresh", createdAtMs: base },
    { text: "[dev] running initial build...", createdAtMs: base + 200 },
    { text: "$ node ../../scripts/run-tsc.mjs --cwd . -p ./", createdAtMs: base + 600 },
    { text: "copied locales → dist/locales", createdAtMs: base + 1400 },
    { text: '✘ [ERROR] Could not resolve "node:fs/promises"', createdAtMs: base + 1600 },
    { text: "Are you trying to bundle for node?", createdAtMs: base + 1800 },
    { text: "will remove this error.", createdAtMs: base + 1900 },
    { text: "你现在实现的是 在空输入框 输入/显示提示", createdAtMs: base + 21 * 60000 }
  ];
  const kept = filterComposerImportCandidates(rows);
  assert.deepEqual(
    kept.map((row) => row.text),
    ["Settings → Workbench 没看到  Composer slash phrases", "你现在实现的是 在空输入框 输入/显示提示"]
  );
});

test("filterComposerImportCandidates keeps spaced TUI paste but drops its noise lines", () => {
  const base = 1788450000000;
  const rows = [
    { text: "忽略上面的需求,  然后看我的新需求", createdAtMs: base },
    { text: "$ node apps/desktop/scripts/dev.mjs --fresh", createdAtMs: base + 5 * 1000 },
    { text: "[dev] running initial build...", createdAtMs: base + 10 * 1000 },
    { text: "$ node ../../scripts/run-tsc.mjs --cwd . -p ./", createdAtMs: base + 15 * 1000 },
    { text: "功能正常了; 现在听我的新需求", createdAtMs: base + 200 * 1000 }
  ];
  const kept = filterComposerImportCandidates(rows);
  assert.deepEqual(
    kept.map((row) => row.text),
    ["忽略上面的需求,  然后看我的新需求", "功能正常了; 现在听我的新需求"]
  );
});

test("filterComposerImportCandidates keeps a mid-burst human question", () => {
  const base = 1788450000000;
  const rows = [
    { text: "$ node apps/desktop/scripts/dev.mjs --fresh", createdAtMs: base },
    { text: "这个构建报错是你的改动引起的吗", createdAtMs: base + 40000 },
    { text: "[dev] running initial build...", createdAtMs: base + 80000 },
    { text: "copied locales → dist/locales", createdAtMs: base + 90000 }
  ];
  const kept = filterComposerImportCandidates(rows);
  assert.deepEqual(kept.map((row) => row.text), ["这个构建报错是你的改动引起的吗"]);
});

test("shouldImportComposerSendText drops agent-injected context as well", () => {
  assert.equal(shouldImportComposerSendText("# AGENTS.md instructions for /x\n\ncall me Master;"), false);
  assert.equal(shouldImportComposerSendText("# AGENTS.md instructions\n\n<INSTRUCTIONS>\ncall me Master;"), false);
  assert.equal(shouldImportComposerSendText("Tool ran without output or errors"), false);
  assert.equal(shouldImportComposerSendText("    at render (/app/x.js:10:3)"), false);
  assert.equal(shouldImportComposerSendText("/var/folders/jg/xxx/T/pi-clipboard-abc"), false);
  assert.equal(shouldImportComposerSendText("Uncaught Error: Minified React error #130"), false);
  assert.equal(shouldImportComposerSendText("react-dom-client.production.js:2599 Uncaught Error"), false);
  assert.equal(shouldImportComposerSendText("251     vi.mocked(llmConfigFromSettings).mockReturnValue(null);"), true, "user-pasted code refs kept by default");
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

test("import sees rows beyond the UI 100-row cap (snowball regression)", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-import-cap-"));
  const desktopDb = desktopDbPath(panelHome);
  const sessionId = "01test-0000-0000-0000-000000000001";
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
    const header = { type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00Z", cwd };
    const first = {
      type: "message",
      id: "m1",
      timestamp: "2026-01-01T00:00:01Z",
      message: { role: "user", content: [{ type: "text", text: "unique early instruction" }] }
    };
    const lines = [header, first];
    for (let index = 0; index < 150; index += 1) {
      lines.push({
        type: "message",
        id: `pad-${index}`,
        timestamp: `2026-01-01T00:00:${String(10 + index).padStart(2, "0")}Z`,
        message: { role: "assistant", content: [{ type: "text", text: `chatter ${index}` }] }
      });
    }
    lines.push({
      type: "message",
      id: "m-last",
      timestamp: "2026-01-01T00:05:00Z",
      message: { role: "user", content: [{ type: "text", text: "unique early instruction" }] }
    });
    await fs.writeFile(piJsonlPath(sessionId), `${lines.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
    const result = await importComposerSendsForSession(desktopDb, session, homes);
    assert.equal(result.imported, 1, "same text in one session imports once, seen past 100 rows");
    assert.equal(result.found, 2);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
    await fs.rm(PI_SESSION_ROOT, { recursive: true, force: true });
  }
});

test("cleanup dedupes, drops noise, and drops import twins of live sends", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-import-cleanup-"));
  const desktopDb = desktopDbPath(panelHome);
  try {
    await ensureDesktopDbSchema(desktopDb);
    const { appendComposerSend } = await import("../dist/index.js");
    await appendComposerSend(desktopDb, { paneKey: "import:pi:s1", projectPath: "/w", provider: "pi", agentSessionId: "s1", text: "fix the login button", createdAtMs: 1000 });
    await appendComposerSend(desktopDb, { paneKey: "import:pi:s1", projectPath: "/w", provider: "pi", agentSessionId: "s1", text: "fix the login button", createdAtMs: 2000 });
    await appendComposerSend(desktopDb, { paneKey: "import:pi:s1", projectPath: "/w", provider: "pi", agentSessionId: "s1", text: "$ node apps/desktop/scripts/dev.mjs --fresh", createdAtMs: 3000 });
    await appendComposerSend(desktopDb, { paneKey: "import:pi:s1", projectPath: "/w", provider: "pi", agentSessionId: "s1", text: "$ node apps/desktop/scripts/dev.mjs --fresh", createdAtMs: 4000 });
    await appendComposerSend(desktopDb, { paneKey: "terminal:1", projectPath: "/w", provider: "pi", agentSessionId: "s1", text: "inspect src", createdAtMs: 5000 });
    await appendComposerSend(desktopDb, { paneKey: "import:pi:s1", projectPath: "/w", provider: "pi", agentSessionId: "s1", text: "inspect src", createdAtMs: 6000 });
    const result = await cleanupImportedComposerSends(desktopDb);
    assert.equal(result.deletedDuplicates, 1);
    assert.equal(result.deletedNoise, 2);
    assert.equal(result.deletedLiveConflicts, 1);
    assert.equal(result.keptLiveRows, 1);
    const rows = await listComposerSends(desktopDb, { agentSessionId: "s1", limit: 50 });
    assert.deepEqual(rows.map((row) => row.text).sort(), ["fix the login button", "inspect src"]);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
