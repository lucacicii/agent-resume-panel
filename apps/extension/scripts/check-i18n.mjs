#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  collectI18nUsage,
  extensionLocalesDir,
  desktopLocalesDir,
  mediaScanFiles
} from "./i18n-usage.mjs";

const extensionRoot = join(import.meta.dirname, "..");
const extensionSrcDir = join(extensionRoot, "src");

const usage = collectI18nUsage();
const extensionEnKeys = usage.extensionEnKeys;
const desktopEnKeys = usage.desktopEnKeys;
const extensionUsedKeys = usage.extensionUsedKeys;
const desktopUsedKeys = usage.desktopUsedKeys;

function assertLocaleShape(label, locale, predicate, errors) {
  for (const key of Object.keys(locale)) {
    if (!predicate(key)) {
      errors.push(`${label}: invalid key "${key}"`);
    }
  }
}

function checkLocaleParity(baseKeys, localesDir, label, errors) {
  const localeFiles = readdirSync(localesDir).filter((name) => name.endsWith(".json") && name !== "en.json");
  for (const file of localeFiles) {
    const locale = JSON.parse(readFileSync(join(localesDir, file), "utf8"));
    const localeKeys = new Set(Object.keys(locale));
    const missing = [...baseKeys].filter((key) => !localeKeys.has(key));
    const extra = [...localeKeys].filter((key) => !baseKeys.has(key));
    if (missing.length > 0 || extra.length > 0) {
      errors.push(`${label} mismatch in ${file} (missing ${missing.length}, extra ${extra.length})`);
    }
  }
}

let failed = false;
const errors = [];

assertLocaleShape("extension locale", usage.extensionEn, (key) => !key.startsWith("desktop."), errors);
assertLocaleShape("desktop locale", usage.desktopEn, (key) => key.startsWith("desktop."), errors);

for (const key of extensionUsedKeys) {
  if (key.startsWith("desktop.")) continue;
  if (!extensionEnKeys.has(key)) {
    errors.push(`Missing extension key in locales/en.json: ${key}`);
  }
}

for (const key of desktopUsedKeys) {
  if (!key.startsWith("desktop.")) continue;
  if (!desktopEnKeys.has(key)) {
    errors.push(`Missing desktop key in apps/desktop/locales/en.json: ${key}`);
  }
}

checkLocaleParity(extensionEnKeys, extensionLocalesDir, "extension", errors);
checkLocaleParity(desktopEnKeys, desktopLocalesDir, "desktop", errors);

const uiStringsPath = join(extensionSrcDir, "webview", "uiStrings.ts");
const uiStringsSource = readFileSync(uiStringsPath, "utf8");
const exportedUiKeys = new Set();
const uiKeyPattern = /^\s+(\w+):\s*t\(/gm;
for (const match of uiStringsSource.matchAll(uiKeyPattern)) {
  exportedUiKeys.add(match[1]);
}

const mediaContent = mediaScanFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const mediaUiPattern = /\b(uiStrings|previewUiStrings)\.(\w+)/g;
const allMediaUiKeys = new Set();
for (const match of mediaContent.matchAll(mediaUiPattern)) {
  allMediaUiKeys.add(match[2]);
}
for (const key of exportedUiKeys) {
  if (!allMediaUiKeys.has(key)) {
    errors.push(`uiStrings.ts key not referenced in media/*.js: ${key}`);
  }
}

if (usage.unusedExtension.length > 0) {
  console.warn(`Warning: ${usage.unusedExtension.length} unused keys in apps/extension/locales/en.json`);
}
if (usage.unusedDesktop.length > 0) {
  console.warn(`Warning: ${usage.unusedDesktop.length} unused keys in apps/desktop/locales/en.json`);
}

if (errors.length > 0) {
  failed = true;
  console.error("i18n check failed:");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `i18n check passed (extension: ${extensionUsedKeys.size} used / ${extensionEnKeys.size} catalog; desktop: ${desktopUsedKeys.size} used / ${desktopEnKeys.size} catalog).`
);
