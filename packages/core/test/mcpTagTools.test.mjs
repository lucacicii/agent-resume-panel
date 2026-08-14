import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureDesktopDbSchema } from "../dist/catalog/db.js";
import { desktopDbPath } from "../dist/panelHome.js";
import {
  handleEntityTagAdd,
  handleEntityTagRemove,
  handleEntityTagsGet,
  handleTagEntitiesList,
  handleTagList,
  handleTagSearch
} from "../dist/mcp/tagTools.js";
import { applyExtractedTags, sessionEntityId } from "../dist/tagging/store.js";

async function withCtx(run) {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-mcp-tags-"));
  const desktopDb = desktopDbPath(panelHome);
  try {
    await ensureDesktopDbSchema(desktopDb);
    await run({ dbPath: desktopDb });
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
}

function textPayload(result) {
  const text = result.content?.[0]?.text || "";
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) return { raw: text };
  return JSON.parse(text.slice(jsonStart));
}

test("MCP tag_list / tag_search / tag_entities_list round-trip", async () => {
  await withCtx(async (ctx) => {
    const sessionId = sessionEntityId("codex", "mcp-1");
    await applyExtractedTags(ctx.dbPath, "session", sessionId, [
      { tag: "TypeScript", category: "tech_stack", confidence: 0.95 },
      { tag: "Monorepo", category: "context_env", confidence: 0.7 }
    ]);
    await applyExtractedTags(ctx.dbPath, "note", "note-mcp", [
      { tag: "TypeScript", category: "tech_stack", confidence: 0.9 }
    ]);

    const listed = textPayload(await handleTagList({ category: "tech_stack", limit: 20 }, ctx));
    assert.equal(listed.ok, true);
    assert.ok(listed.tags.some((t) => t.normalizedTag === "typescript"));

    const searched = textPayload(await handleTagSearch({ query: "type" }, ctx));
    assert.equal(searched.ok, true);
    assert.ok(searched.tags.length >= 1);

    const entities = textPayload(
      await handleTagEntitiesList({ tag: "TypeScript", entityType: "all" }, ctx)
    );
    assert.equal(entities.ok, true);
    assert.equal(entities.entities.length, 2);
  });
});

test("MCP entity_tags_get / add / remove", async () => {
  await withCtx(async (ctx) => {
    const add = textPayload(
      await handleEntityTagAdd(
        {
          entityType: "session",
          provider: "codex",
          sessionId: "mcp-add",
          tag: "Feature Flag",
          category: "architecture"
        },
        ctx
      )
    );
    assert.equal(add.ok, true);

    const got = textPayload(
      await handleEntityTagsGet(
        {
          entityType: "session",
          provider: "codex",
          sessionId: "mcp-add"
        },
        ctx
      )
    );
    assert.equal(got.ok, true);
    assert.ok(got.tags.some((t) => t.normalizedTag === "feature flag"));

    const removed = textPayload(
      await handleEntityTagRemove(
        {
          entityType: "session",
          provider: "codex",
          sessionId: "mcp-add",
          tag: "Feature Flag"
        },
        ctx
      )
    );
    assert.equal(removed.ok, true);

    const after = textPayload(
      await handleEntityTagsGet(
        {
          entityType: "session",
          provider: "codex",
          sessionId: "mcp-add",
          includeObsolete: true
        },
        ctx
      )
    );
    assert.equal(after.ok, true);
    assert.ok(
      after.tags.length === 0 ||
        after.tags.every((t) => t.normalizedTag !== "feature flag" || t.status === "obsolete")
    );
  });
});

test("MCP entity tools reject missing session identity", async () => {
  await withCtx(async (ctx) => {
    const result = await handleEntityTagsGet(
      {
        entityType: "session",
        sessionId: "only-id"
      },
      ctx
    );
    assert.equal(result.isError, true);
  });
});
