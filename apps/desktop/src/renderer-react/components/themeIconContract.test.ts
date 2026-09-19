import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ICON_SIZE } from "./ThemeIcon";

/**
 * Static guard for the Desktop icon contract.
 *
 * Icons have exactly one entry point (`ThemeIcon`), one size ladder, one stroke
 * weight and no per-component sizing in CSS. These rules used to drift across
 * ~250 call sites and 20 stylesheet rules; this test keeps them converged.
 */

const RENDERER_REACT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STYLES_CSS = path.resolve(RENDERER_REACT_ROOT, "../renderer/styles.css");
const STYLES_ROOT = path.dirname(STYLES_CSS);
const THEME_ICON_FILE = "components/ThemeIcon.tsx";

// Functional SVG (data visualisation, user content, library-rendered chrome) is
// not an icon and is out of scope. Keep this list explicit and short.
const FUNCTIONAL_SVG_SELECTORS = new Set([
  ".artifact-svg-canvas svg",
  "[data-streamdown=\"table-wrapper\"] button svg"
]);

const ICON_ELEMENT = /<(?:ThemeIcon|ProviderIcon)\b[^>]*?\/>/g;
const CLASSNAME_ATTR = /className="([^"]+)"/g;
const CSS_RULE = /([^{}]+?)\{([^{}]*)\}/g;

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function relative(file: string): string {
  return path.relative(RENDERER_REACT_ROOT, file).replaceAll("\\", "/");
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

const SOURCE_FILES = listSourceFiles(RENDERER_REACT_ROOT);

/** Class names that are actually applied to a `ThemeIcon` / `ProviderIcon`. */
function iconClassNames(): string[] {
  const names = new Set<string>();
  for (const file of SOURCE_FILES) {
    for (const element of read(file).match(ICON_ELEMENT) ?? []) {
      for (const value of element.match(CLASSNAME_ATTR) ?? []) {
        for (const token of value.slice("className=\"".length, -1).split(/\s+/)) {
          if (token) names.add(token);
        }
      }
    }
  }
  return [...names];
}

function isIconSelector(selector: string, iconClasses: string[]): boolean {
  if (/(^|[\s,>])svg\b/.test(selector)) return true;
  return iconClasses.some((name) => new RegExp(`\\.${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(selector));
}

function iconCssSizeOffenders(): string[] {
  const css = read(STYLES_CSS);
  const iconClasses = iconClassNames();
  const offenders: string[] = [];
  for (const match of css.matchAll(CSS_RULE)) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    if (FUNCTIONAL_SVG_SELECTORS.has(selector)) continue;
    if (!isIconSelector(selector, iconClasses)) continue;
    const declarations = match[2]
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => /^(width|height|stroke-width)\s*:/.test(entry));
    if (declarations.length) offenders.push(`${selector} -> ${declarations.join(" | ")}`);
  }
  return offenders;
}

describe("icon contract", () => {
  it("keeps the four-step size ladder stable", () => {
    expect(ICON_SIZE).toEqual({ inline: 12, dense: 13, default: 16, prominent: 20 });
    expect(new Set(Object.values(ICON_SIZE)).size).toBe(4);
  });

  it("imports lucide only through ThemeIcon", () => {
    const offenders = SOURCE_FILES
      .filter((file) => relative(file) !== THEME_ICON_FILE && /from\s+"lucide-react"/.test(read(file)))
      .map(relative);
    expect(offenders).toEqual([]);
  });

  it("never overrides stroke weight per call site", () => {
    const offenders = SOURCE_FILES
      .filter((file) => relative(file) !== THEME_ICON_FILE && /\bstrokeWidth=/.test(read(file)))
      .map(relative);
    expect(offenders).toEqual([]);
  });

  it("sizes icons only through ICON_SIZE tokens", () => {
    const numericSize = /<(?:ThemeIcon|ProviderIcon)\b[^>]*?\bsize=\{\s*\d/;
    const offenders = SOURCE_FILES
      .filter((file) => numericSize.test(read(file)))
      .map(relative);
    expect(offenders).toEqual([]);
  });

  it("forbids width, height and stroke-width on icon selectors in styles.css", () => {
    expect(iconCssSizeOffenders()).toEqual([]);
  });

  it("keeps the stylesheet scope honest", () => {
    // `styles.css` is the only stylesheet that may style renderer icons.
    const stylesheets = readdirSync(STYLES_ROOT).filter((name) => name.endsWith(".css")).sort();
    expect(stylesheets).toEqual(["styles.css"]);
  });
});
