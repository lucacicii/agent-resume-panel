/**
 * Which locale keys the extension code actually references.
 *
 * `check-i18n.mjs` needs this to report missing keys and unused ones, and
 * `prune-i18n-dead-keys.mjs` needs it to decide what is safe to delete.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CONTEXT_MENU_COMMAND_SPECS, CONTEXT_SUBMENU_SPECS } from "./menu-i18n.mjs";

const extensionRoot = join(import.meta.dirname, "..");

export const extensionLocalesDir = join(extensionRoot, "locales");

const extensionSrcDir = join(extensionRoot, "src");
const mediaDir = join(extensionRoot, "media");

export function walk(dir, filter) {
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

const extensionPatterns = [/\bt\(\s*["']([^"']+)["']/g];
const extensionScanFiles = [
  ...walk(extensionSrcDir, (path) => path.endsWith(".ts")),
  ...walk(join(extensionRoot, "scripts"), (path) => path.endsWith(".mjs")),
  ...walk(mediaDir, (path) => path.endsWith(".js"))
];

export const extensionScanFilesAll = extensionScanFiles;
export const mediaScanFiles = walk(mediaDir, (path) => path.endsWith(".js"));

/**
 * Used keys for extension locales, plus the catalog keys declared in en.json.
 *
 * `unusedExtension` are the keys that no scan found a reference for — the only
 * keys a pruner may remove.
 */
export function collectI18nUsage() {
  const extensionEn = JSON.parse(readFileSync(join(extensionLocalesDir, "en.json"), "utf8"));
  const extensionEnKeys = new Set(Object.keys(extensionEn));

  const extensionUsedKeys = new Set([
    ...collectUsedKeys(extensionScanFiles, extensionPatterns),
    ...collectExtensionReferencedKeys(extensionScanFiles, extensionEnKeys)
  ]);

  return {
    extensionEn,
    extensionEnKeys,
    extensionUsedKeys,
    unusedExtension: [...extensionEnKeys].filter((key) => !extensionUsedKeys.has(key))
  };
}
