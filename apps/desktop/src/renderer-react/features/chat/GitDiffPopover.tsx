import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { desktopApi } from "../../bridge";
import type {
  ThunderChatMessage,
  ThunderFileChangeRecord
} from "@agent-resume/core";
import type { ActiveToolInfo } from "./useThunderChat";
import {
  loadConversationGitFiles,
  parseDiffLines,
  type ConversationGitFile,
  type GitNestedScanOptions,
  type ParsedDiffResult
} from "./gitDiffUtils";
import { basename, type GitStatusResult } from "../workbench/git/workbenchGitModel";

export interface GitDiffPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceDir: string;
  /** All repo roots in the session workspace (shared/nested projects). */
  workspaceDirs?: string[];
  nestedScan?: GitNestedScanOptions;
  fileChanges?: ThunderFileChangeRecord[];
  messages?: ThunderChatMessage[];
  streamingTools?: ActiveToolInfo[];
  onCommitSuccess?: () => void;
}

/** Stable per-file key: the same repo-relative path can exist in two repos. */
function conversationFileKey(file: Pick<ConversationGitFile, "repoRoot" | "repoPath">): string {
  return `${file.repoRoot}\0${file.repoPath}`;
}

/** Group conversation files by repository, so each repo commits its own paths. */
function groupConversationFilesByRepo(files: ConversationGitFile[]): Array<{ repoRoot: string; paths: string[] }> {
  const groups = new Map<string, Set<string>>();
  for (const file of files) {
    const paths = groups.get(file.repoRoot) || new Set<string>();
    paths.add(file.repoPath);
    groups.set(file.repoRoot, paths);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([repoRoot, paths]) => ({ repoRoot, paths: [...paths] }));
}

interface FileDiffState {
  loading: boolean;
  error?: string;
  diff?: ParsedDiffResult;
}

export function GitDiffPopover({
  isOpen,
  onClose,
  workspaceDir,
  workspaceDirs,
  nestedScan,
  fileChanges = [],
  messages = [],
  streamingTools = [],
  onCommitSuccess
}: GitDiffPopoverProps): React.JSX.Element | null {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [isRepo, setIsRepo] = useState<boolean>(true);
  const [repoRoots, setRepoRoots] = useState<string[]>([]);
  const [conversationFiles, setConversationFiles] = useState<ConversationGitFile[]>([]);
  const [fileDiffs, setFileDiffs] = useState<Record<string, FileDiffState>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Commit and Push state
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [isGeneratingMessage, setIsGeneratingMessage] = useState<boolean>(false);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [commitStatusLabel, setCommitStatusLabel] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(false);

  const workspaceRoots = useMemo(() => (
    workspaceDirs && workspaceDirs.length
      ? [...new Set(workspaceDirs.map((dir) => dir?.trim()).filter(Boolean))]
      : workspaceDir ? [workspaceDir] : []
  ), [workspaceDirs, workspaceDir]);

  // Load single file diff from the repository that owns the path.
  const loadSingleFileDiff = useCallback(
    async (root: string, relPath: string) => {
      const key = conversationFileKey({ repoRoot: root, repoPath: relPath });
      setFileDiffs((prev) => ({
        ...prev,
        [key]: { loading: true, diff: prev[key]?.diff }
      }));
      try {
        const sides = await desktopApi().terminalGitDiffSides({
          cwd: root,
          path: relPath,
          staged: false
        });
        const parsed = parseDiffLines(sides);
        setFileDiffs((prev) => ({
          ...prev,
          [key]: { loading: false, diff: parsed }
        }));
      } catch (err) {
        setFileDiffs((prev) => ({
          ...prev,
          [key]: {
            loading: false,
            error: err instanceof Error ? err.message : String(err)
          }
        }));
      }
    },
    []
  );

  // Refresh dirty files and their diffs across every repo in the workspace.
  const refresh = useCallback(async () => {
    if (!workspaceRoots.length) {
      setStatus(null);
      setIsRepo(false);
      setRepoRoots([]);
      setConversationFiles([]);
      return;
    }
    setIsLoadingStatus(true);
    setErrorMessage(null);

    try {
      const snapshot = await loadConversationGitFiles({
        workspaceDirs: workspaceRoots,
        workspaceDir,
        nestedScan,
        fileChanges,
        messages,
        streamingTools
      });
      setStatus(snapshot.status);
      setIsRepo(snapshot.status?.isRepo ?? false);
      setRepoRoots(snapshot.repoRoots);
      setConversationFiles(snapshot.files);

      // Default expand all matched files
      setExpandedPaths(new Set(snapshot.files.map(conversationFileKey)));

      // Fetch diffs in parallel
      for (const item of snapshot.files) {
        void loadSingleFileDiff(item.repoRoot, item.repoPath);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingStatus(false);
    }
  }, [workspaceRoots, workspaceDir, nestedScan, fileChanges, messages, streamingTools, loadSingleFileDiff]);

  useEffect(() => {
    if (isOpen) {
      void refresh();
    }
  }, [isOpen, refresh]);

  const repoGroups = useMemo(() => groupConversationFilesByRepo(conversationFiles), [conversationFiles]);
  const repoFileGroups = useMemo(() => {
    const groups = new Map<string, ConversationGitFile[]>();
    for (const file of conversationFiles) {
      const files = groups.get(file.repoRoot) || [];
      files.push(file);
      groups.set(file.repoRoot, files);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([repoRoot, files]) => ({ repoRoot, files }));
  }, [conversationFiles]);
  const primaryRepo = useMemo(() => (
    repoGroups.length
      ? [...repoGroups].sort((left, right) => right.paths.length - left.paths.length || left.repoRoot.localeCompare(right.repoRoot))[0]
      : null
  ), [repoGroups]);
  const repoLabel = (root: string) => (
    status?.nestedRepos?.find((repo) => repo.root === root)?.displayPath || basename(root)
  );

  // Toggle single file accordion
  const toggleAccordion = (file: ConversationGitFile) => {
    const key = conversationFileKey(file);
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        if (!fileDiffs[key]?.diff) {
          void loadSingleFileDiff(file.repoRoot, file.repoPath);
        }
      }
      return next;
    });
  };

  // Toggle expand / collapse all
  const toggleAll = () => {
    if (expandedPaths.size === conversationFiles.length) {
      setExpandedPaths(new Set());
      return;
    }
    setExpandedPaths(new Set(conversationFiles.map(conversationFileKey)));
    for (const file of conversationFiles) {
      const key = conversationFileKey(file);
      if (!fileDiffs[key]?.diff) {
        void loadSingleFileDiff(file.repoRoot, file.repoPath);
      }
    }
  };

  const handleCopy = (pathStr: string) => {
    navigator.clipboard.writeText(pathStr).catch(() => {});
    setCopiedPath(pathStr);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  // Generate commit message from .arp and desktop settings via LLM / heuristic
  const handleSuggestCommitMessage = async () => {
    if (!primaryRepo || conversationFiles.length === 0 || isGeneratingMessage) return;
    setIsGeneratingMessage(true);
    setErrorMessage(null);
    try {
      const res = await desktopApi().terminalGitSuggestCommit({
        repoRoot: primaryRepo.repoRoot,
        paths: primaryRepo.paths
      });
      if (res?.message) {
        setCommitMessage(res.message);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGeneratingMessage(false);
    }
  };

  // 1-Click Commit and Push only conversation files, per repository.
  const handleCommitAndPush = async () => {
    if (!repoGroups.length || isCommitting) return;
    setIsCommitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    let msg = commitMessage.trim();

    try {
      if (!msg) {
        if (!primaryRepo) throw new Error("Unable to generate commit message.");
        setCommitStatusLabel("Generating message...");
        const res = await desktopApi().terminalGitSuggestCommit({
          repoRoot: primaryRepo.repoRoot,
          paths: primaryRepo.paths
        });
        msg = res.message.trim();
        setCommitMessage(res.message);
      }

      if (!msg) {
        throw new Error("Unable to generate commit message.");
      }

      for (const group of repoGroups) {
        setCommitStatusLabel("Committing...");
        await desktopApi().terminalGitCommit({
          repoRoot: group.repoRoot,
          message: msg,
          paths: group.paths
        });

        setCommitStatusLabel("Pushing...");
        await desktopApi().terminalGitPush({ repoRoot: group.repoRoot });
      }

      setSuccessMessage(`Committed and pushed ${conversationFiles.length} file${conversationFiles.length > 1 ? "s" : ""}!`);
      setCommitMessage("");
      onCommitSuccess?.();

      // Refresh status after commit
      await refresh();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCommitting(false);
      setCommitStatusLabel("");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="tb-trace-overlay" onClick={onClose}>
      <div
        className="tb-trace-popover tb-git-diff-popover"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="tb-trace-header">
          <div className="tb-trace-title-row">
            <div className="tb-trace-title">
              <ThemeIcon name="git-branch" size={ICON_SIZE.dense} />
              <span>Git Diff</span>
              <span className="tb-trace-count-badge">
                {conversationFiles.length} file{conversationFiles.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="tb-trace-actions">
              {conversationFiles.length > 0 && (
                <button
                  type="button"
                  className="tb-trace-refresh-btn"
                  onClick={toggleAll}
                  title={
                    expandedPaths.size === conversationFiles.length
                      ? "Collapse All"
                      : "Expand All"
                  }
                >
                  <ThemeIcon
                    name={
                      expandedPaths.size === conversationFiles.length
                        ? "chevron-up"
                        : "chevron-down"
                    }
                    size={ICON_SIZE.dense}
                  />
                </button>
              )}
              <button
                type="button"
                className="tb-trace-refresh-btn"
                onClick={() => void refresh()}
                disabled={isLoadingStatus}
                title="Refresh Git Diff"
              >
                <ThemeIcon
                  name="refresh"
                  size={ICON_SIZE.dense}
                  className={isLoadingStatus ? "spin" : ""}
                />
              </button>
              <button
                type="button"
                className="tb-trace-close-btn"
                onClick={onClose}
                title="Close"
              >
                <ThemeIcon name="close" size={ICON_SIZE.dense} />
              </button>
            </div>
          </div>

          {/* Commit & Push Bar */}
          <div className="tb-git-commit-bar">
            <div className="tb-git-commit-input-wrap">
              <input
                type="text"
                className="tb-git-commit-input"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message (auto-generated from .arp / settings if empty)..."
                disabled={isCommitting || conversationFiles.length === 0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleCommitAndPush();
                  }
                }}
              />
              <button
                type="button"
                className="tb-git-suggest-btn"
                onClick={() => void handleSuggestCommitMessage()}
                disabled={
                  isGeneratingMessage ||
                  isCommitting ||
                  conversationFiles.length === 0
                }
                title="Generate commit message from .arp and settings rules"
              >
                {isGeneratingMessage ? (
                  <ThemeIcon
                    name="loader"
                    size={ICON_SIZE.dense}
                    className="spin"
                  />
                ) : (
                  <ThemeIcon name="sparkles" size={ICON_SIZE.dense} />
                )}
                <span>AI Message</span>
              </button>
            </div>

            <div className="tb-git-commit-actions">
              {errorMessage && (
                <span className="tb-git-error-text" title={errorMessage}>
                  {errorMessage}
                </span>
              )}
              {successMessage && (
                <span className="tb-git-success-text">{successMessage}</span>
              )}

              <button
                type="button"
                className="tb-git-commit-push-btn"
                onClick={() => void handleCommitAndPush()}
                disabled={isCommitting || conversationFiles.length === 0}
              >
                {isCommitting ? (
                  <>
                    <ThemeIcon
                      name="loader"
                      size={ICON_SIZE.dense}
                      className="spin"
                    />
                    <span>{commitStatusLabel || "Working..."}</span>
                  </>
                ) : (
                  <>
                    <ThemeIcon name="upload" size={ICON_SIZE.dense} />
                    <span>
                      Commit & Push ({conversationFiles.length})
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Accordion Diff Body */}
        <div className="tb-trace-body tb-git-diff-body">
          {!isRepo ? (
            <div className="tb-trace-empty">
              <ThemeIcon name="git-branch" size={ICON_SIZE.prominent} />
              <p>Current workspace is not a Git repository.</p>
              <span>Initialize a Git repository to view diffs and commit changes.</span>
            </div>
          ) : isLoadingStatus && conversationFiles.length === 0 ? (
            <div className="tb-trace-empty">
              <ThemeIcon
                name="loader"
                size={ICON_SIZE.prominent}
                className="spin"
              />
              <p>Checking Git status...</p>
            </div>
          ) : conversationFiles.length === 0 ? (
            <div className="tb-trace-empty">
              <ThemeIcon name="git-branch" size={ICON_SIZE.prominent} />
              <p>No uncommitted Git changes in this conversation.</p>
              <span>
                Files created or modified during this chat will appear here when dirty.
                Changes made by other agents or manually are excluded.
              </span>
            </div>
          ) : (
            <div className="tb-git-accordion-list">
              {repoFileGroups.map(({ repoRoot: groupRoot, files }) => (
                <div key={groupRoot} className="tb-git-repo-group">
                  {repoRoots.length > 1 ? (
                    <div className="tb-git-repo-heading" title={groupRoot}>
                      <ThemeIcon name="git-branch" size={ICON_SIZE.inline} />
                      <span>{repoLabel(groupRoot)}</span>
                    </div>
                  ) : null}
              {files.map((file) => {
                const key = conversationFileKey(file);
                const isExpanded = expandedPaths.has(key);
                const state = fileDiffs[key];
                const diff = state?.diff;
                const isCopied = copiedPath === file.displayPath;

                const statusLabel =
                  file.status === "untracked" || file.status === "added"
                    ? "A"
                    : file.status === "deleted"
                    ? "D"
                    : "M";

                return (
                  <div key={key} className="tb-git-diff-item">
                    <div
                      role="button"
                      tabIndex={0}
                      className="tb-git-diff-item-header"
                      onClick={() => toggleAccordion(file)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleAccordion(file);
                        }
                      }}
                      aria-expanded={isExpanded}
                    >
                      <span
                        className={`tb-git-diff-chevron${
                          isExpanded ? " is-expanded" : ""
                        }`}
                      >
                        <ThemeIcon
                          name="chevron-right"
                          size={ICON_SIZE.inline}
                        />
                      </span>

                      <span
                        className={`tb-file-badge tb-file-badge-${
                          statusLabel === "A"
                            ? "created"
                            : statusLabel === "D"
                            ? "deleted"
                            : "modified"
                        }`}
                      >
                        {statusLabel}
                      </span>

                      <span className="tb-git-diff-path" title={file.displayPath}>
                        {file.displayPath}
                      </span>

                      {diff && (
                        <span className="tb-git-diff-stats">
                          {diff.additions > 0 && (
                            <span className="tb-git-diff-add">
                              +{diff.additions}
                            </span>
                          )}
                          {diff.deletions > 0 && (
                            <span className="tb-git-diff-del">
                              -{diff.deletions}
                            </span>
                          )}
                        </span>
                      )}

                      <button
                        type="button"
                        className="tb-file-copy-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(file.displayPath);
                        }}
                        title="Copy file path"
                      >
                        <ThemeIcon
                          name={isCopied ? "check" : "copy"}
                          size={ICON_SIZE.inline}
                        />
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="tb-git-diff-item-body">
                        {state?.loading ? (
                          <div className="tb-git-diff-loading">
                            <ThemeIcon
                              name="loader"
                              size={ICON_SIZE.dense}
                              className="spin"
                            />
                            <span>Loading diff...</span>
                          </div>
                        ) : state?.error ? (
                          <div className="tb-git-diff-error">
                            <span>Failed to load diff: {state.error}</span>
                          </div>
                        ) : !diff || diff.lines.length === 0 ? (
                          <div className="tb-git-diff-empty">
                            <span>(No textual diff available)</span>
                          </div>
                        ) : (
                          <div className="tb-git-diff-lines">
                            {diff.lines.map((line) => (
                              <div
                                key={line.id}
                                className={`tb-git-diff-line tb-git-diff-line-${line.kind}`}
                              >
                                {line.kind === "header" ? (
                                  <div className="tb-git-diff-hunk-header">
                                    {line.text}
                                  </div>
                                ) : (
                                  <>
                                    <span className="tb-git-diff-gutter tb-git-diff-gutter-old">
                                      {line.oldLine ?? ""}
                                    </span>
                                    <span className="tb-git-diff-gutter tb-git-diff-gutter-new">
                                      {line.newLine ?? ""}
                                    </span>
                                    <span className="tb-git-diff-sign">
                                      {line.kind === "add"
                                        ? "+"
                                        : line.kind === "del"
                                        ? "-"
                                        : " "}
                                    </span>
                                    <span className="tb-git-diff-text">
                                      {line.text}
                                    </span>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="tb-files-footer">
          <ThemeIcon name="shield-check" size={ICON_SIZE.inline} />
          <span>
            Only commits files modified in this conversation. Other workspace modifications are preserved.
          </span>
        </div>
      </div>
    </div>
  );
}
