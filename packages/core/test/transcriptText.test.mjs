import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPreviewContent,
  extractTextFromContent,
  finalizePreviewMessages,
  isConversationPreviewText
} from "../dist/index.js";

test("extractTextFromContent ignores tool_result and tool_use blocks", () => {
  const text = extractTextFromContent([
    { type: "tool_use", name: "Bash", input: { command: "ls" } },
    { type: "tool_result", tool_use_id: "1", content: "total 24" },
    { type: "text", text: "Branch created." }
  ]);
  assert.equal(text, "Branch created.");
});

test("isConversationPreviewText drops slash-command and token wrappers", () => {
  assert.equal(isConversationPreviewText("<command-name>/model</command-name>"), false);
  assert.equal(isConversationPreviewText("<local-command-stdout>Set model to Sonnet</local-command-stdout>"), false);
  assert.equal(isConversationPreviewText("<total_tokens>14968810 tokens left</total_tokens>"), false);
  assert.equal(isConversationPreviewText("[Request interrupted by user for tool use]"), false);
  assert.equal(isConversationPreviewText("commit(中文) and push"), true);
});

test("extractPreviewContent separates thinking from visible answer text", () => {
  const extracted = extractPreviewContent([
    { type: "thinking", thinking: "Need to inspect the git tree." },
    { type: "text", text: "The empty folder is a status parser bug." }
  ]);
  assert.deepEqual(extracted, {
    thinking: "Need to inspect the git tree.",
    text: "The empty folder is a status parser bug."
  });
});

test("finalizePreviewMessages keeps thinking when merging assistant fragments", () => {
  const result = finalizePreviewMessages("Fix renderer", [
    { role: "user", text: "Why is the folder empty?" },
    { role: "assistant", text: "", thinking: "Check git status parsing." },
    { role: "assistant", text: "It drops empty directories." }
  ]);
  assert.deepEqual(result.messages, [
    { role: "user", text: "Why is the folder empty?" },
    { role: "assistant", text: "It drops empty directories.", thinking: "Check git status parsing." }
  ]);
});

test("finalizePreviewMessages merges consecutive assistant fragments and ignores command noise", () => {
  const result = finalizePreviewMessages("Fix renderer", [
    { role: "user", text: "<command-name>/model</command-name>" },
    { role: "user", text: "Add a transcript pane" },
    { role: "assistant", text: "I'll look at the side panel." },
    { role: "assistant", text: "Then I'll dock it beside the TUI." },
    { role: "user", text: "Keep the terminal visible." },
    { role: "assistant", text: "<total_tokens>12 tokens left</total_tokens>" },
    { role: "assistant", text: "Done." }
  ]);
  assert.equal(result.truncated, undefined);
  assert.deepEqual(
    result.messages.map((message) => [message.role, message.text]),
    [
      ["user", "Add a transcript pane"],
      ["assistant", "I'll look at the side panel.\n\nThen I'll dock it beside the TUI."],
      ["user", "Keep the terminal visible."],
      ["assistant", "Done."]
    ]
  );
});
