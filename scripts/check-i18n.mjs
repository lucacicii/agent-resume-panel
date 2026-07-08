#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const srcDir = join(root, "src");
const mediaDir = join(root, "media");
const localesDir = join(root, "locales");

function walk(dir, filter) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full, filter));
    } else if (filter(full)) {
      files.push(full);
    }
  }
  return files;
}

const usedKeys = new Set();
const keyPattern = /\bt\(\s*["']([^"']+)["']/g;

for (const file of walk(srcDir, (path) => path.endsWith(".ts"))) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(keyPattern)) {
    usedKeys.add(match[1]);
  }
}

const uiStringsPath = join(srcDir, "webview", "uiStrings.ts");
const uiStringsSource = readFileSync(uiStringsPath, "utf8");
const exportedUiKeys = new Set();
const uiKeyPattern = /^\s+(\w+):\s*t\(/gm;
for (const match of uiStringsSource.matchAll(uiKeyPattern)) {
  exportedUiKeys.add(match[1]);
}

const mediaFiles = walk(mediaDir, (path) => path.endsWith(".js"));
const mediaContent = mediaFiles.map((file) => readFileSync(file, "utf8")).join("\n");

const uiKeyConsumers = {
  uiStrings: new Set(),
  previewUiStrings: new Set()
};
const mediaUiPattern = /\b(uiStrings|previewUiStrings)\.(\w+)/g;
for (const match of mediaContent.matchAll(mediaUiPattern)) {
  uiKeyConsumers[match[1]].add(match[2]);
}

const allMediaUiKeys = new Set([...uiKeyConsumers.uiStrings, ...uiKeyConsumers.previewUiStrings]);

const enPath = join(localesDir, "en.json");
const en = JSON.parse(readFileSync(enPath, "utf8"));
const enKeys = new Set(Object.keys(en));

const missingInEn = [...usedKeys].filter((key) => !enKeys.has(key)).sort();
const unusedInEn = [...enKeys].filter((key) => !usedKeys.has(key)).sort();

const missingUiInMedia = [...exportedUiKeys].filter((key) => !allMediaUiKeys.has(key)).sort();

let failed = false;

if (missingInEn.length > 0) {
  failed = true;
  console.error("Missing keys in locales/en.json:");
  for (const key of missingInEn) {
    console.error(`  - ${key}`);
  }
}

if (missingUiInMedia.length > 0) {
  failed = true;
  console.error("uiStrings.ts keys not referenced in media/*.js (uiStrings.* or previewUiStrings.*):");
  for (const key of missingUiInMedia) {
    console.error(`  - ${key}`);
  }
}

const localeFiles = readdirSync(localesDir).filter((name) => name.endsWith(".json") && name !== "en.json");
for (const file of localeFiles) {
  const locale = JSON.parse(readFileSync(join(localesDir, file), "utf8"));
  const localeKeys = new Set(Object.keys(locale));
  const missing = [...enKeys].filter((key) => !localeKeys.has(key));
  const extra = [...localeKeys].filter((key) => !enKeys.has(key));
  if (missing.length > 0 || extra.length > 0) {
    failed = true;
    console.error(`Locale mismatch in locales/${file}:`);
    for (const key of missing) {
      console.error(`  missing: ${key}`);
    }
    for (const key of extra) {
      console.error(`  extra: ${key}`);
    }
  }
}

if (unusedInEn.length > 0) {
  console.warn(`Warning: ${unusedInEn.length} unused keys in locales/en.json`);
}

if (failed) {
  process.exit(1);
}

console.log(
  `i18n check passed (${usedKeys.size} t() keys, ${exportedUiKeys.size} uiStrings keys, ${enKeys.size} catalog keys).`
);