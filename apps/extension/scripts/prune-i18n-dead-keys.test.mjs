#!/usr/bin/env node

/**
 * The pruner deletes locale keys, and a wrongly deleted key is invisible until
 * someone opens the screen that needed it. These checks pin the two rules that
 * keep that from happening: a key the code references is never "unused", and the
 * pruner writes nothing unless asked.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectI18nUsage } from "./i18n-usage.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const pruner = join(root, "scripts", "prune-i18n-dead-keys.mjs");
const desktopEnPath = join(root, "apps", "desktop", "locales", "en.json");

const usage = collectI18nUsage();

// Keys that are on screen but which the reference scan has missed in the past:
// the pruner's old hand-written list included both, and removing them silently
// blanked the selection settings pane and the session detail sheet.
const KNOWN_LIVE = ["desktop.common.delete", "desktop.sessions.autoRename"];
for (const key of KNOWN_LIVE) {
  assert.ok(usage.desktopEnKeys.has(key), `${key} should exist in the desktop locale`);
  assert.ok(usage.desktopUsedKeys.has(key), `${key} is referenced in source and must count as used`);
  assert.ok(!usage.unusedDesktop.includes(key), `${key} must never be reported as unused`);
}

// Guard the rule rather than the two examples: anything the scan collected is
// out of the pruner's reach by construction.
for (const key of usage.desktopUsedKeys) {
  assert.ok(!usage.unusedDesktop.includes(key), `${key} is used but was reported as unused`);
}

// A dry run must be the default, and must not touch the locale files.
const before = readFileSync(desktopEnPath, "utf8");
const output = execFileSync(process.execPath, [pruner], { encoding: "utf8" });
assert.ok(output.includes("dry run"), "running without --write should announce a dry run");
assert.equal(readFileSync(desktopEnPath, "utf8"), before, "a dry run must not rewrite the locale");

// Every key the pruner offers to delete has to be absent from the used set, so
// the printed list is the only thing an operator can approve.
const offered = output
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("- desktop."))
  .map((line) => line.slice(2));
assert.ok(offered.length > 0, "the desktop locale has unused keys, so the pruner should list some");
for (const key of offered) {
  assert.ok(!usage.desktopUsedKeys.has(key), `${key} is used but the pruner offered to delete it`);
}

console.log(`prune-i18n-dead-keys: ok (${offered.length} offered, ${usage.desktopUsedKeys.size} protected)`);
