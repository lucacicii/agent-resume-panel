/**
 * Parse import/export bindings and resolve module paths for Link Graph dig.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export type ImportBinding = {
  localName: string;
  importedName: string;
  specifier: string;
  line: number;
  isTypeOnly?: boolean;
  isReexport?: boolean;
};

export type ResolvedModule = {
  absolutePath: string;
  relativePath: string;
  specifier: string;
};

const JS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".json"];

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Join physical lines that are part of multi-line import/export statements. */
export function coalesceSourceStatements(source: string): Array<{ text: string; startLine: number }> {
  const lines = source.split(/\r?\n/);
  const out: Array<{ text: string; startLine: number }> = [];
  let buf = "";
  let start = 1;
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inStr: '"' | "'" | "`" | null = null;
  let escape = false;

  const flush = () => {
    const text = buf.trim();
    if (text) out.push({ text, startLine: start });
    buf = "";
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!buf) start = i + 1;
    if (buf) buf += " ";
    buf += line;

    for (let j = 0; j < line.length; j += 1) {
      const ch = line[j];
      if (inStr) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        continue;
      }
      if (ch === "(") depthParen += 1;
      else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
      else if (ch === "{") depthBrace += 1;
      else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
      else if (ch === "[") depthBracket += 1;
      else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
    }

    const balanced = depthParen === 0 && depthBrace === 0 && depthBracket === 0 && !inStr;
    if (balanced && /[;{}]\s*$/.test(line.trim()) || (balanced && /^\s*(import|export)\b/.test(buf) && /from\s+['"][^'"]+['"]\s*;?\s*$/.test(buf))) {
      flush();
    } else if (balanced && !/^\s*(import|export)\b/.test(buf) && buf.includes(";")) {
      // non-import statement ended — still flush to keep stream moving
      flush();
    }
  }
  if (buf.trim()) flush();
  return out;
}

/** Parse TS/JS import and re-export statements (supports multi-line via coalesce). */
export function parseJsImports(source: string): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  const statements = coalesceSourceStatements(source);

  for (const stmt of statements) {
    const line = stmt.text;
    const lineNo = stmt.startLine;

    const fromImport = line.match(
      /^\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/
    );
    if (fromImport) {
      pushJsClause(bindings, fromImport[2].trim(), fromImport[3], lineNo, Boolean(fromImport[1]), false);
      continue;
    }

    // side-effect import
    const side = line.match(/^\s*import\s+['"]([^'"]+)['"]/);
    if (side) continue;

    const reexport = line.match(/^\s*export\s+(type\s+)?\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/);
    if (reexport) {
      const isTypeOnly = Boolean(reexport[1]);
      for (const part of reexport[2].split(",")) {
        const m = part.trim().match(/^(\w+)\s*(?:as\s+(\w+))?$/);
        if (!m) continue;
        bindings.push({
          localName: m[2] || m[1],
          importedName: m[1],
          specifier: reexport[3],
          line: lineNo,
          isTypeOnly,
          isReexport: true
        });
      }
      continue;
    }

    const starRe = line.match(/^\s*export\s+\*(?:\s+as\s+(\w+))?\s+from\s+['"]([^'"]+)['"]/);
    if (starRe) {
      bindings.push({
        localName: starRe[1] || "*",
        importedName: "*",
        specifier: starRe[2],
        line: lineNo,
        isReexport: true
      });
      continue;
    }

    const req = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (req) {
      bindings.push({
        localName: req[1],
        importedName: "default",
        specifier: req[2],
        line: lineNo
      });
    }
  }

  return bindings;
}

function pushJsClause(
  bindings: ImportBinding[],
  clause: string,
  specifier: string,
  line: number,
  isTypeOnly: boolean,
  isReexport: boolean
): void {
  const namespace = clause.match(/^\*\s+as\s+(\w+)$/);
  if (namespace) {
    bindings.push({
      localName: namespace[1],
      importedName: "*",
      specifier,
      line,
      isTypeOnly,
      isReexport
    });
    return;
  }

  const onlyNamed = clause.startsWith("{");
  if (!onlyNamed) {
    const mixed = clause.match(/^(\w+)\s*,\s*\{([^}]+)\}$/);
    if (mixed) {
      bindings.push({
        localName: mixed[1],
        importedName: "default",
        specifier,
        line,
        isTypeOnly,
        isReexport
      });
      pushNamedList(bindings, mixed[2], specifier, line, isTypeOnly, isReexport);
      return;
    }
    const defaultOnly = clause.match(/^(\w+)\s*$/);
    if (defaultOnly) {
      bindings.push({
        localName: defaultOnly[1],
        importedName: "default",
        specifier,
        line,
        isTypeOnly,
        isReexport
      });
      return;
    }
  }

  const named = clause.match(/^\{([^}]+)\}$/);
  if (named) {
    pushNamedList(bindings, named[1], specifier, line, isTypeOnly, isReexport);
  }
}

function pushNamedList(
  bindings: ImportBinding[],
  inner: string,
  specifier: string,
  line: number,
  isTypeOnly: boolean,
  isReexport: boolean
): void {
  for (const part of inner.split(",")) {
    const cleaned = part.replace(/\btype\s+/g, "").trim();
    if (!cleaned) continue;
    const m = cleaned.match(/^(\w+)\s*(?:as\s+(\w+))?$/);
    if (!m) continue;
    bindings.push({
      localName: m[2] || m[1],
      importedName: m[1],
      specifier,
      line,
      isTypeOnly,
      isReexport
    });
  }
}

export function parseJavaImports(source: string): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*import\s+(static\s+)?([a-zA-Z0-9_.]+)\s*;/);
    if (!m) continue;
    const full = m[2];
    const simple = full.includes(".") ? full.slice(full.lastIndexOf(".") + 1) : full;
    if (simple === "*" || simple === "static") continue;
    bindings.push({
      localName: simple,
      importedName: simple,
      specifier: full.replace(/\./g, "/"),
      line: i + 1
    });
  }
  return bindings;
}

export function parseImportsForFile(source: string, filePath: string): ImportBinding[] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".java") return parseJavaImports(source);
  return parseJsImports(source);
}

export function findBindingForSymbol(bindings: ImportBinding[], symbol: string): ImportBinding | undefined {
  return bindings.find((b) => b.localName === symbol);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function resolveModuleSpecifier(
  root: string,
  fromAbsoluteFile: string,
  specifier: string
): Promise<ResolvedModule | null> {
  const rootResolved = path.resolve(root);

  if (!specifier.startsWith(".") && !specifier.startsWith("/") && specifier.includes("/")) {
    const candidates = [
      path.join(rootResolved, "src/main/java", specifier + ".java"),
      path.join(rootResolved, "src", specifier + ".java"),
      path.join(rootResolved, specifier + ".java")
    ];
    for (const c of candidates) {
      if (await fileExists(c)) {
        return {
          absolutePath: c,
          relativePath: toPosix(path.relative(rootResolved, c)),
          specifier
        };
      }
    }
  }

  if (!specifier.startsWith(".")) {
    if (specifier.startsWith("@/")) {
      const rest = specifier.slice(2);
      for (const base of ["src", "app", ""]) {
        const hit = await resolveWithExtensions(path.join(rootResolved, base, rest));
        if (hit) {
          return { absolutePath: hit, relativePath: toPosix(path.relative(rootResolved, hit)), specifier };
        }
      }
    }
    return null;
  }

  const fromDir = path.dirname(fromAbsoluteFile);
  const base = path.resolve(fromDir, specifier);
  const hit = await resolveWithExtensions(base);
  if (!hit) return null;
  if (hit !== rootResolved && !hit.startsWith(rootResolved + path.sep)) return null;
  return {
    absolutePath: hit,
    relativePath: toPosix(path.relative(rootResolved, hit)),
    specifier
  };
}

async function resolveWithExtensions(base: string): Promise<string | null> {
  if (await fileExists(base)) return base;
  for (const ext of JS_EXTENSIONS) {
    const withExt = base.endsWith(ext) ? base : base + ext;
    if (await fileExists(withExt)) return withExt;
  }
  if (await dirExists(base)) {
    for (const ext of JS_EXTENSIONS) {
      const index = path.join(base, "index" + ext);
      if (await fileExists(index)) return index;
    }
  }
  return null;
}

export function pathKey(root: string, absoluteOrRelative: string): string {
  const abs = path.isAbsolute(absoluteOrRelative)
    ? path.resolve(absoluteOrRelative)
    : path.resolve(root, absoluteOrRelative);
  return toPosix(path.relative(path.resolve(root), abs)).toLowerCase();
}
