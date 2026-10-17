import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ICON_SIZE, ICON_STROKE_WIDTH } from "./ThemeIcon";

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

const DESKTOP_ROOT = path.resolve(RENDERER_REACT_ROOT, "../..");
const DESKTOP_MANIFEST = path.join(DESKTOP_ROOT, "package.json");
const DESKTOP_SRC_ROOT = path.join(DESKTOP_ROOT, "src");

/** Every way a source file can reach an icon library. */
const ICON_LIBRARY_IMPORTS = [
  { label: "lucide-react", pattern: /from\s+["']lucide-react(?:\/[^"']*)?["']/ },
  { label: "sf-symbols-lib (retired)", pattern: /from\s+["']sf-symbols-lib(?:\/[^"']*)?["']/ }
] as const;

/**
 * A *code path* to the retired library — an import, a dynamic import or a
 * require. Deliberately not a bare name match: ThemeIcon's own doc comment
 * names `sf-symbols-lib` to say it must not come back, and prose about the
 * retired layer is the contract working, not a violation.
 */
const RETIRED_SF_REACHES = /(?:from|import|require)\s*\(?\s*["']sf-symbols-lib/;

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
  it("keeps the size ladder stable and pixel-aligned", () => {
    expect(ICON_SIZE).toEqual({
      inline: 12,
      dense: 14,
      default: 16,
      prominent: 20,
      hero: 24
    });
    expect(new Set(Object.values(ICON_SIZE)).size).toBe(5);
    // Every ladder step must be an even integer for pixel-perfect centering on Retina and 1x screens.
    for (const [token, size] of Object.entries(ICON_SIZE)) {
      expect(size % 2, `Icon size token ${token} (${size}px) must be an even integer`).toBe(0);
    }
  });

  it("keeps one stroke weight in the acceptable band", () => {
    // A band rather than an equality: the value is meant to be tuned against
    // the app on a real display, but drifting to 3 is a regression, not a tune.
    expect(typeof ICON_STROKE_WIDTH).toBe("number");
    expect(ICON_STROKE_WIDTH).toBeGreaterThanOrEqual(1.5);
    expect(ICON_STROKE_WIDTH).toBeLessThanOrEqual(2.25);
  });

  it("imports icon libraries only through ThemeIcon", () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      if (relative(file) === THEME_ICON_FILE) continue;
      const source = read(file);
      for (const { label, pattern } of ICON_LIBRARY_IMPORTS) {
        if (pattern.test(source)) offenders.push(`${relative(file)} -> ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never reaches for the retired SF Symbols library, anywhere in the app", () => {
    // The renderer guard above cannot see src/main, so scan the whole desktop
    // app — and pin the manifest, so the dependency cannot quietly come back.
    const offenders = listSourceFiles(DESKTOP_SRC_ROOT)
      .filter((file) => RETIRED_SF_REACHES.test(read(file)))
      .map((file) => path.relative(DESKTOP_SRC_ROOT, file));
    expect(offenders).toEqual([]);

    const manifest = JSON.parse(read(DESKTOP_MANIFEST)) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    const retired = /sf-symbols-lib/;
    expect(Object.keys(declared).filter((name) => retired.test(name))).toEqual([]);
  });

  it("does not tag icons with an icon-system marker", () => {
    // One icon system means no per-system hook. `data-icon-system` is exactly
    // what let the SF rules drift out of sync with the component: the stylesheet
    // asked for "lucide" while the component emitted "open", so the rule that
    // was supposed to give Lucide icons their stroke never matched.
    const offenders = SOURCE_FILES
      .filter((file) => /data-icon-system/.test(read(file)))
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
