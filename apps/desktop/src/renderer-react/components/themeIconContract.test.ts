import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ICON_SIZE } from "./ThemeIcon";

/**
 * Static guard for the Desktop icon contract (ui-design-system.md §4.22).
 *
 * Icons have exactly one entry point (`ThemeIcon`), one size ladder, one stroke
 * weight and no per-component sizing in CSS. These rules used to drift across
 * ~250 call sites and 20 stylesheet rules; this test keeps them converged.
 */

const RENDERER_REACT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STYLES_CSS = path.resolve(RENDERER_REACT_ROOT, "../renderer/styles.css");
const THEME_ICON_FILE = "components/ThemeIcon.tsx";

// Functional SVG (data visualisation, user content, library-rendered chrome) is
// not an icon and is out of scope. Keep this list explicit and short.
const FUNCTIONAL_SVG_SELECTORS = new Set([
  ".artifact-svg-canvas svg",
  "[data-streamdown=\"table-wrapper\"] button svg"
]);

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

const SOURCE_FILES = listSourceFiles(RENDERER_REACT_ROOT);

function read(file: string): string {
  return readFileSync(file, "utf8");
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
    const css = read(STYLES_CSS);
    const rulePattern = /([^{}]+?)\{([^{}]*)\}/g;
    const offenders: string[] = [];
    for (const match of css.matchAll(rulePattern)) {
      const selector = match[1].trim().replace(/\s+/g, " ").replace(/\s*,\s*$/, "");
      if (!/(^|[\s,>])svg\b/.test(selector) || FUNCTIONAL_SVG_SELECTORS.has(selector)) continue;
      const declarations = match[2]
        .split(";")
        .map((entry) => entry.trim())
        .filter((entry) => /^(width|height|stroke-width)\s*:/.test(entry));
      if (declarations.length) offenders.push(`${selector} -> ${declarations.join(" | ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
