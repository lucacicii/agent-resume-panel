import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureDesktopDbSchema } from "../dist/catalog/db.js";
import { desktopDbPath } from "../dist/panelHome.js";
import {
  addManualTag,
  applyExtractedTags,
  listEntitiesByTag,
  listEntityTags,
  listTagDefinitions,
  recordEntityTagHits,
  removeEntityTag,
  searchTagDefinitions,
  sessionEntityId,
  sweepTagDecay
} from "../dist/tagging/store.js";

async function withDesktopDb(run) {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-tag-store-"));
  const desktopDb = desktopDbPath(panelHome);
  try {
    await ensureDesktopDbSchema(desktopDb);
    await run(desktopDb);
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
}

test("applyExtractedTags upserts multi-tags and builds consensus across entities", async () => {
  await withDesktopDb(async (desktopDb) => {
    const sessionA = sessionEntityId("codex", "sess-a");
    const sessionB = sessionEntityId("claude", "sess-b");

    await applyExtractedTags(desktopDb, "session", sessionA, [
      { tag: "React 19", category: "tech_stack", confidence: 0.9 },
      { tag: "Auth", category: "business_domain", confidence: 0.7 }
    ]);
    await applyExtractedTags(desktopDb, "session", sessionB, [
      { tag: "react 19", category: "tech_stack", confidence: 0.8 }
    ]);
    await applyExtractedTags(desktopDb, "note", "note-1", [
      { tag: "React 19", category: "tech_stack", confidence: 0.85 }
    ]);

    const defs = await listTagDefinitions(desktopDb, { status: "all", sortBy: "count" });
    const react = defs.find((d) => d.normalized_tag === "react 19");
    assert.ok(react);
    assert.equal(react.active_entity_count, 3);
    assert.equal(react.session_count, 2);
    assert.equal(react.note_count, 1);
    assert.ok(react.global_weight > 1);

    const aTags = await listEntityTags(desktopDb, "session", sessionA);
    assert.equal(aTags.length, 2);
    const aReact = aTags.find((t) => t.normalizedTag === "react 19");
    assert.ok(aReact);
    assert.equal(aReact.consensusCount, 3);
    assert.ok(aReact.weight > 1);

    const entities = await listEntitiesByTag(desktopDb, "react 19", { entityType: "all" });
    assert.equal(entities.length, 3);
  });
});

test("manual tags are preserved when auto tags are re-extracted", async () => {
  await withDesktopDb(async (desktopDb) => {
    const entityId = sessionEntityId("codex", "sess-manual");
    await addManualTag(desktopDb, "session", entityId, "Pinned Idea", "concept_knowledge");
    await applyExtractedTags(desktopDb, "session", entityId, [
      { tag: "BugFix", category: "task_type", confidence: 0.9 }
    ]);
    await applyExtractedTags(desktopDb, "session", entityId, [
      { tag: "Refactor", category: "task_type", confidence: 0.8 }
    ]);

    const active = await listEntityTags(desktopDb, "session", entityId);
    assert.deepEqual(active.map((t) => t.normalizedTag).sort(), ["pinned idea", "refactor"]);
    const manual = active.find((t) => t.normalizedTag === "pinned idea");
    assert.equal(manual.source, "manual");
    assert.equal(manual.status, "active");

    const all = await listEntityTags(desktopDb, "session", entityId, { includeObsolete: true });
    const bugfix = all.find((t) => t.normalizedTag === "bugfix");
    assert.ok(bugfix);
    assert.equal(bugfix.status, "obsolete");
  });
});

test("recordEntityTagHits boosts weight and reactivates obsolete tags", async () => {
  await withDesktopDb(async (desktopDb) => {
    const entityId = sessionEntityId("codex", "sess-hit");
    await applyExtractedTags(desktopDb, "session", entityId, [
      { tag: "Race Condition", category: "problem_domain", confidence: 0.9 }
    ]);

    await removeEntityTag(desktopDb, "session", entityId, "Race Condition", false);
    let tags = await listEntityTags(desktopDb, "session", entityId, { includeObsolete: true });
    assert.equal(tags.length, 1);
    assert.equal(tags[0].status, "obsolete");

    await recordEntityTagHits(desktopDb, "session", entityId);
    tags = await listEntityTags(desktopDb, "session", entityId, { includeObsolete: true });
    assert.equal(tags[0].status, "active");
    assert.ok(tags[0].hitCount >= 1);
    assert.ok(tags[0].weight >= 1);
  });
});

test("searchTagDefinitions matches substring queries", async () => {
  await withDesktopDb(async (desktopDb) => {
    await applyExtractedTags(desktopDb, "note", "n1", [
      { tag: "OAuth 2.0", category: "concept_knowledge", confidence: 0.9 },
      { tag: "Electron", category: "tech_stack", confidence: 0.8 }
    ]);
    const hits = await searchTagDefinitions(desktopDb, "oauth");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].normalized_tag, "oauth 2.0");
  });
});

test("sweepTagDecay returns scan counters", async () => {
  await withDesktopDb(async (desktopDb) => {
    await applyExtractedTags(desktopDb, "note", "n-decay", [
      { tag: "Temp", category: "context_env", confidence: 0.5 }
    ]);
    const result = await sweepTagDecay(desktopDb, {
      halfLifeDays: 7,
      pruneThreshold: 0.1
    });
    assert.ok(result.scanned >= 1);
    assert.ok(Number.isFinite(result.markedObsolete));
  });
});
