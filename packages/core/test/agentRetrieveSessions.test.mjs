import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildMetaAgentSystemPrompt,
  buildMetaAgentUserPrompt,
  ensureDesktopDbSchema,
  ensureExtensionCatalogSchema,
  formatSessionSourceBlock,
  retrieveAgentContext,
  runSqlite,
  saveSettings
} from "../dist/index.js";

async function setupPanel() {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-ask-sessions-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const desktopDb = path.join(panelHome, ".desktop", "desktop.db");
  await ensureExtensionCatalogSchema(catalogDb);
  await ensureDesktopDbSchema(desktopDb);
  await saveSettings(
    {
      panelHome,
      // No embeddings / chat LLM — keyword session search still works.
      uiLanguage: "en"
    },
    panelHome
  );
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

test("retrieveAgentContext includes keyword session hits as S citations", async () => {
  const { panelHome, catalogDb } = await setupPanel();
  try {
    await insertSession(catalogDb, {
      id: "auth-1",
      title: "OAuth login rewrite",
      summary: "Implemented JWT refresh tokens and callback handling",
      projectPath: "/tmp/auth-app"
    });
    await insertSession(catalogDb, {
      id: "ui-1",
      title: "Button polish",
      summary: "CSS only",
      projectPath: "/tmp/ui"
    });

    // Natural-language query: full-phrase LIKE misses; token fallback should still hit JWT/OAuth.
    const result = await retrieveAgentContext({
      query: "what was the JWT work for OAuth login?",
      panelHome
    });

    assert.ok(Array.isArray(result.sessions));
    assert.ok(result.sessions.length >= 1, "expected at least one session hit");
    assert.ok(
      result.sessions.some((s) => s.sessionId === "auth-1"),
      `expected auth-1 in ${JSON.stringify(result.sessions.map((s) => s.sessionId))}`
    );

    const sessionCitations = result.citations.filter(
      (c) => c.source === "session" || c.level === "session"
    );
    assert.ok(sessionCitations.length >= 1);
    assert.equal(sessionCitations[0].index, 1);
    assert.equal(sessionCitations[0].session?.id, "auth-1");
    assert.equal(sessionCitations[0].session?.provider, "codex");
    assert.ok(sessionCitations[0].contentPreview?.includes("JWT") || sessionCitations[0].title?.includes("OAuth"));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("buildMetaAgentUserPrompt includes Session Sources block", () => {
  const sessionBlock = formatSessionSourceBlock({
    index: 1,
    title: "Auth",
    provider: "codex",
    sessionId: "s1",
    projectPath: "/tmp/a",
    content: "OAuth work",
    score: 0.5
  });
  const prompt = buildMetaAgentUserPrompt({
    query: "what about auth?",
    sourcesBlock: "(none)",
    notesBlock: "(none)",
    sessionsBlock: sessionBlock
  });
  assert.ok(prompt.includes("Session Sources:"));
  assert.ok(prompt.includes("[S1] session · Auth"));
  assert.ok(prompt.includes("OAuth work"));
});

test("system prompt allows session sources and S citations", () => {
  const system = buildMetaAgentSystemPrompt("en");
  assert.ok(system.includes("Session Sources"));
  assert.ok(system.includes("[S1]"));
  assert.ok(!system.includes("Answer ONLY using the Report Sources and Note Sources provided"));
});
