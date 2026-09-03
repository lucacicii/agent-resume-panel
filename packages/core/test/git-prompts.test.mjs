import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommitMessageSystemPrompt,
  buildHeuristicCommitMessage,
  DEFAULT_CONVENTIONAL_COMMIT_INSTRUCTIONS,
  normalizeSuggestedCommitMessage
} from "../dist/index.js";

test("uses Conventional Commits by default", () => {
  const prompt = buildCommitMessageSystemPrompt("English");

  assert.match(prompt, /Use Conventional Commits format: type\(scope\): description/);
  assert.match(prompt, /feat, fix, docs, style, refactor/);
  assert.equal(buildHeuristicCommitMessage(" M src/app.ts"), "chore: update app.ts");
  assert.match(DEFAULT_CONVENTIONAL_COMMIT_INSTRUCTIONS, /type\(scope\)/);
  assert.equal(normalizeSuggestedCommitMessage("修复登录跳转"), "fix: 登录跳转");
});

test("uses real emoji for the Gitmoji style", () => {
  const prompt = buildCommitMessageSystemPrompt("English", { style: "gitmoji" });

  assert.match(prompt, /real Gitmoji emoji/);
  assert.match(prompt, /never use :shortcode: notation/);
  assert.equal(
    buildHeuristicCommitMessage(" M src/app.ts", { style: "gitmoji" }),
    "🔧 chore: update app.ts"
  );
  assert.equal(
    normalizeSuggestedCommitMessage("Fix login redirect", { style: "gitmoji" }),
    "🐛 fix: login redirect"
  );
});

test("keeps fixed constraints while allowing custom format rules", () => {
  const prompt = buildCommitMessageSystemPrompt("Chinese", {
    style: "custom",
    customInstructions: "Use release-note style: category - description."
  });

  assert.match(prompt, /Output the commit message only/);
  assert.match(prompt, /Write the commit message in language: Chinese/);
  assert.match(prompt, /Use release-note style: category - description/);
  assert.equal(
    buildHeuristicCommitMessage(" M src/app.ts", { style: "custom" }),
    "Update app.ts"
  );
});

test("appends extraInstructions after the selected style", () => {
  const conventional = buildCommitMessageSystemPrompt("English", {
    extraInstructions: "scope must be a package name"
  });
  assert.match(conventional, /Use Conventional Commits format/);
  assert.match(conventional, /ADDITIONAL PROJECT RULES: scope must be a package name/);

  const custom = buildCommitMessageSystemPrompt("English", {
    style: "custom",
    customInstructions: "Use release-note style: category - description.",
    extraInstructions: "Mention the ticket id."
  });
  assert.match(custom, /Use release-note style: category - description/);
  assert.match(custom, /ADDITIONAL PROJECT RULES: Mention the ticket id/);
});
