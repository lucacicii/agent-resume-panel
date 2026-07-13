import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  chunkNoteMarkdown,
  extractExactNoteSearchTerms,
  isNotesOnlyQuery,
  normalizeLlmNoteSearchPlan,
  planNoteSearchDeterministically,
  searchNotesByEmbedding
} from "../dist/index.js";

test("chunks notes by markdown headings and caps long sections", () => {
  const longParagraph = "x".repeat(2200);
  const chunks = chunkNoteMarkdown(`# Alpha\n\nfirst paragraph\n\n${longParagraph}\n\n## Beta\n\nsecond paragraph`);

  assert.equal(chunks[0].heading, "Alpha");
  assert.equal(chunks.at(-1).heading, "Beta");
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.content.length <= 1800));
  assert.ok(chunks.every((chunk) => /^[a-f0-9]{64}$/.test(chunk.contentHash)));
});

test("detects exact markers and note-only intent", () => {
  assert.deepEqual(extractExactNoteSearchTerms("帮我查一下带有 TODO 的笔记"), ["TODO"]);
  assert.deepEqual(extractExactNoteSearchTerms("查找包含 `FIXME` 的 notes"), ["FIXME"]);
  assert.equal(isNotesOnlyQuery("帮我查一下带有 TODO 的笔记"), true);
  assert.equal(isNotesOnlyQuery("最近日报里有哪些 TODO"), false);
});

test("builds general exact and semantic note search plans", () => {
  assert.deepEqual(planNoteSearchDeterministically("查找包含 登录失败 和 timeout 的笔记"), {
    mode: "exact",
    terms: ["登录失败", "timeout"],
    operator: "all",
    fields: ["content", "title", "filename", "path"],
    semanticQuery: "查找包含 登录失败 和 timeout 的笔记",
    notesOnly: true,
    confidence: 0.98,
    source: "deterministic"
  });
  assert.deepEqual(planNoteSearchDeterministically("列出包含 TODO 或 FIXME 的笔记").terms, ["TODO", "FIXME"]);
  assert.equal(planNoteSearchDeterministically("列出包含 TODO 或 FIXME 的笔记").operator, "any");
  assert.deepEqual(planNoteSearchDeterministically("标题包含 发布计划 的笔记").terms, ["发布计划"]);
  assert.deepEqual(planNoteSearchDeterministically("标题包含 发布计划 的笔记").fields, ["title"]);
  assert.deepEqual(planNoteSearchDeterministically("查找标签 #urgent 的笔记").terms, ["#urgent"]);
  assert.deepEqual(planNoteSearchDeterministically("find notes containing auth_token").terms, ["auth_token"]);
  assert.equal(planNoteSearchDeterministically("查找关于登录故障的笔记").mode, "semantic");

  const fallback = planNoteSearchDeterministically("帮我查一下登录故障的笔记");
  const llmPlan = normalizeLlmNoteSearchPlan(
    {
      mode: "exact",
      terms: ["登录故障"],
      operator: "all",
      fields: ["content"],
      semanticQuery: "登录故障",
      notesOnly: false
    },
    fallback
  );
  assert.equal(llmPlan?.notesOnly, true);
});

test("exact marker search scans full markdown files without embeddings", async () => {
  const panelHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-note-search-"));
  try {
    const library = path.join(panelHome, "notes", "library");
    await fs.mkdir(library, { recursive: true });
    await fs.writeFile(
      path.join(library, "long-note.md"),
      `# Long note\n\n${"ordinary text\n\n".repeat(1000)}- TODO: hidden near the end\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(library, "short-note.md"),
      "# Short note\n\nTODO: visible item\n",
      "utf8"
    );
    await fs.writeFile(path.join(library, "other.md"), "# Other\n\nNo tasks here.\n", "utf8");

    const hits = await searchNotesByEmbedding({
      panelHome,
      query: "帮我查一下带有 TODO 的笔记",
      limit: 50
    });

    assert.equal(hits.length, 2);
    assert.equal(hits[0].exactMatchTotal, 2);
    assert.ok(hits.every((hit) => hit.matchType === "exact" && hit.content.includes("TODO")));

    const anyHits = await searchNotesByEmbedding({
      panelHome,
      query: "列出包含 TODO 或 No tasks 的笔记",
      limit: 50
    });
    assert.equal(anyHits.length, 3);

    const titleHits = await searchNotesByEmbedding({
      panelHome,
      query: "标题包含 Short note 的笔记",
      limit: 50
    });
    assert.equal(titleHits.length, 1);
    assert.equal(titleHits[0].title, "Short note");
  } finally {
    await fs.rm(panelHome, { recursive: true, force: true });
  }
});
