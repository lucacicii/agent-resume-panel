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

function flattenCatalog(node, out = {}) {
  if (typeof node === "string") {
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      out[key] = value;
    } else if (value && typeof value === "object") {
      flattenCatalog(value, out);
    }
  }
  return out;
}

function setNested(catalogRoot, localeCode, flatPatch) {
  if (!catalogRoot[localeCode]) {
    catalogRoot[localeCode] = {};
  }
  let applied = 0;
  for (const [key, value] of Object.entries(flatPatch)) {
    const parts = key.split(".");
    const groupParts = parts.slice(1, -1);
    let node = catalogRoot[localeCode];
    for (const part of groupParts) {
      node[part] = node[part] || {};
      node = node[part];
    }
    if (node[key] !== value) {
      node[key] = value;
      applied += 1;
    }
  }
  return applied;
}

const extensionJa = loadPatch("extension-ja.json");
const desktopJa = loadPatch("desktop-ja.json");
const desktopZhCn = loadPatch("desktop-zh-cn.json");

applyPatch(join(root, "apps/extension/locales/ja.json"), extensionJa, "extension/ja.json");

const catalogPath = join(root, "scripts", "desktop-i18n-catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const enFlat = flattenCatalog(catalog.en ?? {});

const zhApplied = setNested(catalog, "zh-cn", desktopZhCn);
const jaFlat = { ...enFlat, ...desktopJa };
const jaApplied = setNested(catalog, "ja", jaFlat);
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`catalog zh-cn patches: ${zhApplied}, ja seeded: ${jaApplied} (+${Object.keys(jaFlat).length} total ja keys)`);