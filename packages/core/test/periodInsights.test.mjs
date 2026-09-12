import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
  getPeriodInsights,
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
  assert.equal(insights.llmUsage.totalCalls, 0);

  await fs.rm(panelHome, { recursive: true, force: true });
});

test("getPeriodInsights computes sessions and usage", async () => {
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
     ('pi', 's1', 'Fix bug in auth', '/Users/test/repo1', 1500000, 20, 'Shipped the auth fix and verified the flow.'),
     ('claude', 's2', 'Setup database schema', '/Users/test/repo1', 1600000, 2, 'Schema drafted; migrations still to run.'),
     ('pi', 's3', 'Integrate payments', '/Users/test/repo2', 1700000, 10, 'Blocked on payment provider credentials.');`
  );

  // Insert LLM usage into desktopDb
  await runSqlite(
    desktopDb,
    `INSERT INTO llm_usage_events (id, created_at_ms, kind, source, model, prompt_tokens, completion_tokens, total_tokens, duration_ms, ok)
     VALUES
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
  assert.equal(insights.sessionStats.deepTurnCount, 1); // s1 had 20 turns
  assert.equal(insights.sessionStats.quickTurnCount, 1); // s2 had 2 turns
  assert.equal(insights.sessionStats.byProvider.pi, 2);
  assert.equal(insights.sessionStats.byProvider.claude, 1);
  assert.equal(insights.sessionStats.byProject.length, 2);
  assert.equal(insights.sessionStats.byProject[0].projectName, "repo1");
  assert.equal(insights.sessionStats.byProject[0].count, 2);

  assert.equal(insights.llmUsage.totalCalls, 1);
  assert.equal(insights.llmUsage.totalTokens, 300);
  assert.equal(insights.llmUsage.promptTokens, 200);
  assert.equal(insights.llmUsage.completionTokens, 100);
  assert.equal(insights.llmUsage.topModels[0].model, "gpt-5.5");
  assert.equal(insights.llmUsage.topModels[0].count, 1);

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
