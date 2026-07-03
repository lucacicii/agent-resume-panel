#!/usr/bin/env node

import assert from "node:assert/strict";
import { buildHandoffMenuContributionBlocks } from "./generate-handoff-menu-contributions.mjs";

const blocks = buildHandoffMenuContributionBlocks();

assert.equal(blocks.handoffSubmenu.id, "agentResume.handoffTo");
assert.ok(blocks.sessionHandoffTrigger.length === 1);
assert.ok(blocks.acpHandoffTrigger.length === 1);
assert.equal(blocks.handoffSubmenuItems.length, 11);
assert.ok(blocks.handoffSubmenuItems.every((entry) => entry.command.startsWith("agentResume.handoffTo.")));
assert.ok(
  blocks.handoffSubmenuItems.some(
    (entry) => entry.when.includes("agentResume.session.grok") && entry.command === "agentResume.handoffTo.grok"
  )
);
assert.ok(
  blocks.handoffSubmenuItems.some(
    (entry) => entry.when.includes("agentResume.acpChat.grok") && entry.command === "agentResume.handoffTo.grok"
  )
);
assert.ok(blocks.acpContextEntries.length === 3);

console.log("generate-handoff-menu-contributions.test.mjs: ok");