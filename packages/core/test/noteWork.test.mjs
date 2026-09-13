import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildNoteDocument,
  ensureWorkItemSessionIndex,
  listWorkItems,
  NotesStore,
  parseNoteDocument,
  runSqlite,
  workFieldsFromFrontmatter
} from "../dist/index.js";

test("work-item front-matter round-trips through parse and build", () => {
  const raw = buildNoteDocument(
    {
      id: "n1",
      scope: "project",
      projectPath: "/work/app",
      createdAt: "2026-01-01T00:00:00.000Z",
      work: true,
      next: "Wire the rollup",
      decision: "Show connecting state?",
      sessions: ["codex:sess-1", "claude:sess-2"]
    },
    "# Goal\n\nBody\n"
  );

  const parsed = parseNoteDocument(raw);
  assert.equal(parsed.frontmatter.work, true);
  assert.equal(parsed.frontmatter.next, "Wire the rollup");
  assert.equal(parsed.frontmatter.decision, "Show connecting state?");
  assert.deepEqual(parsed.frontmatter.sessions, ["codex:sess-1", "claude:sess-2"]);
  assert.match(parsed.body, /# Goal/);

  assert.deepEqual(workFieldsFromFrontmatter(parsed.frontmatter), {
    next: "Wire the rollup",
    decision: "Show connecting state?",
    sessions: ["codex:sess-1", "claude:sess-2"]
  });
  assert.equal(workFieldsFromFrontmatter({ scope: "project" }), null);
});

test("work items are indexed from front-matter and survive a move", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-note-work-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const store = new NotesStore(catalogDb, panelHome);
  await store.initialize();

  try {
    const record = await store.createProjectNote(path.join(panelHome, "app"));

    // A plain project note is not a work item.
    assert.equal((await listWorkItems(catalogDb)).length, 0);

    await store.writeNoteContent(
      record.noteId,
      `---\nscope: project\nwork: true\nnext: Ship it\ndecision: Pick a color\nsessions: codex:s1, claude:s2\nprojects: /work/app, /work/api\nprimaryProject: /work/app\n---\n# Realtime status\n`
    );

    const items = await listWorkItems(catalogDb);
    assert.equal(items.length, 1);
    assert.equal(items[0].noteId, record.noteId);
    assert.equal(items[0].work.next, "Ship it");
    assert.equal(items[0].work.decision, "Pick a color");
    assert.deepEqual(items[0].work.sessions, ["codex:s1", "claude:s2"]);
    assert.deepEqual(items[0].work.projects, ["/work/app", "/work/api"]);
    assert.equal(items[0].work.primaryProject, "/work/app");

    // Moving the note keeps its work fields.
    const moved = await store.moveNote(record.noteId, { scope: "project", projectPath: path.join(panelHome, "other") });
    const content = await store.readNoteContent(moved.noteId);
    assert.match(content, /work: true/);
    const afterMove = await listWorkItems(catalogDb);
    assert.equal(afterMove.length, 1);
    assert.equal(afterMove[0].work.next, "Ship it");

    // Dropping the flag removes it from the board index.
    await store.writeNoteContent(
      record.noteId,
      `---\nscope: project\n---\n# Realtime status\n`
    );
    assert.equal((await listWorkItems(catalogDb)).length, 0);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("work-item session links are indexed for reverse lookup and project derivation", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-work-links-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const store = new NotesStore(catalogDb, panelHome);
  await store.initialize();

  try {
    await runSqlite(
      catalogDb,
      `INSERT INTO sessions (provider, agent_session_id, title, project_path, updated_at_ms, hidden)
       VALUES ('codex', 's1', 'A', '/work/app', 1, 0), ('claude', 's2', 'B', '/work/api', 1, 0);`
    );

    const item = await store.createWorkItem({ title: "Cross-repo", sessions: ["codex:s1", "claude:s2"] });
    const links = await store.listWorkItemSessionLinks();
    assert.deepEqual(links.map((link) => `${link.provider}:${link.sessionId}`).sort(), ["claude:s2", "codex:s1"]);
    assert.equal(links[0].title, "Cross-repo");

    const projects = await store.listWorkItemSessionProjects();
    assert.deepEqual((projects[item.noteId] ?? []).sort(), ["/work/api", "/work/app"]);

    // A session belongs to at most one work item: re-claiming moves it.
    const other = await store.createWorkItem({ title: "Other", sessions: ["codex:s1"] });
    const after = await store.listWorkItemSessionLinks();
    const claimed = after.filter((link) => link.provider === "codex" && link.sessionId === "s1");
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].noteId, other.noteId);

    // Deleting the work item clears its links.
    await store.deleteNote(other.noteId);
    const cleaned = await store.listWorkItemSessionLinks();
    assert.equal(cleaned.filter((link) => link.noteId === other.noteId).length, 0);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("backfills the session index from existing note_work rows", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-work-backfill-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const store = new NotesStore(catalogDb, panelHome);
  await store.initialize();

  try {
    const item = await store.createWorkItem({ title: "Legacy", sessions: ["codex:old"] });
    // Simulate a row written before the index table existed.
    await runSqlite(
      catalogDb,
      `DELETE FROM work_item_sessions; DELETE FROM catalog_meta WHERE key = 'work_item_sessions_index_v1';`
    );
    await ensureWorkItemSessionIndex(catalogDb);

    const links = await store.listWorkItemSessionLinks();
    assert.ok(links.some((link) => link.noteId === item.noteId && link.provider === "codex" && link.sessionId === "old"));
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});

test("createWorkItem writes a queryable work item that references projects", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-create-work-"));
  const catalogDb = path.join(panelHome, "catalog.db");
  const store = new NotesStore(catalogDb, panelHome);
  await store.initialize();

  try {
    const item = await store.createWorkItem({
      title: "Ship realtime status",
      decision: "Show connecting state?",
      sessions: ["codex:s1"],
      projects: [path.join(panelHome, "app"), path.join(panelHome, "api")]
    });
    assert.equal(item.scope, "library");
    assert.equal(item.work.next, undefined);
    assert.equal(item.work.decision, "Show connecting state?");
    assert.deepEqual(item.work.sessions, ["codex:s1"]);
    assert.deepEqual(item.work.projects, [path.join(panelHome, "app"), path.join(panelHome, "api")]);
    assert.equal(item.work.primaryProject, path.join(panelHome, "app"));

    const listed = await listWorkItems(catalogDb);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].noteId, item.noteId);
    assert.equal(listed[0].title, "Ship realtime status");
    assert.deepEqual(listed[0].work.projects, [path.join(panelHome, "app"), path.join(panelHome, "api")]);
    assert.match(await store.readNoteContent(item.noteId), /^---\n[\s\S]*work: true[\s\S]*\n---\n# Ship realtime status/);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
