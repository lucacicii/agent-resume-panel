import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSessionPreview, resolvePreviewHomes } from "../dist/index.js";

function makeSession(id, title) {
  return { provider: "chat", id, title, projectPath: "/project", updatedAt: 1 };
}

test("ACP preview treats a missing thread file as an empty chat (no warning)", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-acp-preview-empty-"));
  try {
    // No thread file is written — this is the lifecycle of a chat created but never messaged.
    const preview = await loadSessionPreview(makeSession("empty-chat", "New ACP Chat"), resolvePreviewHomes({ panelHome }));
    assert.equal(preview.warning, undefined);
    assert.deepEqual(preview.messages, []);
    assert.equal(preview.title, "New ACP Chat");
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("ACP preview returns parsed messages when the thread file exists", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-acp-preview-messages-"));
  try {
    await fs.mkdir(path.join(panelHome, "acp", "threads"), { recursive: true });
    const threadPath = path.join(panelHome, "acp", "threads", "with-messages.jsonl");
    const lines = [
      { id: "m1", role: "user", text: "hello", timestamp: 1000 },
      { id: "m2", role: "assistant", text: "hi there", timestamp: 2000 }
    ];
    await fs.writeFile(threadPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");

    const preview = await loadSessionPreview(makeSession("with-messages", "Chat"), resolvePreviewHomes({ panelHome }));
    assert.equal(preview.warning, undefined);
    assert.deepEqual(
      preview.messages.map((message) => [message.role, message.text]),
      [["user", "hello"], ["assistant", "hi there"]]
    );
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
