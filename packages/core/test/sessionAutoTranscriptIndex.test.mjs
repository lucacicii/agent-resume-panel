import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSessionTranscriptIndexSettings,
  selectTranscriptIndexCandidates
} from "../dist/index.js";

test("resolveSessionTranscriptIndexSettings defaults and clamps", () => {
  const a = resolveSessionTranscriptIndexSettings({});
  assert.equal(a.enabled, true);
  assert.equal(a.quietDelayMinutes, 15);
  assert.equal(a.maxPerTick, 3);
  assert.equal(a.concurrency, 1);

  const b = resolveSessionTranscriptIndexSettings({
    sessionTranscriptIndex: {
      enabled: false,
      quietDelayMinutes: -1,
      maxPerTick: 99,
      concurrency: 0
    }
  });
  assert.equal(b.enabled, false);
  assert.equal(b.quietDelayMinutes, 0);
  assert.equal(b.maxPerTick, 20);
  assert.equal(b.concurrency, 1);
});

test("selectTranscriptIndexCandidates ignores chat and quiet delay; prefers missing index without requiring summary", () => {
  const auto = resolveSessionTranscriptIndexSettings({
    sessionTranscriptIndex: { quietDelayMinutes: 15, maxPerTick: 5 }
  });
  const now = 1_000_000_000;
  const sessions = [
    {
      provider: "chat",
      id: "acp",
      title: "acp",
      projectPath: "/t",
      updatedAt: now - 60 * 60_000
      // no summary
    },
    {
      provider: "codex",
      id: "active",
      title: "active",
      projectPath: "/t",
      updatedAt: now - 5 * 60_000
      // no summary — still eligible only after quiet delay
    },
    {
      provider: "codex",
      id: "old-no-summary",
      title: "old",
      projectPath: "/t",
      updatedAt: now - 2 * 60 * 60_000
      // no summary — should be selected
    },
    {
      provider: "grok",
      id: "indexed-fresh",
      title: "idx",
      projectPath: "/t",
      updatedAt: now - 2 * 60 * 60_000,
      sessionSummary: "has summary but irrelevant"
    }
  ];
  const indexMeta = new Map([
    [
      "grok:indexed-fresh",
      {
        provider: "grok",
        agent_session_id: "indexed-fresh",
        source_hash: "h",
        embedding_key: "k",
        chunk_count: 2,
        updated_at_ms: now // index newer than session update → not maybeStale
      }
    ]
  ]);

  const picked = selectTranscriptIndexCandidates(sessions, indexMeta, now, auto);
  assert.ok(picked.some((s) => s.id === "old-no-summary"), "missing summary still eligible");
  assert.ok(!picked.some((s) => s.id === "acp"), "chat skipped");
  assert.ok(!picked.some((s) => s.id === "active"), "within quiet delay skipped");
  assert.ok(!picked.some((s) => s.id === "indexed-fresh"), "already indexed and not stale");
});

test("selectTranscriptIndexCandidates re-queues when session updated after index", () => {
  const auto = resolveSessionTranscriptIndexSettings({
    sessionTranscriptIndex: { quietDelayMinutes: 0, maxPerTick: 5 }
  });
  const now = Date.now();
  const sessions = [
    {
      provider: "codex",
      id: "s1",
      title: "s1",
      projectPath: "/t",
      updatedAt: now - 1000
    }
  ];
  const indexMeta = new Map([
    [
      "codex:s1",
      {
        provider: "codex",
        agent_session_id: "s1",
        source_hash: "old",
        embedding_key: "k",
        chunk_count: 1,
        updated_at_ms: now - 60_000
      }
    ]
  ]);
  const picked = selectTranscriptIndexCandidates(sessions, indexMeta, now, auto);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].id, "s1");
});
