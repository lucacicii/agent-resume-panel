import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureDesktopDbSchema,
  insertReportEntry,
  listReportEntriesForSessions
} from "../dist/index.js";

test("listReportEntriesForSessions: reverse lookup from sessions to reports", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-report-store-"));
  const dbPath = path.join(tmpDir, "desktop.db");

  try {
    await ensureDesktopDbSchema(dbPath);

    // Initial query on empty table
    const emptyResult = await listReportEntriesForSessions(dbPath, ["codex:sess-1"]);
    assert.deepEqual(emptyResult, []);

    // Empty session inputs
    assert.deepEqual(await listReportEntriesForSessions(dbPath, []), []);

    // Insert two report entries with links
    await insertReportEntry(
      dbPath,
      {
        id: "weekly:2026-W37",
        level: "weekly",
        periodStartMs: 1789000000000,
        periodEndMs: 1789600000000,
        title: "Weekly · 2026-W37",
        content: "Weekly summary content mentioning various work items.",
        embeddingJson: null,
        createdAtMs: 1789605000000
      },
      [
        {
          provider: "codex",
          agentSessionId: "session-a",
          projectPath: "/projects/alpha"
        },
        {
          provider: "claude",
          agentSessionId: "session-b",
          projectPath: "/projects/beta"
        }
      ]
    );

    await insertReportEntry(
      dbPath,
      {
        id: "daily:2026-09-10",
        level: "daily",
        periodStartMs: 1788900000000,
        periodEndMs: 1788986400000,
        title: "Daily · 2026-09-10",
        content: "Daily summary content.",
        embeddingJson: null,
        createdAtMs: 1788990000000
      },
      [
        {
          provider: "codex",
          agentSessionId: "session-a",
          projectPath: "/projects/alpha"
        }
      ]
    );

    // Query for session-a (linked in both reports)
    const resA = await listReportEntriesForSessions(dbPath, ["codex:session-a"]);
    assert.equal(resA.length, 2);
    // Ordered by periodStartMs DESC
    assert.equal(resA[0].id, "weekly:2026-W37");
    assert.equal(resA[1].id, "daily:2026-09-10");

    // Query for session-b using object format
    const resB = await listReportEntriesForSessions(dbPath, [
      { provider: "claude", sessionId: "session-b" }
    ]);
    assert.equal(resB.length, 1);
    assert.equal(resB[0].id, "weekly:2026-W37");

    // Query for unlinked session
    const resUnlinked = await listReportEntriesForSessions(dbPath, ["codex:session-other"]);
    assert.deepEqual(resUnlinked, []);

    // Query with limit 1
    const resLimited = await listReportEntriesForSessions(dbPath, ["codex:session-a"], { limit: 1 });
    assert.equal(resLimited.length, 1);
    assert.equal(resLimited[0].id, "weekly:2026-W37");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
