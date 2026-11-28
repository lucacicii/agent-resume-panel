#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { previewAlmaSession } = require("../out/history/preview/alma.js");
const { renameAlmaSession } = require("../out/history/rename/alma.js");
const { readTranscriptFiles } = require("../out/catalog/transcript/read.js");
const { buildResumeCommand } = require("../out/terminal/commandBuilder.js");
const {
  createAlmaThread,
  ensureAlmaWorkspaceId,
  openAlmaThreadRef,
  sendAlmaThreadMessage
} = require("../out/terminal/almaApi.js");

function sqlite(dbPath, sql) {
  execFileSync("sqlite3", [dbPath, sql]);
}

test("previewAlmaSession and readTranscriptFiles read Alma text and reasoning parts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-alma-preview-"));
  try {
    const dbPath = path.join(root, "chat_threads.db");
    sqlite(
      dbPath,
      `CREATE TABLE workspaces(id TEXT PRIMARY KEY,path TEXT NOT NULL,name TEXT NOT NULL,is_temporary INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE chat_threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,model TEXT,is_incognito INTEGER DEFAULT 0,workspace_id TEXT,parent_thread_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
       CREATE TABLE chat_messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,message TEXT NOT NULL,timestamp TEXT NOT NULL,created_at TEXT NOT NULL);
       INSERT INTO workspaces VALUES('ws-1','/tmp/demo','demo',0);
       INSERT INTO chat_threads VALUES('t-1','Alma Preview','magpie:test',0,'ws-1',NULL,'2026-11-28T00:00:00Z','2026-11-28T00:00:05Z');
       INSERT INTO chat_messages VALUES('m-1','t-1','${JSON.stringify({
         role: "user",
         parts: [{ type: "text", text: "Explain the sync flow" }]
       }).replaceAll("'", "''")}','2026-11-28T00:00:01Z','2026-11-28T00:00:01Z');
       INSERT INTO chat_messages VALUES('m-2','t-1','${JSON.stringify({
         role: "assistant",
         parts: [
           { type: "step-start" },
           { type: "reasoning", text: "Need to check sqlite tables" },
           { type: "text", text: "Sync reads chat_threads joined with workspaces." }
         ]
       }).replaceAll("'", "''")}','2026-11-28T00:00:02Z','2026-11-28T00:00:02Z');`
    );

    const preview = await previewAlmaSession(
      {
        provider: "alma",
        id: "t-1",
        title: "Alma Preview",
        projectPath: "/tmp/demo",
        updatedAt: Date.parse("2026-11-28T00:00:05Z")
      },
      { almaHome: root }
    );

    assert.equal(preview.title, "Alma Preview");
    assert.equal(preview.messages.length, 2);
    assert.equal(preview.messages[0].role, "user");
    assert.equal(preview.messages[0].text, "Explain the sync flow");
    assert.equal(preview.messages[1].role, "assistant");
    assert.equal(preview.messages[1].thinking, "Need to check sqlite tables");
    assert.equal(preview.messages[1].text, "Sync reads chat_threads joined with workspaces.");

    const exported = await readTranscriptFiles({
      kind: "sqlite",
      dbPath,
      dialect: "alma",
      sessionId: "t-1"
    });
    assert.equal(exported.length, 1);
    assert.equal(exported[0].fileName, "alma-thread-t-1.json");
    const parsed = JSON.parse(exported[0].content);
    assert.equal(parsed.thread.id, "t-1");
    assert.equal(parsed.messages.length, 2);

    const resumeCmd = buildResumeCommand({
      provider: "alma",
      id: "t-1",
      title: "Alma Preview",
      projectPath: "/tmp/demo",
      updatedAt: 0
    });
    assert.match(resumeCmd, /\/api\/refs\/open/);
    assert.match(resumeCmd, /alma:\/\/thread\/t-1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("almaApi and renameAlmaSession interact with Alma REST API cleanly", async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    requests.push({ method: req.method, url: req.url, body });

    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/api/health") {
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/workspaces") {
      res.end(JSON.stringify([{ id: "ws-existing", name: "demo", path: "/tmp/alma-ws", isTemporary: false }]));
      return;
    }
    if (req.method === "POST" && req.url === "/api/workspaces") {
      res.end(JSON.stringify({ id: "ws-created", ...body }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/threads") {
      res.end(JSON.stringify({ id: "thread-new", title: body.title }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/threads/thread-new/send") {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/refs/open") {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "PUT" && req.url === "/api/threads/thread-new") {
      res.end(JSON.stringify({ id: "thread-new", title: body.title }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const prevUrl = process.env.ALMA_API_URL;
  process.env.ALMA_API_URL = `http://127.0.0.1:${addr.port}`;

  const root = await mkdtemp(path.join(os.tmpdir(), "agent-resume-alma-api-"));
  try {
    await mkdir(root, { recursive: true });
    const existingWsId = await ensureAlmaWorkspaceId("/tmp/alma-ws", "demo");
    assert.equal(existingWsId, "ws-existing");

    const createdWsId = await ensureAlmaWorkspaceId("/tmp/alma-new-ws", "new-ws");
    assert.equal(createdWsId, "ws-created");

    const thread = await createAlmaThread("Handoff: Demo", createdWsId);
    assert.equal(thread.id, "thread-new");

    await sendAlmaThreadMessage(thread.id, "Handoff brief payload");
    await openAlmaThreadRef(thread.id);
    await renameAlmaSession(
      root,
      {
        provider: "alma",
        id: thread.id,
        title: "Old",
        projectPath: "/tmp/alma-new-ws",
        updatedAt: 100
      },
      "Renamed via API"
    );

    const openReq = requests.find((r) => r.url === "/api/refs/open");
    assert.deepEqual(openReq?.body, { uri: "alma://thread/thread-new" });

    const sendReq = requests.find((r) => r.url === "/api/threads/thread-new/send");
    assert.deepEqual(sendReq?.body, { text: "Handoff brief payload" });

    const renameReq = requests.find((r) => r.method === "PUT" && r.url === "/api/threads/thread-new");
    assert.deepEqual(renameReq?.body, { title: "Renamed via API", skipUpdatedAt: true });
  } finally {
    if (prevUrl === undefined) {
      delete process.env.ALMA_API_URL;
    } else {
      process.env.ALMA_API_URL = prevUrl;
    }
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
