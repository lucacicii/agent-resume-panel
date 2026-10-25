import type { WorkbenchComposerMention, WorkbenchComposerMentionRoot } from "@agent-resume/core";

/**
 * Renderer-side mirror of `normalizeWorkbenchComposerMentions` from
 * `packages/core/src/settings/mentions.ts`.
 *
 * The core implementation resolves paths with `node:path`, which the renderer
 * (a browser bundle) cannot import, so it is kept in sync by hand — the same
 * arrangement `normalizeComposerSlashPhrases` already uses in the settings
 * model. Keep the identity/path rules here identical to core, or the same
 * settings file would normalize differently depending on who read it last.
 */
export const COMPOSER_MENTION_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const COMPOSER_MENTIONS_MAX = 50;
export const COMPOSER_MENTION_ROOTS_MAX = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `~` expansion without `node:os`: home is only needed for display parity. */
export function expandMentionHome(value: string, homeDir?: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("~")) return trimmed;
  if (!homeDir) return trimmed;
  if (trimmed === "~") return homeDir;
  return trimmed.startsWith("~/") ? `${homeDir}/${trimmed.slice(2)}` : trimmed;
}

function normalizeMentionPath(value: unknown, homeDir?: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const expanded = expandMentionHome(value, homeDir);
  if (!expanded) return undefined;
  const trimmed = expanded.replace(/\/+$/, "");
  return trimmed || "/";
}

function normalizeRoots(
  value: unknown,
  cwd: string,
  homeDir?: string
): WorkbenchComposerMentionRoot[] {
  const seen = new Set<string>([cwd.toLowerCase()]);
  const roots: WorkbenchComposerMentionRoot[] = [{ path: cwd, role: "work" }];
  if (!Array.isArray(value)) return roots;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const rootPath = normalizeMentionPath(entry.path, homeDir);
    if (!rootPath) continue;
    const key = rootPath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push({ path: rootPath, role: "reference" });
    if (roots.length >= COMPOSER_MENTION_ROOTS_MAX) break;
  }
  return roots;
}

export function normalizeComposerMentions(
  value: unknown,
  homeDir?: string
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
    const cwd = normalizeMentionPath(entry.cwd, homeDir);
    if (!cwd) continue;
    seen.add(key);
    output.push({ id, cwd, roots: normalizeRoots(entry.roots, cwd, homeDir) });
    if (output.length >= COMPOSER_MENTIONS_MAX) break;
  }
  return output;
}
