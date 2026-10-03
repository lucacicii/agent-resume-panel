import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThunderChatMessage, ThunderFileChangeRecord } from "@agent-resume/core";
import type { GitStatusResult } from "../workbench/git/workbenchGitModel";
import type { ActiveToolInfo } from "./useThunderChat";
import {
  conversationFileKey,
  loadConversationGitFiles,
  resolveRepoRelativePath,
  type ConversationGitFile,
  type GitNestedScanOptions
} from "./gitDiffUtils";

export type NoDiffReason = "committed" | "not-in-repo" | "failed";

/** A conversation-touched path that currently has no diff to show. */
export interface NoDiffEntry {
  key: string;
  path: string;
  reason: NoDiffReason;
}

export interface ConversationChanges {
  status: GitStatusResult | null;
  repoRoots: string[];
  /** Conversation-touched dirty files (displayable and committable). */
  files: ConversationGitFile[];
  /** Conversation-touched paths with no pending diff (see the Diff tab's footer section). */
  noDiffEntries: NoDiffEntry[];
  /** Raw event footprint, rendered by the read-only Footprint tab. */
  footprintFiles: ThunderFileChangeRecord[];
  /**
   * Header badge number. In a git workspace it equals the committable file count;
   * outside git it falls back to the distinct touched-path count.
   */
  badgeCount: number;
  /** Distinct touched-path count (the Footprint tab's label). */
  footprintCount: number;
  isLoading: boolean;
  /** True once the first status sweep has settled (success or failure). */
  hasLoaded: boolean;
  error?: string;
  /** Called on popover open and after a commit; coalesced with the automatic scan. */
  refresh: () => Promise<void>;
}

const REASON_RANK: Record<NoDiffReason, number> = {
  committed: 1,
  "not-in-repo": 2,
  failed: 3
};

function distinctFootprintPaths(fileChanges: ThunderFileChangeRecord[]): Set<string> {
  const paths = new Set<string>();
  for (const record of fileChanges) {
    if (record.path) paths.add(record.path);
  }
  return paths;
}

/**
 * Footprint entries that are not currently dirty. `failed` outranks `not-in-repo`,
 * which outranks `committed`, so the most actionable reason wins when a path is
 * recorded more than once.
 */
function computeNoDiffEntries(options: {
  repoRoots: string[];
  workspaceDir?: string;
  fileChanges: ThunderFileChangeRecord[];
  dirtyKeys: Set<string>;
}): NoDiffEntry[] {
  const { repoRoots, workspaceDir, fileChanges, dirtyKeys } = options;
  const entries: NoDiffEntry[] = [];
  const index = new Map<string, number>();

  const add = (rawPath: string, reason: NoDiffReason) => {
    const resolved = resolveRepoRelativePath(rawPath, repoRoots, workspaceDir);
    const key = resolved
      ? conversationFileKey(resolved)
      : `outside\0${rawPath}`;
    if (resolved && dirtyKeys.has(key)) return;
    const existing = index.get(key);
    if (existing !== undefined) {
      if (REASON_RANK[reason] > REASON_RANK[entries[existing].reason]) {
        entries[existing] = { key, path: resolved?.repoPath ?? rawPath, reason };
      }
      return;
    }
    index.set(key, entries.length);
    entries.push({ key, path: resolved?.repoPath ?? rawPath, reason });
  };

  // Failed writes first so they win the reason tie-break.
  for (const record of fileChanges) {
    if (!record.path || record.action !== "failed") continue;
    add(record.path, "failed");
  }
  for (const record of fileChanges) {
    if (!record.path || record.action === "failed") continue;
    const resolved = resolveRepoRelativePath(record.path, repoRoots, workspaceDir);
    add(record.path, resolved ? "committed" : "not-in-repo");
  }

  return entries;
}

function sameDeps(left: unknown[], right: unknown[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * Single source of truth for the conversation's git changes. `ChatMain` reads the
 * badge from here and `ChatChangesPopover` reads the panels from here, so the two
 * can never disagree, and only one status sweep is ever in flight.
 */
export function useConversationChanges(options: {
  workspaceDir: string;
  workspaceDirs?: string[];
  nestedScan?: GitNestedScanOptions;
  fileChanges?: ThunderFileChangeRecord[];
  messages?: ThunderChatMessage[];
  streamingTools?: ActiveToolInfo[];
}): ConversationChanges {
  const { workspaceDir, nestedScan, workspaceDirs } = options;
  // Memoize the defaults, otherwise a missing prop would hand `refresh` a new
  // identity on every render and re-trigger its effect endlessly.
  const fileChanges = useMemo(() => options.fileChanges ?? [], [options.fileChanges]);
  const messages = useMemo(() => options.messages ?? [], [options.messages]);
  const streamingTools = useMemo(() => options.streamingTools ?? [], [options.streamingTools]);

  const workspaceRoots = useMemo(
    () =>
      workspaceDirs && workspaceDirs.length
        ? [...new Set(workspaceDirs.map((dir) => dir?.trim()).filter(Boolean))]
        : workspaceDir
          ? [workspaceDir]
          : [],
    [workspaceDirs, workspaceDir]
  );

  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [repoRoots, setRepoRoots] = useState<string[]>([]);
  const [files, setFiles] = useState<ConversationGitFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Latest inputs, so a coalesced refresh always scans the newest state.
  const inputsRef = useRef({ workspaceRoots, workspaceDir, nestedScan, fileChanges, messages, streamingTools });
  inputsRef.current = { workspaceRoots, workspaceDir, nestedScan, fileChanges, messages, streamingTools };

  const runId = useRef(0);
  const requestRef = useRef<{ deps: unknown[]; promise: Promise<void> } | null>(null);

  const refresh = useCallback(async () => {
    const deps = [workspaceRoots, workspaceDir, nestedScan, fileChanges, messages, streamingTools];
    const previous = requestRef.current;
    if (previous && sameDeps(previous.deps, deps)) return previous.promise;

    const myRun = ++runId.current;
    setIsLoading(true);
    const promise = (async () => {
      try {
        const snapshot = await loadConversationGitFiles({
          workspaceDirs: inputsRef.current.workspaceRoots,
          workspaceDir: inputsRef.current.workspaceDir,
          nestedScan: inputsRef.current.nestedScan,
          fileChanges: inputsRef.current.fileChanges,
          messages: inputsRef.current.messages,
          streamingTools: inputsRef.current.streamingTools
        });
        if (runId.current !== myRun) return;
        setStatus(snapshot.status);
        setRepoRoots(snapshot.repoRoots);
        setFiles(snapshot.files);
        setError(undefined);
      } catch (caught) {
        if (runId.current !== myRun) return;
        setStatus(null);
        setRepoRoots([]);
        setFiles([]);
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (runId.current === myRun) {
          setIsLoading(false);
          setHasLoaded(true);
        }
      }
    })();

    requestRef.current = { deps, promise };
    await promise;
    if (requestRef.current?.promise === promise) requestRef.current = null;
  }, [workspaceRoots, workspaceDir, nestedScan, fileChanges, messages, streamingTools]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const noDiffEntries = useMemo(
    () =>
      computeNoDiffEntries({
        repoRoots,
        workspaceDir,
        fileChanges,
        dirtyKeys: new Set(files.map(conversationFileKey))
      }),
    [repoRoots, workspaceDir, fileChanges, files]
  );

  const footprintCount = useMemo(() => distinctFootprintPaths(fileChanges).size, [fileChanges]);
  const badgeCount = status?.isRepo ? files.length : footprintCount;

  return {
    status,
    repoRoots,
    files,
    noDiffEntries,
    footprintFiles: fileChanges,
    badgeCount,
    footprintCount,
    isLoading,
    hasLoaded,
    error,
    refresh
  };
}
