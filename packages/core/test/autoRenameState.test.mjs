import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AUTO_RENAME_CLAIM_TTL_MS,
  claimSessionAutoRename,
  ensureExtensionCatalogSchema,
  listBackgroundAutoRenameCandidates,
  markSessionAutoRenameDone,
  markSessionAutoRenameFailed,
  markSessionAutoRenameSkipped,
  runSqlite,
  setUserTitleIfUnsetInCatalog
} from "../dist/index.js";

async function seedSession(dbPath, overrides = {}) {
  const row = {
    provider: "codex",
    agent_session_id: "sess-1",
    title: "Initial prompt",
    project_path: "/tmp/project",
    updated_at_ms: 1_700_000_000_000,
    archived: 0,
    message_count: 4,
    source: null,
    user_title: null,
    hidden: 0,
    ...overrides
  };

  await runSqlite(
    dbPath,
    `INSERT INTO sessions (
       provider, agent_session_id, title, project_path, updated_at_ms, archived,
       message_count, source, user_title, hidden
     ) VALUES (
       '${row.provider}',
       '${row.agent_session_id}',
       '${row.title}',
       '${row.project_path}',
       ${row.updated_at_ms},
       ${row.archived},
       ${row.message_count},
       ${row.source === null ? "NULL" : `'${row.source}'`},
       ${row.user_title === null ? "NULL" : `'${row.user_title}'`},
       ${row.hidden}
     );`
  );
}

test("listBackgroundAutoRenameCandidates filters by time window, message count, and exclusions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-rename-candidates-"));
  const dbPath = path.join(dir, "catalog.db");
  await ensureExtensionCatalogSchema(dbPath);

  const nowMs = 1_700_100_000_000;
  const sinceMs = nowMs - 24 * 60 * 60 * 1000;

  await seedSession(dbPath, { agent_session_id: "eligible", updated_at_ms: nowMs - 1000, message_count: 4 });
  await seedSession(dbPath, { agent_session_id: "too-old", updated_at_ms: sinceMs - 1, message_count: 4 });
  await seedSession(dbPath, { agent_session_id: "too-few-msgs", updated_at_ms: nowMs - 500, message_count: 1 });
  await seedSession(dbPath, { agent_session_id: "archived", updated_at_ms: nowMs - 500, archived: 1 });
  await seedSession(dbPath, { agent_session_id: "hidden", updated_at_ms: nowMs - 500, hidden: 1 });
  await seedSession(dbPath, { agent_session_id: "subagent", updated_at_ms: nowMs - 500, source: "subagent-worker" });
  await seedSession(dbPath, { provider: "chat", agent_session_id: "acp-chat", updated_at_ms: nowMs - 500 });
  await seedSession(dbPath, { agent_session_id: "already-named", updated_at_ms: nowMs - 500, user_title: "Custom" });

  const candidates = await listBackgroundAutoRenameCandidates(dbPath, {
    sinceMs,
    minMessages: 2,
    limit: 10,
    nowMs
  });

  assert.deepEqual(
    candidates.map((s) => s.id),
    ["eligible"]
  );

  await fs.rm(dir, { recursive: true, force: true });
});

test("claimSessionAutoRename prevents duplicate claims, respects user_title, and reclaims stale claims", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-rename-claim-"));
  const dbPath = path.join(dir, "catalog.db");
  await ensureExtensionCatalogSchema(dbPath);

  const nowMs = 1_700_100_000_000;
  await seedSession(dbPath, { agent_session_id: "s1", updated_at_ms: nowMs });
  await seedSession(dbPath, { agent_session_id: "s2-named", updated_at_ms: nowMs, user_title: "Manual" });

  assert.equal(await claimSessionAutoRename(dbPath, "codex", "s2-named", nowMs), false);
  assert.equal(await claimSessionAutoRename(dbPath, "codex", "missing", nowMs), false);

  assert.equal(await claimSessionAutoRename(dbPath, "codex", "s1", nowMs), true);
  assert.equal(await claimSessionAutoRename(dbPath, "codex", "s1", nowMs + 1000), false);

  // While active claim holds, s1 should not be listed as a candidate
  const duringClaim = await listBackgroundAutoRenameCandidates(dbPath, {
    sinceMs: nowMs - 10_000,
    minMessages: 2,
    limit: 10,
    nowMs: nowMs + 1000
  });
  assert.equal(duringClaim.length, 0);

  // After TTL expires, s1 becomes eligible and reclaimable
  const afterTtl = nowMs + AUTO_RENAME_CLAIM_TTL_MS + 1;
  const staleCandidates = await listBackgroundAutoRenameCandidates(dbPath, {
    sinceMs: nowMs - 10_000,
    minMessages: 2,
    limit: 10,
    nowMs: afterTtl
  });
  assert.deepEqual(staleCandidates.map((s) => s.id), ["s1"]);
  assert.equal(await claimSessionAutoRename(dbPath, "codex", "s1", afterTtl), true);

  await fs.rm(dir, { recursive: true, force: true });
});

test("failure retries up to max attempts then marks skipped; done and skipped stay excluded", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-rename-retry-"));
  const dbPath = path.join(dir, "catalog.db");
  await ensureExtensionCatalogSchema(dbPath);

  const nowMs = 1_700_100_000_000;
  await seedSession(dbPath, { agent_session_id: "flaky", updated_at_ms: nowMs });
  await seedSession(dbPath, { agent_session_id: "done-sess", updated_at_ms: nowMs });
  await seedSession(dbPath, { agent_session_id: "skip-sess", updated_at_ms: nowMs });

  // Attempt 1 fails -> remains retryable
  assert.equal(await claimSessionAutoRename(dbPath, "codex", "flaky", nowMs), true);
  await markSessionAutoRenameFailed(dbPath, "codex", "flaky", "network timeout", nowMs + 100);
  let candidates = await listBackgroundAutoRenameCandidates(dbPath, {
    sinceMs: nowMs - 10_000,
    minMessages: 2,
    limit: 10,
    nowMs: nowMs + 200
  });
  assert.equal(candidates.some((s) => s.id === "flaky"), true);

  // Attempt 2 fails -> reaches max attempts (2) and becomes skipped
  assert.equal(await claimSessionAutoRename(dbPath, "codex", "flaky", nowMs + 300), true);
  await markSessionAutoRenameFailed(dbPath, "codex", "flaky", "still failing", nowMs + 400);
  assert.equal(await claimSessionAutoRename(dbPath, "codex", "flaky", nowMs + 500), false);

  await markSessionAutoRenameDone(dbPath, "codex", "done-sess", nowMs);
  await markSessionAutoRenameSkipped(dbPath, "codex", "skip-sess", "insufficient-messages", nowMs);
  assert.equal(await claimSessionAutoRename(dbPath, "codex", "done-sess", nowMs + 500), false);
  assert.equal(await claimSessionAutoRename(dbPath, "codex", "skip-sess", nowMs + 500), false);

  candidates = await listBackgroundAutoRenameCandidates(dbPath, {
    sinceMs: nowMs - 10_000,
    minMessages: 2,
    limit: 10,
    nowMs: nowMs + 500
  });
  assert.equal(candidates.length, 0);

  await fs.rm(dir, { recursive: true, force: true });
});

test("setUserTitleIfUnsetInCatalog writes only when user_title is empty", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-rename-title-"));
  const dbPath = path.join(dir, "catalog.db");
  await ensureExtensionCatalogSchema(dbPath);

  await seedSession(dbPath, { agent_session_id: "s1", user_title: null });
  await seedSession(dbPath, { agent_session_id: "s2", user_title: "   " });
  await seedSession(dbPath, { agent_session_id: "s3", user_title: "Already Renamed" });

  assert.equal(await setUserTitleIfUnsetInCatalog(dbPath, "codex", "s1", "Auto Title 1"), true);
  assert.equal(await setUserTitleIfUnsetInCatalog(dbPath, "codex", "s1", "Second Title"), false);
  assert.equal(await setUserTitleIfUnsetInCatalog(dbPath, "codex", "s2", "Auto Title 2"), true);
  assert.equal(await setUserTitleIfUnsetInCatalog(dbPath, "codex", "s3", "Overwrite Attempt"), false);

  const candidates = await listBackgroundAutoRenameCandidates(dbPath, {
    sinceMs: 0,
    minMessages: 2,
    limit: 10
  });
  assert.equal(candidates.length, 0);

  await fs.rm(dir, { recursive: true, force: true });
});
