#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { overridesByLocale } from "./desktop-settings-i18n-overrides.mjs";

const root = join(import.meta.dirname, "..");
const catalogPath = join(root, "scripts", "desktop-i18n-catalog.json");
const aliasesPath = join(root, "scripts", "desktop-settings-i18n-aliases.json");
const localesDir = join(root, "locales");
const settingsOverlayLocales = new Set(["ja", "ko", "de", "es", "fr", "it", "pt-br", "ru"]);

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
const settingsAliases = JSON.parse(readFileSync(aliasesPath, "utf8"));
const settingsOverrides = overridesByLocale();

function applyDesktopSettingsOverlay(localeCode, locale) {
  if (!settingsOverlayLocales.has(localeCode)) return 0;
  let applied = 0;
  const overrides = settingsOverrides[localeCode] ?? {};
  const settingsKeys = new Set([
    ...Object.keys(locale).filter((key) => key.startsWith("desktop.settings.")),
    ...Object.keys(overrides).filter((key) => key.startsWith("desktop.settings."))
  ]);
  for (const desktopKey of settingsKeys) {
    if (overrides[desktopKey]) {
      locale[desktopKey] = overrides[desktopKey];
      applied += 1;
      continue;
    }
    const aliasKey = settingsAliases[desktopKey];
    if (aliasKey && typeof locale[aliasKey] === "string") {
      locale[desktopKey] = locale[aliasKey];
      applied += 1;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!key.startsWith("desktop.tabs.")) continue;
    locale[key] = value;
    applied += 1;
  }
  return applied;
}

for (const file of readdirSync(localesDir).filter((name) => name.endsWith(".json"))) {
  const localePath = join(localesDir, file);
  const locale = JSON.parse(readFileSync(localePath, "utf8"));
  const localeCode = file.replace(/\.json$/, "");
  const source = localeCode === "zh-cn" && Object.keys(zhKeys).length ? zhKeys : enKeys;
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith("desktop.")) continue;
    locale[key] = value;
  }
  const overlayCount = applyDesktopSettingsOverlay(localeCode, locale);
  const sorted = Object.fromEntries(Object.keys(locale).sort().map((key) => [key, locale[key]]));
  writeFileSync(localePath, `${JSON.stringify(sorted, null, 2)}\n`);
  const overlayNote = overlayCount ? ` (+${overlayCount} settings i18n)` : "";
  console.log(`merged ${Object.keys(source).length} desktop keys into locales/${file}${overlayNote}`);
}

const desktopDistLocales = join(root, "apps", "desktop", "dist", "locales");
if (existsSync(localesDir)) {
  mkdirSync(desktopDistLocales, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(localesDir)) {
    if (!name.endsWith(".json")) continue;
    copyFileSync(join(localesDir, name), join(desktopDistLocales, name));
    copied += 1;
  }
  console.log(`copied ${copied} locale files → apps/desktop/dist/locales`);
}