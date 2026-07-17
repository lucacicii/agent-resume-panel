#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Compile output required; run after `pnpm run compile`.
const { formatProjectLabel, normalizeProjectPath } = require("../out/projects/projectAliases.js");

assert.equal(formatProjectLabel("/Users/me/agent-resume-panel"), "agent-resume-panel");
assert.equal(formatProjectLabel("/Users/me/agent-resume-panel", "  My Alias  "), "agent-resume-panel · My Alias");
assert.equal(formatProjectLabel("/Users/me/agent-resume-panel", ""), "agent-resume-panel");
assert.equal(formatProjectLabel("/Users/me/agent-resume-panel", "   "), "agent-resume-panel");

assert.equal(normalizeProjectPath("/foo/bar/"), normalizeProjectPath("/foo/bar"));

console.log("project-aliases.test.mjs: all assertions passed");
