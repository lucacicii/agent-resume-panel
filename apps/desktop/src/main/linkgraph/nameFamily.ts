/**
 * Symbol normalization, name-family aliases, and match validity filters
 * for Link Graph dig / bridge.
 */

const STOPWORDS = new Set([
  "id",
  "ids",
  "get",
  "set",
  "put",
  "post",
  "data",
  "value",
  "values",
  "item",
  "items",
  "key",
  "keys",
  "type",
  "types",
  "name",
  "names",
  "index",
  "count",
  "size",
  "length",
  "list",
  "map",
  "result",
  "results",
  "error",
  "err",
  "ok",
  "true",
  "false",
  "null",
  "undefined",
  "this",
  "self",
  "that",
  "ret",
  "tmp",
  "temp",
  "obj",
  "fn",
  "cb",
  "i",
  "j",
  "k",
  "n",
  "x",
  "y",
  "z"
]);

const MAX_SELECTION_LEN = 80;

/** Normalize user selection into a search symbol. */
export function normalizeLinkGraphSymbol(selection: string): { symbol: string; wholeWord: boolean } | null {
  const trimmed = selection.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > MAX_SELECTION_LEN) return null;

  const member = trimmed.match(/^(?:[\w$]+\.)+([\w$]+)$/);
  if (member?.[1]) {
    return { symbol: member[1], wholeWord: true };
  }

  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    return { symbol: trimmed, wholeWord: true };
  }

  if (trimmed.length >= 2 && !trimmed.includes("\n")) {
    return { symbol: trimmed, wholeWord: false };
  }

  return null;
}

export function isStopwordSymbol(symbol: string): boolean {
  if (symbol.length <= 1) return true;
  if (symbol.length <= 2 && !/[A-Z]/.test(symbol)) return true;
  return STOPWORDS.has(symbol.toLowerCase());
}

/** Score how specific an identifier looks (higher = better). */
export function symbolSpecificity(symbol: string): number {
  if (isStopwordSymbol(symbol)) return 0;
  let score = Math.min(40, symbol.length * 3);
  if (/[A-Z]/.test(symbol) && /[a-z]/.test(symbol)) score += 12;
  if (symbol.includes("_") && symbol.length > 4) score += 6;
  if (/^\d/.test(symbol)) score -= 20;
  return Math.max(0, score);
}

/** Split camelCase / snake_case / PascalCase into lower segments. */
export function splitIdentifierSegments(symbol: string): string[] {
  const withBreaks = symbol
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[-.\s]+/g, "_");
  return withBreaks
    .split("_")
    .map((s) => s.toLowerCase())
    .filter(Boolean);
}

function toCamel(segments: string[]): string {
  if (!segments.length) return "";
  return segments
    .map((seg, i) => (i === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1)))
    .join("");
}

function toPascal(segments: string[]): string {
  return segments.map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1)).join("");
}

function toSnake(segments: string[]): string {
  return segments.join("_");
}

/**
 * Build alias family for multi-segment identifiers.
 * Short / single-segment symbols do NOT expand to snake variants (avoids a → a_a noise).
 */
export function buildNameFamily(symbol: string, options?: { includeAccessors?: boolean }): string[] {
  const includeAccessors = options?.includeAccessors !== false;
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  add(symbol);
  const segments = splitIdentifierSegments(symbol);
  if (segments.length >= 2) {
    add(toCamel(segments));
    add(toPascal(segments));
    add(toSnake(segments));
    if (includeAccessors) {
      const pascal = toPascal(segments);
      add(`get${pascal}`);
      add(`set${pascal}`);
      add(`is${pascal}`);
    }
  } else if (segments.length === 1 && symbol.length >= 3 && /[A-Z]/.test(symbol[0])) {
    // Pascal single word still gets camel lower
    add(symbol.charAt(0).toLowerCase() + symbol.slice(1));
  }

  return out;
}

/**
 * Whether a search hit text is a valid occurrence of seed (not aa for a, not a-a, etc.).
 * `matched` should be the exact substring that matched when available.
 */
export function isValidSymbolMatch(seed: string, matched: string, preview: string): boolean {
  if (!seed || !matched) return false;
  // Exact alias match preferred
  if (matched === seed) return true;

  const family = new Set(buildNameFamily(seed));
  if (family.has(matched)) return true;

  // Reject hyphenated / dotted noise when seed is plain identifier
  if (/[-./\\]/.test(matched) && !/[-./\\]/.test(seed)) return false;

  // Substring inflation: seed "a" must not keep "aa"
  if (matched.length > seed.length && matched.toLowerCase().includes(seed.toLowerCase())) {
    if (!family.has(matched)) return false;
  }

  // Word boundary check against preview
  try {
    const escaped = matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`);
    if (!re.test(preview)) return false;
  } catch {
    return false;
  }

  return matched === seed || family.has(matched);
}

/** Whether name-family expansion is safe for global/bridge field search. */
export function shouldExpandNameFamily(symbol: string): boolean {
  if (isStopwordSymbol(symbol)) return false;
  return splitIdentifierSegments(symbol).length >= 2;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
