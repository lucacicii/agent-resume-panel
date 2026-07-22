import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  chunkTranscriptText,
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
  rankSessionsByTranscriptChunks,
  runSqlite,
  searchSessionsByTranscriptEmbedding
} from "../dist/index.js";

test("chunkTranscriptText splits long transcripts deterministically", () => {
  const long = Array.from({ length: 30 }, (_, i) => `User: turn ${i}\n\nAssistant: reply ${i} with some detail about auth OAuth tokens.`).join(
    "\n\n"
  );
  const chunks = chunkTranscriptText(long);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.length <= 40);
  assert.equal(chunks[0].chunkIndex, 0);
  assert.ok(chunks[0].contentHash);
  const again = chunkTranscriptText(long);
  assert.deepEqual(
    chunks.map((c) => c.contentHash),
    again.map((c) => c.contentHash)
  );
});

test("rankSessionsByTranscriptChunks ranks by max cosine score (fixture vectors)", () => {
  const query = [1, 0, 0];
  const ranked = rankSessionsByTranscriptChunks(
    query,
    [
      { provider: "codex", sessionId: "a", content: "oauth login", vector: [0.9, 0.1, 0], chunkIndex: 0 },
      { provider: "codex", sessionId: "a", content: "noise", vector: [0.1, 0.9, 0], chunkIndex: 1 },
      { provider: "claude", sessionId: "b", content: "ui polish", vector: [0, 1, 0], chunkIndex: 0 },
      { provider: "codex", sessionId: "c", content: "also auth", vector: [0.8, 0.2, 0], chunkIndex: 0 }
    ],
    { minScore: 0.2, limit: 10 }
  );
  assert.equal(ranked[0].sessionId, "a");
  assert.ok(ranked[0].score > 0.8);
  assert.equal(ranked[0].bestChunkContent, "oauth login");
  assert.ok(ranked.some((r) => r.sessionId === "c"));
  assert.ok(!ranked.some((r) => r.sessionId === "b") || ranked.find((r) => r.sessionId === "b").score < 0.2);
});

test("searchSessionsByTranscriptEmbedding joins catalog with fixture chunk rows", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-tx-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const desktopDb = path.join(panelHome, ".desktop", "desktop.db");
  await ensureExtensionCatalogSchema(catalogDb);
  await ensureDesktopDbSchema(desktopDb);
  const now = Date.now();
  await runSqlite(
    catalogDb,
    `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden, session_summary)
     VALUES
       ('codex', 'tx1', 'Auth session', '/tmp/app', ${now}, 0, 0, 'summary'),
       ('codex', 'tx2', 'UI session', '/tmp/ui', ${now}, 0, 0, 'ui');`
  );
  await runSqlite(
    desktopDb,
    `INSERT INTO session_transcript_chunks (
       chunk_id, provider, agent_session_id, chunk_index, content, content_hash,
       embedding_json, embedding_key, source_hash, updated_at_ms
     ) VALUES
       ('c1', 'codex', 'tx1', 0, 'User talked about OAuth login tokens', 'h1', '[1,0,0]', 'k', 's1', ${now}),
       ('c2', 'codex', 'tx2', 0, 'Button spacing only', 'h2', '[0,1,0]', 'k', 's2', ${now});`
  );

  const hits = await searchSessionsByTranscriptEmbedding({
    catalogDb,
    desktopDb,
    settings: {},
    query: "oauth",
    queryVector: [1, 0, 0],
    minScore: 0.1,
    limit: 5
  });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].sessionId, "tx1");
  assert.equal(hits[0].match, "transcript");
  assert.ok(hits[0].summaryPreview?.toLowerCase().includes("oauth"));
});
