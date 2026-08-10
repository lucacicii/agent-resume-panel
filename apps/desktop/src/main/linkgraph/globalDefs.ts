/**
 * Flow 2: global same-name definition discovery + dig each branch.
 */

import * as fs from "node:fs/promises";
import {
  searchWorkbenchText,
  type WorkbenchSearchMatch
} from "../workbenchSearch";
import { digDefinitionChain, findLocalDefinition } from "./definitionDig";
import { pathKey } from "./importResolve";
import {
  buildNameFamily,
  isStopwordSymbol,
  isValidSymbolMatch,
  shouldExpandNameFamily,
  symbolSpecificity
} from "./nameFamily";
import type {
  LinkGraphBranch,
  LinkGraphChainStep,
  LinkGraphOpenEnd
} from "../../shared/linkGraphTypes";

export type GlobalDefsResult = {
  branches: LinkGraphBranch[];
  discardedCount: number;
  truncatedCount: number;
  openEnds: LinkGraphOpenEnd[];
  pathKeys: Set<string>;
  filesTouched: number;
};

function extractMatchedToken(preview: string, aliases: string[]): string | null {
  for (const a of aliases) {
    try {
      const re = new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (re.test(preview)) return a;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function confirmDefinitionInFile(
  absolutePath: string,
  symbol: string,
  aliases: string[]
): Promise<{ line: number; preview: string; matched: string } | null> {
  let source: string;
  try {
    source = await fs.readFile(absolutePath, "utf8");
  } catch {
    return null;
  }
  for (const alias of aliases) {
    const def = findLocalDefinition(source, alias);
    if (def && def.kind !== "reexport") {
      return { line: def.line, preview: def.preview, matched: alias };
    }
  }
  const def = findLocalDefinition(source, symbol);
  if (def && def.kind !== "reexport") {
    return { line: def.line, preview: def.preview, matched: symbol };
  }
  return null;
}

export async function expandGlobalDefinitionBranches(args: {
  root: string;
  symbol: string;
  primaryPathKeys: Set<string>;
  primaryRelativePaths: Set<string>;
  maxBranches?: number;
  maxDigHops?: number;
  deadlineMs?: number;
  signal?: AbortSignal;
  onBranchProgress?: (current: number, total: number, file: string) => void;
}): Promise<GlobalDefsResult> {
  const maxBranches = args.maxBranches ?? 80;
  const branches: LinkGraphBranch[] = [];
  const openEnds: LinkGraphOpenEnd[] = [];
  const pathKeys = new Set<string>();
  let discardedCount = 0;
  let truncatedCount = 0;
  let filesTouched = 0;

  const aliases = shouldExpandNameFamily(args.symbol)
    ? buildNameFamily(args.symbol, { includeAccessors: false })
    : [args.symbol];

  const search = await searchWorkbenchText({
    rootPath: args.root,
    query: args.symbol,
    matchCase: true,
    wholeWord: true,
    useRegex: false,
    maxResults: 200,
    timeBudgetMs: 10_000,
    signal: args.signal
  });

  const candidates: WorkbenchSearchMatch[] = [];
  for (const m of search.matches) {
    const preview = m.preview || "";
    const matched = extractMatchedToken(preview, aliases) || args.symbol;
    if (!isValidSymbolMatch(args.symbol, matched, preview)) {
      discardedCount += 1;
      continue;
    }
    if (isStopwordSymbol(args.symbol) && matched !== args.symbol) {
      discardedCount += 1;
      continue;
    }
    const key = pathKey(args.root, m.path);
    if (args.primaryPathKeys.has(key) || args.primaryRelativePaths.has(m.relativePath)) {
      discardedCount += 1;
      continue;
    }
    candidates.push(m);
  }

  // Dedupe by file
  const byFile = new Map<string, WorkbenchSearchMatch>();
  for (const c of candidates) {
    const prev = byFile.get(c.path);
    if (!prev || c.line < prev.line) byFile.set(c.path, c);
  }

  // Confirm definition by full-file read
  type Entry = { path: string; relativePath: string; line: number; preview: string; matched: string };
  const confirmed: Entry[] = [];
  for (const m of byFile.values()) {
    if (args.signal?.aborted) break;
    if (typeof args.deadlineMs === "number" && Date.now() >= args.deadlineMs) break;
    const hit = await confirmDefinitionInFile(m.path, args.symbol, aliases);
    if (!hit) {
      discardedCount += 1;
      continue;
    }
    confirmed.push({
      path: m.path,
      relativePath: m.relativePath,
      line: hit.line,
      preview: hit.preview,
      matched: hit.matched
    });
  }

  confirmed.sort((a, b) => {
    const score = (p: string) =>
      (/(vo|dto|entity|model|types?)/i.test(p) ? 20 : 0) + symbolSpecificity(args.symbol);
    return score(b.relativePath) - score(a.relativePath);
  });

  const total = Math.min(confirmed.length, maxBranches);
  let branchIdx = 0;
  for (const entry of confirmed) {
    if (args.signal?.aborted) break;
    const pastDeadline = typeof args.deadlineMs === "number" && Date.now() >= args.deadlineMs;
    if (pastDeadline || branchIdx >= maxBranches) {
      truncatedCount += 1;
      continue;
    }

    const branchId = `g${branchIdx + 1}`;
    branchIdx += 1;
    filesTouched += 1;
    args.onBranchProgress?.(branchIdx, total, entry.relativePath);

    const dig = await digDefinitionChain({
      root: args.root,
      startAbsolutePath: entry.path,
      startRelativePath: entry.relativePath,
      symbol: entry.matched || args.symbol,
      prunePathKeys: args.primaryPathKeys,
      maxHops: args.maxDigHops ?? 10,
      signal: args.signal,
      branchId
    });

    for (const k of dig.pathKeys) pathKeys.add(k);
    openEnds.push(...dig.openEnds);

    if (dig.pruned) {
      branches.push({
        id: branchId,
        entryFile: entry.relativePath,
        entryLine: entry.line,
        entryPreview: entry.preview,
        pruned: true,
        pruneReason: dig.pruneReason || "import_path_on_primary",
        steps: dig.steps
      });
      continue;
    }

    let steps: LinkGraphChainStep[] = dig.steps;
    if (!steps.length) {
      steps = [
        {
          id: `${branchId}_entry`,
          edgeKind: "defines",
          nodeKind: "definition",
          role: "definition",
          title: `Define ${args.symbol}`,
          narrative: entry.preview,
          file: entry.relativePath,
          path: entry.path,
          line: entry.line,
          symbol: args.symbol,
          preview: entry.preview,
          confidence: "medium"
        }
      ];
    }

    branches.push({
      id: branchId,
      entryFile: entry.relativePath,
      entryLine: entry.line,
      entryPreview: entry.preview,
      pruned: false,
      steps
    });
  }

  // Count remaining beyond max as truncated too
  if (confirmed.length > maxBranches) {
    truncatedCount += confirmed.length - maxBranches;
  }

  return {
    branches,
    discardedCount,
    truncatedCount,
    openEnds,
    pathKeys,
    filesTouched
  };
}
