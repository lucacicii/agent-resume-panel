import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DigestBudgetExceededError,
  assertDigestCallBudget,
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
  estimateDailyForSessions,
  insertReportEntry,
  listAllSessionsInRange,
  listReportLinks,
  localDayRangePeriod,
  localMonthRange,
  localWeekRange,
  needsDailyDigestRefresh,
  needsMonthlyDigestRefresh,
  needsWeeklyDigestRefresh,
  runSqlite
} from "../dist/index.js";

async function fixture(maxDigestLlmCalls = 100) {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-report-refresh-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const desktopDb = path.join(panelHome, ".desktop", "desktop.db");
  await fs.writeFile(path.join(panelHome, "settings.desktop.json"), JSON.stringify({
    panelHome,
    report: { maxDigestLlmCalls }
  }));
  await ensureExtensionCatalogSchema(catalogDb);
  await ensureDesktopDbSchema(desktopDb);
  return { panelHome, catalogDb, desktopDb };
}

async function seedDay(input) {
  const period = localDayRangePeriod(input.day);
  const values = Array.from({ length: input.count }, (_, index) =>
    `('codex','s-${index}','Session ${index}','/tmp/project',${period.startMs + Math.floor(index / 3) + 1},0,0)`
  ).join(",");
  await runSqlite(input.catalogDb, `INSERT INTO sessions
    (provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden)
    VALUES ${values};`);
  const included = Math.min(input.count, input.linkCount);
  await insertReportEntry(input.desktopDb, {
    id: `daily:${input.day}`,
    level: "daily",
    periodStartMs: period.startMs,
    periodEndMs: period.endMs,
    title: `Daily · ${input.day}`,
    content: "# Daily",
    embeddingJson: null,
    createdAtMs: period.endMs + 1
  }, Array.from({ length: included }, (_, offset) => {
    const index = input.count - 1 - offset;
    return { provider: "codex", agentSessionId: `s-${index}`, projectPath: "/tmp/project" };
  }));
  return period;
}

test("daily refresh reads all 54 report links instead of treating links after 50 as new", async () => {
  const env = await fixture();
  try {
    await seedDay({ ...env, day: "2026-07-27", count: 54, linkCount: 54 });
    const check = await needsDailyDigestRefresh({ panelHome: env.panelHome, date: "2026-07-27" });
    assert.equal(check.reason, "up_to_date");
    assert.equal(check.needed, false);
    assert.equal(check.linkedSessionCount, 54);
    assert.equal(check.newSessionCount, 0);
  } finally {
    await fs.rm(env.panelHome, { recursive: true, force: true });
  }
});

test("daily refresh treats every unlinked current session as actionable", async () => {
  const env = await fixture();
  try {
    await seedDay({ ...env, day: "2026-07-14", count: 45, linkCount: 40 });
    const check = await needsDailyDigestRefresh({ panelHome: env.panelHome, date: "2026-07-14" });
    assert.equal(check.reason, "new_sessions");
    assert.equal(check.needed, true);
    assert.equal(check.newSessionCount, 5);
    assert.equal(check.omittedSessionCount, 5);
  } finally {
    await fs.rm(env.panelHome, { recursive: true, force: true });
  }
});

test("range pagination and report links remain complete beyond 200 sessions", async () => {
  const env = await fixture();
  try {
    const period = await seedDay({ ...env, day: "2026-07-13", count: 1200, linkCount: 1200 });
    const sessions = await listAllSessionsInRange(env.catalogDb, period.startMs, period.endMs, 137);
    const links = await listReportLinks(env.desktopDb, "daily:2026-07-13");
    assert.equal(sessions.length, 1200);
    assert.equal(new Set(sessions.map((session) => `${session.provider}:${session.id}`)).size, 1200);
    assert.equal(links.length, 1200);

    const check = await needsDailyDigestRefresh({ panelHome: env.panelHome, date: "2026-07-13" });
    assert.equal(check.reason, "up_to_date");
    assert.equal(check.linkedSessionCount, 1200);
  } finally {
    await fs.rm(env.panelHome, { recursive: true, force: true });
  }
});

test("call budget blocks an unapproved large digest without dropping sessions", () => {
  const settings = {
    llm: { maxContextChars: 120000 },
    embedding: {},
    report: { maxDigestLlmCalls: 100 }
  };
  const sessions = Array.from({ length: 201 }, (_, index) => ({
    provider: "codex",
    id: `s-${index}`,
    title: `Session ${index}`,
    projectPath: "/tmp/project",
    updatedAt: index + 1
  }));
  const estimate = estimateDailyForSessions(settings, "2026-07-12", sessions);
  assert.equal(estimate.sessionCount, 201);
  assert.equal(estimate.summaryCallCount, 201);
  assert.equal(estimate.overBudget, true);
  assert.throws(() => assertDigestCallBudget(estimate), DigestBudgetExceededError);
  assert.doesNotThrow(() => assertDigestCallBudget(estimate, true));
});

test("weekly and monthly freshness inherit actionable stale daily sources", async () => {
  const env = await fixture();
  try {
    const day = "2026-07-14";
    await seedDay({ ...env, day, count: 2, linkCount: 1 });
    const week = localWeekRange(new Date(2026, 6, 14, 12));
    const month = localMonthRange("2026-07");
    const createdAtMs = month.endMs + 10;
    await insertReportEntry(env.desktopDb, {
      id: week.entryId,
      level: "weekly",
      periodStartMs: week.startMs,
      periodEndMs: week.endMs,
      title: week.label,
      content: "# Weekly",
      embeddingJson: null,
      createdAtMs
    }, []);
    await insertReportEntry(env.desktopDb, {
      id: month.entryId,
      level: "monthly",
      periodStartMs: month.startMs,
      periodEndMs: month.endMs,
      title: month.label,
      content: "# Monthly",
      embeddingJson: null,
      createdAtMs
    }, []);

    const weekly = await needsWeeklyDigestRefresh({ panelHome: env.panelHome, weekKey: week.label });
    const monthly = await needsMonthlyDigestRefresh({ panelHome: env.panelHome, monthKey: month.label });
    assert.equal(weekly.needed, true);
    assert.equal(weekly.reason, "new_sessions");
    assert.equal(monthly.needed, true);
    assert.equal(monthly.reason, "new_sessions");
  } finally {
    await fs.rm(env.panelHome, { recursive: true, force: true });
  }
});
