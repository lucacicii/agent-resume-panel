/**
 * Which locale keys the code actually references.
 *
 * `check-i18n.mjs` needs this to report missing keys and unused ones, and
 * `prune-i18n-dead-keys.mjs` needs it to decide what is safe to delete. Keeping
 * one implementation matters: the pruner used to carry its own hand-maintained
 * list of "dead" keys, which drifted and ended up deleting strings that were
 * still on screen (`desktop.common.delete` in the selection settings pane).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CONTEXT_MENU_COMMAND_SPECS, CONTEXT_SUBMENU_SPECS } from "./menu-i18n.mjs";

const extensionRoot = join(import.meta.dirname, "..");
const desktopRoot = join(extensionRoot, "..", "desktop");
const coreSrcDir = join(extensionRoot, "..", "..", "packages", "core", "src");

export const extensionLocalesDir = join(extensionRoot, "locales");
export const desktopLocalesDir = join(desktopRoot, "locales");

const extensionSrcDir = join(extensionRoot, "src");
const mediaDir = join(extensionRoot, "media");
const desktopRendererDir = join(desktopRoot, "src", "renderer");
const desktopRendererReactDir = join(desktopRoot, "src", "renderer-react");
const desktopMainDir = join(desktopRoot, "src", "main");
const desktopIndexHtml = join(desktopRendererDir, "index.html");

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

function collectDesktopReferencedKeys(files, catalogKeys) {
  const used = new Set();
  const blob = files.map((file) => readFileSync(file, "utf8")).join("\n");

  for (const key of catalogKeys) {
    if (blob.includes(key)) {
      used.add(key);
    }
  }

  // Dynamically composed keys: `desktop.foo.bar.${expr}` or `desktop.foo.mode${expr}`
  // marks every catalog key under `desktop.foo.bar.` / `desktop.foo.mode` as used.
  // Without this, template-literal keys look "unused" and pruning them breaks runtime.
  for (const match of blob.matchAll(/`(desktop\.[A-Za-z0-9_.]*?)\$\{/g)) {
    const prefix = match[1];
    for (const key of catalogKeys) {
      if (key.startsWith(prefix)) {
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

export const extensionScanFilesAll = extensionScanFiles;
export const mediaScanFiles = walk(mediaDir, (path) => path.endsWith(".js"));

/**
 * Used keys for both locales, plus the catalog keys each locale declares.
 *
 * `unusedExtension` / `unusedDesktop` are the keys that no scan found a
 * reference for — the only keys a pruner may remove.
 */
export function collectI18nUsage() {
  const extensionEn = JSON.parse(readFileSync(join(extensionLocalesDir, "en.json"), "utf8"));
  const desktopEn = JSON.parse(readFileSync(join(desktopLocalesDir, "en.json"), "utf8"));

  const extensionEnKeys = new Set(Object.keys(extensionEn).filter((key) => !key.startsWith("desktop.")));
  const desktopEnKeys = new Set(Object.keys(desktopEn).filter((key) => key.startsWith("desktop.")));

  const extensionUsedKeys = new Set([
    ...collectUsedKeys(extensionScanFiles, extensionPatterns),
    ...collectExtensionReferencedKeys(extensionScanFiles, extensionEnKeys)
  ]);
  const desktopUsedKeys = new Set([
    ...collectUsedKeys(desktopScanFiles, desktopPatterns),
    ...collectDesktopReferencedKeys(desktopScanFiles, desktopEnKeys)
  ]);

  return {
    extensionEn,
    desktopEn,
    extensionEnKeys,
    desktopEnKeys,
    extensionUsedKeys,
    desktopUsedKeys,
    unusedExtension: [...extensionEnKeys].filter((key) => !extensionUsedKeys.has(key)),
    unusedDesktop: [...desktopEnKeys].filter((key) => !desktopUsedKeys.has(key))
  };
}
