import React, { useEffect, useRef, useState, type ReactPortal } from "react";
import { createPortal } from "react-dom";
import { ThemeIcon } from "../../../components/ThemeIcon";
import { useI18n } from "../../../i18n";
import { startWorkbenchPathDrag } from "../workbenchDnd";
import {
  type ActiveGitDiff,
  type CommitSuggestion,
  type GitChange,
  type GitStageTarget,
  type GitStatusResult,
  type GitTreeNode,
  buildGitChangeTree,
  gitChangeFilePath,
  gitChangeKey,
  gitChangeTreePath,
  gitDirectoryExpandKey,
  gitGroupCheckboxState,
  gitNodeDragPath,
  gitRepositoryCount,
  gitRepositoryLabel,
  gitStatusClass,
  gitStatusLetter,
  groupGitChangesByRepo,
  trackingForRoot,
  uniqueGitChanges
} from "./workbenchGitModel";
import { GitBranchSelector, GitRepositorySelector } from "./GitGraphView";

const COMMIT_INPUT_MIN_HEIGHT = 96;
const COMMIT_INPUT_MAX_HEIGHT = 190;

export function GitTreeCheckbox({
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
  return <button
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
    {checked ? <ThemeIcon name="check" size={11} strokeWidth={3} aria-hidden="true" /> : null}
    {mixed ? <span className="wb-git-check-dash" aria-hidden="true" /> : null}
  </button>;
}

export function GitChangeTree({
  nodes,
  depth,
  staged,
  expanded,
  activeDiff,
  discarding,
  onToggleDir,
  onToggleStage,
  onOpen,
  onContextMenu,
  onDiscard,
  onDiscardDirectory,
  discardLabel
}: {
  nodes: GitTreeNode[];
  depth: number;
  staged: boolean;
  expanded: Set<string>;
  activeDiff?: ActiveGitDiff;
  discarding: Set<string>;
  onToggleDir: (path: string) => void;
  onToggleStage: (targets: GitStageTarget | GitStageTarget[], targetStaged: boolean) => void;
  onOpen: (change: GitChange) => void;
  onContextMenu: (event: React.MouseEvent, change: GitChange) => void;
  onDiscard: (change: GitChange) => void;
  onDiscardDirectory: (directoryPath: string, repoRoot: string) => void;
  discardLabel: string;
}): React.JSX.Element {
  return <>{nodes.map((node) => {
    if (node.isDirectory) {
      const nodeChanges = node.changes;
      const keys = nodeChanges.map(gitChangeKey);
      const repoPaths = node.repoPaths;
      const directoryDiscarding = keys.some((key) => discarding.has(key));
      const repoRoot = nodeChanges[0]?.repoRoot || "";
      const expandKey = gitDirectoryExpandKey(repoRoot, node.path);
      const isExpanded = expanded.has(expandKey);
      return <div key={`${repoRoot}:${node.path}`}>
        <div
          className="wb-file-tree-row wb-git-tree-row"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          draggable
          onDragStart={(event) => {
            if (!repoRoot) return;
            startWorkbenchPathDrag(event, gitChangeFilePath({ repoRoot, repoPath: node.path }));
          }}
        >
          <GitTreeCheckbox state={staged} ariaLabel={node.path} onChange={(checked) => {
            if (!repoRoot || !repoPaths.length) return;
            onToggleStage({ repoRoot, paths: repoPaths }, checked);
          }} />
          <button type="button" className="wb-git-tree-row-main" aria-expanded={isExpanded} onClick={() => onToggleDir(expandKey)}>
            <span className={`wb-file-tree-chevron${isExpanded ? " is-expanded" : ""}`}><ThemeIcon name="chevron-right" size={12} /></span>
            <ThemeIcon name="folder" size={14} className="wb-file-tree-icon" />
            <span className="wb-file-tree-label" title={node.path}>{node.name}</span>
          </button>
          <button
            type="button"
            className="wb-git-discard-btn"
            disabled={directoryDiscarding || !repoRoot}
            aria-label={`${discardLabel} ${node.path}`}
            title={discardLabel}
            onClick={() => onDiscardDirectory(node.path, repoRoot)}
          >
            {directoryDiscarding ? <ThemeIcon name="loader" size={13} className="spin" /> : <ThemeIcon name="undo" size={13} />}
          </button>
        </div>
        {isExpanded ? <div className="wb-file-tree-children"><GitChangeTree nodes={node.children} depth={depth + 1} staged={staged} expanded={expanded} activeDiff={activeDiff} discarding={discarding} onToggleDir={onToggleDir} onToggleStage={onToggleStage} onOpen={onOpen} onContextMenu={onContextMenu} onDiscard={onDiscard} onDiscardDirectory={onDiscardDirectory} discardLabel={discardLabel} /></div> : null}
      </div>;
    }
    if (!node.change) return null;
    const key = gitChangeKey(node.change);
    const active = activeDiff?.staged === staged
      && activeDiff.repoRoot === node.change.repoRoot
      && activeDiff.repoPath === node.change.repoPath;
    return <div
      className={`wb-file-tree-row wb-git-tree-file${active ? " is-selected" : ""}`}
      key={node.path}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      aria-selected={active}
      draggable
      onDragStart={(event) => {
        const path = gitNodeDragPath(node);
        if (path) startWorkbenchPathDrag(event, path);
      }}
      onContextMenu={(event) => onContextMenu(event, node.change!)}
    >
      <GitTreeCheckbox state={staged} ariaLabel={gitChangeTreePath(node.change)} onChange={(checked) => {
        if (!node.change?.repoRoot) return;
        onToggleStage({ repoRoot: node.change.repoRoot, paths: [node.change.repoPath] }, checked);
      }} />
      <button type="button" className="wb-git-tree-row-main" title={gitChangeTreePath(node.change)} onClick={() => onOpen(node.change!)}>
        <span className="wb-file-tree-chevron is-placeholder" aria-hidden="true" />
        <span className={`wb-git-file-status ${gitStatusClass(node.change.status)}`}>{gitStatusLetter(node.change.status)}</span>
        <span className="wb-file-tree-label">{node.name}</span>
      </button>
      <button
        type="button"
        className="wb-git-discard-btn"
        disabled={discarding.has(key)}
        aria-label={`${discardLabel} ${node.change.path}`}
        title={discardLabel}
        onClick={() => onDiscard(node.change!)}
      >
        {discarding.has(key) ? <ThemeIcon name="loader" size={13} className="spin" /> : <ThemeIcon name="undo" size={13} />}
      </button>
    </div>;
  })}</>;
}

export function GitChangesPanel({
  visible,
  git,
  gitRoot,
  repositories,
  branch,
  activeDiff,
  expanded,
  discarding,
  commitMessage,
  commitBusy,
  commitSuggestion,
  canCommit,
  syncing,
  onSelectRepo,
  onSelectBranch,
  onSync,
  onToggleDir,
  onToggleStage,
  onOpenDiff,
  onOpenFile,
  onOpenExternal,
  onCopyPath,
  onDiscard,
  onDiscardDirectory,
  onCommitMessageChange,
  onSuggestCommit,
  onCommit,
  labels
}: {
  visible: boolean;
  git: GitStatusResult | null;
  gitRoot: string;
  repositories: Array<{ root: string; label: string }>;
  branch: string;
  activeDiff?: ActiveGitDiff;
  expanded: Set<string>;
  discarding: Set<string>;
  commitMessage: string;
  commitBusy: boolean;
  commitSuggestion: CommitSuggestion | null;
  canCommit: boolean;
  syncing: boolean;
  onSelectRepo: (root: string) => void;
  onSelectBranch: (selection: { branch: string; remote?: string }) => void;
  onSync: () => void;
  onToggleDir: (path: string) => void;
  onToggleStage: (targets: GitStageTarget | GitStageTarget[], targetStaged: boolean) => void;
  onOpenDiff: (change: GitChange, staged: boolean) => void;
  onOpenFile: (change: GitChange) => void;
  onOpenExternal: (change: GitChange) => void;
  onCopyPath: (change: GitChange) => void;
  onDiscard: (change: GitChange) => void;
  onDiscardDirectory: (changes: GitChange[], directoryPath: string) => void;
  onCommitMessageChange: (value: string) => void;
  onSuggestCommit: () => void;
  onCommit: (pushAfter: boolean) => void;
  labels: {
    stagedTitle: string;
    changesTitle: string;
    noChanges: string;
    unavailable: string;
    messageLabel: string;
    resizeInput: string;
    autoGenerate: string;
    commit: string;
    commitAndPush: string;
    sync: string;
    suggestedLlm: string;
    suggestedUnconfigured: string;
    suggestedFallback: string;
    openFile: string;
    openDefault: string;
    copyPath: string;
    discard: string;
  };
}): ReactPortal | null {
  const { t } = useI18n();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{ change: GitChange; x: number; y: number } | null>(null);
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [commitInputHeight, setCommitInputHeight] = useState<number | null>(null);
  const [commitInputResizing, setCommitInputResizing] = useState(false);

  useEffect(() => {
    setHost(visible ? document.querySelector<HTMLElement>("#react-workbench .wb-git-panel") : null);
  }, [visible, git, gitRoot]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".wb-context-menu")) setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    setContextMenu(null);
  }, [visible, gitRoot]);

  const beginCommitInputResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = commitInputHeight ?? commitInputRef.current?.offsetHeight ?? COMMIT_INPUT_MIN_HEIGHT;
    setCommitInputResizing(true);
    document.body.classList.add("is-pane-resizing");
    document.body.classList.add("is-pane-resizing-row");
    const move = (next: PointerEvent) => {
      const height = Math.round(Math.min(COMMIT_INPUT_MAX_HEIGHT, Math.max(COMMIT_INPUT_MIN_HEIGHT, startHeight + startY - next.clientY)));
      setCommitInputHeight(height);
    };
    const end = () => {
      setCommitInputResizing(false);
      document.body.classList.remove("is-pane-resizing");
      document.body.classList.remove("is-pane-resizing-row");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };

  if (!visible || !host) return null;
  if (!git?.isRepo && !git?.nestedRepos?.length) {
    return createPortal(<div className="react-git-panel"><p className="muted wb-git-empty">{labels.unavailable}</p></div>, host);
  }

  const sections = [
    { title: labels.stagedTitle, staged: true, entries: uniqueGitChanges(git.staged) },
    { title: labels.changesTitle, staged: false, entries: uniqueGitChanges(git.unstaged) }
  ];
  const allEntries = uniqueGitChanges(sections.flatMap((section) => section.entries));
  const hasEntries = sections.some((section) => section.entries.length > 0);
  const hasStagedEntries = sections.some((section) => section.staged && section.entries.length > 0);
  const showRepoGroups = gitRepositoryCount(git) > 1;
  const tracking = trackingForRoot(git, gitRoot);
  const trackingLabel = tracking?.upstream
    ? t("desktop.workbench.gitBranchTracking", tracking.ahead, tracking.behind)
    : null;
  const suggestionText = commitSuggestion
    ? commitSuggestion.source === "llm"
      ? labels.suggestedLlm
      : commitSuggestion.fallbackReason === "unconfigured"
        ? labels.suggestedUnconfigured
        : labels.suggestedFallback
    : null;

  return createPortal(<><div className="react-git-panel wb-git-panel-layout">
    <div className="wb-git-changes-scroll">
      {hasEntries ? sections.map((section) => {
        if (!section.entries.length) return null;
        const repoGroups = groupGitChangesByRepo(section.entries).map((group) => ({
          ...group,
          entries: section.entries.filter((change) => change.repoRoot === group.repoRoot)
        }));
        return <section className="wb-git-section" key={section.title}>
          <div className="wb-git-section-title">
            <GitTreeCheckbox state={section.staged} ariaLabel={section.title} onChange={(checked) => onToggleStage(repoGroups, checked)} />
            <span className="wb-git-section-title-text">{section.title}</span>
            <span className="wb-git-section-count">{section.entries.length}</span>
          </div>
          {repoGroups.map((group) => <div className="wb-git-repo-group" key={`${section.title}:${group.repoRoot}`}>
            {showRepoGroups ? <div className="wb-git-repo-group-title">
              <GitTreeCheckbox
                state={gitGroupCheckboxState(group.repoRoot, git.staged, git.unstaged)}
                ariaLabel={gitRepositoryLabel(git, group.repoRoot)}
                onChange={(checked) => onToggleStage({ repoRoot: group.repoRoot, paths: group.paths }, checked)}
              />
              <span className="wb-git-repo-group-label" title={group.repoRoot}>{gitRepositoryLabel(git, group.repoRoot)}</span>
              <span className="wb-git-section-count">{group.entries.length}</span>
            </div> : null}
            <div className="wb-git-tree" role="tree">
              <GitChangeTree
                nodes={buildGitChangeTree(group.entries)}
                depth={0}
                staged={section.staged}
                expanded={expanded}
                activeDiff={activeDiff}
                discarding={discarding}
                onToggleDir={onToggleDir}
                onToggleStage={onToggleStage}
                onOpen={(change) => onOpenDiff(change, section.staged)}
                onContextMenu={(event, change) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setContextMenu({ change, x: event.clientX, y: event.clientY });
                }}
                onDiscard={onDiscard}
                onDiscardDirectory={(directoryPath, repoRoot) => {
                  const prefix = `${directoryPath}/`;
                  const changes = allEntries.filter((change) => (
                    change.repoRoot === repoRoot && gitChangeTreePath(change).startsWith(prefix)
                  ));
                  if (changes.length) onDiscardDirectory(changes, directoryPath);
                }}
                discardLabel={labels.discard}
              />
            </div>
          </div>)}
        </section>;
      }) : <p className="muted wb-git-empty">{labels.noChanges}</p>}
    </div>
    <div className="wb-git-commit-composer">
      <div className="wb-git-commit-target">
        <GitRepositorySelector repositories={repositories} value={gitRoot} ariaLabel={t("desktop.workbench.gitRepoSelect")} onChange={onSelectRepo} />
        <GitBranchSelector repoRoot={gitRoot} value={branch} ariaLabel={t("desktop.workbench.switchBranch")} onChange={onSelectBranch} />
      </div>
      {suggestionText ? <p className={`wb-git-commit-suggestion${commitSuggestion?.source === "llm" ? " is-ai" : ""}`}>{suggestionText}</p> : null}
      <div
        className={`pane-resizer is-horizontal wb-git-commit-resizer${commitInputResizing ? " is-dragging" : ""}`}
        role="separator"
        aria-orientation="horizontal"
        aria-label={labels.resizeInput}
        onPointerDown={beginCommitInputResize}
      />
      <textarea
        ref={commitInputRef}
        className="wb-git-commit-input"
        value={commitMessage}
        disabled={commitBusy || !gitRoot}
        placeholder={labels.messageLabel}
        aria-label={labels.messageLabel}
        style={commitInputHeight ? { height: commitInputHeight } : undefined}
        onChange={(event) => onCommitMessageChange(event.target.value)}
      />
      <div className="wb-git-commit-actions">
        <button
          type="button"
          className={`wb-git-action-btn wb-git-commit-auto-btn${commitBusy ? " is-loading" : ""}`}
          disabled={commitBusy || !gitRoot || !hasStagedEntries}
          aria-busy={commitBusy}
          aria-label={labels.autoGenerate}
          title={labels.autoGenerate}
          onClick={onSuggestCommit}
        >
          {commitBusy ? <ThemeIcon name="loader" className="spin wb-git-default-loading" size={16} /> : <ThemeIcon name="sparkles" size={16} />}
        </button>
        <button
          type="button"
          className="wb-git-action-btn"
          disabled={!canCommit}
          aria-label={labels.commit}
          title={labels.commit}
          onClick={() => onCommit(false)}
        >
          <ThemeIcon name="check" size={16} />
        </button>
        <button
          type="button"
          className="wb-git-action-btn primary"
          disabled={!canCommit}
          aria-label={labels.commitAndPush}
          title={labels.commitAndPush}
          onClick={() => onCommit(true)}
        >
          <ThemeIcon name="arrow-up-to-line" size={16} />
        </button>
        {trackingLabel ? <button
          type="button"
          className="muted wb-git-tracking wb-git-tracking-btn"
          title={tracking?.upstream ? `${labels.sync} · ${tracking.upstream}` : labels.sync}
          aria-label={labels.sync}
          aria-busy={syncing}
          disabled={syncing}
          onClick={onSync}
        >
          <ThemeIcon
            name={syncing ? "loader" : "refresh"}
            size={14}
            className={`wb-git-tracking-icon${syncing ? " spin" : ""}`}
            aria-hidden="true"
          />
          <span className="wb-git-tracking-label">{trackingLabel}</span>
        </button> : null}
      </div>
    </div>
  </div>
    {contextMenu ? createPortal(<div
      className="wb-context-menu wb-git-context-menu"
      role="menu"
      style={{
        left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 196)),
        top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 120))
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => { onOpenFile(contextMenu.change); setContextMenu(null); }}>{labels.openFile}</button>
      <button type="button" role="menuitem" onClick={() => { onOpenExternal(contextMenu.change); setContextMenu(null); }}>{labels.openDefault}</button>
      <button type="button" role="menuitem" onClick={() => { onCopyPath(contextMenu.change); setContextMenu(null); }}>{labels.copyPath}</button>
    </div>, document.body) : null}
  </>, host);
}
