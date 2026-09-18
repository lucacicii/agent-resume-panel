import * as path from "node:path";
import { expandHome } from "../pathUtils";
import type {
  WorkbenchComposerMention,
  WorkbenchComposerMentionRoot
} from "./types";
export { resolveMention, matchMentionForCwd, buildMentionPrompt } from "./mentionPrompt";

export const COMPOSER_MENTION_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const COMPOSER_MENTIONS_MAX = 50;
export const COMPOSER_MENTION_ROOTS_MAX = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function normalizeRoots(
  value: unknown,
  cwd: string
): WorkbenchComposerMentionRoot[] {
  const cwdKey = pathKey(cwd);
  const seen = new Set<string>([cwdKey]);
  const roots: WorkbenchComposerMentionRoot[] = [{ path: cwd, role: "work" }];
  if (!Array.isArray(value)) return roots;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const rootPath = normalizeMentionPath(entry.path);
    if (!rootPath) continue;
    const key = pathKey(rootPath);
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push({ path: rootPath, role: "reference" });
    if (roots.length >= COMPOSER_MENTION_ROOTS_MAX) break;
  }
  return roots;
}

export function normalizeWorkbenchComposerMentions(
  value: WorkbenchComposerMention[] | unknown
): WorkbenchComposerMention[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: WorkbenchComposerMention[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = String(entry.id ?? "").trim().replace(/^@+/, "");
    if (!COMPOSER_MENTION_ID.test(id)) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    const cwd = normalizeMentionPath(entry.cwd);
    if (!cwd) continue;
    seen.add(key);
    output.push({
      id,
      cwd,
      roots: normalizeRoots(entry.roots, cwd)
    });
    if (output.length >= COMPOSER_MENTIONS_MAX) break;
  }
  return output;
}
