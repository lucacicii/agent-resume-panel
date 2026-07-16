#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { overridesByLocale } from "./desktop-settings-i18n-overrides.mjs";

const root = join(import.meta.dirname, "..");
const catalogPath = join(root, "scripts", "desktop-i18n-catalog.json");
const aliasesPath = join(root, "scripts", "desktop-settings-i18n-aliases.json");
const extensionLocalesDir = join(root, "apps", "extension", "locales");
const desktopLocalesDir = join(root, "apps", "desktop", "locales");
const settingsOverlayLocales = new Set(["ja"]);

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

function writeLocale(filePath, locale) {
  const desktopOnly = Object.fromEntries(
    Object.entries(locale)
      .filter(([key]) => key.startsWith("desktop."))
      .sort(([a], [b]) => a.localeCompare(b))
  );
  writeFileSync(filePath, `${JSON.stringify(desktopOnly)}\n`);
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const enKeys = flattenCatalog(catalog.en ?? catalog);
const zhKeys = catalog["zh-cn"] ? flattenCatalog(catalog["zh-cn"]) : {};
const jaKeys = catalog.ja ? flattenCatalog(catalog.ja) : {};
const catalogSources = { en: enKeys, "zh-cn": zhKeys, ja: jaKeys };
const settingsAliases = JSON.parse(readFileSync(aliasesPath, "utf8"));
const settingsOverrides = overridesByLocale();

function loadExtensionLocale(localeCode) {
  const localePath = join(extensionLocalesDir, `${localeCode}.json`);
  if (!existsSync(localePath)) {
    return {};
  }
  return JSON.parse(readFileSync(localePath, "utf8"));
}

function applyDesktopSettingsOverlay(localeCode, locale) {
  const extensionLocale = loadExtensionLocale(localeCode);
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
    if (aliasKey && typeof extensionLocale[aliasKey] === "string") {
      locale[desktopKey] = extensionLocale[aliasKey];
      applied += 1;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!key.startsWith("desktop.tabs.") && !key.startsWith("desktop.workbench.")) continue;
    locale[key] = value;
    applied += 1;
  }
  if (settingsOverlayLocales.has(localeCode)) {
    return applied;
  }
  return applied;
}

mkdirSync(desktopLocalesDir, { recursive: true });

for (const file of readdirSync(desktopLocalesDir).filter((name) => name.endsWith(".json"))) {
  const localeCode = file.replace(/\.json$/, "");
  const localePath = join(desktopLocalesDir, file);
  const locale = existsSync(localePath) ? JSON.parse(readFileSync(localePath, "utf8")) : {};
  const source =
    localeCode === "zh-cn" && Object.keys(zhKeys).length
      ? zhKeys
      : localeCode === "ja" && Object.keys(jaKeys).length
        ? jaKeys
        : enKeys;
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith("desktop.")) continue;
    locale[key] = value;
  }
  const overlayCount = applyDesktopSettingsOverlay(localeCode, locale);
  writeLocale(localePath, locale);
  const overlayNote = overlayCount ? ` (+${overlayCount} settings i18n)` : "";
  console.log(`merged ${Object.keys(source).length} desktop keys into apps/desktop/locales/${file}${overlayNote}`);
}

const desktopDistLocales = join(root, "apps", "desktop", "dist", "locales");
if (existsSync(desktopLocalesDir)) {
  mkdirSync(desktopDistLocales, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(desktopLocalesDir)) {
    if (!name.endsWith(".json")) continue;
    copyFileSync(join(desktopLocalesDir, name), join(desktopDistLocales, name));
    copied += 1;
  }
  console.log(`copied ${copied} locale files → apps/desktop/dist/locales`);
}