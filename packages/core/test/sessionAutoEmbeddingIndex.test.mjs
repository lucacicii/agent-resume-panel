import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSessionEmbeddingIndexSettings,
  selectSessionEmbeddingCandidates
} from "../dist/index.js";

test("resolveSessionEmbeddingIndexSettings defaults and clamps", () => {
  const a = resolveSessionEmbeddingIndexSettings({});
  assert.equal(a.enabled, true);
  assert.equal(a.quietDelayMinutes, 0);
  assert.equal(a.maxPerTick, 5);
  assert.equal(a.concurrency, 2);

  const b = resolveSessionEmbeddingIndexSettings({
    sessionEmbeddingIndex: {
      enabled: false,
      quietDelayMinutes: 9999,
      maxPerTick: 0,
      concurrency: 99
    }
  });
  assert.equal(b.enabled, false);
  assert.equal(b.quietDelayMinutes, 1440);
  assert.equal(b.maxPerTick, 1);
  assert.equal(b.concurrency, 4);
});

test("selectSessionEmbeddingCandidates requires quiet delay and prefers missing", () => {
  const auto = resolveSessionEmbeddingIndexSettings({
    sessionEmbeddingIndex: { quietDelayMinutes: 10, maxPerTick: 5 }
  });
  const now = 1_000_000;
  const rows = [
    {
      provider: "codex",
      sessionId: "fresh",
      title: "fresh",
      summary: "has summary",
      summaryAtMs: now - 2 * 60_000,
      updatedAtMs: now - 2 * 60_000,
      reason: "missing"
    },
    {
      provider: "codex",
      sessionId: "old-missing",
      title: "old",
      summary: "summary text",
      summaryAtMs: now - 60 * 60_000,
      updatedAtMs: now - 60 * 60_000,
      reason: "missing"
    },
    {
      provider: "grok",
      sessionId: "key-mismatch",
      title: "k",
      summary: "s",
      summaryAtMs: now - 60 * 60_000,
      updatedAtMs: now - 60 * 60_000,
      reason: "key_mismatch"
    }
  ];
  const picked = selectSessionEmbeddingCandidates(rows, now, auto);
  assert.ok(!picked.some((r) => r.sessionId === "fresh"), "within quiet delay skipped");
  assert.ok(picked.some((r) => r.sessionId === "old-missing"));
  assert.equal(picked[0].reason, "missing");
  assert.ok(picked.some((r) => r.sessionId === "key-mismatch"));
});
