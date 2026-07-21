import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
  extractTouchedSessions,
  mergeSessionSearchHits,
  runSqlite,
  runSqliteJson,
  searchCatalogSessions,
  searchSessionsByEmbedding
} from "../dist/index.js";

async function setupCatalog() {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-session-search-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const desktopDb = path.join(panelHome, ".desktop", "desktop.db");
  await ensureExtensionCatalogSchema(catalogDb);
  await ensureDesktopDbSchema(desktopDb);
  return { panelHome, catalogDb, desktopDb };
}

async function insertSession(catalogDb, row) {
  const summarySql =
    row.summary == null ? "NULL" : `'${String(row.summary).replaceAll("'", "''")}'`;
  await runSqlite(
    catalogDb,
    `INSERT INTO sessions (
       provider, agent_session_id, title, project_path, updated_at_ms, archived, hidden, session_summary
     ) VALUES (
       '${row.provider || "codex"}',
       '${row.id}',
       '${String(row.title).replaceAll("'", "''")}',
       '${String(row.projectPath || "/tmp/demo").replaceAll("'", "''")}',
       ${row.updatedAtMs || Date.now()},
       0,
       ${row.hidden || 0},
       ${summarySql}
     );`
  );
}

test("searchCatalogSessions matches title and summary; hides hidden", async () => {
  const { catalogDb } = await setupCatalog();
  const now = Date.now();
  await insertSession(catalogDb, {
    id: "a1",
    title: "Login rewrite",
    summary: "JWT and refresh tokens",
    updatedAtMs: now
  });
  await insertSession(catalogDb, {
    id: "a2",
    title: "Docs only",
    summary: "README polish",
    updatedAtMs: now - 1000
  });
  await insertSession(catalogDb, {
    id: "a3",
    title: "Login secret",
    summary: "should not show",
    hidden: 1,
    updatedAtMs: now
  });

  const byTitle = await searchCatalogSessions(catalogDb, { query: "Login" });
  assert.equal(byTitle.length, 1);
  assert.equal(byTitle[0].sessionId, "a1");
  assert.equal(byTitle[0].match, "keyword");

  const bySummary = await searchCatalogSessions(catalogDb, { query: "JWT" });
  assert.equal(bySummary.length, 1);
  assert.equal(bySummary[0].sessionId, "a1");

  const byProvider = await searchCatalogSessions(catalogDb, {
    query: "Login",
    provider: "claude"
  });
  assert.equal(byProvider.length, 0);
});

test("searchCatalogSessions filters by projectPath and gtd", async () => {
  const { catalogDb } = await setupCatalog();
  await insertSession(catalogDb, {
    id: "p1",
    title: "Feature A",
    projectPath: "/Users/me/work/app",
    summary: "feature"
  });
  await insertSession(catalogDb, {
    id: "p2",
    title: "Feature B",
    projectPath: "/Users/me/other",
    summary: "feature"
  });
  await runSqlite(
    catalogDb,
    `INSERT INTO session_gtd (provider, agent_session_id, status, updated_at_ms)
     VALUES ('codex', 'p1', 'next', ${Date.now()});`
  );

  const byPath = await searchCatalogSessions(catalogDb, {
    query: "Feature",
    projectPath: "work/app"
  });
  assert.equal(byPath.length, 1);
  assert.equal(byPath[0].sessionId, "p1");

  const byGtd = await searchCatalogSessions(catalogDb, {
    query: "Feature",
    gtdStatus: "next"
  });
  assert.equal(byGtd.length, 1);
  assert.equal(byGtd[0].sessionId, "p1");
  assert.equal(byGtd[0].gtdStatus, "next");
});

test("mergeSessionSearchHits prefers both then score then recency", () => {
  const keyword = [
    {
      provider: "codex",
      sessionId: "k1",
      title: "K1",
      projectPath: "/a",
      updatedAtMs: 100,
      match: "keyword"
    },
    {
      provider: "codex",
      sessionId: "both",
      title: "Both",
      projectPath: "/a",
      updatedAtMs: 50,
      match: "keyword"
    }
  ];
  const semantic = [
    {
      provider: "codex",
      sessionId: "both",
      title: "Both",
      projectPath: "/a",
      updatedAtMs: 50,
      score: 0.9,
      match: "semantic"
    },
    {
      provider: "codex",
      sessionId: "s1",
      title: "S1",
      projectPath: "/a",
      updatedAtMs: 200,
      score: 0.5,
      match: "semantic"
    }
  ];
  const merged = mergeSessionSearchHits(keyword, semantic, 10);
  assert.equal(merged[0].sessionId, "both");
  assert.equal(merged[0].match, "both");
  assert.equal(merged[0].score, 0.9);
  assert.ok(merged.some((h) => h.sessionId === "s1" && h.match === "semantic"));
  assert.ok(merged.some((h) => h.sessionId === "k1" && h.match === "keyword"));
});

test("extractTouchedSessions parses session_search JSON results", () => {
  const text = `Found 2 session(s) matching "auth":
[
  {
    "provider": "codex",
    "sessionId": "s1",
    "title": "Auth work",
    "projectPath": "/tmp/app",
    "summaryPreview": "OAuth login",
    "score": 0.42,
    "match": "both"
  },
  {
    "provider": "claude",
    "sessionId": "s2",
    "title": "Other",
    "projectPath": "/tmp/b"
  }
]`;
  const hits = extractTouchedSessions("session_search", text);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].provider, "codex");
  assert.equal(hits[0].sessionId, "s1");
  assert.equal(hits[0].contentPreview, "OAuth login");
  assert.equal(hits[0].operation, "search");
  assert.equal(hits[1].provider, "claude");
});

test("extractTouchedSessions uses args for session_read_transcript", () => {
  const text = "Transcript excerpt for codex:abc (max 2500 chars):\n\nUser: hello\n\nAssistant: hi";
  const hits = extractTouchedSessions("session_read_transcript", text, {
    provider: "codex",
    sessionId: "abc"
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sessionId, "abc");
  assert.equal(hits[0].operation, "read");
  assert.ok(hits[0].contentPreview?.includes("hello"));
});

test("searchSessionsByEmbedding scores injected vectors and joins catalog", async () => {
  const { catalogDb, desktopDb } = await setupCatalog();
  await insertSession(catalogDb, {
    id: "emb1",
    title: "Auth work",
    summary: "OAuth login and tokens"
  });
  await insertSession(catalogDb, {
    id: "emb2",
    title: "UI",
    summary: "buttons only"
  });

  // Unit vector along first axis vs orthogonal — query [1,0,0] ranks emb1 highest.
  await runSqlite(
    desktopDb,
    `INSERT INTO session_embeddings (
       provider, agent_session_id, title, summary_preview, embedding_json,
       content_hash, embedding_key, updated_at_ms
     ) VALUES
       ('codex', 'emb1', 'Auth work', 'OAuth', '[1,0,0]', 'h1', 'test-key', ${Date.now()}),
       ('codex', 'emb2', 'UI', 'buttons', '[0,1,0]', 'h2', 'test-key', ${Date.now()});`
  );

  const hits = await searchSessionsByEmbedding({
    catalogDb,
    desktopDb,
    settings: {},
    query: "auth",
    queryVector: [1, 0, 0],
    minScore: 0.1,
    limit: 5
  });

  // Without matching embedding_key from settings, listSessionEmbeddingRows may return all when key omitted.
  // searchSessionsByEmbedding passes embeddingKey only when emb config exists — so with empty settings it lists all.
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].sessionId, "emb1");
  assert.equal(hits[0].match, "semantic");
  assert.ok(hits[0].score > 0.9);

  const rows = await runSqliteJson(desktopDb, "SELECT COUNT(*) AS n FROM session_embeddings;");
  assert.equal(Number(rows[0].n), 2);
});
