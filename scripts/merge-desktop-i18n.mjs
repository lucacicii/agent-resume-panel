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
const obsoleteDesktopKeys = new Set([
  "desktop.workbench.terminalScrollPosition",
  "desktop.workbench.sidePanelBack",
  "desktop.workbench.renameSession",
  "desktop.workbench.renameSessionTitle",
  "desktop.workbench.generatingTitle",
  "desktop.workbench.titleSuggested",
  "desktop.workbench.titleEmpty",
  "desktop.im.emptyRoomNoFolder",
  // Link Graph: removed dig/continue/branches UI (core agent only)
  "desktop.workbench.linkGraphIncomplete",
  "desktop.workbench.linkGraphMeta",
  "desktop.workbench.linkGraphChain",
  "desktop.workbench.linkGraphAllHits",
  "desktop.workbench.linkGraphContinue",
  "desktop.workbench.linkGraphTogglePreview",
  "desktop.workbench.linkGraphContinueNoProgress",
  "desktop.workbench.linkGraphChainCumulativeHint",
  "desktop.workbench.linkGraphLlmPath",
  "desktop.workbench.linkGraphShowMore",
  "desktop.workbench.linkGraphShowLess",
  "desktop.workbench.linkGraphMainPath",
  "desktop.workbench.linkGraphMainPathHint",
  "desktop.workbench.linkGraphEvidence",
  "desktop.workbench.linkGraphPrimaryChainHint",
  "desktop.workbench.linkGraphBranches",
  "desktop.workbench.linkGraphBranchesHint",
  "desktop.workbench.linkGraphPrunedBranches",
  "desktop.workbench.linkGraphPrunedHint",
  "desktop.workbench.linkGraphDiscarded",
  "desktop.workbench.linkGraphChainGroups",
  "desktop.workbench.linkGraphChainGroupsHint",
  "desktop.workbench.linkGraphBranchGroup",
  "desktop.workbench.linkGraphTruncated",
  // Settings → Models replaced by Settings → Providers (provider pool)
  "desktop.settings.paneModels",
  "desktop.settings.paneModelsDesc",
  "desktop.settings.toolLlm",
  "desktop.settings.toolLlmFootnote",
  "desktop.settings.chatLlm",
  "desktop.settings.chatModel",
  "desktop.settings.chatModelFootnote",
  "desktop.settings.embedding",
  "desktop.settings.embeddingFootnote",
  "desktop.settings.model",
  "desktop.settings.baseUrlOptional",
  "desktop.settings.apiKeyOptional",
  "desktop.settings.testConnectionHint",
  // Flow DAG: removed desktop tab, inspector copy, and Ask tool category
  "desktop.tabs.flow",
  "desktop.agent.toolCategory.flow",
  "desktop.flow.addNode",
  "desktop.flow.created",
  "desktop.flow.currentRun",
  "desktop.flow.defaultName",
  "desktop.flow.deleteConfirm",
  "desktop.flow.empty",
  "desktop.flow.emptyHint",
  "desktop.flow.emptyTitle",
  "desktop.flow.inspector",
  "desktop.flow.namePrompt",
  "desktop.flow.native",
  "desktop.flow.nativePermissionHint",
  "desktop.flow.nativeSession",
  "desktop.flow.nativeSessionRequired",
  "desktop.flow.newFlow",
  "desktop.flow.newNode",
  "desktop.flow.newYolo",
  "desktop.flow.nodeInspector",
  "desktop.flow.nodeRunning",
  "desktop.flow.nodeTitle",
  "desktop.flow.project",
  "desktop.flow.projectPathRequired",
  "desktop.flow.provider",
  "desktop.flow.removeNode",
  "desktop.flow.retryNode",
  "desktop.flow.run",
  "desktop.flow.runCompleted",
  "desktop.flow.runStopped",
  "desktop.flow.saveTemplate",
  "desktop.flow.saved",
  "desktop.flow.selectNodeHint",
  "desktop.flow.selectSession",
  "desktop.flow.sessionMode",
  "desktop.flow.sessionStartFailed",
  "desktop.flow.setStatus",
  "desktop.flow.skipNode",
  "desktop.flow.stop",
  "desktop.flow.templateNamePrompt",
  "desktop.flow.templateSaved",
  "desktop.flow.templates",
  "desktop.flow.title",
  "desktop.flow.viewNote",
  "desktop.flow.viewSession",
  "desktop.flow.workflows",
  "desktop.flow.yoloHint"
]);

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
  const localizedSource =
    localeCode === "zh-cn" && Object.keys(zhKeys).length
      ? zhKeys
      : localeCode === "ja" && Object.keys(jaKeys).length
        ? jaKeys
        : enKeys;
  // Keep every generated locale structurally complete when a localized catalog
  // lags behind English; untranslated entries intentionally fall back to en.
  const source = localeCode === "en" ? enKeys : { ...enKeys, ...localizedSource };
  for (const key of obsoleteDesktopKeys) {
    delete locale[key];
  }
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith("desktop.")) continue;
    locale[key] = value;
  }
  const overlayCount = applyDesktopSettingsOverlay(localeCode, locale);
  if (localeCode !== "en") {
    const englishLocale = JSON.parse(readFileSync(join(desktopLocalesDir, "en.json"), "utf8"));
    for (const [key, value] of Object.entries(englishLocale)) {
      if (!(key in locale)) locale[key] = value;
    }
  }
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
