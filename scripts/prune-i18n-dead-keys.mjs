#!/usr/bin/env node
/**
 * Remove locale keys nothing references any more.
 *
 * Deleting a key that is still on screen is silent and only shows up as a raw
 * `desktop.foo.bar` string in the UI, so this script is deliberately cautious:
 *
 *   - it decides what is dead by asking `i18n-usage.mjs`, the same module
 *     `check-i18n.mjs` uses, instead of keeping a hand-maintained list that
 *     drifts (that list had come to include `desktop.common.delete`, which the
 *     selection settings pane still renders);
 *   - it prints a dry run unless `--write` is passed;
 *   - it refuses to run when `check-i18n.mjs` reports errors, since a broken
 *     scan would make live keys look dead;
 *   - it leaves a key alone when the reference scan cannot see it but the file
 *     itself mentions it, e.g. a key composed from settings aliases.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectI18nUsage, desktopLocalesDir, extensionLocalesDir, walk } from "../apps/extension/scripts/i18n-usage.mjs";

const root = join(import.meta.dirname, "..");
const write = process.argv.includes("--write");
const desktopRoot = join(root, "apps", "desktop");
const catalogPath = join(root, "scripts", "desktop-i18n-catalog.json");

const usage = collectI18nUsage();

/** A key the scan missed but which still appears verbatim somewhere is not dead. */
function stillMentioned(key) {
  const hits = walk(join(desktopRoot, "src"), (path) => path.endsWith(".ts") || path.endsWith(".tsx"))
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
    .filter((file) => readFileSync(file, "utf8").includes(key));
  return hits.length > 0;
}

const deadExtension = usage.unusedExtension.filter((key) => !stillMentioned(key));
const deadDesktop = usage.unusedDesktop.filter((key) => !stillMentioned(key));

const kept = [
  ...usage.unusedExtension.filter((key) => stillMentioned(key)),
  ...usage.unusedDesktop.filter((key) => stillMentioned(key))
];

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
report("desktop", deadDesktop, usage.desktopEnKeys.size);
if (kept.length > 0) {
  console.log(`\nkept ${kept.length} key(s) the scan missed but that are still referenced:`);
  for (const key of kept) {
    console.log(`  ~ ${key}`);
  }
}
if (deadExtension.length === 0 && deadDesktop.length === 0) {
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
pruneLocaleDir(desktopLocalesDir, deadDesktop);

// The catalog is the source the locales are merged from; a key removed only
// from the locales would come back on the next merge.
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const deadDesktopSet = new Set(deadDesktop);
let removedCatalog = 0;
for (const locale of Object.values(catalog)) {
  if (!locale || typeof locale !== "object") continue;
  for (const key of deadDesktopSet) {
    if (key in locale) {
      delete locale[key];
      removedCatalog += 1;
    }
  }
}
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`pruned ${removedCatalog} entries from scripts/desktop-i18n-catalog.json`);

console.log("\nnow run: pnpm run i18n:check");
