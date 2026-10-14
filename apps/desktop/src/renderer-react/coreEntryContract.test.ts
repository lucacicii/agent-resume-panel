import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static guard for how the renderer imports `@agent-resume/core`.
 *
 * The renderer is bundled for the browser, so every import it makes is resolved
 * by esbuild with `platform: "browser"`. The main barrel is a Node barrel: one
 * *value* import drags its whole runtime graph — session sync, settings store,
 * the MCP SDK — into the bundle and the build dies with one "Could not resolve
 * node:*" per Node builtin, none of which points at the offending import.
 *
 * `import type` costs nothing (types are erased), and runtime values have a
 * browser-safe home in the `@agent-resume/core/browser` entry.
 */

const RENDERER_REACT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CORE = "@agent-resume/core";
const CORE_BROWSER_ENTRY = `${CORE}/browser`;

/**
 * `[statement clause][module specifier]` for every import/export declaration.
 * The clause may span lines only inside a brace list, so it can never run past
 * the end of the declaration that introduced it.
 */
const DECLARATION = /(?:\bimport\b|\bexport\b)((?:[^;\n{]|\{[^}]*\})*?)\bfrom\s*["']([^"']+)["']/g;

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

/**
 * Whether a declaration is erased at build time: `import type {...}`, or a
 * brace list where every specifier carries its own `type` marker. A default or
 * namespace binding is a value, however the braces are marked.
 */
function isTypeOnly(clause: string): boolean {
  const text = clause.replace(/\s+/g, " ").trim();
  if (/^type(\s|$)/.test(text)) return true;
  const braces = text.match(/\{([\s\S]*)\}/);
  if (!braces) return false;
  const bindings = text.replace(braces[0], " ").replace(/\btype\b/g, " ").replace(/[,\s]/g, "");
  if (bindings) return false;
  return braces[1]
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean)
    .every((specifier) => /^type\s/.test(specifier));
}

const SOURCE_FILES = listSourceFiles(RENDERER_REACT_ROOT);

describe("core import contract", () => {
  it("imports core values only through the browser-safe entry", () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      for (const [, clause, specifier] of readFileSync(file, "utf8").matchAll(DECLARATION)) {
        if (specifier !== CORE && !specifier.startsWith(`${CORE}/`)) continue;
        if (specifier === CORE_BROWSER_ENTRY || isTypeOnly(clause)) continue;
        offenders.push(`${relative(file)}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
