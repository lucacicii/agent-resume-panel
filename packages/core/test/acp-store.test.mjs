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
      insertAcpSessionRecord(panelHome, record("desktop-chat", 100)),
      insertAcpSessionRecord(panelHome, record("extension-chat", 200))
    ]);

    const records = await loadAcpSessionRecords(panelHome);
    assert.deepEqual(
      records.map((entry) => entry.id).sort(),
      ["desktop-chat", "extension-chat"]
    );

    await Promise.all([
      updateAcpSessionRecord(panelHome, { ...record("desktop-chat", 300), messageCount: 3 }),
      updateAcpSessionRecord(panelHome, { ...record("extension-chat", 400), messageCount: 4 })
    ]);
    const updated = await loadAcpSessionRecords(panelHome);
    assert.deepEqual(
      updated.map((entry) => [entry.id, entry.messageCount]).sort((a, b) => a[0].localeCompare(b[0])),
      [["desktop-chat", 3], ["extension-chat", 4]]
    );

    await Promise.all([
      appendAcpThreadMessage(panelHome, "desktop-chat", { id: "desktop-message", timestamp: 10 }),
      appendAcpThreadMessage(panelHome, "desktop-chat", { id: "extension-message", timestamp: 20 })
    ]);
    const messages = await loadAcpThreadMessages(panelHome, "desktop-chat");
    assert.deepEqual(
      messages.map((entry) => entry.id),
      ["desktop-message", "extension-message"]
    );

    await deleteAcpSessionRecord(panelHome, "extension-chat");
    assert.deepEqual(
      (await loadAcpSessionRecords(panelHome)).map((entry) => entry.id),
      ["desktop-chat"]
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
