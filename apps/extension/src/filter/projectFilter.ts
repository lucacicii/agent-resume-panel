import * as fs from "node:fs";
import * as path from "node:path";
import { expandPortableKey, toPortableKey } from "@agent-resume/core/extension";
import type { NoteRecord } from "../catalog/notes";

export interface ProjectFilterScope {
  roots: string[];
  expandedRoots: string[];
  portableRoots: string[];
}

const CASE_INSENSITIVE_PLATFORM = process.platform === "win32" || process.platform === "darwin";

function stripTrailingSeparator(dir: string): string {
  const fsRoot = path.parse(dir).root;
  if (dir === fsRoot) {
    return dir;
  }
  return dir.endsWith(path.sep) ? dir.slice(0, -1) : dir;
}

function normalizeForCompare(dir: string): string {
  const stripped = stripTrailingSeparator(dir);
  return CASE_INSENSITIVE_PLATFORM ? stripped.toLowerCase() : stripped;
}

function normalizePortableForCompare(portableKey: string): string {
  const stripped = portableKey.length > 1 && portableKey.endsWith("/") ? portableKey.slice(0, -1) : portableKey;
  return CASE_INSENSITIVE_PLATFORM ? stripped.toLowerCase() : stripped;
}

function tryRealpath(dir: string): string | undefined {
  try {
    return fs.realpathSync(dir);
  } catch {
    return undefined;
  }
}

export function buildProjectFilterScope(workspaceRoots: readonly string[]): ProjectFilterScope {
  const roots: string[] = [];
  const seenRoots = new Set<string>();
  const expandedRoots: string[] = [];
  const seenExpanded = new Set<string>();
  const portableRoots: string[] = [];
  const seenPortable = new Set<string>();

  const addExpanded = (candidate: string | undefined) => {
    if (!candidate) {
      return;
    }
    const stripped = stripTrailingSeparator(path.resolve(candidate));
    const key = normalizeForCompare(stripped);
    if (!seenExpanded.has(key)) {
      seenExpanded.add(key);
      expandedRoots.push(stripped);
    }
  };

  const addPortable = (candidate: string) => {
    try {
      const portable = toPortableKey(candidate);
      const compareKey = normalizePortableForCompare(portable);
      if (!seenPortable.has(compareKey)) {
        seenPortable.add(compareKey);
        portableRoots.push(portable);
      }
      const expanded = expandPortableKey(portable);
      addExpanded(expanded);
    } catch {
      // Ignore malformed paths when deriving portable keys.
    }
  };

  for (const rawRoot of workspaceRoots) {
    const trimmed = rawRoot.trim();
    if (!trimmed) {
      continue;
    }
    const resolved = stripTrailingSeparator(path.resolve(trimmed));
    const rootCompare = normalizeForCompare(resolved);
    if (!seenRoots.has(rootCompare)) {
      seenRoots.add(rootCompare);
      roots.push(resolved);
    }
    addExpanded(resolved);
    addPortable(resolved);

    const real = tryRealpath(resolved);
    if (real) {
      addExpanded(real);
      addPortable(real);
    }
  }

  return {
    roots,
    expandedRoots,
    portableRoots
  };
}

function pathMatchesRoot(candidate: string, root: string): boolean {
  const normCandidate = normalizeForCompare(candidate);
  const normRoot = normalizeForCompare(root);
  if (normCandidate === normRoot) {
    return true;
  }
  const prefix = normRoot.endsWith(path.sep) ? normRoot : `${normRoot}${path.sep}`;
  return normCandidate.startsWith(prefix);
}

function portableMatchesRoot(candidatePortable: string, rootPortable: string): boolean {
  const normCandidate = normalizePortableForCompare(candidatePortable);
  const normRoot = normalizePortableForCompare(rootPortable);
  if (normCandidate === normRoot) {
    return true;
  }
  const prefix = normRoot.endsWith("/") ? normRoot : `${normRoot}/`;
  return normCandidate.startsWith(prefix);
}

export function matchesProjectScope(
  targetPath: string | undefined,
  scope: ProjectFilterScope
): boolean {
  const trimmed = targetPath?.trim();
  if (!trimmed || scope.expandedRoots.length === 0) {
    return false;
  }

  const resolved = stripTrailingSeparator(path.resolve(trimmed));
  const candidates = [resolved];
  const real = tryRealpath(resolved);
  if (real) {
    candidates.push(stripTrailingSeparator(real));
  }

  for (const candidate of candidates) {
    for (const root of scope.expandedRoots) {
      if (pathMatchesRoot(candidate, root)) {
        return true;
      }
    }
    try {
      const portable = toPortableKey(candidate);
      for (const portableRoot of scope.portableRoots) {
        if (portableMatchesRoot(portable, portableRoot)) {
          return true;
        }
      }
    } catch {
      // Ignore portable key conversion errors.
    }
  }

  return false;
}

function escapeSqlLikePrefix(prefix: string): string {
  return prefix
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

export function buildProjectRootsSqlWhere(
  alias: string,
  scope: ProjectFilterScope,
  escapeSql: (value: string) => string
): string {
  if (scope.expandedRoots.length === 0) {
    return "0";
  }

  const clauses: string[] = [];
  const collate = CASE_INSENSITIVE_PLATFORM ? " COLLATE NOCASE" : "";

  for (const root of scope.expandedRoots) {
    const cleanRoot = stripTrailingSeparator(root);
    const prefix = cleanRoot.endsWith(path.sep) ? cleanRoot : `${cleanRoot}${path.sep}`;
    const escapedExact = escapeSql(cleanRoot);
    const escapedLike = escapeSql(escapeSqlLikePrefix(prefix));
    clauses.push(
      `${alias}.project_path${collate} = '${escapedExact}'`,
      `${alias}.project_path${collate} LIKE '${escapedLike}%' ESCAPE '\\'`
    );
  }

  return `(${clauses.join(" OR ")})`;
}

export function noteMatchesProjectScope(
  note: NoteRecord,
  scope: ProjectFilterScope,
  resolveSessionProjectPath?: (provider: string, sessionId: string) => string | undefined
): boolean {
  if (note.scope === "project") {
    return matchesProjectScope(note.projectPath, scope);
  }

  if (note.scope === "session") {
    const sessionProjectPath =
      note.projectPath ??
      (note.provider && note.agentSessionId
        ? resolveSessionProjectPath?.(note.provider, note.agentSessionId)
        : undefined);
    return matchesProjectScope(sessionProjectPath, scope);
  }

  if (note.scope === "library") {
    if (note.work?.primaryProject && matchesProjectScope(note.work.primaryProject, scope)) {
      return true;
    }
    if (note.work?.projects?.some((projectPath) => matchesProjectScope(projectPath, scope))) {
      return true;
    }
    return false;
  }

  return false;
}
