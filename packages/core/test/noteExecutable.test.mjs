import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMaterializedNoteIds,
  defaultChildNoteBody,
  formatNoteChildBlock,
  formatRunBlock,
  formatSessionBlock,
  listUnmaterializedNoteChildren,
  parseExecutableNote,
  parseNativeSessionRef,
  updateNoteChildBlocks,
  updateRunBlocks,
  updateSessionBlocks
} from "../dist/notes/executable.js";

describe("parseExecutableNote", () => {
  it("parses note-child, session, run, and result blocks", () => {
    const md = [
      "# Spec",
      "",
      ":::note-child idle",
      "Implement API",
      ":::",
      "",
      ":::note-child next note=child-1",
      "Implement UI",
      ":::",
      "",
      ":::run awaiting_approval",
      "Serial chain",
      ":::",
      "",
      ":::result completed",
      "All good",
      ":::"
    ].join("\n");

    const parsed = parseExecutableNote(md);
    assert.equal(parsed.noteChildren.length, 2);
    assert.equal(parsed.noteChildren[0].status, "idle");
    assert.equal(parsed.noteChildren[0].text, "Implement API");
    assert.equal(parsed.noteChildren[0].noteId, undefined);
    assert.equal(parsed.noteChildren[1].status, "idle");
    assert.equal(parsed.noteChildren[1].noteId, "child-1");
    assert.equal(parsed.runs[0].status, "awaiting_approval");
    assert.equal(parsed.results[0].status, "completed");
  });

  it("parses session block with native ref", () => {
    const md = ":::session codex running native=codex/sess-1\nDo work\n:::";
    const parsed = parseExecutableNote(md);
    assert.equal(parsed.sessions[0].provider, "codex");
    assert.equal(parsed.sessions[0].status, "running");
    assert.equal(parsed.sessions[0].native, "codex/sess-1");
    assert.deepEqual(parseNativeSessionRef(parsed.sessions[0].native), {
      provider: "codex",
      sessionId: "sess-1"
    });
  });

  it("normalizes legacy session done status to settled", () => {
    const md = ":::session codex done native=codex/sess-done\n:::";
    const parsed = parseExecutableNote(md);
    assert.equal(parsed.sessions.length, 1);
    assert.equal(parsed.sessions[0].status, "settled");
    assert.equal(parsed.sessions[0].native, "codex/sess-done");
  });

  it("ignores blocks inside fenced code", () => {
    const md = ["```md", ":::run executing", "nope", ":::", "```", "", ":::run draft", "yes", ":::"].join(
      "\n"
    );
    const parsed = parseExecutableNote(md);
    assert.equal(parsed.runs.length, 1);
    assert.equal(parsed.runs[0].status, "draft");
  });
});

describe("update helpers", () => {
  it("rewrites note-child note ids", () => {
    const md = [":::note-child idle", "A", ":::", "", ":::note-child idle", "B", ":::"].join("\n");
    const next = applyMaterializedNoteIds(md, [
      { index: 0, noteId: "n0" },
      { index: 1, noteId: "n1" }
    ]);
    const parsed = parseExecutableNote(next);
    assert.deepEqual(
      parsed.noteChildren.map((c) => c.noteId),
      ["n0", "n1"]
    );
    assert.equal(listUnmaterializedNoteChildren(next).length, 0);
  });

  it("updates run and session status", () => {
    let md = formatRunBlock({ status: "awaiting_approval", text: "go" });
    md += "\n\n" + formatSessionBlock({ provider: "claude", status: "idle", text: "p" });
    md = updateRunBlocks(md, new Map([[0, { status: "executing" }]]));
    md = updateSessionBlocks(md, new Map([[0, { status: "running", native: "claude/x" }]]));
    const parsed = parseExecutableNote(md);
    assert.equal(parsed.runs[0].status, "executing");
    assert.equal(parsed.sessions[0].status, "running");
    assert.equal(parsed.sessions[0].native, "claude/x");
  });

  it("formats default child note body with empty session", () => {
    const body = defaultChildNoteBody("Ship feature", "grok");
    assert.match(body, /# Ship feature/);
    const parsed = parseExecutableNote(body);
    assert.equal(parsed.sessions[0].provider, "grok");
    assert.equal(parsed.sessions[0].status, "idle");
  });

  it("updateNoteChildBlocks can change status only", () => {
    const md = formatNoteChildBlock({ status: "idle", text: "T", noteId: "x" });
    const next = updateNoteChildBlocks(md, new Map([[0, { status: "done" }]]));
    assert.equal(parseExecutableNote(next).noteChildren[0].status, "done");
  });
});
