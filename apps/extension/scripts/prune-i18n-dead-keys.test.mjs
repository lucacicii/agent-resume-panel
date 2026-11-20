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
const extensionEnPath = join(root, "apps", "extension", "locales", "en.json");

const usage = collectI18nUsage();

for (const key of usage.extensionUsedKeys) {
  assert.ok(!usage.unusedExtension.includes(key), `${key} is used but was reported as unused`);
}

// A dry run must be the default, and must not touch the locale files.
const before = readFileSync(extensionEnPath, "utf8");
const output = execFileSync(process.execPath, [pruner], { encoding: "utf8" });
assert.ok(output.includes("dry run"), "running without --write should announce a dry run");
assert.equal(readFileSync(extensionEnPath, "utf8"), before, "a dry run must not rewrite the locale");

const offered = output
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("- "))
  .map((line) => line.slice(2));
for (const key of offered) {
  assert.ok(!usage.extensionUsedKeys.has(key), `${key} is used but the pruner offered to delete it`);
}

assert.equal(
  offered.length,
  usage.unusedExtension.length,
  "the pruner should offer exactly the keys the scan called unused"
);
for (const key of offered) {
  assert.ok(usage.unusedExtension.includes(key), `${key} was offered but is not in the unused set`);
}

console.log(
  `prune-i18n-dead-keys: ok (${offered.length} offered, ${usage.extensionUsedKeys.size} protected)`
);
