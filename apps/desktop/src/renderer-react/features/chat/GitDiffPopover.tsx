import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { desktopApi } from "../../bridge";
import type {
  ThunderChatMessage,
  ThunderFileChangeRecord
} from "@agent-resume/core";
import type { ActiveToolInfo } from "./useThunderChat";
import {
  extractConversationTouchedPaths,
  filterConversationDirtyFiles,
  parseDiffLines,
  type DirtyGitFile,
  type ParsedDiffResult
} from "./gitDiffUtils";

export interface GitDiffPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceDir: string;
  fileChanges?: ThunderFileChangeRecord[];
  messages?: ThunderChatMessage[];
  streamingTools?: ActiveToolInfo[];
  onCommitSuccess?: () => void;
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
  fileChanges = [],
  messages = [],
  streamingTools = [],
  onCommitSuccess
}: GitDiffPopoverProps): React.JSX.Element | null {
  const [repoRoot, setRepoRoot] = useState<string>("");
  const [isRepo, setIsRepo] = useState<boolean>(true);
  const [conversationFiles, setConversationFiles] = useState<DirtyGitFile[]>([]);
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

  // Identify all touched paths in the current conversation
  const touchedPaths = useMemo(() => {
    if (!repoRoot && !workspaceDir) return new Set<string>();
    return extractConversationTouchedPaths({
      fileChanges,
      messages,
      streamingTools,
      repoRoot: repoRoot || workspaceDir,
      workspaceDir
    });
  }, [fileChanges, messages, streamingTools, repoRoot, workspaceDir]);

  // Load single file diff
  const loadSingleFileDiff = useCallback(
    async (root: string, relPath: string) => {
      setFileDiffs((prev) => ({
        ...prev,
        [relPath]: { loading: true, diff: prev[relPath]?.diff }
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
          [relPath]: { loading: false, diff: parsed }
        }));
      } catch (err) {
        setFileDiffs((prev) => ({
          ...prev,
          [relPath]: {
            loading: false,
            error: err instanceof Error ? err.message : String(err)
          }
        }));
      }
    },
    []
  );

  // Refresh dirty files and their diffs
  const refresh = useCallback(async () => {
    if (!workspaceDir) return;
    setIsLoadingStatus(true);
    setErrorMessage(null);

    try {
      const gitInfo = await desktopApi()
        .terminalGitInfo({ cwd: workspaceDir })
        .catch(() => ({ isRepo: false, repoRoot: null, branch: null }));

      if (!gitInfo.isRepo) {
        setIsRepo(false);
        setConversationFiles([]);
        setIsLoadingStatus(false);
        return;
      }

      setIsRepo(true);
      const root = gitInfo.repoRoot || workspaceDir;
      setRepoRoot(root);

      const status = await desktopApi().terminalGitStatus({ cwd: root });
      const dirtyCandidates: DirtyGitFile[] = [
        ...(status.unstaged || []),
        ...(status.staged || [])
      ].map((f) => ({
        path: f.path,
        repoPath: f.repoPath,
        status: f.status
      }));

      const activeTouched = extractConversationTouchedPaths({
        fileChanges,
        messages,
        streamingTools,
        repoRoot: root,
        workspaceDir
      });

      const matched = filterConversationDirtyFiles(dirtyCandidates, activeTouched);
      setConversationFiles(matched);

      // Default expand all matched files
      setExpandedPaths(new Set(matched.map((m) => m.path)));

      // Fetch diffs in parallel
      for (const item of matched) {
        void loadSingleFileDiff(root, item.path);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingStatus(false);
    }
  }, [workspaceDir, fileChanges, messages, streamingTools, loadSingleFileDiff]);

  useEffect(() => {
    if (isOpen) {
      void refresh();
    }
  }, [isOpen, refresh]);

  // Toggle single file accordion
  const toggleAccordion = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!fileDiffs[path]?.diff && repoRoot) {
          void loadSingleFileDiff(repoRoot, path);
        }
      }
      return next;
    });
  };

  // Toggle expand / collapse all
  const toggleAll = () => {
    if (expandedPaths.size === conversationFiles.length) {
      setExpandedPaths(new Set());
    } else {
      setExpandedPaths(new Set(conversationFiles.map((f) => f.path)));
      if (repoRoot) {
        for (const f of conversationFiles) {
          if (!fileDiffs[f.path]?.diff) {
            void loadSingleFileDiff(repoRoot, f.path);
          }
        }
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
    if (!repoRoot || conversationFiles.length === 0 || isGeneratingMessage) return;
    setIsGeneratingMessage(true);
    setErrorMessage(null);
    try {
      const paths = conversationFiles.map((f) => f.path);
      const res = await desktopApi().terminalGitSuggestCommit({
        repoRoot,
        paths
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

  // 1-Click Commit and Push only conversation files
  const handleCommitAndPush = async () => {
    if (!repoRoot || conversationFiles.length === 0 || isCommitting) return;
    setIsCommitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const paths = conversationFiles.map((f) => f.path);
    let msg = commitMessage.trim();

    try {
      if (!msg) {
        setCommitStatusLabel("Generating message...");
        const res = await desktopApi().terminalGitSuggestCommit({
          repoRoot,
          paths
        });
        msg = res.message.trim();
        setCommitMessage(res.message);
      }

      if (!msg) {
        throw new Error("Unable to generate commit message.");
      }

      setCommitStatusLabel("Committing...");
      await desktopApi().terminalGitCommit({
        repoRoot,
        message: msg,
        paths
      });

      setCommitStatusLabel("Pushing...");
      await desktopApi().terminalGitPush({ repoRoot });

      setSuccessMessage(`Committed and pushed ${paths.length} file${paths.length > 1 ? "s" : ""}!`);
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
              {conversationFiles.map((file) => {
                const isExpanded = expandedPaths.has(file.path);
                const state = fileDiffs[file.path];
                const diff = state?.diff;
                const isCopied = copiedPath === file.path;

                const statusLabel =
                  file.status === "untracked" || file.status === "added"
                    ? "A"
                    : file.status === "deleted"
                    ? "D"
                    : "M";

                return (
                  <div key={file.path} className="tb-git-diff-item">
                    <div
                      role="button"
                      tabIndex={0}
                      className="tb-git-diff-item-header"
                      onClick={() => toggleAccordion(file.path)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleAccordion(file.path);
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

                      <span className="tb-git-diff-path" title={file.path}>
                        {file.path}
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
                          handleCopy(file.path);
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
