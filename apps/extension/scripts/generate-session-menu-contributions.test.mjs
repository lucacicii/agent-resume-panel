#!/usr/bin/env node

import assert from "node:assert/strict";
import { buildSessionMenuContributionBlocks } from "./generate-session-menu-contributions.mjs";
import { UI_LOCALES, expandMenuEntriesForLocales } from "./menu-i18n.mjs";

const ACTION_COUNT = 10;
const SESSION_VIEW_PATTERN = /agentResume\\.session/;

const blocks = buildSessionMenuContributionBlocks();
const localizedMain = expandMenuEntriesForLocales(blocks.mainSessionMenu);
const localizedMore = expandMenuEntriesForLocales(blocks.moreSessionMenu);

assert.equal(blocks.mainSessionMenu.length, ACTION_COUNT * ACTION_COUNT);
assert.equal(blocks.moreSessionMenu.length, ACTION_COUNT * ACTION_COUNT + 2);
assert.equal(localizedMain.length, blocks.mainSessionMenu.length * UI_LOCALES.length);
assert.equal(localizedMore.length, blocks.moreSessionMenu.length * UI_LOCALES.length);

for (const entry of localizedMain) {
  assert.match(entry.when, SESSION_VIEW_PATTERN);
  assert.match(entry.when, /agentResume\.uiLocale/);
}

const configureEntry = blocks.moreSessionMenu.find((entry) => entry.command === "agentResume.configureSessionMenu");
assert.ok(configureEntry, "more menu should include configureSessionMenu");

console.log("generate-session-menu-contributions.test.mjs: all assertions passed");