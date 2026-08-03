import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  NotesStore,
  ensureExtensionCatalogSchema,
  parseExecutableNote
} from "../dist/index.js";

async function withStore(run) {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-exec-"));
  const dbPath = path.join(panelHome, "catalog.db");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const store = new NotesStore(dbPath, panelHome);
    await store.initialize();
    await run(store, panelHome, dbPath);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
}

test("writeNoteContent auto-materializes note-child blocks with empty session", async () => {
  await withStore(async (store) => {
    const parent = await store.createProjectNote(
      "/tmp/proj-exec",
      [
        "# Parent",
        "",
        ":::note-child idle",
        "Task Alpha",
        ":::",
        "",
        ":::note-child idle",
        "Task Beta",
        ":::",
        "",
        ":::run awaiting_approval",
        "Serial",
        ":::"
      ].join("\n")
    );

    const raw = await store.readNoteContent(parent.noteId);
    const written = await store.writeNoteContent(parent.noteId, raw);
    assert.equal(written.materialized, true);

    const content = written.content;
    const parsed = parseExecutableNote(content);
    assert.equal(parsed.noteChildren.length, 2);
    assert.ok(parsed.noteChildren[0].noteId);
    assert.ok(parsed.noteChildren[1].noteId);

    const childA = await store.getNote(parsed.noteChildren[0].noteId);
    assert.ok(childA);
    const childBody = await store.readNoteContent(childA.noteId);
    assert.match(childBody, /# Task Alpha/);
    const childParsed = parseExecutableNote(childBody);
    assert.equal(childParsed.sessions.length, 1);
    assert.equal(childParsed.sessions[0].status, "idle");
    assert.equal(childParsed.sessions[0].provider, "codex");

    const parentLink = await store.getNoteParent(childA.noteId);
    assert.equal(parentLink?.parentNoteId, parent.noteId);
  });
});

test("approve run then settle children serially", async () => {
  await withStore(async (store) => {
    const parent = await store.createProjectNote(
      "/tmp/proj-exec2",
      [
        "# Parent",
        "",
        ":::note-child idle",
        "One",
        ":::",
        "",
        ":::note-child idle",
        "Two",
        ":::",
        "",
        ":::run awaiting_approval",
        "",
        ":::"
      ].join("\n")
    );
    await store.writeNoteContent(parent.noteId, await store.readNoteContent(parent.noteId));

    const approved = await store.approveExecutableRun(parent.noteId);
    assert.ok(approved.runId);
    assert.equal(approved.childNoteIds.length, 2);

    const afterApprove = parseExecutableNote(approved.content);
    assert.equal(afterApprove.runs[0].status, "executing");
    assert.equal(afterApprove.noteChildren[0].status, "running");
    assert.equal(afterApprove.noteChildren[1].status, "planned");

    const child0 = afterApprove.noteChildren[0].noteId;
    const child1 = afterApprove.noteChildren[1].noteId;

    await store.bindExecutableSession({
      noteId: child0,
      provider: "codex",
      agentSessionId: "s-1",
      runId: approved.runId
    });

    const step1 = await store.settleExecutableChild({
      parentNoteId: parent.noteId,
      childNoteId: child0,
      outcome: "completed",
      summary: "First done",
      runId: approved.runId
    });
    assert.equal(step1.advanced, true);
    assert.equal(step1.done, false);
    const mid = parseExecutableNote(step1.content);
    assert.equal(mid.noteChildren[0].status, "done");
    assert.equal(mid.noteChildren[1].status, "running");

    const step2 = await store.settleExecutableChild({
      parentNoteId: parent.noteId,
      childNoteId: child1,
      outcome: "completed",
      summary: "Second done",
      runId: approved.runId
    });
    assert.equal(step2.done, true);
    const end = parseExecutableNote(step2.content);
    assert.equal(end.runs[0].status, "completed");
    assert.equal(end.noteChildren[1].status, "done");
    assert.ok(end.results.some((r) => r.status === "completed"));

    const runs = await store.listExecutableRuns(parent.noteId);
    assert.ok(runs.some((r) => r.runId === approved.runId && r.status === "completed"));
  });
});
