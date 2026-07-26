#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CONTEXT_MENU_COMMAND_SPECS, CONTEXT_SUBMENU_SPECS } from "./menu-i18n.mjs";

const extensionRoot = join(import.meta.dirname, "..");
const desktopRoot = join(extensionRoot, "..", "desktop");
const coreSrcDir = join(extensionRoot, "..", "..", "packages", "core", "src");
const extensionLocalesDir = join(extensionRoot, "locales");
const desktopLocalesDir = join(desktopRoot, "locales");
const extensionSrcDir = join(extensionRoot, "src");
const mediaDir = join(extensionRoot, "media");
const desktopRendererDir = join(desktopRoot, "src", "renderer");
const desktopRendererReactDir = join(desktopRoot, "src", "renderer-react");
const desktopMainDir = join(desktopRoot, "src", "main");
const desktopIndexHtml = join(desktopRendererDir, "index.html");

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

function collectUsedKeys(files, patterns) {
  const usedKeys = new Set();
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        usedKeys.add(match[1]);
      }
    }
  }
  return usedKeys;
}

function collectExtensionReferencedKeys(files, catalogKeys) {
  const used = new Set();
  const blob = files.map((file) => readFileSync(file, "utf8")).join("\n");

  for (const spec of [...CONTEXT_MENU_COMMAND_SPECS, ...CONTEXT_SUBMENU_SPECS]) {
    used.add(spec.key);
  }

  for (const key of catalogKeys) {
    if (blob.includes(key)) {
      used.add(key);
    }
  }

  if (blob.includes("tree.gtd.status.")) {
    for (const key of catalogKeys) {
      if (key.startsWith("tree.gtd.status.")) {
        used.add(key);
      }
    }
  }

  return used;
}

function collectDesktopReferencedKeys(files, catalogKeys) {
  const used = new Set();
  const blob = files.map((file) => readFileSync(file, "utf8")).join("\n");

  for (const key of catalogKeys) {
    if (blob.includes(key)) {
      used.add(key);
    }
  }

  return used;
}

function assertLocaleShape(label, localePath, predicate, errors) {
  const locale = JSON.parse(readFileSync(localePath, "utf8"));
  for (const key of Object.keys(locale)) {
    if (!predicate(key)) {
      errors.push(`${label}: invalid key "${key}"`);
    }
  }
  return locale;
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

const extensionPatterns = [/\bt\(\s*["']([^"']+)["']/g];
const extensionScanFiles = [
  ...walk(extensionSrcDir, (path) => path.endsWith(".ts")),
  ...walk(join(extensionRoot, "scripts"), (path) => path.endsWith(".mjs")),
  ...walk(mediaDir, (path) => path.endsWith(".js"))
];
const extensionTKeys = collectUsedKeys(extensionScanFiles, extensionPatterns);

const desktopPatterns = [
  /\bt\(\s*["']([^"']+)["']/g,
  /\bpt\(\s*["']([^"']+)["']/g,
  /progressText\(\s*["']([^"']+)["']/g,
  /data-i18n(?:-placeholder|-title|-aria-label)?="([^"]+)"/g
];
const desktopScanFiles = [
  ...walk(desktopRendererDir, (path) => path.endsWith(".js")),
  // React settings/workbench UI lives here; without it, desktop.* keys look "unused"
  // and missing keys used only from TSX are not reported. Skip unit tests.
  ...walk(
    desktopRendererReactDir,
    (path) =>
      (path.endsWith(".ts") || path.endsWith(".tsx")) &&
      !path.endsWith(".test.ts") &&
      !path.endsWith(".test.tsx")
  ),
  ...walk(desktopMainDir, (path) => path.endsWith(".ts")),
  ...walk(coreSrcDir, (path) => path.endsWith(".ts")),
  desktopIndexHtml
];
const desktopDirectKeys = collectUsedKeys(desktopScanFiles, desktopPatterns);

const extensionEnPath = join(extensionLocalesDir, "en.json");
const desktopEnPath = join(desktopLocalesDir, "en.json");
const extensionEn = assertLocaleShape(
  "extension locale",
  extensionEnPath,
  (key) => !key.startsWith("desktop."),
  errors
);
const desktopEn = assertLocaleShape(
  "desktop locale",
  desktopEnPath,
  (key) => key.startsWith("desktop."),
  errors
);

const extensionEnKeys = new Set(Object.keys(extensionEn));
const desktopEnKeys = new Set(Object.keys(desktopEn));

const extensionReferencedKeys = collectExtensionReferencedKeys(extensionScanFiles, extensionEnKeys);
const extensionUsedKeys = new Set([...extensionTKeys, ...extensionReferencedKeys]);

const desktopReferencedKeys = collectDesktopReferencedKeys(desktopScanFiles, desktopEnKeys);
const desktopUsedKeys = new Set([...desktopDirectKeys, ...desktopReferencedKeys]);

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

const mediaContent = walk(mediaDir, (path) => path.endsWith(".js"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
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

const unusedExtension = [...extensionEnKeys].filter((key) => !extensionUsedKeys.has(key));
const unusedDesktop = [...desktopEnKeys].filter((key) => !desktopUsedKeys.has(key));
if (unusedExtension.length > 0) {
  console.warn(`Warning: ${unusedExtension.length} unused keys in apps/extension/locales/en.json`);
}
if (unusedDesktop.length > 0) {
  console.warn(`Warning: ${unusedDesktop.length} unused keys in apps/desktop/locales/en.json`);
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