import type { ThunderChatMessage, ThunderFileChangeRecord } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { collectGitRoots, mergeGitStatuses, type GitStatusResult } from "../workbench/git/workbenchGitModel";
import type { ActiveToolInfo } from "./useThunderChat";

export interface GitDiffDisplayLine {
  id: string;
  kind: "header" | "add" | "del" | "context";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface ParsedDiffResult {
  lines: GitDiffDisplayLine[];
  additions: number;
  deletions: number;
}

const FILE_MODIFYING_TOOLS = new Set([
  "write_file",
  "edit_file",
  "create_file",
  "delete_file",
  "patch_file",
  "replace_in_file",
  "apply_diff",
  "append_to_file"
]);

/**
 * Normalizes a path string to a repo-relative forward-slash path without
 * leading or trailing slashes, handling both absolute paths and workspace-relative paths.
 */
export function normalizeRepoPath(filePath: string, repoRoot: string, workspaceDir?: string): string {
  if (!filePath || typeof filePath !== "string") return "";
  let clean = filePath.replace(/\\/g, "/").trim();
  if (clean.includes("\0")) return "";

  const cleanRepoRoot = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const cleanWorkspace = workspaceDir ? workspaceDir.replace(/\\/g, "/").replace(/\/+$/, "") : "";

  // If path is absolute and starts with repoRoot:
  if (clean.startsWith(cleanRepoRoot + "/")) {
    clean = clean.slice(cleanRepoRoot.length + 1);
  } else if (clean === cleanRepoRoot) {
    return "";
  } else if (clean.startsWith("/") && cleanWorkspace && clean.startsWith(cleanWorkspace + "/")) {
    // If inside workspaceDir, but workspaceDir is inside repoRoot:
    if (cleanWorkspace.startsWith(cleanRepoRoot + "/")) {
      clean = clean.slice(cleanRepoRoot.length + 1);
    } else {
      clean = clean.slice(cleanWorkspace.length + 1);
    }
  } else if (!clean.startsWith("/")) {
    // If it's a relative path and workspaceDir is a subdirectory of repoRoot:
    if (cleanWorkspace && cleanWorkspace.startsWith(cleanRepoRoot + "/") && cleanWorkspace !== cleanRepoRoot) {
      const relPrefix = cleanWorkspace.slice(cleanRepoRoot.length + 1);
      clean = `${relPrefix}/${clean}`;
    }
  }

  // Clean redundant segments (. and ..)
  const parts = clean.split("/").filter((p) => p && p !== ".");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== "..") {
        resolved.pop();
      }
    } else {
      resolved.push(part);
    }
  }

  return resolved.join("/");
}

function extractFilePathFromArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  const candidate =
    record.path ??
    record.file_path ??
    record.filePath ??
    record.target_file ??
    record.filename ??
    record.file;
  return typeof candidate === "string" ? candidate : null;
}

/**
 * Collects all repo-relative file paths touched by the current conversation.
 * Scans explicit `fileChanges` records, message `tool_executions` / `tool_calls`,
 * and in-flight `streamingTools`.
 */
export function extractConversationTouchedPaths(options: {
  fileChanges?: ThunderFileChangeRecord[];
  messages?: ThunderChatMessage[];
  streamingTools?: ActiveToolInfo[];
  repoRoot: string;
  workspaceDir?: string;
}): Set<string> {
  const { fileChanges = [], messages = [], streamingTools = [], repoRoot, workspaceDir } = options;
  const touched = new Set<string>();

  const addPath = (rawPath: string | null | undefined) => {
    if (!rawPath) return;
    const normalized = normalizeRepoPath(rawPath, repoRoot, workspaceDir);
    if (normalized) {
      touched.add(normalized);
    }
  };

  // 1. Explicit file change records from trace collector
  for (const fc of fileChanges) {
    if (fc.action !== "failed" && fc.path) {
      addPath(fc.path);
    }
  }

  // 2. Tool executions and tool calls in messages
  for (const msg of messages) {
    if (Array.isArray(msg.tool_executions)) {
      for (const tool of msg.tool_executions) {
        if (FILE_MODIFYING_TOOLS.has(tool.name) || tool.name.includes("file") || tool.name.includes("edit")) {
          addPath(extractFilePathFromArgs(tool.arguments));
        }
      }
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const fnName = tc.function?.name || "";
        if (FILE_MODIFYING_TOOLS.has(fnName) || fnName.includes("file") || fnName.includes("edit")) {
          try {
            const parsed = JSON.parse(tc.function.arguments);
            addPath(extractFilePathFromArgs(parsed));
          } catch {
            // ignore malformed arguments
          }
        }
      }
    }
  }

  // 3. Streaming tools in current active turn
  for (const st of streamingTools) {
    if (FILE_MODIFYING_TOOLS.has(st.name) || st.name.includes("file") || st.name.includes("edit")) {
      addPath(extractFilePathFromArgs(st.arguments));
    }
  }

  return touched;
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizeRoot(value: string): string {
  return toPosixPath(value || "").trim().replace(/\/+$/, "");
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

/** Resolve `.` / `..` segments while preserving an absolute prefix. */
function normalizeAbsolutePath(value: string): string {
  const clean = toPosixPath(value).trim();
  const resolveSegments = (raw: string): string => {
    const resolved: string[] = [];
    for (const part of raw.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (resolved.length && resolved[resolved.length - 1] !== "..") resolved.pop();
        continue;
      }
      resolved.push(part);
    }
    return resolved.join("/");
  };
  if (/^[A-Za-z]:\//.test(clean)) return `${clean.slice(0, 2)}/${resolveSegments(clean.slice(2))}`;
  return `/${resolveSegments(clean)}`;
}

/**
 * Resolve a tool/file path to the repository it belongs to and the repo-relative
 * path within it. Absolute paths are matched against the longest repo root;
 * relative paths are joined against the session workspace before matching.
 * This is what lets a shared workspace or nested monorepo attribute a change to
 * the right repository instead of the first one that happens to have a match.
 */
export function resolveRepoRelativePath(
  rawPath: string | null | undefined,
  repoRoots: string[],
  workspaceDir?: string
): { repoRoot: string; repoPath: string } | null {
  if (!rawPath || typeof rawPath !== "string") return null;
  const clean = toPosixPath(rawPath).trim();
  if (!clean || clean.includes("\0")) return null;

  let absolute: string;
  if (isAbsolutePath(clean)) {
    absolute = normalizeAbsolutePath(clean);
  } else {
    const base = workspaceDir ? normalizeAbsolutePath(workspaceDir) : "";
    if (!base) return null;
    absolute = normalizeAbsolutePath(`${base}/${clean}`);
  }

  let best: string | null = null;
  for (const root of repoRoots) {
    if (absolute === root || absolute.startsWith(`${root}/`)) {
      if (!best || root.length > best.length) best = root;
    }
  }
  if (!best) return null;

  const repoPath = absolute.slice(best.length).replace(/^\/+/, "");
  return repoPath ? { repoRoot: best, repoPath } : null;
}

/**
 * Collects the repo-relative paths touched by the current conversation, grouped
 * by repository. Mirrors {@link extractConversationTouchedPaths} but keeps each
 * repo's namespace separate so identical relative paths in sibling repos never
 * collide.
 */
export function extractConversationTouchedPathsByRepo(options: {
  repoRoots: string[];
  workspaceDir?: string;
  fileChanges?: ThunderFileChangeRecord[];
  messages?: ThunderChatMessage[];
  streamingTools?: ActiveToolInfo[];
}): Map<string, Set<string>> {
  const { fileChanges = [], messages = [], streamingTools = [], workspaceDir } = options;
  const repoRoots = [...new Set(options.repoRoots.map(normalizeRoot).filter(Boolean))];
  const touched = new Map<string, Set<string>>();
  if (!repoRoots.length) return touched;

  const addPath = (rawPath: string | null | undefined) => {
    if (!rawPath) return;
    const resolved = resolveRepoRelativePath(rawPath, repoRoots, workspaceDir);
    if (!resolved) return;
    const set = touched.get(resolved.repoRoot) || new Set<string>();
    set.add(resolved.repoPath);
    touched.set(resolved.repoRoot, set);
  };

  // 1. Explicit file change records from trace collector
  for (const fc of fileChanges) {
    if (fc.action !== "failed" && fc.path) addPath(fc.path);
  }

  // 2. Tool executions and tool calls in messages
  for (const msg of messages) {
    if (Array.isArray(msg.tool_executions)) {
      for (const tool of msg.tool_executions) {
        if (FILE_MODIFYING_TOOLS.has(tool.name) || tool.name.includes("file") || tool.name.includes("edit")) {
          addPath(extractFilePathFromArgs(tool.arguments));
        }
      }
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const fnName = tc.function?.name || "";
        if (FILE_MODIFYING_TOOLS.has(fnName) || fnName.includes("file") || fnName.includes("edit")) {
          try {
            const parsed = JSON.parse(tc.function.arguments);
            addPath(extractFilePathFromArgs(parsed));
          } catch {
            // ignore malformed arguments
          }
        }
      }
    }
  }

  // 3. Streaming tools in current active turn
  for (const st of streamingTools) {
    if (FILE_MODIFYING_TOOLS.has(st.name) || st.name.includes("file") || st.name.includes("edit")) {
      addPath(extractFilePathFromArgs(st.arguments));
    }
  }

  return touched;
}

export interface DirtyGitFile {
  path: string;
  repoRoot?: string;
  repoPath?: string;
  status: string;
}

/** One conversation-touched dirty file, scoped to its repository. */
export interface ConversationGitFile {
  repoRoot: string;
  repoPath: string;
  /** Workspace-relative display path from the status result. */
  displayPath: string;
  status: string;
}

/**
 * Filters a repository's full dirty file list down to only the files that were
 * modified in the current conversation, matching on the repository + path pair.
 */
export function filterConversationDirtyFiles(
  allDirtyFiles: DirtyGitFile[],
  touchedByRepo: Map<string, Set<string>>
): ConversationGitFile[] {
  if (touchedByRepo.size === 0) return [];

  const result: ConversationGitFile[] = [];
  const seen = new Set<string>();

  for (const file of allDirtyFiles) {
    const repoRoot = file.repoRoot || "";
    const repoKey = normalizeRoot(repoRoot);
    if (!repoKey) continue;
    const touched = touchedByRepo.get(repoKey);
    if (!touched?.size) continue;

    const repoPath = toPosixPath(file.repoPath || file.path || "").replace(/^\.?\//, "");
    if (!repoPath) continue;
    const key = `${repoKey}\0${repoPath}`;
    if (!touched.has(repoPath) || seen.has(key)) continue;

    seen.add(key);
    result.push({
      repoRoot,
      repoPath,
      displayPath: file.path || repoPath,
      status: file.status || "modified"
    });
  }

  return result;
}

export interface GitNestedScanOptions {
  maxDepth?: number;
  ignoreDirs?: string[];
  maxRepos?: number;
}

export interface ConversationGitSnapshot {
  status: GitStatusResult | null;
  repoRoots: string[];
  files: ConversationGitFile[];
}

/**
 * Loads the conversation's dirty git files across a shared/nested workspace.
 * Runs status per workspace root with the same nested scan the workbench uses,
 * merges the results into one multi-repo status, and keeps only the files this
 * conversation touched.
 */
export async function loadConversationGitFiles(options: {
  workspaceDirs: string[];
  workspaceDir?: string;
  nestedScan?: GitNestedScanOptions;
  fileChanges?: ThunderFileChangeRecord[];
  messages?: ThunderChatMessage[];
  streamingTools?: ActiveToolInfo[];
}): Promise<ConversationGitSnapshot> {
  const { nestedScan, fileChanges = [], messages = [], streamingTools = [] } = options;
  const roots = [...new Set(options.workspaceDirs.map((dir) => dir?.trim()).filter(Boolean))];
  const workspaceDir = options.workspaceDir || roots[0];
  if (!roots.length) return { status: null, repoRoots: [], files: [] };

  const results = await Promise.all(roots.map((cwd) =>
    desktopApi().terminalGitStatus({ cwd, nestedScan }).catch(() => null)
  ));
  const projects: string[] = [];
  const statuses: GitStatusResult[] = [];
  results.forEach((result, index) => {
    if (result) {
      projects.push(roots[index]);
      statuses.push(result);
    }
  });
  if (!statuses.length) return { status: null, repoRoots: [], files: [] };

  const status = mergeGitStatuses(projects, statuses);
  const repoRoots = collectGitRoots(status);
  const touchedByRepo = extractConversationTouchedPathsByRepo({
    repoRoots,
    workspaceDir,
    fileChanges,
    messages,
    streamingTools
  });
  const dirty: DirtyGitFile[] = [...status.staged, ...status.unstaged].map((change) => ({
    path: change.path,
    repoPath: change.repoPath,
    repoRoot: change.repoRoot || status.root || (repoRoots.length === 1 ? repoRoots[0] : ""),
    status: change.status
  }));

  return { status, repoRoots, files: filterConversationDirtyFiles(dirty, touchedByRepo) };
}

const HUNK_HEADER_REGEX = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/;

/**
 * Parses raw git diff sides / patch output into structured lines for display.
 * Includes hunk headers, line additions/deletions, context lines, and line numbers.
 */
export function parseDiffLines(diffSides: {
  oldLabel?: string;
  newLabel?: string;
  oldText?: string;
  newText?: string;
  patch?: string;
}): ParsedDiffResult {
  const patch = diffSides.patch?.trim();
  const oldText = diffSides.oldText ?? "";
  const newText = diffSides.newText ?? "";

  const lines: GitDiffDisplayLine[] = [];
  let additions = 0;
  let deletions = 0;

  // Case 1: Standard git patch output is present
  if (patch) {
    const rawLines = patch.split("\n");
    let currentOldLine = 1;
    let currentNewLine = 1;
    let lineIdx = 0;

    for (const raw of rawLines) {
      lineIdx += 1;
      // Skip patch meta headers
      if (
        raw.startsWith("diff --git") ||
        raw.startsWith("index ") ||
        raw.startsWith("--- ") ||
        raw.startsWith("+++ ")
      ) {
        continue;
      }

      const hunkMatch = HUNK_HEADER_REGEX.exec(raw);
      if (hunkMatch) {
        currentOldLine = Number.parseInt(hunkMatch[1], 10);
        currentNewLine = Number.parseInt(hunkMatch[3], 10);
        lines.push({
          id: `hunk_${lineIdx}`,
          kind: "header",
          text: raw
        });
        continue;
      }

      if (raw.startsWith("+")) {
        additions += 1;
        lines.push({
          id: `line_${lineIdx}`,
          kind: "add",
          text: raw.slice(1),
          newLine: currentNewLine++
        });
      } else if (raw.startsWith("-")) {
        deletions += 1;
        lines.push({
          id: `line_${lineIdx}`,
          kind: "del",
          text: raw.slice(1),
          oldLine: currentOldLine++
        });
      } else if (raw.startsWith(" ") || raw === "") {
        lines.push({
          id: `line_${lineIdx}`,
          kind: "context",
          text: raw.startsWith(" ") ? raw.slice(1) : raw,
          oldLine: currentOldLine++,
          newLine: currentNewLine++
        });
      }
    }

    return { lines, additions, deletions };
  }

  // Case 2: Untracked / newly added file (empty oldText, non-empty newText)
  if (oldText === "" && newText !== "") {
    const textLines = newText.split("\n");
    // Strip trailing empty line from git representation if standard
    if (textLines.length > 0 && textLines[textLines.length - 1] === "") {
      textLines.pop();
    }
    lines.push({
      id: "hunk_new",
      kind: "header",
      text: `@@ -0,0 +1,${textLines.length} @@ (new file)`
    });
    textLines.forEach((text, i) => {
      additions += 1;
      lines.push({
        id: `add_${i + 1}`,
        kind: "add",
        text,
        newLine: i + 1
      });
    });
    return { lines, additions, deletions };
  }

  // Case 3: Deleted file (non-empty oldText, empty newText)
  if (newText === "" && oldText !== "") {
    const textLines = oldText.split("\n");
    if (textLines.length > 0 && textLines[textLines.length - 1] === "") {
      textLines.pop();
    }
    lines.push({
      id: "hunk_del",
      kind: "header",
      text: `@@ -1,${textLines.length} +0,0 @@ (deleted file)`
    });
    textLines.forEach((text, i) => {
      deletions += 1;
      lines.push({
        id: `del_${i + 1}`,
        kind: "del",
        text,
        oldLine: i + 1
      });
    });
    return { lines, additions, deletions };
  }

  // Case 4: No changes
  return { lines: [], additions: 0, deletions: 0 };
}
