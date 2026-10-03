import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { basename } from "../workbench/git/workbenchGitModel";
import {
  conversationFileKey,
  parseDiffLines,
  type ConversationGitFile,
  type ParsedDiffResult
} from "./gitDiffUtils";
import type { ConversationChanges, NoDiffReason } from "./useConversationChanges";
import type { ConversationCommit } from "./useConversationCommit";

export interface GitDiffPanelProps {
  /** Only the active tab loads diffs (lazy-load gate). */
  active: boolean;
  workspaceDir: string;
  changes: ConversationChanges;
  commit: ConversationCommit;
}

interface FileDiffState {
  loading: boolean;
  error?: string;
  diff?: ParsedDiffResult;
}

function statusLetter(file: ConversationGitFile): "A" | "D" | "M" {
  return file.status === "untracked" || file.status === "added"
    ? "A"
    : file.status === "deleted"
      ? "D"
      : "M";
}

function SelectionCheckbox({
  state,
  ariaLabel,
  disabled,
  onChange
}: {
  state: boolean | "mixed";
  ariaLabel: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  const checked = state === true;
  const mixed = state === "mixed";
  return (
    <button
      type="button"
      role="checkbox"
      className={`wb-git-check${checked ? " is-checked" : ""}${mixed ? " is-mixed" : ""}`}
      aria-checked={mixed ? "mixed" : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onChange(!(checked || mixed));
      }}
    >
      {checked ? <ThemeIcon name="check" size={ICON_SIZE.inline} aria-hidden="true" /> : null}
      {mixed ? <span className="wb-git-check-dash" aria-hidden="true" /> : null}
    </button>
  );
}

/**
 * Diff tab body: per-repo grouped accordions of the conversation's dirty files,
 * a per-file selection that drives the commit, the commit bar, and the
 * "no pending diff" section for touched files that are already clean.
 */
export function GitDiffPanel({
  active,
  workspaceDir,
  changes,
  commit
}: GitDiffPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [fileDiffs, setFileDiffs] = useState<Record<string, FileDiffState>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const files = changes.files;
  const repoRoots = changes.repoRoots;

  const loadSingleFileDiff = useCallback(async (root: string, relPath: string) => {
    const key = conversationFileKey({ repoRoot: root, repoPath: relPath });
    setFileDiffs((previous) => ({
      ...previous,
      [key]: { loading: true, diff: previous[key]?.diff }
    }));
    try {
      const sides = await desktopApi().terminalGitDiffSides({
        cwd: root,
        path: relPath,
        staged: false
      });
      const parsed = parseDiffLines(sides);
      setFileDiffs((previous) => ({ ...previous, [key]: { loading: false, diff: parsed } }));
    } catch (caught) {
      setFileDiffs((previous) => ({
        ...previous,
        [key]: { loading: false, error: caught instanceof Error ? caught.message : String(caught) }
      }));
    }
  }, []);

  // Lazy-load gate: only the active tab fetches diffs. Keep the cache pruned to
  // the current file set so a re-dirtied path never shows a stale diff.
  useEffect(() => {
    if (!active) return;
    setExpandedPaths(new Set(files.map(conversationFileKey)));
    setFileDiffs((previous) => {
      const available = new Set(files.map(conversationFileKey));
      const next: Record<string, FileDiffState> = {};
      let changed = false;
      for (const [key, value] of Object.entries(previous)) {
        if (available.has(key)) next[key] = value;
        else changed = true;
      }
      return changed ? next : previous;
    });
    for (const file of files) {
      void loadSingleFileDiff(file.repoRoot, file.repoPath);
    }
  }, [active, files, loadSingleFileDiff]);

  const repoFileGroups = useMemo(() => {
    const groups = new Map<string, ConversationGitFile[]>();
    for (const file of files) {
      const bucket = groups.get(file.repoRoot) || [];
      bucket.push(file);
      groups.set(file.repoRoot, bucket);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([repoRoot, groupFiles]) => ({ repoRoot, files: groupFiles }));
  }, [files]);

  const repoLabel = (root: string) =>
    changes.status?.nestedRepos?.find((repo) => repo.root === root)?.displayPath || basename(root);

  const toggleAccordion = (file: ConversationGitFile) => {
    const key = conversationFileKey(file);
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        if (!fileDiffs[key]?.diff) void loadSingleFileDiff(file.repoRoot, file.repoPath);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (expandedPaths.size === files.length) {
      setExpandedPaths(new Set());
      return;
    }
    setExpandedPaths(new Set(files.map(conversationFileKey)));
    for (const file of files) {
      const key = conversationFileKey(file);
      if (!fileDiffs[key]?.diff) void loadSingleFileDiff(file.repoRoot, file.repoPath);
    }
  };

  const handleCopy = (pathStr: string) => {
    navigator.clipboard.writeText(pathStr).catch(() => {});
    setCopiedPath(pathStr);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const reasonLabel = (reason: NoDiffReason): string =>
    reason === "committed"
      ? t("desktop.chat.changes.reasonCommitted")
      : reason === "not-in-repo"
        ? t("desktop.chat.changes.reasonNotInRepo")
        : t("desktop.chat.changes.reasonFailed");

  const noDiffEntries = changes.noDiffEntries;
  const groupState = (groupFiles: ConversationGitFile[]): boolean | "mixed" => {
    const selectedCount = groupFiles.filter((file) =>
      commit.selected.has(conversationFileKey(file))
    ).length;
    if (selectedCount === 0) return false;
    if (selectedCount === groupFiles.length) return true;
    return "mixed";
  };

  return (
    <>
      {/* Commit & Push Bar */}
      <div className="tb-git-commit-bar">
        <div className="tb-git-commit-input-wrap">
          <input
            type="text"
            className="tb-git-commit-input"
            value={commit.message}
            onChange={(event) => commit.setMessage(event.target.value)}
            placeholder="Commit message (auto-generated from .arp / settings if empty)..."
            disabled={commit.isBusy || commit.selected.size === 0}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void commit.run();
              }
            }}
          />
          <button
            type="button"
            className="tb-git-suggest-btn"
            onClick={() => void commit.suggestMessage()}
            disabled={commit.isBusy || commit.selected.size === 0}
            title="Generate commit message from .arp and settings rules"
          >
            {commit.phase === "generating-message" ? (
              <ThemeIcon name="loader" size={ICON_SIZE.dense} className="spin" />
            ) : (
              <ThemeIcon name="sparkles" size={ICON_SIZE.dense} />
            )}
            <span>AI Message</span>
          </button>
        </div>

        <div className="tb-git-commit-actions">
          {commit.error && (
            <span className="tb-git-error-text" title={commit.error}>
              {commit.error}
            </span>
          )}
          {commit.success && <span className="tb-git-success-text">{commit.success}</span>}

          <button
            type="button"
            className="tb-git-commit-push-btn"
            onClick={() => void commit.run()}
            disabled={commit.isBusy || commit.selected.size === 0}
          >
            {commit.isBusy ? (
              <>
                <ThemeIcon name="loader" size={ICON_SIZE.dense} className="spin" />
                <span>{commit.phaseLabel || "Working..."}</span>
              </>
            ) : (
              <>
                <ThemeIcon name="upload" size={ICON_SIZE.dense} />
                <span>Commit &amp; Push ({commit.selected.size})</span>
              </>
            )}
          </button>
        </div>

        {commit.selected.size > 0 ? (
          <p className="tb-git-unstage-hint">
            {t("desktop.chat.changes.unstageWarning")}
          </p>
        ) : null}

        {commit.outcomes.length > 0 ? (
          <div className="tb-git-outcomes">
            {commit.outcomes.map((outcome) => (
              <div key={outcome.repoRoot} className="tb-git-outcome">
                <span className="tb-git-outcome-repo">{repoLabel(outcome.repoRoot)}</span>
                {outcome.committed && outcome.pushed ? (
                  <span className="tb-git-outcome-ok">pushed</span>
                ) : outcome.committed ? (
                  <>
                    <span className="tb-git-outcome-warn">
                      committed, push failed: {outcome.error}
                    </span>
                    <button
                      type="button"
                      className="tb-git-outcome-retry"
                      onClick={() => void commit.retryPush(outcome.repoRoot)}
                      disabled={commit.isBusy}
                    >
                      Retry push
                    </button>
                  </>
                ) : (
                  <span className="tb-git-outcome-err">commit failed: {outcome.error}</span>
                )}
                {outcome.skipped?.length ? (
                  <span className="tb-git-outcome-warn">
                    skipped: {outcome.skipped.join(", ")}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Accordion Diff Body */}
      <div className="tb-git-diff-body">
        {changes.status?.isRepo && (files.length > 0 || noDiffEntries.length > 0) ? (
          <p className="tb-git-diff-summary">
            {files.length} file{files.length === 1 ? "" : "s"} with uncommitted changes
            {noDiffEntries.length > 0
              ? ` · ${noDiffEntries.length} touched file${
                  noDiffEntries.length === 1 ? "" : "s"
                } have no pending diff`
              : ""}
          </p>
        ) : null}
        {!changes.status?.isRepo ? (
          <div className="tb-trace-empty">
            <ThemeIcon name="git-branch" size={ICON_SIZE.prominent} />
            <p>Current workspace is not a Git repository.</p>
            <span>Initialize a Git repository to view diffs and commit changes.</span>
          </div>
        ) : changes.isLoading && files.length === 0 ? (
          <div className="tb-trace-empty">
            <ThemeIcon name="loader" size={ICON_SIZE.prominent} className="spin" />
            <p>Checking Git status...</p>
          </div>
        ) : files.length === 0 ? (
          <div className="tb-trace-empty">
            <ThemeIcon name="git-branch" size={ICON_SIZE.prominent} />
            <p>No uncommitted Git changes in this conversation.</p>
            <span>
              Files created or modified during this chat will appear here when dirty.
              Changes made by other agents or manually are excluded.
            </span>
          </div>
        ) : (
          <>
            <div className="tb-git-list-toolbar">
              <button
                type="button"
                className="tb-trace-refresh-btn"
                onClick={toggleAll}
                title={expandedPaths.size === files.length ? "Collapse All" : "Expand All"}
              >
                <ThemeIcon
                  name={expandedPaths.size === files.length ? "chevron-up" : "chevron-down"}
                  size={ICON_SIZE.dense}
                />
              </button>
            </div>

            <div className="tb-git-accordion-list">
              {repoFileGroups.map(({ repoRoot: groupRoot, files: groupFiles }) => (
                <div key={groupRoot} className="tb-git-repo-group">
                  {repoRoots.length > 1 ? (
                    <div className="tb-git-repo-heading" title={groupRoot}>
                      <SelectionCheckbox
                        state={groupState(groupFiles)}
                        ariaLabel={`Select all changes in ${repoLabel(groupRoot)}`}
                        onChange={(checked) => {
                          for (const file of groupFiles) {
                            const key = conversationFileKey(file);
                            const isSelected = commit.selected.has(key);
                            if (checked !== isSelected) commit.toggle(key);
                          }
                        }}
                      />
                      <ThemeIcon name="git-branch" size={ICON_SIZE.inline} />
                      <span>{repoLabel(groupRoot)}</span>
                    </div>
                  ) : null}

                  {groupFiles.map((file) => {
                    const key = conversationFileKey(file);
                    const isExpanded = expandedPaths.has(key);
                    const state = fileDiffs[key];
                    const diff = state?.diff;
                    const isCopied = copiedPath === file.displayPath;
                    const letter = statusLetter(file);

                    return (
                      <div key={key} className="tb-git-diff-item">
                        <div
                          role="button"
                          tabIndex={0}
                          className="tb-git-diff-item-header"
                          onClick={() => toggleAccordion(file)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              toggleAccordion(file);
                            }
                          }}
                          aria-expanded={isExpanded}
                        >
                          <SelectionCheckbox
                            state={commit.selected.has(key)}
                            ariaLabel={`Select ${file.displayPath}`}
                            disabled={commit.isBusy}
                            onChange={() => commit.toggle(key)}
                          />

                          <span className={`tb-git-diff-chevron${isExpanded ? " is-expanded" : ""}`}>
                            <ThemeIcon name="chevron-right" size={ICON_SIZE.inline} />
                          </span>

                          <span
                            className={`tb-file-badge tb-file-badge-${
                              letter === "A" ? "created" : letter === "D" ? "deleted" : "modified"
                            }`}
                          >
                            {letter}
                          </span>

                          <span className="tb-git-diff-path" title={file.displayPath}>
                            {file.displayPath}
                          </span>

                          {diff && (
                            <span className="tb-git-diff-stats">
                              {diff.additions > 0 && (
                                <span className="tb-git-diff-add">+{diff.additions}</span>
                              )}
                              {diff.deletions > 0 && (
                                <span className="tb-git-diff-del">-{diff.deletions}</span>
                              )}
                            </span>
                          )}

                          <button
                            type="button"
                            className="tb-file-copy-btn"
                            onClick={(event) => {
                              event.stopPropagation();
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
                            {state?.loading && !diff ? (
                              <div className="tb-git-diff-loading">
                                <ThemeIcon name="loader" size={ICON_SIZE.dense} className="spin" />
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
                                      <div className="tb-git-diff-hunk-header">{line.text}</div>
                                    ) : (
                                      <>
                                        <span className="tb-git-diff-gutter tb-git-diff-gutter-old">
                                          {line.oldLine ?? ""}
                                        </span>
                                        <span className="tb-git-diff-gutter tb-git-diff-gutter-new">
                                          {line.newLine ?? ""}
                                        </span>
                                        <span className="tb-git-diff-sign">
                                          {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
                                        </span>
                                        <span className="tb-git-diff-text">{line.text}</span>
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
          </>
        )}

        {noDiffEntries.length > 0 ? (
          <details className="tb-no-diff-section">
            <summary>
              {t("desktop.chat.changes.noPendingDiff")} ({noDiffEntries.length})
            </summary>
            <ul className="tb-no-diff-list">
              {noDiffEntries.map((entry) => (
                <li key={entry.key} className="tb-no-diff-item">
                  <span className={`tb-no-diff-reason is-${entry.reason}`}>
                    {reasonLabel(entry.reason)}
                  </span>
                  <span className="tb-no-diff-path" title={entry.path}>
                    {entry.path}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </>
  );
}
