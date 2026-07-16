#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.join(scriptDir, "..");

execFileSync("node", ["scripts/prepare-vsix.mjs"], { cwd: extensionRoot, stdio: "inherit" });

const corePkgPath = path.join(extensionRoot, "node_modules", "@agent-resume", "core", "package.json");
const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf8"));
assert.ok(corePkg.exports?.["./extension"], "vendored @agent-resume/core must expose ./extension in exports");

const requireFromExtension = createRequire(path.join(extensionRoot, "package.json"));
const resolved = requireFromExtension.resolve("@agent-resume/core/extension");
assert.match(resolved, /node_modules[/\\]@agent-resume[/\\]core[/\\]dist[/\\]extension\.js$/);

console.log("prepare-vsix.test.mjs: all assertions passed");