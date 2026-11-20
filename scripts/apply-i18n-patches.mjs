#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const patchesDir = join(root, "scripts", "i18n-patches");

function loadPatch(name) {
  const path = join(patchesDir, name);
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function applyPatch(localePath, patch, label) {
  const locale = JSON.parse(readFileSync(localePath, "utf8"));
  let applied = 0;
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in locale)) {
      console.warn(`skip missing key in ${label}: ${key}`);
      continue;
    }
    locale[key] = value;
    applied += 1;
  }
  const sorted = Object.fromEntries(Object.keys(locale).sort().map((key) => [key, locale[key]]));
  writeFileSync(localePath, `${JSON.stringify(sorted)}\n`);
  console.log(`applied ${applied} patches to ${label}`);
}

const extensionJa = loadPatch("extension-ja.json");
applyPatch(join(root, "apps/extension/locales/ja.json"), extensionJa, "extension/ja.json");
