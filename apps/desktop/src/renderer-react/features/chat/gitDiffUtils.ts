import type { ThunderChatMessage, ThunderFileChangeRecord } from "@agent-resume/core";
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

export interface DirtyGitFile {
  path: string;
  repoPath?: string;
  status: string;
}

/**
 * Filters a repository's full dirty file list down to only the files
 * that were modified in the current conversation.
 */
export function filterConversationDirtyFiles(
  allDirtyFiles: DirtyGitFile[],
  touchedPaths: Set<string>
): DirtyGitFile[] {
  if (touchedPaths.size === 0) return [];

  const result: DirtyGitFile[] = [];
  const seen = new Set<string>();

  for (const file of allDirtyFiles) {
    const candidate = file.repoPath || file.path;
    const clean = candidate.replace(/\\/g, "/").replace(/^\.?\//, "");
    if (touchedPaths.has(clean) && !seen.has(clean)) {
      seen.add(clean);
      result.push({
        path: clean,
        repoPath: clean,
        status: file.status || "modified"
      });
    }
  }

  return result;
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
