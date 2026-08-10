/**
 * Lightweight text search for link-graph agent (rg preferred, node fallback).
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SearchMatch = {
  path: string;
  relativePath: string;
  line: number;
  column: number;
  preview: string;
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".next",
  "coverage",
  "bin",
  ".turbo",
  "target",
  ".gradle"
]);

export async function searchText(args: {
  root: string;
  query: string;
  wholeWord?: boolean;
  matchCase?: boolean;
  maxResults?: number;
  timeBudgetMs?: number;
}): Promise<SearchMatch[]> {
  const max = args.maxResults ?? 40;
  const root = path.resolve(args.root);
  try {
    return await searchWithRg(root, args.query, {
      wholeWord: args.wholeWord,
      matchCase: args.matchCase,
      maxResults: max
    });
  } catch {
    return searchWithNode(root, args.query, {
      wholeWord: Boolean(args.wholeWord),
      matchCase: Boolean(args.matchCase),
      maxResults: max,
      deadline: Date.now() + (args.timeBudgetMs ?? 8_000)
    });
  }
}

async function searchWithRg(
  root: string,
  query: string,
  opts: { wholeWord?: boolean; matchCase?: boolean; maxResults: number }
): Promise<SearchMatch[]> {
  const args = [
    "--json",
    "--line-number",
    "--column",
    "--max-count",
    String(opts.maxResults),
    opts.matchCase ? "--case-sensitive" : "--ignore-case",
    ...(opts.wholeWord ? ["--word-regexp"] : []),
    "-g",
    "!node_modules",
    "-g",
    "!.git",
    "-g",
    "!dist",
    "-g",
    "!build",
    "-g",
    "!*.class",
    "-g",
    "!*.jar",
    "--",
    query,
    root
  ];
  const { stdout } = await execFileAsync("rg", args, {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 12_000
  });
  const out: SearchMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as {
        type?: string;
        data?: {
          path?: { text?: string };
          line_number?: number;
          submatches?: Array<{ start?: number }>;
          lines?: { text?: string };
        };
      };
      if (row.type !== "match" || !row.data?.path?.text) continue;
      const abs = row.data.path.text;
      out.push({
        path: abs,
        relativePath: path.relative(root, abs).split(path.sep).join("/"),
        line: row.data.line_number || 1,
        column: (row.data.submatches?.[0]?.start ?? 0) + 1,
        preview: (row.data.lines?.text || "").trim().slice(0, 200)
      });
      if (out.length >= opts.maxResults) break;
    } catch {
      /* skip */
    }
  }
  return out;
}

async function searchWithNode(
  root: string,
  query: string,
  opts: { wholeWord: boolean; matchCase: boolean; maxResults: number; deadline: number }
): Promise<SearchMatch[]> {
  const out: SearchMatch[] = [];
  const q = opts.matchCase ? query : query.toLowerCase();
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= opts.maxResults || Date.now() > opts.deadline) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= opts.maxResults || Date.now() > opts.deadline) return;
      if (ent.name.startsWith(".") && ent.name !== ".env") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        await walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|vue|java|kt|go|py|cs)$/i.test(ent.name)) continue;
      let text: string;
      try {
        const st = await fs.stat(full);
        if (st.size > 512 * 1024) continue;
        text = await fs.readFile(full, "utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const lineText = lines[i];
        const hay = opts.matchCase ? lineText : lineText.toLowerCase();
        let idx = -1;
        if (opts.wholeWord) {
          const re = new RegExp(
            `\\b${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
            opts.matchCase ? "" : "i"
          );
          const m = re.exec(lineText);
          if (m) idx = m.index;
        } else {
          idx = hay.indexOf(q);
        }
        if (idx < 0) continue;
        out.push({
          path: full,
          relativePath: path.relative(root, full).split(path.sep).join("/"),
          line: i + 1,
          column: idx + 1,
          preview: lineText.trim().slice(0, 200)
        });
        if (out.length >= opts.maxResults) return;
      }
    }
  };
  await walk(root);
  return out;
}

export async function readWindow(
  absolutePath: string,
  centerLine: number,
  radius = 40
): Promise<{ start: number; end: number; text: string; lines: string[] }> {
  const text = await fs.readFile(absolutePath, "utf8");
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, centerLine - radius);
  const end = Math.min(lines.length, centerLine + radius);
  const window = lines
    .slice(start - 1, end)
    .map((line, i) => `${start + i}| ${line}`)
    .join("\n");
  return { start, end, text: window, lines };
}
