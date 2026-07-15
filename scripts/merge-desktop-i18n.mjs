#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const catalogPath = join(root, "scripts", "desktop-i18n-catalog.json");
const localesDir = join(root, "locales");

function normalizePlaceholders(value) {
  const names = [];
  const normalized = value.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    if (!names.includes(name)) {
      names.push(name);
    }
    return `{${names.indexOf(name)}}`;
  });
  return normalized;
}

function flattenCatalog(node, out = {}) {
  if (typeof node === "string") {
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      out[key] = normalizePlaceholders(value);
    } else if (value && typeof value === "object") {
      flattenCatalog(value, out);
    }
  }
  return out;
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const enKeys = flattenCatalog(catalog.en ?? catalog);
const zhKeys = catalog["zh-cn"] ? flattenCatalog(catalog["zh-cn"]) : {};

for (const file of readdirSync(localesDir).filter((name) => name.endsWith(".json"))) {
  const localePath = join(localesDir, file);
  const locale = JSON.parse(readFileSync(localePath, "utf8"));
  const localeCode = file.replace(/\.json$/, "");
  const source = localeCode === "zh-cn" && Object.keys(zhKeys).length ? zhKeys : enKeys;
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith("desktop.")) continue;
    locale[key] = value;
  }
  const sorted = Object.fromEntries(Object.keys(locale).sort().map((key) => [key, locale[key]]));
  writeFileSync(localePath, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`merged ${Object.keys(source).length} desktop keys into locales/${file}`);
}