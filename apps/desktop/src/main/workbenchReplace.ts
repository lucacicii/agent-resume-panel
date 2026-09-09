import * as path from "node:path";
import {
  inspectWorkbenchFile,
  saveWorkbenchFile
} from "./workbenchFileIo";
import { buildSearchRegex, scanLineMatches } from "./workbenchSearch";

/**
 * Replace text across files that came from a Workbench search result set.
 *
 * The engine rescans each file with the exact same line matcher the search
 * engine uses (`scanLineMatches`), so the number of replaced occurrences is
 * consistent with what the results list reported, and matches can never cross
 * line breaks (mirroring ripgrep without multiline mode).
 *
 * Replacing writes through the encoding-aware, conflict-checked file IO used
 * by the built-in editor, so encodings, BOMs and line endings are preserved.
 */

export type WorkbenchReplaceSkipReason =
  | "invalid"
  | "missing"
  | "binary"
  | "too-large"
  | "conflict"
  | "stale"
  | "limit";

export interface WorkbenchReplaceRequest {
  rootPath: string;
  query: string;
  replaceWith: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  useRegex?: boolean;
  /** Absolute paths from the current search results. Only these files are touched. */
  files: string[];
  /**
   * When set, only the listed occurrences are replaced (per-match replace).
   * `ordinal` is the 0-based position of the match inside that file's results
   * (lines ascending, columns ascending), matching result row order.
   */
  only?: Array<{ path: string; ordinal: number }>;
}

export interface WorkbenchReplaceResult {
  replaced: Array<{ path: string; count: number }>;
  skipped: Array<{ path: string; reason: WorkbenchReplaceSkipReason }>;
  totalReplaced: number;
}

const MAX_FILES_PER_REPLACE = 500;

function posixRelative(root: string, absolute: string): string {
  const rel = path.relative(root, absolute);
  return rel.split(path.sep).join("/");
}

interface FoundMatch {
  line: number;
  start: number;
  end: number;
  groups: string[];
}

/**
 * Expand ripgrep/VS Code style placeholders in a replacement string:
 * `$&` / `$0` whole match, `$1`… capture groups, `$$` literal dollar.
 * Unresolvable placeholders stay as typed.
 */
function expandReplacement(replaceWith: string, groups: string[]): string {
  const placeholder = /\$(\$|&|0|[1-9][0-9]*)/g;
  return replaceWith.replace(placeholder, (token, name: string) => {
    if (name === "$") return "$";
    if (name === "&" || name === "0") return groups[0];
    const index = Number(name);
    return index < groups.length ? groups[index] : token;
  });
}

/**
 * Replace selected matches inside one decoded file. The scan order (lines
 * ascending, columns ascending) mirrors search result row order, so ordinal
 * selection in `wantedOrdinals` targets exactly the occurrences the search
 * reported. Returns null when nothing was selected/replaced.
 */
function replaceInContent(
  content: string,
  query: string,
  replaceWith: string,
  options: { matchCase: boolean; wholeWord: boolean; useRegex: boolean },
  wantedOrdinals: Set<number> | null
): { content: string; count: number } | null {
  const regex = buildSearchRegex(query, options);
  const found: FoundMatch[] = [];
  scanLineMatches(content, regex, (lineIndex, start, end, _lineText, groups) => {
    found.push({ line: lineIndex, start, end, groups });
    return false;
  });

  const targets = wantedOrdinals === null
    ? found
    : found.filter((_match, ordinal) => wantedOrdinals.has(ordinal));
  if (targets.length === 0) return null;

  // Rebuild per line: original offsets from the scan stay valid because the
  // replacement is assembled after scanning the untouched content.
  const lines = content.split("\n");
  const byLine = new Map<number, FoundMatch[]>();
  for (const target of targets) {
    let list = byLine.get(target.line);
    if (!list) {
      list = [];
      byLine.set(target.line, list);
    }
    list.push(target);
  }
  let count = 0;
  for (const [lineIndex, list] of byLine) {
    const original = lines[lineIndex];
    let built = "";
    let previous = 0;
    for (const match of list) {
      built += original.slice(previous, match.start);
      built += expandReplacement(replaceWith, match.groups);
      previous = match.end;
      count += 1;
    }
    built += original.slice(previous);
    lines[lineIndex] = built;
  }
  return { content: lines.join("\n"), count };
}

/**
 * Replace occurrences across the given files. `files` must come from the
 * current search results: those are exactly the files the search engine
 * actually scanned, so replacements never reach files search skipped.
 */
export async function replaceWorkbenchText(raw: WorkbenchReplaceRequest): Promise<WorkbenchReplaceResult> {
  const query = typeof raw.query === "string" ? raw.query : "";
  if (!query) {
    return { replaced: [], skipped: [], totalReplaced: 0 };
  }
  const rootPath = path.resolve(raw.rootPath.trim());
  const replaceWith = typeof raw.replaceWith === "string" ? raw.replaceWith : "";
  const options = {
    matchCase: Boolean(raw.matchCase),
    wholeWord: Boolean(raw.wholeWord),
    useRegex: Boolean(raw.useRegex)
  };
  // Validate the regex once up-front so a broken pattern fails fast for every file.
  buildSearchRegex(query, options);

  const filePaths = Array.isArray(raw.files) ? [...new Set(raw.files)] : [];
  if (filePaths.length > MAX_FILES_PER_REPLACE) {
    filePaths.length = MAX_FILES_PER_REPLACE;
  }
  const onlyByPath = new Map<string, Set<number>>();
  if (Array.isArray(raw.only)) {
    for (const item of raw.only) {
      if (!item || typeof item.path !== "string" || !Number.isInteger(item.ordinal)) continue;
      let ordinals = onlyByPath.get(item.path);
      if (!ordinals) {
        ordinals = new Set();
        onlyByPath.set(item.path, ordinals);
      }
      ordinals.add(item.ordinal);
    }
  }

  const replaced: Array<{ path: string; count: number }> = [];
  const skipped: Array<{ path: string; reason: WorkbenchReplaceSkipReason }> = [];
  let totalReplaced = 0;

  // Resolve every target to a lexical absolute path first so all file IO below
  // runs against a consistent root; inspectWorkbenchFile / saveWorkbenchFile do
  // their own realpath-based containment checks (and throw when a path escapes
  // the root, which we map to "invalid").
  const targets = filePaths.map((filePath) => path.resolve(filePath));
  const wantedOrdinalsFor = (filePath: string): Set<number> | null => {
    const ordinals = onlyByPath.get(filePath);
    return ordinals && ordinals.size > 0 ? ordinals : null;
  };

  const processFile = (filePath: string): "replaced" | WorkbenchReplaceSkipReason => {
    const inspected = inspectWorkbenchFile(rootPath, filePath);
    if (inspected.kind === "missing") return "missing";
    if (inspected.kind === "external") {
      return inspected.reason === "binary" ? "binary" : "too-large";
    }
    const wanted = wantedOrdinalsFor(filePath);
    const outcome = replaceInContent(
      inspected.content,
      query,
      replaceWith,
      options,
      wanted
    );
    if (outcome === null) {
      // Every file in the results must contain at least one match; a null
      // outcome means the file changed since the search ran.
      return "stale";
    }
    const saved = saveWorkbenchFile(
      rootPath,
      filePath,
      outcome.content,
      inspected.encoding,
      inspected.version
    );
    if (saved.ok) {
      replaced.push({ path: posixRelative(rootPath, filePath), count: outcome.count });
      totalReplaced += outcome.count;
      return "replaced";
    }
    if (saved.reason === "missing") return "missing";
    // Conflict: the file changed between read and write. Retry once against
    // the fresh content — the replacement scan is deterministic.
    const retried = inspectWorkbenchFile(rootPath, filePath);
    if (retried.kind !== "text") {
      return retried.kind === "missing" ? "missing" : "conflict";
    }
    const retryOutcome = replaceInContent(
      retried.content,
      query,
      replaceWith,
      options,
      wanted
    );
    if (retryOutcome === null) return "stale";
    const retrySaved = saveWorkbenchFile(
      rootPath,
      filePath,
      retryOutcome.content,
      retried.encoding,
      retried.version
    );
    if (retrySaved.ok) {
      replaced.push({ path: posixRelative(rootPath, filePath), count: retryOutcome.count });
      totalReplaced += retryOutcome.count;
      return "replaced";
    }
    return "conflict";
  };

  for (const filePath of targets) {
    try {
      const status = processFile(filePath);
      if (status !== "replaced") {
        skipped.push({ path: posixRelative(rootPath, filePath), reason: status });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Path escaping the project root raises from the containment checks.
      skipped.push({
        path: posixRelative(rootPath, filePath),
        reason: message.includes("\u8d85\u51fa\u5141\u8bb8\u8303\u56f4") ? "invalid" : "conflict"
      });
    }
  }

  return { replaced, skipped, totalReplaced };
}
