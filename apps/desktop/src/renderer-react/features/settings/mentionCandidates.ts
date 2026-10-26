import { COMPOSER_MENTION_ID } from "@agent-resume/core/browser";
import type { WorkbenchComposerMention } from "@agent-resume/core";

/**
 * Turning the catalog's session history into `@` workspace packs.
 *
 * The catalog records every directory an agent ever ran in, which is why the
 * `@` menu used to fill with `/tmp`, the home directory and the app's own
 * scaffolding. A pack should name a place the user works *in*, so scanning is a
 * suggestion list, not an import: every excluded row stays visible with its
 * reason, and nothing is written until the user applies the selection.
 */

/** Why a catalog directory should not become a `@` pack. */
export type MentionCandidateExclusion =
  /** A root the agent ran from once — too broad to be a project. */
  | "home"
  /** Scratch space: the contents are throwaway by definition. */
  | "temp"
  /** The app's own workspace/scratch folders, not the user's code. */
  | "internal"
  /** Indexed on another machine, or the folder is gone. */
  | "missing"
  /** A pack already points here. */
  | "alreadyAdded";

export interface MentionCandidate {
  projectId: string;
  /** Catalog alias, else the last path segment. */
  label: string;
  path: string;
  /** Mention id this row would use, valid per `COMPOSER_MENTION_ID`. */
  id: string;
  sessionCount: number;
  lastSeenAtMs: number | null;
  pinned: boolean;
  exclusion?: MentionCandidateExclusion;
}

export interface MentionCandidateInput {
  projectId: string;
  alias: string;
  localPath: string | null;
  pathMissing: boolean;
  sessionCount: number;
  lastSeenAtMs: number | null;
  pinned: boolean;
}

export interface MentionCandidateContext {
  /** Absolute home directory, or "" when unknown. */
  homeDir: string;
  /** Absolute panel home (holds `.desktop/workspaces`); "" when unknown. */
  panelHome: string;
  /** Packs already configured, to mark rows that would be duplicates. */
  packs: readonly WorkbenchComposerMention[];
  /** Paths of temporary directories to exclude (`/tmp`, `$TMPDIR`, …). */
  tempRoots?: readonly string[];
}

const DEFAULT_TEMP_ROOTS = ["/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp", "/private/var/folders"];

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isUnder(path: string, root: string): boolean {
  if (!root) return false;
  const base = stripTrailingSlash(root);
  return path === base || path.startsWith(`${base}/`);
}

/**
 * A mention id from the directory: the last segment, lowercased, with anything
 * that is not `[A-Za-z0-9_-]` collapsed into `-`. Falls back to the catalog
 * alias and finally to a numbered placeholder so the row is still selectable.
 */
export function suggestMentionId(path: string, alias: string, taken?: Set<string>): string {
  const segment = stripTrailingSlash(path).split("/").filter(Boolean).pop() || "";
  const candidates = [segment, alias, segment ? `${segment}-2` : ""];
  for (const candidate of candidates) {
    const cleaned = candidate
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (cleaned && COMPOSER_MENTION_ID.test(cleaned) && !taken?.has(cleaned)) {
      taken?.add(cleaned);
      return cleaned;
    }
  }
  const fallback = `dir-${Math.abs(hashCode(path)) % 10000}`;
  taken?.add(fallback);
  return fallback;
}

function hashCode(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

/**
 * Classify one catalog row. Pure path and catalog checks only: no filesystem
 * probing per row, so a scan over a few hundred projects stays instant.
 */
export function classifyCandidate(
  project: MentionCandidateInput,
  context: MentionCandidateContext
): MentionCandidateExclusion | undefined {
  const path = project.localPath;
  if (!path || project.pathMissing) return "missing";
  const trimmed = stripTrailingSlash(path);
  if (context.homeDir && trimmed === stripTrailingSlash(context.homeDir)) return "home";
  const tempRoots = context.tempRoots ?? DEFAULT_TEMP_ROOTS;
  if (tempRoots.some((root) => isUnder(trimmed, root))) return "temp";
  if (context.panelHome && isUnder(trimmed, context.panelHome)) return "internal";
  if (trimmed.split("/").includes(".desktop")) return "internal";
  if (context.packs.some((pack) => stripTrailingSlash(pack.cwd) === trimmed)) return "alreadyAdded";
  return undefined;
}

/** Candidate rows for the picker: eligible first, then excluded, each by use. */
export function buildMentionCandidates(
  projects: readonly MentionCandidateInput[],
  context: MentionCandidateContext
): MentionCandidate[] {
  const taken = new Set(context.packs.map((pack) => pack.id.toLowerCase()));
  const rows = projects.map((project) => {
    const path = stripTrailingSlash(project.localPath || "");
    const label = (project.alias || "").trim() || path.split("/").filter(Boolean).pop() || path;
    const exclusion = classifyCandidate(project, context);
    return {
      projectId: project.projectId,
      label,
      path,
      id: exclusion === "alreadyAdded"
        ? context.packs.find((pack) => stripTrailingSlash(pack.cwd) === path)?.id || ""
        : suggestMentionId(path, project.alias, taken),
      sessionCount: project.sessionCount,
      lastSeenAtMs: project.lastSeenAtMs,
      pinned: project.pinned,
      exclusion
    } satisfies MentionCandidate;
  });
  const byUse = (a: MentionCandidate, b: MentionCandidate): number =>
    b.sessionCount - a.sessionCount || (b.lastSeenAtMs || 0) - (a.lastSeenAtMs || 0);
  return [
    ...rows.filter((row) => !row.exclusion).sort(byUse),
    ...rows.filter((row) => row.exclusion).sort(byUse)
  ];
}
