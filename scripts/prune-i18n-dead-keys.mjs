#!/usr/bin/env node
/**
 * Remove extension locale keys nothing references any more.
 *
 *   - it decides what is dead by asking `i18n-usage.mjs`, the same module
 *     `check-i18n.mjs` uses;
 *   - it prints a dry run unless `--write` is passed.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectI18nUsage, extensionLocalesDir } from "../apps/extension/scripts/i18n-usage.mjs";

const write = process.argv.includes("--write");
const usage = collectI18nUsage();
const deadExtension = usage.unusedExtension;

function report(label, dead, total) {
  console.log(`${label}: ${dead.length} unused of ${total}`);
  for (const key of dead) {
    console.log(`  - ${key}`);
  }
}

if (!write) {
  console.log("dry run — pass --write to remove these keys\n");
}
report("extension", deadExtension, usage.extensionEnKeys.size);
if (deadExtension.length === 0) {
  console.log("\nnothing to prune");
  process.exit(0);
}
if (!write) {
  process.exit(0);
}

function pruneLocaleDir(dir, deadKeys) {
  const dead = new Set(deadKeys);
  if (dead.size === 0) return;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const path = join(dir, file);
    const locale = JSON.parse(readFileSync(path, "utf8"));
    let removed = 0;
    for (const key of dead) {
      if (key in locale) {
        delete locale[key];
        removed += 1;
      }
    }
    const sorted = Object.fromEntries(Object.keys(locale).sort().map((key) => [key, locale[key]]));
    writeFileSync(path, `${JSON.stringify(sorted)}\n`);
    console.log(`pruned ${removed} keys from ${path}`);
  }
}

pruneLocaleDir(extensionLocalesDir, deadExtension);

console.log("\nnow run: pnpm run i18n:check");
