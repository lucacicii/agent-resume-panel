import assert from "node:assert/strict";
import test from "node:test";
import {
  isEligibleForAutoSummary,
  resolveSessionSummaryAutoSettings,
  selectAutoSummaryCandidates
} from "../dist/index.js";

test("resolveSessionSummaryAutoSettings applies defaults and clamps", () => {
  const a = resolveSessionSummaryAutoSettings({});
  assert.equal(a.enabled, true);
  assert.equal(a.staleDelayMinutes, 30);
  assert.equal(a.missingDelayMinutes, 0);
  assert.equal(a.concurrency, 1);
  assert.equal(a.maxPerTick, 5);

  const b = resolveSessionSummaryAutoSettings({
    sessionSummaryAuto: {
      enabled: false,
      staleDelayMinutes: 9999,
      missingDelayMinutes: -3,
      concurrency: 99,
      maxPerTick: 0
    }
  });
  assert.equal(b.enabled, false);
  assert.equal(b.staleDelayMinutes, 1440);
  assert.equal(b.missingDelayMinutes, 0);
  assert.equal(b.concurrency, 3);
  assert.equal(b.maxPerTick, 1);
});

test("isEligibleForAutoSummary respects missing and stale delays", () => {
  const auto = resolveSessionSummaryAutoSettings({
    sessionSummaryAuto: { missingDelayMinutes: 60, staleDelayMinutes: 30 }
  });
  const now = 1_000_000;

  const missingTooSoon = {
    provider: "codex",
    id: "m1",
    title: "m",
    projectPath: "/t",
    updatedAt: now - 10 * 60_000
  };
  assert.equal(isEligibleForAutoSummary(missingTooSoon, now, auto).eligible, false);

  const missingReady = {
    ...missingTooSoon,
    id: "m2",
    updatedAt: now - 90 * 60_000
  };
  const miss = isEligibleForAutoSummary(missingReady, now, auto);
  assert.equal(miss.eligible, true);
  assert.equal(miss.reason, "missing");

  const staleTooSoon = {
    provider: "codex",
    id: "s1",
    title: "s",
    projectPath: "/t",
    updatedAt: now - 10 * 60_000,
    sessionSummary: "old",
    sessionSummaryAtMs: now - 60 * 60_000
  };
  assert.equal(isEligibleForAutoSummary(staleTooSoon, now, auto).eligible, false);

  const staleReady = {
    ...staleTooSoon,
    id: "s2",
    updatedAt: now - 40 * 60_000
  };
  const st = isEligibleForAutoSummary(staleReady, now, auto);
  assert.equal(st.eligible, true);
  assert.equal(st.reason, "stale");

  const fresh = {
    provider: "codex",
    id: "ok",
    title: "ok",
    projectPath: "/t",
    updatedAt: now - 10_000,
    sessionSummary: "ok",
    sessionSummaryAtMs: now
  };
  assert.equal(isEligibleForAutoSummary(fresh, now, auto).eligible, false);
});

test("selectAutoSummaryCandidates prefers missing and respects maxPerTick", () => {
  const auto = resolveSessionSummaryAutoSettings({
    sessionSummaryAuto: { missingDelayMinutes: 0, staleDelayMinutes: 0, maxPerTick: 2 }
  });
  const now = Date.now();
  const sessions = [
    {
      provider: "codex",
      id: "stale",
      title: "stale",
      projectPath: "/a",
      updatedAt: now - 1000,
      sessionSummary: "x",
      sessionSummaryAtMs: now - 5000
    },
    {
      provider: "codex",
      id: "miss1",
      title: "miss1",
      projectPath: "/a",
      updatedAt: now - 2000
    },
    {
      provider: "claude",
      id: "miss2",
      title: "miss2",
      projectPath: "/a",
      updatedAt: now - 3000
    }
  ];
  const picked = selectAutoSummaryCandidates(sessions, now, auto);
  assert.equal(picked.length, 2);
  assert.equal(picked[0].reason, "missing");
  assert.equal(picked[1].reason, "missing");
});
