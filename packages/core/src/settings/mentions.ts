import * as path from "node:path";
import { expandHome } from "../pathUtils";
import type { WorkbenchComposerMention } from "./types";

import {
  COMPOSER_MENTION_ID,
  COMPOSER_MENTIONS_MAX,
  isMentionRecord
} from "./mentionSources";

export {
  COMPOSER_MENTION_ID,
  COMPOSER_MENTIONS_MAX,
  normalizeWorkbenchMentionSources
} from "./mentionSources";

function mentionIdKey(id: string): string {
  return id.trim().replace(/^@+/, "").toLowerCase();
}

function cwdKey(value: string): string {
  return value.trim().replace(/[\\/]+$/, "") || value.trim();
}

export function resolveMention(
  mentions: readonly WorkbenchComposerMention[] | undefined | null,
  id: string
): WorkbenchComposerMention | null {
  const needle = mentionIdKey(id);
  if (!needle) return null;
  return mentions?.find((item) => item.id.toLowerCase() === needle) ?? null;
}

/** The pack whose `cwd` is this directory, if any. */
export function matchMentionForCwd(
  mentions: readonly WorkbenchComposerMention[] | undefined | null,
  cwd: string
): WorkbenchComposerMention | null {
  const key = cwdKey(cwd);
  if (!key || !mentions?.length) return null;
  return mentions.find((item) => cwdKey(item.cwd) === key) ?? null;
}

function normalizeMentionPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const expanded = expandHome(value);
  if (!expanded) return undefined;
  const resolved = path.resolve(expanded);
  return resolved === path.sep ? undefined : resolved;
}

function pathKey(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

export function normalizeWorkbenchComposerMentions(
  value: WorkbenchComposerMention[] | unknown
): WorkbenchComposerMention[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: WorkbenchComposerMention[] = [];
  for (const entry of value) {
    if (!isMentionRecord(entry)) continue;
    const id = String(entry.id ?? "").trim().replace(/^@+/, "");
    if (!COMPOSER_MENTION_ID.test(id)) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    const cwd = normalizeMentionPath(entry.cwd);
    if (!cwd) continue;
    seen.add(key);
    output.push({ id, cwd });
    if (output.length >= COMPOSER_MENTIONS_MAX) break;
  }
  return output;
}
