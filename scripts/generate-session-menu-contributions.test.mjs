#!/usr/bin/env node

import assert from "node:assert/strict";
import { buildSessionMenuContributionBlocks } from "./generate-session-menu-contributions.mjs";

const ACTION_COUNT = 7;
const SESSION_VIEW_PATTERN = /agentResume\\.session/;

const blocks = buildSessionMenuContributionBlocks();

assert.equal(blocks.mainSessionMenu.length, ACTION_COUNT * ACTION_COUNT);
assert.equal(blocks.moreSessionMenu.length, ACTION_COUNT * ACTION_COUNT + 2);

for (const entry of blocks.mainSessionMenu) {
  assert.match(entry.when, SESSION_VIEW_PATTERN);
}

const configureEntry = blocks.moreSessionMenu.find((entry) => entry.command === "agentResume.configureSessionMenu");
assert.ok(configureEntry, "more menu should include configureSessionMenu");

console.log("generate-session-menu-contributions.test.mjs: all assertions passed");