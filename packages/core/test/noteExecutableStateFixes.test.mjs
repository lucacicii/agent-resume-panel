import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  NotesStore,
  ensureExtensionCatalogSchema,
  hideSessionsInCatalog,
  parseExecutableNote,
  unhideSessionInCatalog,
  upsertAcpSessionInCatalog
} from "../dist/index.js";

async function withStore(run) {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-fix-"));
  const dbPath = path.join(panelHome, "catalog.db");
  try {
    await ensureExtensionCatalogSchema(dbPath);
    const store = new NotesStore(dbPath, panelHome);
    await store.initialize();
    await run(store);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
}

test("probeExecutableNote reports run/session/asStep roles", async () => {
  await withStore(async (store) => {
    const project = "/tmp/fix-proj";
    const runNote = await store.createProjectNote(project, [
      "# Run",
      "",
      ":::note-child idle",
      "Step A",
      ":::",
      "",
      ":::run awaiting_approval",
      "main",
      ":::",
      ""
    ].join("\n"));
    await store.writeNoteContent(runNote.noteId, await store.readNoteContent(runNote.noteId));

    const runProbe = await store.probeExecutableNote(runNote.noteId);
    assert.equal(runProbe.hasRun, true);
    assert.equal(runProbe.runStatus, "awaiting_approval");
    assert.equal(runProbe.hasSession, false);
    assert.equal(runProbe.asStep, undefined);

    const childId = parseExecutableNote(await store.readNoteContent(runNote.noteId)).noteChildren[0].noteId;
    assert.ok(childId);
    const stepProbe = await store.probeExecutableNote(childId);
    assert.equal(stepProbe.hasRun, false);
    assert.equal(stepProbe.hasSession, true);
    assert.equal(stepProbe.sessionProvider, "codex");
    assert.equal(stepProbe.sessionNativeRef, undefined);
    assert.ok(stepProbe.asStep);
    assert.equal(stepProbe.asStep.parentNoteId, runNote.noteId);
    assert.equal(stepProbe.asStep.childStatus, "idle");
    assert.equal(stepProbe.asStep.parentRunStatus, "awaiting_approval");
  });
});

test("probeExecutableNote parses session native ref", async () => {
  await withStore(async (store) => {
    const project = "/tmp/fix-proj-native";
    const leaf = await store.createProjectNote(project, [
      "# Leaf",
      "",
      ":::session codex running native=codex/sess-9",
      "do it",
      ":::",
      ""
    ].join("\n"));
    await store.writeNoteContent(leaf.noteId, await store.readNoteContent(leaf.noteId));

    const probe = await store.probeExecutableNote(leaf.noteId);
    assert.equal(probe.hasSession, true);
    assert.equal(probe.sessionProvider, "codex");
    assert.deepEqual(probe.sessionNativeRef, { provider: "codex", sessionId: "sess-9" });
  });
});

test("setExecutableRunStatus rewrites run block and syncs note_runs", async () => {
  await withStore(async (store) => {
    const project = "/tmp/fix-run";
    const note = await store.createProjectNote(project, [
      "# Run",
      "",
      ":::note-child idle",
      "Step A",
      ":::",
      "",
      ":::run awaiting_approval",
      "main",
      ":::",
      ""
    ].join("\n"));
    await store.writeNoteContent(note.noteId, await store.readNoteContent(note.noteId));

    const approved = await store.approveExecutableRun(note.noteId);
    assert.equal(
      parseExecutableNote(await store.readNoteContent(note.noteId)).runs[0].status,
      "executing"
    );

    // Manual reset back to awaiting_approval.
    const reset = await store.setExecutableRunStatus(note.noteId, "awaiting_approval");
    assert.equal(parseExecutableNote(reset.content).runs[0].status, "awaiting_approval");
    const runs = await store.listExecutableRuns(note.noteId);
    assert.ok(runs.length >= 1);
    assert.equal(runs[0].status, "awaiting_approval");

    // Manual forward to executing keeps an active run row in sync.
    await store.setExecutableRunStatus(note.noteId, "executing");
    const runs2 = await store.listExecutableRuns(note.noteId);
    assert.equal(runs2.find((r) => r.status === "executing").runId, approved.runId);
  });
});

test("setExecutableChildStatus cascades to session and does NOT touch parent run", async () => {
  await withStore(async (store) => {
    const project = "/tmp/fix-child";
    const runNote = await store.createProjectNote(project, [
      "# Run",
      "",
      ":::note-child idle",
      "Step A",
      ":::",
      "",
      ":::run executing",
      "main",
      ":::",
      ""
    ].join("\n"));
    await store.writeNoteContent(runNote.noteId, await store.readNoteContent(runNote.noteId));
    const childId = parseExecutableNote(await store.readNoteContent(runNote.noteId)).noteChildren[0].noteId;

    // Mark failed — parent run must stay executing.
    const res = await store.setExecutableChildStatus(childId, "failed");
    assert.equal(res.parentNoteId, runNote.noteId);
    const parentParsed = parseExecutableNote(res.content);
    assert.equal(parentParsed.noteChildren[0].status, "failed");
    assert.equal(parentParsed.runs[0].status, "executing");

    const childParsed = parseExecutableNote(await store.readNoteContent(childId));
    assert.equal(childParsed.sessions[0].status, "failed");
    assert.equal(childParsed.results[0].status, "failed");

    // Mark back to planned for a rerun.
    await store.setExecutableChildStatus(childId, "planned");
    const parentAfter = parseExecutableNote(await store.readNoteContent(runNote.noteId));
    assert.equal(parentAfter.noteChildren[0].status, "planned");
    assert.equal(parentAfter.runs[0].status, "executing");
    const childAfter = parseExecutableNote(await store.readNoteContent(childId));
    assert.equal(childAfter.sessions[0].status, "planned");
  });
});

test("setExecutableChildStatus done settles session and appends completed result", async () => {
  await withStore(async (store) => {
    const project = "/tmp/fix-child-done";
    const runNote = await store.createProjectNote(project, [
      "# Run",
      "",
      ":::note-child idle",
      "Step A",
      ":::",
      "",
      ":::run executing",
      "main",
      ":::",
      ""
    ].join("\n"));
    await store.writeNoteContent(runNote.noteId, await store.readNoteContent(runNote.noteId));
    const childId = parseExecutableNote(await store.readNoteContent(runNote.noteId)).noteChildren[0].noteId;

    await store.setExecutableChildStatus(childId, "done");
    const childParsed = parseExecutableNote(await store.readNoteContent(childId));
    assert.equal(childParsed.sessions[0].status, "settled");
    assert.equal(childParsed.results[0].status, "completed");
    const parentParsed = parseExecutableNote(await store.readNoteContent(runNote.noteId));
    assert.equal(parentParsed.noteChildren[0].status, "done");
    assert.equal(parentParsed.runs[0].status, "executing");
  });
});

test("setExecutableSessionStatus rewrites a leaf session block", async () => {
  await withStore(async (store) => {
    const project = "/tmp/fix-session";
    const note = await store.createProjectNote(project, [
      "# Leaf",
      "",
      ":::session codex running native=codex/sess-1",
      "do it",
      ":::",
      ""
    ].join("\n"));
    await store.writeNoteContent(note.noteId, await store.readNoteContent(note.noteId));

    const res = await store.setExecutableSessionStatus(note.noteId, "idle");
    const parsed = parseExecutableNote(res.content);
    assert.equal(parsed.sessions[0].status, "idle");
    assert.equal(parsed.sessions[0].provider, "codex");
    assert.equal(parsed.sessions[0].native, "codex/sess-1");
  });
});

test("appendExecutableStep adds a materialized step to a run-holder", async () => {
  await withStore(async (store) => {
    const project = "/tmp/fix-append";
    const runNote = await store.createProjectNote(project, [
      "# Run",
      "",
      ":::note-child idle",
      "Step A",
      ":::",
      "",
      ":::run executing",
      "main",
      ":::",
      ""
    ].join("\n"));
    await store.writeNoteContent(runNote.noteId, await store.readNoteContent(runNote.noteId));

    const before = parseExecutableNote(await store.readNoteContent(runNote.noteId)).noteChildren.length;
    const res = await store.appendExecutableStep(runNote.noteId, "New step B");
    const after = parseExecutableNote(res.content);
    assert.equal(after.noteChildren.length, before + 1);
    assert.equal(after.noteChildren.at(-1).noteId, res.childNoteId);
    assert.equal(after.noteChildren.at(-1).status, "planned");
    assert.equal(after.noteChildren.at(-1).text, "New step B");

    const childContent = await store.readNoteContent(res.childNoteId);
    const childParsed = parseExecutableNote(childContent);
    assert.equal(childParsed.sessions[0].status, "idle");
  });
});

test("appendExecutableStep rejects non-project notes", async () => {
  await withStore(async (store) => {
    const note = await store.createLibraryNote();
    await assert.rejects(() => store.appendExecutableStep(note.noteId, "x"), /project notes/);
  });
});

test("unhideSessionInCatalog restores a hidden session for resume", async () => {
  await withStore(async (store) => {
    const dbPath = store.dbPath;
    await upsertAcpSessionInCatalog(dbPath, store.getPanelHome(), {
      id: "sess-h",
      title: "Hidden chat",
      projectPath: "/tmp/x",
      acpProvider: "grok",
      updatedAt: Date.now(),
      messageCount: 0
    });
    // Hide the newly synced session.
    await hideSessionsInCatalog(dbPath, [{ provider: "chat", id: "sess-h" }]);
    const restored = await unhideSessionInCatalog(dbPath, "chat", "sess-h");
    assert.equal(restored, true);
    // Second unhide has nothing to restore.
    const again = await unhideSessionInCatalog(dbPath, "chat", "sess-h");
    assert.equal(again, false);
  });
});
