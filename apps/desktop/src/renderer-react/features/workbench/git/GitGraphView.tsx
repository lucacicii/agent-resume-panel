import React, { useEffect, useRef, useState, type ReactPortal } from "react";
import { createPortal } from "react-dom";
import { ThemeIcon } from "../../../components/ThemeIcon";
import { desktopApi } from "../../../bridge";
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

export function GitGraphSvg({ row, layout }: { row: GitGraphRow; layout: GitGraphLayout }): React.JSX.Element {
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
      <ThemeIcon name="git-branch" size={10} aria-hidden="true" />
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
    { label: "Git log", icon: <ThemeIcon name="history" size={16} /> },
    { label: "Refresh", icon: <ThemeIcon name="refresh" size={16} /> }
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
  return <select className="react-git-repo-select wb-git-repo-select" value={value} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)}>
    {repositories.map((repository) => <option value={repository.root} key={repository.root}>{repository.label}</option>)}
  </select>;
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
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const requestRef = useRef(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!repoRoot) {
      setBranches(null);
      setLoading(false);
      return;
    }
    const api = desktopApi();
    if (typeof api.terminalGitBranches !== "function") {
      setBranches(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void api.terminalGitBranches({ cwd: repoRoot }).then((result) => {
      if (requestRef.current === requestId) setBranches(result);
    }).catch(() => {
      if (requestRef.current === requestId) setBranches(null);
    }).finally(() => {
      if (requestRef.current === requestId) setLoading(false);
    });
    return () => { requestRef.current += 1; };
  }, [repoRoot, value]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".react-git-branch-control")) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!repoRoot) return null;
  const localBranches = branches?.mode === "direct" ? branches.localBranches || branches.branches || [] : [];
  const remoteBranches = branches?.mode === "direct" ? branches.remoteBranches || [] : [];
  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPosition({
        top: Math.min(rect.bottom + 4, window.innerHeight - 16),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 268))
      });
    }
    setOpen((current) => !current);
  };
  const selectBranch = (selection: { branch: string; remote?: string }) => {
    setOpen(false);
    onChange(selection);
  };
  const trigger = <button
    ref={buttonRef}
    type="button"
    className="react-git-branch-control react-git-branch-trigger"
    aria-label={`${ariaLabel}: ${value || "-"}`}
    aria-haspopup="menu"
    aria-expanded={open}
    onClick={openMenu}
  >
    <ThemeIcon name="git-branch" size={12} aria-hidden="true" />
    <span>{value || "-"}</span>
    <ThemeIcon name="chevron-down" size={11} aria-hidden="true" />
  </button>;
  const menu = open ? createPortal(<div
    className="react-git-branch-control react-git-branch-popover wb-git-branch-popover"
    style={menuPosition || undefined}
    role="menu"
    aria-label={ariaLabel}
  >
    <div className="wb-git-branch-list">
      {loading && !branches ? <p className="wb-git-branch-empty muted" role="status">{t("desktop.common.loading")}</p> : <>
        <div className="wb-git-branch-repo-group">
          <div className="wb-git-branch-repo-head">{t("desktop.workbench.gitLocalBranches")}</div>
          {localBranches.length ? localBranches.map((branch) => <button
            type="button"
            role="menuitemradio"
            aria-checked={branch === value}
            className={`wb-git-branch-item${branch === value ? " active" : ""}`}
            key={branch}
            onClick={() => selectBranch({ branch })}
          >{branch}</button>) : <p className="wb-git-branch-empty muted">{t("desktop.workbench.gitNoLocalBranches")}</p>}
        </div>
        <div className="wb-git-branch-repo-group">
          <div className="wb-git-branch-repo-head">{t("desktop.workbench.gitRemoteBranches")}</div>
          {remoteBranches.length ? remoteBranches.map((branch) => <button
            type="button"
            role="menuitem"
            className="wb-git-branch-item"
            title={branch.fullName}
            key={branch.fullName}
            onClick={() => selectBranch({ branch: branch.name, remote: branch.remote })}
          >{branch.fullName}</button>) : <p className="wb-git-branch-empty muted">{t("desktop.workbench.gitNoRemoteBranches")}</p>}
        </div>
      </>}
    </div>
  </div>, document.body) : null;
  return <>{trigger}{menu}</>;
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
    <button type="button" className="wb-diff-back" aria-label={ariaLabel} onClick={onBack}><ThemeIcon name="chevron-left" size={15} /></button>
    <span className="react-branch-graph-title">{title}</span>
  </div>, host) : null;
}
