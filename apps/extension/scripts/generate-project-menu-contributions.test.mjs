#!/usr/bin/env node

import assert from "node:assert/strict";
import { buildProjectMenuContributionBlocks } from "./generate-project-menu-contributions.mjs";
import { UI_LOCALES, expandMenuEntriesForLocales } from "./menu-i18n.mjs";

const ACTION_COUNT = 15;
const COMMAND_VARIANT_COUNT = 16;

const PROJECT_VIEW_PATTERN = /viewItem =~ \/agentResume\\.project\//;
const SESSION_VIEW_PATTERN = /agentResume\\.session/;
const SESSION_COMMANDS = new Set([
  "agentResume.openSession",
  "agentResume.copyResumeCommand",
  "agentResume.previewSession",
  "agentResume.renameSession",
  "agentResume.autoRenameSession",
  "agentResume.openInCodexApp",
  "agentResume.openInClaudeCodePanel",
  "agentResume.openInCodexIdePanel"
]);

const blocks = buildProjectMenuContributionBlocks();
const localizedMain = expandMenuEntriesForLocales(blocks.mainProjectMenu);

function assertProjectMenuEntries(entries, label) {
  assert.ok(entries.length > 0, `${label} should not be empty`);

  for (const entry of entries) {
    assert.match(entry.when, PROJECT_VIEW_PATTERN, `${label} entry must scope to project nodes`);
    assert.doesNotMatch(entry.when, SESSION_VIEW_PATTERN, `${label} entry must not scope to session nodes`);

    if (entry.command) {
      assert.equal(
        SESSION_COMMANDS.has(entry.command),
        false,
        `${label} must not include session command ${entry.command}`
      );
    }
  }
}

assertProjectMenuEntries(blocks.mainProjectMenu, "mainProjectMenu");
assertProjectMenuEntries(blocks.moreProjectMenu, "moreProjectMenu");
assert.equal(localizedMain.length, blocks.mainProjectMenu.length * UI_LOCALES.length);
for (const entry of localizedMain) {
  assert.match(entry.when, /agentResume\.uiLocale/);
}

assert.equal(
  blocks.mainProjectMenu.length,
  ACTION_COUNT * COMMAND_VARIANT_COUNT,
  "main menu should have one slot per action x all command variants"
);
assert.equal(
  blocks.moreProjectMenu.length,
  ACTION_COUNT * COMMAND_VARIANT_COUNT + 1,
  "more menu should include configureProjectMenu"
);

const configureEntry = blocks.moreProjectMenu.find((entry) => entry.command === "agentResume.configureProjectMenu");
assert.ok(configureEntry, "more menu should include configureProjectMenu");
assert.match(configureEntry.when, PROJECT_VIEW_PATTERN);

console.log("generate-project-menu-contributions.test.mjs: all assertions passed");
