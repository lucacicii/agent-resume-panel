import React, { useEffect, useRef, useState, type ReactPortal } from "react";
import { createPortal } from "react-dom";
import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { NativeMenuSelect } from "../../../components/NativeMenuSelect";
import { desktopApi } from "../../../bridge";
import { showContextMenuAt, type NativeContextMenuItem } from "../../../nativeContextMenu";
import { useI18n } from "../../../i18n";
import {
  type GitGraphLayout,
  type GitGraphRow,
  type GitLog,
  type GitLogCommit,
  type GitShow,
  type TerminalGitBranches,
  basename,
  gitCommitBranchNames,
  graphColumnX,
  graphCurvePath
} from "./workbenchGitModel";
import type { CheckoutOption, CheckoutScope } from "./useTaskWorktrees";

function GitGraphSvg({ row, layout }: { row: GitGraphRow; layout: GitGraphLayout }): React.JSX.Element {
  const radius = 4;
  const midY = layout.rowHeight / 2;
  const color = (column: number) => layout.columnColors[column] ?? column % 8;
  const incoming = new Set(row.incomingTracks || []);
  const outgoing = new Set(row.outgoingTracks || []);
  return <svg className="wb-git-log-graph-row-canvas" width={layout.maxColumns * layout.laneWidth} height={layout.rowHeight} viewBox={`0 0 ${layout.maxColumns * layout.laneWidth} ${layout.rowHeight}`} aria-hidden="true">
    {[...incoming].map((column) => <line key={`in-${column}`} x1={graphColumnX(layout, column)} y1={0} x2={graphColumnX(layout, column)} y2={row.commitColumn === column ? midY - radius - 1 : midY} className={`wb-git-graph-lane wb-git-graph-lane-${color(column)}`} />)}
    {[...outgoing].filter((column) => incoming.has(column)).map((column) => <line key={`out-${column}`} x1={graphColumnX(layout, column)} y1={row.commitColumn === column ? midY + radius + 1 : midY} x2={graphColumnX(layout, column)} y2={layout.rowHeight} className={`wb-git-graph-lane wb-git-graph-lane-${color(column)}`} />)}
    {(row.curves || []).map((curve, index) => {
      if (curve.side === "left" && curve.fromCol <= curve.toCol) return null;
      return <path key={`curve-${index}`} d={graphCurvePath(graphColumnX(layout, curve.fromCol), graphColumnX(layout, curve.toCol), layout.rowHeight, curve.side)} className={`wb-git-graph-lane wb-git-graph-lane-${curve.colorIndex ?? color(curve.fromCol)}`} />;
    })}
    {row.commitColumn != null ? <>{row.isHead ? <circle cx={graphColumnX(layout, row.commitColumn)} cy={midY} r={radius + 2.5} className="wb-git-graph-head-ring" /> : null}<circle cx={graphColumnX(layout, row.commitColumn)} cy={midY} r={radius} className={`wb-git-graph-node wb-git-graph-lane-${row.colorIndex ?? color(row.commitColumn)}`} /></> : null}
  </svg>;
}

export function GitGraphPortals({ gitLog, gitShow, keepGraph }: { gitLog: GitLog | null; gitShow: GitShow | null; keepGraph: boolean }): React.JSX.Element | null {
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  useEffect(() => {
    setHosts(gitLog && (keepGraph || !gitShow) ? [...document.querySelectorAll<HTMLElement>("#react-workbench .wb-git-log-graph-row")] : []);
  }, [gitLog, gitShow, keepGraph]);
  if (!gitLog || (gitShow && !keepGraph)) return null;
  return <>{hosts.map((host, index) => {
    const row = gitLog.layout.rows[index];
    return row ? createPortal(<span className="react-git-graph-gutter wb-git-log-graph-gutter" key={gitLog.commits[index]?.hash || index}><GitGraphSvg row={row} layout={gitLog.layout} /></span>, host) : null;
  })}</>;
}

export function GitCommitBranches({ commit }: { commit: GitLogCommit }): React.JSX.Element | null {
  const branches = gitCommitBranchNames(commit);
  if (!branches.length) return null;
  const localBranches = new Set(commit.refs.heads || []);
  return <span className="wb-git-log-branches" aria-label={branches.join(", ")}>
    {branches.map((branch) => <span
      className={`wb-git-log-decoration-pill${localBranches.has(branch) ? " is-local" : " is-remote"}${commit.refs.isHead && commit.refs.primaryLabel === branch ? " is-head" : ""}`}
      data-branch-name={branch}
      title={branch}
      key={branch}
    >
      <ThemeIcon name="git-branch" size={ICON_SIZE.inline} aria-hidden="true" />
      <span>{branch}</span>
    </span>)}
  </span>;
}

export function GitActionIcons({ visible }: { visible: boolean }): React.JSX.Element | null {
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  useEffect(() => {
    setHosts(visible ? [...document.querySelectorAll<HTMLElement>("#react-workbench .wb-git-actions button")] : []);
  }, [visible]);
  if (!visible) return null;
  const icons = [
    { label: "Git log", icon: <ThemeIcon name="history" size={ICON_SIZE.default} /> },
    { label: "Refresh", icon: <ThemeIcon name="refresh" size={ICON_SIZE.default} /> }
  ];
  return <>{hosts.map((host, index) => icons[index] ? createPortal(<span className="react-git-action-icon" title={icons[index].label} aria-hidden="true">{icons[index].icon}</span>, host) : null)}</>;
}

export function GitRepositorySelector({
  repositories,
  value,
  ariaLabel,
  onChange
}: {
  repositories: Array<{ root: string; label: string }>;
  value: string;
  ariaLabel: string;
  onChange: (root: string) => void;
}): React.JSX.Element {
  if (repositories.length <= 1) {
    const only = repositories[0];
    return <span className="wb-git-repo-select is-static" title={only?.root || value} aria-label={ariaLabel}>{only?.label || basename(value)}</span>;
  }
  return <NativeMenuSelect
    className="react-git-repo-select wb-git-repo-select"
    value={value}
    ariaLabel={ariaLabel}
    options={repositories.map((repository) => ({ value: repository.root, label: repository.label }))}
    onChange={onChange}
  />;
}

/**
 * The checkout a pane is looking at: a repository's main working tree, or one of
 * its worktrees.
 *
 * Rendered only when there is something to choose between, so a task that uses
 * no worktree has exactly the chrome it had before. `GitRepositorySelector` above
 * stays what it was — it picks between the *repositories* found inside one
 * checkout — while this picks between the checkouts of the repositories the task
 * references.
 */
export function WorktreeSelector({
  checkouts,
  checkoutFor,
  scope,
  pinned,
  ariaLabel,
  hint,
  onSelect,
  onPin,
  onUnpin
}: {
  checkouts: CheckoutOption[];
  checkoutFor: (scope: CheckoutScope, repoRoot: string) => string | null;
  scope: CheckoutScope;
  pinned: boolean;
  ariaLabel: string;
  /** Replaces the checkout path in the tooltip, for a control whose effect needs saying. */
  hint?: string;
  onSelect: (repoRoot: string, path: string) => void;
  onPin: () => void;
  onUnpin: () => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const byPath = new Map(checkouts.map((option) => [pathKey(option.path), option] as const));
  const repoRoots = [...new Set(checkouts.map((option) => option.repoRoot))];
  const diverted = repoRoots.flatMap((repoRoot) => {
    const path = checkoutFor(scope, repoRoot);
    const option = path ? byPath.get(pathKey(path)) : undefined;
    return option ? [option] : [];
  });
  // With nothing but main checkouts there is nothing to choose, so the control
  // is left out entirely rather than shown disabled.
  if (!checkouts.some((option) => !option.isMain)) return null;

  const mainLabel = t("desktop.workbench.worktreeMainCheckout");
  const branchLabels = new Set(diverted.map((option) => option.branchLabel));
  const label = !diverted.length
    ? mainLabel
    : repoRoots.length === 1
      ? diverted[0].branchLabel
      : diverted.length === repoRoots.length && branchLabels.size === 1
        ? diverted[0].branchLabel
        : `${diverted[0].repoLabel} ▸ ${diverted[0].branchLabel}${diverted.length > 1 ? ` +${diverted.length - 1}` : ""}`;

  /**
   * One native menu, grouped by repository: a disabled label names each
   * repository and its checkouts follow as checkboxes, so the menu shows every
   * repository's choice at once rather than pretending there is only one.
   */
  const openMenu = async () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const items: NativeContextMenuItem[] = [];
    const selectionById = new Map<string, { repoRoot: string; path: string }>();
    repoRoots.forEach((repoRoot, repoIndex) => {
      const rows = checkouts.filter((option) => option.repoRoot === repoRoot);
      if (repoIndex) items.push({ type: "separator" });
      // With a single repository the group header would only repeat the panel's
      // own title, so it is left out.
      if (repoRoots.length > 1) items.push({ label: rows[0]?.repoLabel ?? repoRoot, enabled: false });
      const current = checkoutFor(scope, repoRoot);
      rows.forEach((option, index) => {
        const id = `c${repoIndex}-${index}`;
        selectionById.set(id, { repoRoot, path: option.path });
        items.push({
          id,
          label: option.isMain ? mainLabel : `⌥ ${option.branchLabel}`,
          type: "checkbox",
          checked: current ? pathKey(current) === pathKey(option.path) : option.isMain
        });
      });
    });
    const chosen = await showContextMenuAt({ x: rect.left, y: rect.bottom + 4 }, items);
    const selection = chosen ? selectionById.get(chosen) : undefined;
    if (selection) onSelect(selection.repoRoot, selection.path);
  };

  const shown = diverted[0];
  const detail = hint ?? shown?.path;
  const title = pinned ? t("desktop.workbench.worktreePinned", label) : detail ? `${label}\n${detail}` : label;
  return <span className="wb-worktree-control">
    <button
      ref={buttonRef}
      type="button"
      className={`wb-git-repo-select wb-worktree-select${pinned ? " is-pinned" : ""}`}
      aria-label={`${ariaLabel}: ${label}`}
      aria-haspopup="menu"
      title={title}
      onClick={() => void openMenu()}
    >
      <ThemeIcon name={shown ? "git-branch" : "folder"} size={ICON_SIZE.inline} aria-hidden="true" />
      <span className="native-menu-select-label">{label}</span>
      <ThemeIcon name="chevron-down" size={ICON_SIZE.inline} aria-hidden="true" />
    </button>
    <button
      type="button"
      className="wb-worktree-pin"
      aria-pressed={pinned}
      aria-label={pinned ? t("desktop.workbench.worktreeUnpin") : t("desktop.workbench.worktreePin")}
      title={pinned ? t("desktop.workbench.worktreeUnpin") : t("desktop.workbench.worktreePin")}
      onClick={pinned ? onUnpin : onPin}
    >
      <ThemeIcon name="pin" size={ICON_SIZE.inline} aria-hidden="true" />
    </button>
  </span>;
}

/** Identity of a path across the two spellings macOS reports for the same place. */
function pathKey(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

export function GitBranchSelector({
  repoRoot,
  value,
  ariaLabel,
  onChange
}: {
  repoRoot: string;
  value: string;
  ariaLabel: string;
  onChange: (selection: { branch: string; remote?: string }) => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const [branches, setBranches] = useState<TerminalGitBranches | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Branch picker as a native `NSMenu`: local branches as checkbox items and
   * remote branches under a separator. Item ids map back to the selection.
   */
  const openMenu = async () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    let result = branches;
    if (!result) {
      const api = desktopApi();
      if (typeof api.terminalGitBranches !== "function") return;
      try {
        result = await api.terminalGitBranches({ cwd: repoRoot });
        setBranches(result);
      } catch { return; }
    }
    const direct = result.mode === "direct" ? result : null;
    const localBranches = direct?.localBranches || direct?.branches || [];
    const remoteBranches = direct?.remoteBranches || [];
    const items: NativeContextMenuItem[] = [];
    const selectionById = new Map<string, { branch: string; remote?: string }>();
    if (localBranches.length) {
      items.push({ label: t("desktop.workbench.gitLocalBranches"), enabled: false });
      localBranches.forEach((branch, index) => {
        const id = `l${index}`;
        selectionById.set(id, { branch });
        items.push({ id, label: branch, type: "checkbox", checked: branch === value });
      });
    }
    if (remoteBranches.length) {
      if (items.length) items.push({ type: "separator" });
      items.push({ label: t("desktop.workbench.gitRemoteBranches"), enabled: false });
      remoteBranches.forEach((branch, index) => {
        const id = `r${index}`;
        selectionById.set(id, { branch: branch.name, remote: branch.remote });
        items.push({ id, label: branch.fullName });
      });
    }
    if (!items.length) items.push({ label: t("desktop.workbench.gitNoLocalBranches"), enabled: false });
    const chosen = await showContextMenuAt({ x: rect.left, y: rect.bottom + 4 }, items);
    const selection = chosen ? selectionById.get(chosen) : undefined;
    if (selection) onChange(selection);
  };

  if (!repoRoot) return null;
  return <button
    ref={buttonRef}
    type="button"
    className="react-git-branch-control react-git-branch-trigger"
    aria-label={`${ariaLabel}: ${value || "-"}`}
    aria-haspopup="menu"
    onClick={() => void openMenu()}
  >
    <ThemeIcon name="git-branch" size={ICON_SIZE.inline} aria-hidden="true" />
    <span>{value || "-"}</span>
    <ThemeIcon name="chevron-down" size={ICON_SIZE.inline} aria-hidden="true" />
  </button>;
}

export function BranchGraphNavigation({
  visible,
  title,
  ariaLabel,
  onBack
}: {
  visible: boolean;
  title: string;
  ariaLabel: string;
  onBack: () => void;
}): ReactPortal | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(visible ? document.querySelector<HTMLElement>("#react-workbench .wb-git-pane-head") : null);
  }, [visible]);
  return visible && host ? createPortal(<div className="react-branch-graph-nav">
    <button type="button" className="wb-diff-back" aria-label={ariaLabel} onClick={onBack}><ThemeIcon name="chevron-left" size={ICON_SIZE.default} /></button>
    <span className="react-branch-graph-title">{title}</span>
  </div>, host) : null;
}
