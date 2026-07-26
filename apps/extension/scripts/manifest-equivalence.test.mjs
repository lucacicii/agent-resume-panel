#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.join(scriptDir, "..");

const BASELINES = {
  openvsx: {
    commands: 487,
    menuEntries: 20043,
    submenus: 13,
    activationEvents: 45,
    views: 4
  },
  marketplace: {
    commands: 162,
    menuEntries: 20043,
    submenus: 13,
    activationEvents: 39,
    views: 4
  }
};

function menuEntryCount(menus) {
  return Object.values(menus ?? {}).reduce((sum, entries) => sum + entries.length, 0);
}

function loadMerged(variant) {
  const args = variant === "marketplace" ? ["--variant=marketplace"] : [];
  execSync(`node scripts/merge-extension-manifest.mjs ${args.join(" ")}`, { cwd: extensionRoot, stdio: "inherit" });
  return JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
}

for (const [variant, expected] of Object.entries(BASELINES)) {
  const pkg = loadMerged(variant);
  assert.equal(pkg.contributes.commands.length, expected.commands, `${variant} commands`);
  assert.equal(menuEntryCount(pkg.contributes.menus), expected.menuEntries, `${variant} menu entries`);
  assert.equal(pkg.contributes.submenus.length, expected.submenus, `${variant} submenus`);
  assert.equal(pkg.activationEvents.length, expected.activationEvents, `${variant} activationEvents`);
  assert.equal(pkg.contributes.views.agentResume.length, expected.views, `${variant} views`);
}

execSync("node scripts/merge-extension-manifest.mjs", { cwd: extensionRoot, stdio: "inherit" });
console.log("manifest-equivalence.test.mjs: all assertions passed");
