import assert from "node:assert/strict";
import test from "node:test";
import { chunkNoteMarkdown } from "../dist/index.js";

test("chunks notes by markdown headings and caps long sections", () => {
  const longParagraph = "x".repeat(2200);
  const chunks = chunkNoteMarkdown(`# Alpha\n\nfirst paragraph\n\n${longParagraph}\n\n## Beta\n\nsecond paragraph`);

  assert.equal(chunks[0].heading, "Alpha");
  assert.equal(chunks.at(-1).heading, "Beta");
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.content.length <= 1800));
  assert.ok(chunks.every((chunk) => /^[a-f0-9]{64}$/.test(chunk.contentHash)));
});
