import assert from "node:assert/strict";
import test from "node:test";
import {
  appendNoteGtdTask,
  deleteNoteGtdTask,
  parseNoteGtdTasks,
  updateNoteGtdTask
} from "../dist/index.js";

test("note GTD parser only recognizes complete :::gtd blocks", () => {
  const tasks = parseNoteGtdTasks([
    "# Plan",
    "- [ ] Legacy task @GTD/next",
    ":::gtd next",
    "Build the task view",
    ":::",
    ":::gtd done",
    "Review release",
    ":::",
    ":::gtd later",
    "Ignored status",
    ":::",
    "~~~md",
    ":::gtd waiting",
    "Example only",
    ":::",
    "~~~"
  ].join("\n"));
  assert.deepEqual(tasks.map((task) => ({ text: task.text, status: task.status, line: task.line })), [
    { text: "Build the task view", status: "next", line: 3 },
    { text: "Review release", status: "done", line: 6 }
  ]);
});

test("note GTD mutations preserve surrounding Markdown and reject ambiguous tasks", () => {
  const markdown = "# Plan\n\n:::gtd next\nDuplicate\n:::\n\n:::gtd waiting\nDuplicate\n:::\n\nParagraph.\n";
  assert.throws(() => updateNoteGtdTask(markdown, { taskText: "Duplicate", status: "done" }), /Multiple GTD tasks/);
  const updated = updateNoteGtdTask(markdown, { taskText: "Duplicate", occurrence: 2, text: "Wait for review", status: "done" });
  assert.ok(updated.includes(":::gtd done\nWait for review\n:::"));
  assert.ok(updated.includes("Paragraph."));
  const appended = appendNoteGtdTask(updated, { text: "File release", status: "next" });
  assert.ok(appended.includes(":::gtd next\nFile release\n:::"));
  const deleted = deleteNoteGtdTask(appended, { taskText: "File release" });
  assert.ok(!deleted.includes("File release"));
  assert.ok(deleted.includes("Paragraph."));
});

test("status updates retain multi-line GTD task content", () => {
  const markdown = ":::gtd next\nFirst line\n\nSecond line\n:::\n";
  const updated = updateNoteGtdTask(markdown, { taskText: "First line Second line", status: "waiting" });
  assert.equal(updated, ":::gtd waiting\nFirst line\n\nSecond line\n:::\n");
});
