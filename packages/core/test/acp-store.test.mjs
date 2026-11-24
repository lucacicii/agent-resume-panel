import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acpStoreLockPath,
  appendAcpThreadMessage,
  deleteAcpSessionRecord,
  insertAcpSessionRecord,
  loadAcpSessionRecords,
  loadAcpThreadMessages,
  updateAcpSessionRecord
} from "../dist/index.js";

function record(id, updatedAt) {
  return {
    id,
    title: id,
    projectPath: "/project",
    provider: "codex",
    createdAt: updatedAt,
    updatedAt,
    messageCount: 0
  };
}

test("ACP store serializes concurrent session and message writes", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-acp-store-"));
  try {
    await Promise.all([
      insertAcpSessionRecord(panelHome, record("chat-1", 100)),
      insertAcpSessionRecord(panelHome, record("chat-2", 200))
    ]);

    const records = await loadAcpSessionRecords(panelHome);
    assert.deepEqual(
      records.map((entry) => entry.id).sort(),
      ["chat-1", "chat-2"]
    );

    await Promise.all([
      updateAcpSessionRecord(panelHome, { ...record("chat-1", 300), messageCount: 3 }),
      updateAcpSessionRecord(panelHome, { ...record("chat-2", 400), messageCount: 4 })
    ]);
    const updated = await loadAcpSessionRecords(panelHome);
    assert.deepEqual(
      updated.map((entry) => [entry.id, entry.messageCount]).sort((a, b) => a[0].localeCompare(b[0])),
      [["chat-1", 3], ["chat-2", 4]]
    );

    await Promise.all([
      appendAcpThreadMessage(panelHome, "chat-1", { id: "msg-1", timestamp: 10 }),
      appendAcpThreadMessage(panelHome, "chat-1", { id: "msg-2", timestamp: 20 })
    ]);
    const messages = await loadAcpThreadMessages(panelHome, "chat-1");
    assert.deepEqual(
      messages.map((entry) => entry.id),
      ["msg-1", "msg-2"]
    );

    await deleteAcpSessionRecord(panelHome, "chat-2");
    assert.deepEqual(
      (await loadAcpSessionRecords(panelHome)).map((entry) => entry.id),
      ["chat-1"]
    );
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("ACP store reclaims a stale cross-process lock", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-acp-stale-lock-"));
  try {
    const lockPath = acpStoreLockPath(panelHome);
    await fs.mkdir(lockPath, { recursive: true });
    const staleAt = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, staleAt, staleAt);

    await insertAcpSessionRecord(panelHome, record("recovered", 1));
    assert.equal((await loadAcpSessionRecords(panelHome))[0]?.id, "recovered");
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
