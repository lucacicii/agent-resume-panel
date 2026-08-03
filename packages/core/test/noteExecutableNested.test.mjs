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
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-nested-"));
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

test("resolveExecutableLeaf dives into nested composite run", async () => {
  await withStore(async (store) => {
    const project = "/tmp/nested-proj";
    const composite = await store.createProjectNote(
      project,
      [
        "# Composite",
        "",
        ":::note-child idle",
        "Leaf A-1",
        ":::",
        "",
        ":::run awaiting_approval",
        "nested",
        ":::",
        ""
      ].join("\n")
    );

    const root = await store.createProjectNote(
      project,
      [
        "# Root",
        "",
        ":::note-child idle",
        "Step leaf first",
        ":::",
        "",
        `:::note-child idle note=${composite.noteId}`,
        "Composite step",
        ":::",
        "",
        ":::run awaiting_approval",
        "main",
        ":::",
        ""
      ].join("\n")
    );

    await store.writeNoteContent(root.noteId, await store.readNoteContent(root.noteId));
    await store.writeNoteContent(composite.noteId, await store.readNoteContent(composite.noteId));

    const approved = await store.approveExecutableRun(root.noteId);
    assert.ok(approved.runId);

    const leaf1 = await store.resolveExecutableLeaf(root.noteId);
    assert.equal(leaf1.leafParentNoteId, root.noteId);
    assert.notEqual(leaf1.leafNoteId, composite.noteId);
    assert.ok(leaf1.path.some((p) => p.noteId === root.noteId && p.composite));

    await store.bindExecutableSession({
      noteId: leaf1.leafNoteId,
      provider: "codex",
      agentSessionId: "s1",
      runId: approved.runId
    });
    const s1 = await store.settleExecutableChildWithBubble({
      parentNoteId: leaf1.leafParentNoteId,
      childNoteId: leaf1.leafNoteId,
      outcome: "completed",
      summary: "first done",
      runId: approved.runId
    });
    assert.equal(s1.advanced, true);
    assert.ok(s1.nextLeaf);
    assert.equal(s1.nextLeaf.leafParentNoteId, composite.noteId);
    assert.ok(s1.nextLeaf.path.some((p) => p.noteId === composite.noteId && p.composite));

    await store.bindExecutableSession({
      noteId: s1.nextLeaf.leafNoteId,
      provider: "codex",
      agentSessionId: "s2",
      runId: s1.nextLeaf.runIdsByNoteId[composite.noteId]
    });
    const s2 = await store.settleExecutableChildWithBubble({
      parentNoteId: s1.nextLeaf.leafParentNoteId,
      childNoteId: s1.nextLeaf.leafNoteId,
      outcome: "completed",
      summary: "nested done",
      runId: s1.nextLeaf.runIdsByNoteId[composite.noteId]
    });
    assert.equal(s2.bubbled, true);
    const rootFinal = parseExecutableNote(await store.readNoteContent(root.noteId));
    assert.equal(rootFinal.runs[0].status, "completed");
    assert.ok(rootFinal.noteChildren.every((c) => c.status === "done"));
    const compositeFinal = parseExecutableNote(await store.readNoteContent(composite.noteId));
    assert.equal(compositeFinal.runs[0].status, "completed");
  });
});

test("nested failure bubbles to outer run", async () => {
  await withStore(async (store) => {
    const project = "/tmp/nested-fail";
    const composite = await store.createProjectNote(
      project,
      [
        "# Composite",
        "",
        ":::note-child idle",
        "Only leaf",
        ":::",
        "",
        ":::run awaiting_approval",
        "nested",
        ":::",
        ""
      ].join("\n")
    );
    const root = await store.createProjectNote(
      project,
      [
        "# Root",
        "",
        `:::note-child idle note=${composite.noteId}`,
        "Composite only",
        ":::",
        "",
        ":::note-child idle",
        "Should not run",
        ":::",
        "",
        ":::run awaiting_approval",
        "main",
        ":::",
        ""
      ].join("\n")
    );
    await store.writeNoteContent(root.noteId, await store.readNoteContent(root.noteId));
    await store.writeNoteContent(composite.noteId, await store.readNoteContent(composite.noteId));

    await store.approveExecutableRun(root.noteId);
    const leaf = await store.resolveExecutableLeaf(root.noteId);
    assert.equal(leaf.leafParentNoteId, composite.noteId);

    const failed = await store.settleExecutableChildWithBubble({
      parentNoteId: leaf.leafParentNoteId,
      childNoteId: leaf.leafNoteId,
      outcome: "failed",
      summary: "boom",
      runId: leaf.runIdsByNoteId[composite.noteId]
    });
    assert.equal(failed.done, true);
    assert.equal(failed.bubbled, true);

    const rootFinal = parseExecutableNote(await store.readNoteContent(root.noteId));
    assert.equal(rootFinal.runs[0].status, "failed");
    assert.equal(rootFinal.noteChildren[0].status, "failed");
    // Later siblings stay planned (never started after fail-stop).
    assert.equal(rootFinal.noteChildren[1].status, "planned");
  });
});
