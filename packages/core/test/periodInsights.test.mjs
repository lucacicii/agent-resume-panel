import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
  getPeriodInsights,
  setSessionDeliveryStatusInCatalog,
  runSqlite
} from "../dist/index.js";

test("getPeriodInsights handles empty databases and out-of-range queries cleanly", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-insights-empty-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const desktopDb = path.join(panelHome, ".desktop", "desktop.db");

  await ensureExtensionCatalogSchema(catalogDb);
  await ensureDesktopDbSchema(desktopDb);

  const insights = await getPeriodInsights({
    catalogDb,
    desktopDb,
    fromMs: 1000,
    toMs: 2000
  });

  assert.equal(insights.sessionStats.total, 0);
  assert.equal(insights.sessionStats.completed, 0);
  assert.equal(insights.sessionStats.blocked, 0);
  assert.equal(insights.blockedSessions.length, 0);
  assert.equal(insights.tagStats.totalTags, 0);
  assert.equal(insights.llmUsage.totalCalls, 0);

  await fs.rm(panelHome, { recursive: true, force: true });
});

test("getPeriodInsights computes sessions, delivery states, tags, and usage", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-insights-populated-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const desktopDb = path.join(panelHome, ".desktop", "desktop.db");

  await ensureExtensionCatalogSchema(catalogDb);
  await ensureDesktopDbSchema(desktopDb);

  const t0 = 1000000;
  const t1 = 2000000;

  // Insert test sessions into catalogDb
  await runSqlite(
    catalogDb,
    `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, message_count, session_summary)
     VALUES
     ('pi', 's1', 'Fix bug in auth', '/Users/test/repo1', 1500000, 20, 'State: completed\nOutcome: All done'),
     ('claude', 's2', 'Setup database schema', '/Users/test/repo1', 1600000, 2, 'State: active\nNext action: run migrations'),
     ('pi', 's3', 'Integrate payments', '/Users/test/repo2', 1700000, 10, 'State: blocked\nOpen work: waiting for keys\nEvidence: API 403 Forbidden\nNext action: get api key');`
  );

  // Insert tags into desktopDb
  await runSqlite(
    desktopDb,
    `INSERT INTO entity_tags (id, entity_type, entity_id, tag, normalized_tag, category, weight, hit_count, consensus_count, status, source, created_at_ms, updated_at_ms, last_hit_at_ms, last_decay_at_ms)
     VALUES
     ('t1', 'session', 'pi:s1', 'Electron', 'electron', 'tech_stack', 3.5, 1, 1, 'active', 'auto', 1500000, 1500000, 1500000, 1500000),
     ('t2', 'session', 'pi:s1', 'Bug Fix', 'bug-fix', 'task_type', 2.0, 1, 1, 'active', 'auto', 1500000, 1500000, 1500000, 1500000),
     ('t3', 'session', 'pi:s3', 'Electron', 'electron', 'tech_stack', 4.0, 1, 1, 'active', 'auto', 1700000, 1700000, 1700000, 1700000);`
  );

  // Insert LLM usage into desktopDb
  await runSqlite(
    desktopDb,
    `INSERT INTO llm_usage_events (id, created_at_ms, kind, source, model, prompt_tokens, completion_tokens, total_tokens, duration_ms, ok)
     VALUES
     ('u1', 1500000, 'chat', 'auto_tag', 'gpt-5.5', 100, 50, 150, 1200, 1),
     ('u2', 1600000, 'chat', 'summarize', 'gpt-5.5', 200, 100, 300, 2000, 1);`
  );

  // Insert workbench composer sends into desktopDb
  await runSqlite(
    desktopDb,
    `INSERT INTO workbench_composer_sends (id, created_at_ms, pane_key, project_path, provider, agent_session_id, text)
     VALUES
     ('cs1', 1500000, 'terminal:1', '/Users/test/repo1', 'pi', 's1', '添加用户管理组件'),
     ('cs2', 1510000, 'terminal:1', '/Users/test/repo1', 'pi', 's1', 'commit(中文) and push'),
     ('cs3', 1700000, 'terminal:1', '/Users/test/repo2', 'pi', 's3', '还是不行，接口报错了');`
  );

  const insights = await getPeriodInsights({
    catalogDb,
    desktopDb,
    fromMs: t0,
    toMs: t1
  });

  // Check sessionStats
  assert.equal(insights.sessionStats.total, 3);
  assert.equal(insights.sessionStats.completed, 1);
  assert.equal(insights.sessionStats.active, 1);
  assert.equal(insights.sessionStats.blocked, 1);
  assert.equal(insights.sessionStats.deepTurnCount, 1); // s1 had 20 turns
  assert.equal(insights.sessionStats.quickTurnCount, 1); // s2 had 2 turns
  assert.equal(insights.sessionStats.byProvider.pi, 2);
  assert.equal(insights.sessionStats.byProvider.claude, 1);
  assert.equal(insights.sessionStats.byProject.length, 2);
  assert.equal(insights.sessionStats.byProject[0].projectName, "repo1");
  assert.equal(insights.sessionStats.byProject[0].count, 2);

  // Check blocked session details
  assert.equal(insights.blockedSessions.length, 1);
  assert.equal(insights.blockedSessions[0].id, "s3");
  assert.equal(insights.blockedSessions[0].blockerReason, "API 403 Forbidden");
  assert.equal(insights.blockedSessions[0].nextAction, "get api key");

  // Check active session details
  assert.equal(insights.activeSessions.length, 1);
  assert.equal(insights.activeSessions[0].id, "s2");
  assert.equal(insights.activeSessions[0].nextAction, "run migrations");

  // Check tags
  assert.equal(insights.tagStats.totalTags, 2);
  assert.equal(insights.tagStats.topTags[0].normalizedTag, "electron");
  assert.equal(insights.tagStats.topTags[0].sessionCount, 2); // s1 and s3
  assert.deepEqual(insights.tagStats.topTags[0].sessionIds.sort(), ["pi:s1", "pi:s3"]);
  assert.equal(insights.tagStats.byCategory.tech_stack.length, 1);
  assert.equal(insights.tagStats.byCategory.task_type.length, 1);

  // Check LLM usage
  assert.equal(insights.llmUsage.totalCalls, 2);
  assert.equal(insights.llmUsage.totalTokens, 450);
  assert.equal(insights.llmUsage.promptTokens, 300);
  assert.equal(insights.llmUsage.completionTokens, 150);
  assert.equal(insights.llmUsage.topModels[0].model, "gpt-5.5");
  assert.equal(insights.llmUsage.topModels[0].count, 2);

  // Check dailyTrend
  assert.ok(Array.isArray(insights.dailyTrend));
  assert.ok(insights.dailyTrend.length > 0);

  // Check composerInsights
  assert.ok(insights.composerInsights);
  assert.equal(insights.composerInsights.totalSends, 3);
  assert.equal(insights.composerInsights.intentDistribution.feature, 1);
  assert.equal(insights.composerInsights.intentDistribution.flowControl, 1);
  assert.equal(insights.composerInsights.smoothness.frictionSends, 1);
  assert.equal(insights.composerInsights.frictionSessions.length, 1);
  assert.equal(insights.composerInsights.frictionSessions[0].id, "s3");

  await fs.rm(panelHome, { recursive: true, force: true });
});

test("setSessionDeliveryStatusInCatalog updates state and preserves other fields", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-set-status-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  await ensureExtensionCatalogSchema(catalogDb);

  await runSqlite(
    catalogDb,
    `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, session_summary)
     VALUES ('pi', 's_mut', 'Test session', '/Users/test/app', 1000, 'State: active\nOutcome: working\nNext action: finish test');`
  );

  const res = await setSessionDeliveryStatusInCatalog(catalogDb, "pi", "s_mut", "completed");
  assert.match(res.summary, /^State: completed/);
  assert.match(res.summary, /Outcome: working/);
  assert.match(res.summary, /Next action: finish test/);

  // Switch to blocked
  const resBlocked = await setSessionDeliveryStatusInCatalog(catalogDb, "pi", "s_mut", "blocked");
  assert.match(resBlocked.summary, /^State: blocked/);
  assert.match(resBlocked.summary, /Outcome: working/);

  await fs.rm(panelHome, { recursive: true, force: true });
});
