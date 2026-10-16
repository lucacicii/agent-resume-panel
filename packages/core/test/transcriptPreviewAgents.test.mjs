import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSessionPreview, previewThunderConversation } from "../dist/index.js";

function sqlite(dbPath, sql) {
  execFileSync("sqlite3", [dbPath, sql]);
}

function homes(root) {
  return {
    panelHome: path.join(root, "panel"),
    codexHome: path.join(root, "codex"),
    claudeHome: path.join(root, "claude"),
    antigravityHome: path.join(root, "agy"),
    grokHome: path.join(root, "grok"),
    opencodeHome: path.join(root, "opencode"),
    piHome: path.join(root, "pi"),
    primeHome: path.join(root, "prime"),
    ompHome: path.join(root, "omp"),
    cursorHome: path.join(root, "cursor"),
    cursorIdeUserDataHome: path.join(root, "cursor-ide")
  };
}

async function withRoot(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-preview-"));
  try {
    return await run(root, homes(root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeJsonl(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function session(provider, id, title = "Session") {
  return { provider, id, title, projectPath: "/project", updatedAt: 1 };
}

// ---------------------------------------------------------------- Antigravity

test("agy preview merges the summary and full logs, dropping truncation and duplicate steps", async () => {
  await withRoot(async (root, previewHomes) => {
    const logs = path.join(root, "agy", "brain", "conv-1", ".system_generated", "logs");
    const truncated = `开始\n<truncated 3294 bytes>\n结尾`;
    await writeJsonl(path.join(logs, "transcript.jsonl"), [
      { step_index: 0, type: "USER_INPUT", content: "<USER_REQUEST>\n第一问\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-10-15T19:46:37+08:00\n</ADDITIONAL_METADATA>" },
      // The summary truncates the planner's own text; the full log has it whole.
      { step_index: 1, type: "PLANNER_RESPONSE", content: truncated, created_at: "2026-10-15T11:46:37Z" },
      { step_index: 2, type: "PLANNER_RESPONSE", thinking: "想一下", content: "" },
      { step_index: 3, type: "GENERIC", content: "Created At: now\nOutput:\n工具输出不该进预览" },
      // A prefix copy: some conversations record the opening steps twice.
      { step_index: 0, type: "USER_INPUT", content: "<USER_REQUEST>\n第一问\n</USER_REQUEST>" },
      { step_index: 1, type: "PLANNER_RESPONSE", content: truncated }
    ]);
    // The full log is missing the opening step, so only the merge keeps it.
    await writeJsonl(path.join(logs, "transcript_full.jsonl"), [
      { step_index: 1, type: "PLANNER_RESPONSE", content: "完整回答", created_at: "2026-10-15T11:46:37Z" },
      { step_index: 2, type: "PLANNER_RESPONSE", thinking: "想一下" }
    ]);

    const preview = await loadSessionPreview(session("agy", "conv-1"), previewHomes);
    assert.equal(preview.warning, undefined);
    assert.deepEqual(
      preview.messages.map((message) => [message.role, message.text, message.thinking || ""]),
      [
        ["user", "第一问", ""],
        ["assistant", "完整回答", "想一下"]
      ]
    );
    assert.ok(!JSON.stringify(preview.messages).includes("truncated"), "the truncation marker must not reach the preview");
    assert.ok(!JSON.stringify(preview.messages).includes("工具输出"), "non-turn rows must be dropped");
  });
});

test("agy preview reports an empty session when the transcript holds no turns", async () => {
  await withRoot(async (root, previewHomes) => {
    const logs = path.join(root, "agy", "brain", "conv-1", ".system_generated", "logs");
    await writeJsonl(path.join(logs, "transcript.jsonl"), [
      { step_index: 0, type: "CONVERSATION_HISTORY", content: "{}" }
    ]);

    const preview = await loadSessionPreview(session("agy", "conv-1"), previewHomes);
    assert.equal(preview.warning, undefined);
    assert.deepEqual(preview.messages, []);
  });
});

test("agy preview falls back to the history index when no transcript survived", async () => {
  await withRoot(async (root, previewHomes) => {
    await writeJsonl(path.join(root, "agy", "history.jsonl"), [
      { conversationId: "conv-1", display: "早先的提示" },
      { conversationId: "conv-2", display: "别的会话" }
    ]);

    const preview = await loadSessionPreview(session("agy", "conv-1"), previewHomes);
    assert.deepEqual(preview.messages.map((message) => [message.role, message.text]), [["user", "早先的提示"]]);
    assert.match(preview.warning, /limited history metadata/);
  });
});

test("agy preview throws only when the session is unknown to both the transcript and the index", async () => {
  await withRoot(async (root, previewHomes) => {
    await fs.mkdir(path.join(root, "agy"), { recursive: true });
    await assert.rejects(
      () => loadSessionPreview(session("agy", "conv-missing"), previewHomes),
      /Antigravity transcript not available/
    );
  });
});

// --------------------------------------------------- empty session vs missing

test("claude preview reports a matched but turn-less project file as empty, and an unknown session as missing", async () => {
  await withRoot(async (root, previewHomes) => {
    await writeJsonl(path.join(root, "claude", "projects", "-project", "empty-1.jsonl"), [
      { type: "summary", summary: "no turns" }
    ]);
    await writeJsonl(path.join(root, "claude", "projects", "-project", "other.jsonl"), [
      { type: "user", sessionId: "other", message: { role: "user", content: "hi" } }
    ]);

    const empty = await loadSessionPreview(session("claude", "empty-1"), previewHomes);
    assert.equal(empty.warning, undefined);
    assert.deepEqual(empty.messages, []);

    await assert.rejects(
      () => loadSessionPreview(session("claude", "unknown-1"), previewHomes),
      /Claude transcript not found/
    );
  });
});

test("pi preview reports a session file without turns as empty, and an unknown session as missing", async () => {
  await withRoot(async (root, previewHomes) => {
    await writeJsonl(path.join(root, "pi", "sessions", "-project", "empty-1.jsonl"), [
      { type: "session", id: "empty-1" },
      { type: "model_change", model: "x" }
    ]);
    await writeJsonl(path.join(root, "pi", "sessions", "-project", "other.jsonl"), [
      { type: "session", id: "other" },
      { type: "message", message: { role: "user", content: "hi" } }
    ]);

    const empty = await loadSessionPreview(session("pi", "empty-1"), previewHomes);
    assert.equal(empty.warning, undefined);
    assert.deepEqual(empty.messages, []);

    await assert.rejects(
      () => loadSessionPreview(session("pi", "unknown-1"), previewHomes),
      /Session transcript not found/
    );
  });
});

test("omp preview uses the same empty-vs-missing rule as pi", async () => {
  await withRoot(async (root, previewHomes) => {
    await writeJsonl(path.join(root, "omp", "sessions", "-project", "empty-1.jsonl"), [
      { type: "session", id: "empty-1" }
    ]);

    const empty = await loadSessionPreview(session("omp", "empty-1"), previewHomes);
    assert.deepEqual(empty.messages, []);
    assert.equal(empty.warning, undefined);
    await assert.rejects(
      () => loadSessionPreview(session("omp", "unknown-1"), previewHomes),
      /Session transcript not found/
    );
  });
});

test("codex preview reports a turn-less rollout as empty, and an unknown session as missing", async () => {
  await withRoot(async (root, previewHomes) => {
    await writeJsonl(path.join(root, "codex", "sessions", "2026", "rollout-2026-01-01T00-00-00-empty-1.jsonl"), [
      { timestamp: "2026-01-01T00:00:00Z", type: "session_meta", payload: { id: "empty-1", type: "session_meta" } }
    ]);

    const empty = await loadSessionPreview(session("codex", "empty-1"), previewHomes);
    assert.equal(empty.warning, undefined);
    assert.deepEqual(empty.messages, []);

    await assert.rejects(
      () => loadSessionPreview(session("codex", "unknown-1"), previewHomes),
      /Codex rollout transcript not found/
    );
  });
});

test("cursor preview reports a turn-less transcript as empty, and an unknown session as missing", async () => {
  await withRoot(async (root, previewHomes) => {
    const transcript = path.join(root, "cursor", "projects", "p1", "agent-transcripts", "empty-1", "empty-1.jsonl");
    await writeJsonl(transcript, [{ kind: "meta" }]);

    const empty = await loadSessionPreview(session("cursor", "empty-1"), previewHomes);
    assert.equal(empty.warning, undefined);
    assert.deepEqual(empty.messages, []);

    await assert.rejects(
      () => loadSessionPreview(session("cursor", "unknown-1"), previewHomes),
      /Cursor CLI transcript not found/
    );
  });
});

test("grok preview reports a turn-less chat history as empty, and an unknown session as missing", async () => {
  await withRoot(async (root, previewHomes) => {
    await writeJsonl(path.join(root, "grok", "sessions", "empty-1", "chat_history.jsonl"), [{ kind: "meta" }]);

    const empty = await loadSessionPreview(session("grok", "empty-1"), previewHomes);
    assert.equal(empty.warning, undefined);
    assert.deepEqual(empty.messages, []);

    await assert.rejects(
      () => loadSessionPreview(session("grok", "unknown-1"), previewHomes),
      /Grok chat_history.jsonl not found/
    );
  });
});

test("opencode preview tells an empty session apart from one the database never saw", async () => {
  await withRoot(async (root, previewHomes) => {
    const dbPath = path.join(root, "opencode", "opencode.db");
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    sqlite(dbPath, `
      create table session (id text primary key, title text);
      create table message (id text, session_id text, time_created integer, data text);
      create table part (message_id text, session_id text, time_created integer, data text);
      insert into session (id, title) values ('empty-1', 'New session');
    `);

    const empty = await loadSessionPreview(session("opencode", "empty-1"), previewHomes);
    assert.equal(empty.warning, undefined);
    assert.deepEqual(empty.messages, []);

    await assert.rejects(
      () => loadSessionPreview(session("opencode", "unknown-1"), previewHomes),
      /OpenCode transcript not found/
    );
  });
});

test("cursor-ide preview degrades to a stated limitation instead of an unsupported-provider error", async () => {
  await withRoot(async (root, previewHomes) => {
    const preview = await loadSessionPreview(session("cursor-ide", "composer-1", "Cursor Chat"), previewHomes);
    assert.equal(preview.title, "Cursor Chat");
    assert.deepEqual(preview.messages, []);
    assert.match(preview.warning, /Cursor IDE stores conversation bodies/);
  });
});

// ------------------------------------------------------------------- Thunder

test("thunder preview maps a conversation onto turns, dropping plumbing and merging a run's answers", () => {
  const preview = previewThunderConversation({
    id: "sess_1",
    title: "Thunder chat",
    status: "active",
    created_at_ms: 1,
    updated_at_ms: 2,
    messages: [
      { role: "system", content: "engine plumbing" },
      { role: "user", content: "改一下端口" },
      { role: "assistant", content: "先看看配置", reasoning: "读文件" },
      { role: "tool", content: "tool output" },
      { role: "assistant", content: "改好了" },
      { role: "assistant", content: "" }
    ]
  });

  assert.deepEqual(
    preview.messages.map((message) => [message.role, message.text, message.thinking || ""]),
    [
      ["user", "改一下端口", ""],
      ["assistant", "先看看配置\n\n改好了", "读文件"]
    ]
  );
  assert.equal(preview.warning, undefined);
  assert.equal(preview.title, "Thunder chat");
});

test("thunder preview reports a conversation without turns as empty and honours the message cap", () => {
  assert.deepEqual(previewThunderConversation({ id: "sess_1", status: "active", created_at_ms: 1, updated_at_ms: 2, messages: [] }).messages, []);

  const messages = [];
  for (let index = 0; index < 6; index++) {
    messages.push({ role: "user", content: `prompt ${index}` });
    messages.push({ role: "assistant", content: `answer ${index}` });
  }
  const capped = previewThunderConversation({ id: "sess_2", status: "active", created_at_ms: 1, updated_at_ms: 2, messages }, { maxMessages: 2 });
  assert.equal(capped.truncated, true);
  assert.deepEqual(capped.messages.map((message) => message.text), ["prompt 5", "answer 5"]);
});
