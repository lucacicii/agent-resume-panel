import { createPortal } from "react-dom";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type ReactPortal } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { EditorState } from "@codemirror/state";
import { MergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import type {
  AgentProvider,
  AgentSession,
  GtdStatus,
  PanelSettings,
  WorkbenchProjectContextMenuAction
} from "@agent-resume/core";
import { DEFAULT_WORKBENCH_PROJECT_CONTEXT_MENU } from "../settings/model";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Circle, FileCode2, Folder,
  FolderOpen, FolderTree, GitBranch, History, LoaderCircle, PanelRight, Pin,
  Plus, RefreshCw, Save, Search, TerminalSquare, X
} from "lucide-react";
import { desktopApi } from "../../bridge";
import { CodeEditor } from "../../components/CodeEditor";
import { notifyDesktop } from "../../components/Notifications";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Status, type StatusKind } from "../../components/Status";
import { useI18n } from "../../i18n";

type DesktopApi = ReturnType<typeof desktopApi>;
type DirectoryEntry = Awaited<ReturnType<DesktopApi["workbenchListDirectory"]>>["entries"][number];
type FileInspection = Awaited<ReturnType<DesktopApi["workbenchInspectFile"]>>;
type GitStatusResult = Awaited<ReturnType<DesktopApi["terminalGitStatus"]>>;
type GitRepoTracking = NonNullable<GitStatusResult["tracking"]>[number];
type TerminalGitInfo = Awaited<ReturnType<DesktopApi["terminalGitInfo"]>>;
type TerminalGitBranches = Awaited<ReturnType<DesktopApi["terminalGitBranches"]>>;
type GitChange = GitStatusResult["staged"][number];
type GitLog = Awaited<ReturnType<DesktopApi["terminalGitLog"]>>;
type GitShow = Awaited<ReturnType<DesktopApi["terminalGitShow"]>>;
type GitGraphLayout = GitLog["layout"];
type GitGraphRow = GitGraphLayout["rows"][number];
type CommitSuggestion = Awaited<ReturnType<DesktopApi["terminalGitSuggestCommit"]>>;

/** Local porcelain status poll while Workbench is active. */
const GIT_STATUS_POLL_MS = 4000;
/** Remote fetch cadence while Workbench is active (VS Code-like). */
const GIT_AUTO_FETCH_MS = 180_000;
/** Cap nested monorepo fetch fan-out per sweep. */
const GIT_AUTO_FETCH_MAX_ROOTS = 8;
type GitTreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children: GitTreeNode[];
  change?: GitChange;
};
type EditorPane = Extract<FileInspection, { kind: "text" }> & {
  key: string;
  path: string;
  projectPath: string;
  content: string;
  dirty: boolean;
  saving?: boolean;
};
type DiffPane = {
  key: string;
  projectPath: string;
  repoRoot: string;
  path: string;
  oldLabel: string;
  newLabel: string;
  oldText: string;
  newText: string;
};
type TerminalPane = {
  key: string;
  title: string;
  sessionKey?: string;
  projectPath: string;
  cwd: string;
  command?: string;
  ptyId?: number;
  branch?: string | null;
  repoRoot?: string | null;
  gitMode?: TerminalGitInfo["mode"];
  nestedRepos?: TerminalGitInfo["nestedRepos"];
};
type SideView = "files" | "git" | null;
type ProjectFilter = "all" | "pinned" | "active";
type SessionFilter = "all" | "active";
type WorkbenchSidebarView = "projects" | "gtd";
const GTD_STATUSES = ["inbox", "next", "waiting", "someday", "reference", "done"] as const satisfies readonly GtdStatus[];
const GTD_ACTIVE_STATUSES = ["inbox", "next", "waiting", "someday", "reference"] as const satisfies readonly GtdStatus[];
type CatalogProject = {
  projectId: string;
  portableKey: string;
  alias: string;
  hidden: boolean;
  pinned?: boolean;
  lastSeenAtMs: number | null;
  updatedAtMs: number;
  localPath: string | null;
  pathMissing: boolean;
  sessionCount: number;
};
type WorkbenchProject = {
  id: string;
  path: string;
  portableKey: string;
  pathMissing: boolean;
  sessions: AgentSession[];
  label: string;
  active: boolean;
  pinned: boolean;
  updatedAt: number;
};
type WorkbenchContextMenu = {
  kind: "project" | "session";
  x: number;
  y: number;
  projectPath?: string;
  projectId?: string;
  session?: AgentSession;
  editorLabel?: string;
};
type WorkbenchRenameDialog = {
  kind: "project" | "session";
  projectPath?: string;
  projectId?: string;
  session?: AgentSession;
  title: string;
  autoBusy: boolean;
  status: string;
};
type ProjectPickDialog =
  | {
      kind: "merge";
      sourceId: string;
      sourceLabel: string;
      options: Array<{ id: string; label: string; path: string }>;
      query: string;
      busy: boolean;
      status: string;
    }
  | {
      kind: "split";
      sourceId: string;
      sourceLabel: string;
      options: Array<{ absolutePath: string; portableKey: string; sessionCount: number }>;
      query: string;
      busy: boolean;
      status: string;
    };

/**
 * Session indexed under another user's home (cross-machine catalog sync).
 * Do NOT flag mere path-string differences on the same machine.
 */
function enabledProjectMenuActions(settings: PanelSettings | null): Set<WorkbenchProjectContextMenuAction> {
  const configured = settings?.workbench?.projectContextMenu;
  // unset → defaults; explicit empty array → hide all
  if (!Array.isArray(configured)) {
    return new Set(DEFAULT_WORKBENCH_PROJECT_CONTEXT_MENU);
  }
  return new Set(configured);
}

function isOtherMachineSession(session: AgentSession, _localPath?: string | null): boolean {
  const raw = session.projectPath?.trim() || "";
  if (!raw || raw.startsWith("~") || raw.startsWith("$HOME")) return false;
  const normalized = raw.replaceAll("\\", "/");
  // Absolute path under a different /Users/name or /home/name than common same-host patterns
  // is treated as foreign. Tilde / relative paths are local-relative.
  if (!normalized.startsWith("/")) return false;
  const userMatch = normalized.match(/^\/Users\/([^/]+)(?:\/|$)/);
  const homeMatch = normalized.match(/^\/home\/([^/]+)(?:\/|$)/);
  if (!userMatch && !homeMatch) return false;
  // Compare against the first path segment of localPath when available; else treat
  // non-matching only when we can detect "Users/X" vs current selection.
  // Without process.homedir in renderer, use: if localPath is set and its /Users/name differs.
  const local = (_localPath || "").replaceAll("\\", "/");
  if (local) {
    const localUser = local.match(/^\/Users\/([^/]+)/);
    const localHome = local.match(/^\/home\/([^/]+)/);
    if (userMatch && localUser) return userMatch[1] !== localUser[1];
    if (homeMatch && localHome) return homeMatch[1] !== localHome[1];
    // local path exists but not under Users/home — still show badge for foreign Users paths
    if (userMatch || homeMatch) return true;
  }
  // No local path context: only flag obvious multi-user home paths that look absolute-foreign
  // (cannot know current username without IPC; avoid over-flagging).
  return false;
}
type BranchMenuPosition = {
  right: number;
  bottom: number;
};

const PROJECT_KEY = "workbench-selected-project";
const SIDEBAR_VIEW_KEY = "workbench-sidebar-view";
const PINNED_PROJECTS_KEY = "pinned-projects";
const FOLDERS_COLLAPSED_KEY = "wb-folders-collapsed";
const FOLDERS_WIDTH_KEY = "sidebar-folders-width";
const LIST_WIDTH_KEY = "wb-list-pane-width";
const SIDE_WIDTH_KEY = "wb-side-panel-width";
const ALL_PROJECTS_PANE_KEY = "__all_projects__";

function effectiveGtdStatus(
  statuses: Record<string, GtdStatus>,
  session: AgentSession
): GtdStatus {
  return statuses[sessionKey(session)] || "inbox";
}

function paneProjectKey(projectPath: string | null): string {
  return projectPath || ALL_PROJECTS_PANE_KEY;
}

function basename(value = ""): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

function sessionKey(session: AgentSession): string {
  return `${session.provider}:${session.id}`;
}

function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

function storageString(key: string): string {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function storageBoolean(key: string): boolean {
  return storageString(key) === "true";
}

function storedWidth(key: string, fallback: number, min: number, max: number): number {
  const value = Number(storageString(key));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function loadPinnedProjects(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(PINNED_PROJECTS_KEY) || "[]");
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch { return new Set(); }
}

function savePinnedProjects(projects: Set<string>): void {
  try { localStorage.setItem(PINNED_PROJECTS_KEY, JSON.stringify([...projects])); } catch { /* storage is optional */ }
}

function statusError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function gitOperationError(error: unknown): string {
  return statusError(error).replace(/^Error invoking remote method 'terminal:[^']+': Error:\s*/, "");
}

function gitStatusLetter(status: string): string {
  const normalized = status.trim() || "?";
  if (normalized === "?" || normalized === "A") return "A";
  if (normalized === "D") return "D";
  return "M";
}

function gitStatusClass(status: string): string {
  const letter = gitStatusLetter(status);
  return letter === "A" ? "is-add" : letter === "D" ? "is-del" : "is-mod";
}

function buildGitChangeTree(changes: GitChange[]): GitTreeNode[] {
  const roots: GitTreeNode[] = [];
  const directories = new Map<string, GitTreeNode>();

  for (const change of changes) {
    const parts = change.path.split("/").map((part) => part.trim()).filter(Boolean);
    let parentPath = "";
    let siblings = roots;
    for (const [index, name] of parts.entries()) {
      const isFile = index === parts.length - 1;
      const path = parentPath ? `${parentPath}/${name}` : name;
      if (isFile) {
        siblings.push({ name, path: change.path, isDirectory: false, children: [], change });
        continue;
      }
      let directory = directories.get(path);
      if (!directory) {
        directory = { name, path, isDirectory: true, children: [] };
        directories.set(path, directory);
        siblings.push(directory);
      }
      parentPath = path;
      siblings = directory.children;
    }
  }

  const sort = (nodes: GitTreeNode[]) => {
    nodes.sort((left, right) => Number(right.isDirectory) - Number(left.isDirectory) || left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
    nodes.filter((node) => node.isDirectory).forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

function expandedGitDirectories(changes: GitChange[]): Set<string> {
  const expanded = new Set<string>();
  for (const change of changes) {
    const parts = change.path.split("/").map((part) => part.trim()).filter(Boolean);
    let parentPath = "";
    for (const name of parts.slice(0, -1)) {
      parentPath = parentPath ? `${parentPath}/${name}` : name;
      expanded.add(parentPath);
    }
  }
  return expanded;
}

function gitChangeKey(change: Pick<GitChange, "repoRoot" | "repoPath">): string {
  return `${change.repoRoot}\0${change.repoPath}`;
}

function collectNodeChangeKeys(node: GitTreeNode): string[] {
  if (!node.isDirectory) return node.change ? [gitChangeKey(node.change)] : [];
  return node.children.flatMap(collectNodeChangeKeys);
}

function selectionTriState(keys: string[], selected: Set<string>): boolean | "mixed" {
  if (!keys.length) return false;
  let checked = 0;
  for (const key of keys) if (selected.has(key)) checked += 1;
  if (checked === 0) return false;
  if (checked === keys.length) return true;
  return "mixed";
}

function GitTreeCheckbox({
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
    {checked ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : null}
    {mixed ? <span className="wb-git-check-dash" aria-hidden="true" /> : null}
  </button>;
}

function GitChangeTree({
  nodes,
  depth,
  expanded,
  selected,
  onToggleDir,
  onToggleKeys,
  onOpen
}: {
  nodes: GitTreeNode[];
  depth: number;
  expanded: Set<string>;
  selected: Set<string>;
  onToggleDir: (path: string) => void;
  onToggleKeys: (keys: string[], checked: boolean) => void;
  onOpen: (change: GitChange) => void;
}): React.JSX.Element {
  return <>{nodes.map((node) => {
    const isExpanded = node.isDirectory && expanded.has(node.path);
    if (node.isDirectory) {
      const keys = collectNodeChangeKeys(node);
      const state = selectionTriState(keys, selected);
      return <div key={node.path}>
        <div className="wb-file-tree-row wb-git-tree-row" style={{ paddingLeft: `${8 + depth * 14}px` }}>
          <GitTreeCheckbox state={state} ariaLabel={node.path} onChange={(checked) => onToggleKeys(keys, checked)} />
          <button type="button" className="wb-git-tree-row-main" aria-expanded={isExpanded} onClick={() => onToggleDir(node.path)}>
            <span className={`wb-file-tree-chevron${isExpanded ? " is-expanded" : ""}`}><ChevronRight size={12} /></span>
            <Folder size={14} className="wb-file-tree-icon" />
            <span className="wb-file-tree-label" title={node.path}>{node.name}</span>
          </button>
        </div>
        {isExpanded ? <div className="wb-file-tree-children"><GitChangeTree nodes={node.children} depth={depth + 1} expanded={expanded} selected={selected} onToggleDir={onToggleDir} onToggleKeys={onToggleKeys} onOpen={onOpen} /></div> : null}
      </div>;
    }
    if (!node.change) return null;
    const key = gitChangeKey(node.change);
    return <div className="wb-file-tree-row wb-git-tree-file" key={node.path} style={{ paddingLeft: `${8 + depth * 14}px` }}>
      <GitTreeCheckbox state={selected.has(key)} ariaLabel={node.change.path} onChange={(checked) => onToggleKeys([key], checked)} />
      <button type="button" className="wb-git-tree-row-main" title={node.change.path} onClick={() => onOpen(node.change!)}>
        <span className="wb-file-tree-chevron is-placeholder" aria-hidden="true" />
        <span className={`wb-git-file-status ${gitStatusClass(node.change.status)}`}>{gitStatusLetter(node.change.status)}</span>
        <span className="wb-file-tree-label">{node.name}</span>
      </button>
    </div>;
  })}</>;
}

function trackingForRoot(git: GitStatusResult | null, gitRoot: string): GitRepoTracking | null {
  if (!git?.tracking?.length) return null;
  if (gitRoot) {
    return git.tracking.find((item) => item.repoRoot === gitRoot) || null;
  }
  return git.tracking[0] || null;
}

function GitChangesPanel({
  visible,
  git,
  gitRoot,
  expanded,
  selected,
  commitMessage,
  commitBusy,
  commitSuggestion,
  canCommit,
  onToggleDir,
  onToggleKeys,
  onOpenDiff,
  onCommitMessageChange,
  onSuggestCommit,
  onCommit,
  labels
}: {
  visible: boolean;
  git: GitStatusResult | null;
  gitRoot: string;
  expanded: Set<string>;
  selected: Set<string>;
  commitMessage: string;
  commitBusy: boolean;
  commitSuggestion: CommitSuggestion | null;
  canCommit: boolean;
  onToggleDir: (path: string) => void;
  onToggleKeys: (keys: string[], checked: boolean) => void;
  onOpenDiff: (change: GitChange, staged: boolean) => void;
  onCommitMessageChange: (value: string) => void;
  onSuggestCommit: () => void;
  onCommit: (pushAfter: boolean) => void;
  labels: {
    stagedTitle: string;
    changesTitle: string;
    noChanges: string;
    unavailable: string;
    messageLabel: string;
    autoGenerate: string;
    commit: string;
    commitAndPush: string;
    suggestedLlm: string;
    suggestedUnconfigured: string;
    suggestedFallback: string;
  };
}): ReactPortal | null {
  const { t } = useI18n();
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(visible ? document.querySelector<HTMLElement>("#react-workbench .wb-git-panel") : null);
  }, [visible, git, gitRoot]);

  if (!visible || !host) return null;
  if (!git?.isRepo && !git?.nestedRepos?.length) {
    return createPortal(<div className="react-git-panel"><p className="muted wb-git-empty">{labels.unavailable}</p></div>, host);
  }

  const filterEntries = (entries: GitChange[]) => gitRoot ? entries.filter((change) => change.repoRoot === gitRoot) : entries;
  const sections = [
    { title: labels.stagedTitle, staged: true, entries: filterEntries(git.staged) },
    { title: labels.changesTitle, staged: false, entries: filterEntries(git.unstaged) }
  ];
  const hasEntries = sections.some((section) => section.entries.length > 0);
  const tracking = trackingForRoot(git, gitRoot);
  const trackingLabel = tracking?.branch
    ? tracking.upstream
      ? t("desktop.workbench.gitBranchTracking", tracking.branch, tracking.ahead, tracking.behind)
      : t("desktop.workbench.gitNoUpstream", tracking.branch)
    : null;
  const suggestionText = commitSuggestion
    ? commitSuggestion.source === "llm"
      ? labels.suggestedLlm
      : commitSuggestion.fallbackReason === "unconfigured"
        ? labels.suggestedUnconfigured
        : labels.suggestedFallback
    : null;

  return createPortal(<div className="react-git-panel wb-git-panel-layout">
    {trackingLabel ? <p className="muted wb-git-tracking" title={tracking?.upstream || undefined}>{trackingLabel}</p> : null}
    <div className="wb-git-changes-scroll">
      {hasEntries ? sections.map((section) => {
        if (!section.entries.length) return null;
        const keys = section.entries.map(gitChangeKey);
        const state = selectionTriState(keys, selected);
        return <section className="wb-git-section" key={section.title}>
          <div className="wb-git-section-title">
            <GitTreeCheckbox state={state} ariaLabel={section.title} onChange={(checked) => onToggleKeys(keys, checked)} />
            <span className="wb-git-section-title-text">{section.title}</span>
            <span className="wb-git-section-count">{section.entries.length}</span>
          </div>
          <div className="wb-git-tree" role="tree">
            <GitChangeTree
              nodes={buildGitChangeTree(section.entries)}
              depth={0}
              expanded={expanded}
              selected={selected}
              onToggleDir={onToggleDir}
              onToggleKeys={onToggleKeys}
              onOpen={(change) => onOpenDiff(change, section.staged)}
            />
          </div>
        </section>;
      }) : <p className="muted wb-git-empty">{labels.noChanges}</p>}
    </div>
    <div className="wb-git-commit-composer">
      {suggestionText ? <p className={`wb-git-commit-suggestion${commitSuggestion?.source === "llm" ? " is-ai" : ""}`}>{suggestionText}</p> : null}
      <textarea
        className="wb-git-commit-input"
        value={commitMessage}
        disabled={commitBusy || !gitRoot}
        placeholder={labels.messageLabel}
        aria-label={labels.messageLabel}
        onChange={(event) => onCommitMessageChange(event.target.value)}
      />
      <div className="wb-git-commit-actions">
        <button type="button" className="wb-git-commit-btn wb-git-commit-auto-btn" disabled={commitBusy || !gitRoot} onClick={onSuggestCommit}>
          {commitBusy ? <LoaderCircle className="spin" size={14} /> : null}
          {labels.autoGenerate}
        </button>
        <button type="button" className="wb-git-commit-btn" disabled={!canCommit} onClick={() => onCommit(false)}>{labels.commit}</button>
        <button type="button" className="wb-git-commit-btn primary" disabled={!canCommit} onClick={() => onCommit(true)}>{labels.commitAndPush}</button>
      </div>
    </div>
  </div>, host);
}

function MergeDiffView({ oldText, newText }: { oldText: string; newText: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const view = new MergeView({
      a: { doc: oldText, extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false)] },
      b: { doc: newText, extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false)] },
      parent: host.current,
      highlightChanges: true,
      gutter: true,
      revertControls: undefined,
      collapseUnchanged: { margin: 3, minSize: 8 }
    });
    return () => view.destroy();
  }, [newText, oldText]);

  return <div className="react-git-diff-merge" ref={host} />;
}

function GitDiffMergePanel({ diff }: { diff: DiffPane | undefined }): ReactPortal | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(diff ? document.querySelector<HTMLElement>("#react-workbench .wb-git-diff-pane .wb-diff-content") : null);
  }, [diff]);
  return diff && host ? createPortal(<MergeDiffView oldText={diff.oldText} newText={diff.newText} />, host) : null;
}

function graphColumnX(layout: GitGraphLayout, column: number): number {
  return column * layout.laneWidth + layout.laneWidth / 2;
}

function graphCurvePath(fromX: number, toX: number, rowHeight: number, side: "left" | "right"): string {
  const midY = rowHeight / 2;
  const bend = Math.max(10, Math.abs(toX - fromX) * 0.75);
  if (side === "left") return `M ${fromX} ${midY} C ${fromX - bend} ${midY + rowHeight * 0.2}, ${toX + bend * 0.35} ${midY + rowHeight * 0.3}, ${toX} ${rowHeight}`;
  return `M ${toX} ${rowHeight} C ${toX - bend * 0.35} ${midY + rowHeight * 0.3}, ${fromX + bend} ${midY + rowHeight * 0.2}, ${fromX} ${midY}`;
}

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

function GitGraphPortals({ gitLog, gitShow }: { gitLog: GitLog | null; gitShow: GitShow | null }): React.JSX.Element | null {
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  useEffect(() => {
    setHosts(gitLog && !gitShow ? [...document.querySelectorAll<HTMLElement>("#react-workbench .wb-git-log-graph-row")] : []);
  }, [gitLog, gitShow]);
  if (!gitLog || gitShow) return null;
  return <>{hosts.map((host, index) => {
    const row = gitLog.layout.rows[index];
    return row ? createPortal(<span className="react-git-graph-gutter wb-git-log-graph-gutter" key={gitLog.commits[index]?.hash || index}><GitGraphSvg row={row} layout={gitLog.layout} />{row.laneLabel && row.commitColumn != null ? <span className={`wb-git-graph-lane-label wb-git-graph-lane-label-${row.laneLabelColorIndex ?? row.colorIndex ?? 0}`} style={{ left: `${graphColumnX(gitLog.layout, row.commitColumn) + 16}px` }}>{row.laneLabel}</span> : null}</span>, host) : null;
  })}</>;
}

function GitActionIcons({ visible }: { visible: boolean }): React.JSX.Element | null {
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  useEffect(() => {
    setHosts(visible ? [...document.querySelectorAll<HTMLElement>("#react-workbench .wb-git-actions button")] : []);
  }, [visible]);
  if (!visible) return null;
  const icons = [
    { label: "Push", icon: <ArrowUp size={16} /> },
    { label: "Pull", icon: <ArrowDown size={16} /> },
    { label: "Git log", icon: <History size={16} /> },
    { label: "Refresh", icon: <RefreshCw size={16} /> }
  ];
  return <>{hosts.map((host, index) => icons[index] ? createPortal(<span className="react-git-action-icon" title={icons[index].label} aria-hidden="true">{icons[index].icon}</span>, host) : null)}</>;
}

function GitRepositorySelector({
  visible,
  repositories,
  value,
  ariaLabel,
  onChange
}: {
  visible: boolean;
  repositories: Array<{ root: string; label: string }>;
  value: string;
  ariaLabel: string;
  onChange: (root: string) => void;
}): ReactPortal | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(visible && repositories.length > 1 ? document.querySelector<HTMLElement>("#react-workbench .wb-git-pane-head") : null);
  }, [repositories.length, visible]);
  return host ? createPortal(<select className="react-git-repo-select wb-git-repo-select" value={value} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)}>
    {repositories.map((repository) => <option value={repository.root} key={repository.root}>{repository.label}</option>)}
  </select>, host) : null;
}

function BranchGraphNavigation({
  visible,
  projectLabel,
  ariaLabel,
  onBack
}: {
  visible: boolean;
  projectLabel: string;
  ariaLabel: string;
  onBack: () => void;
}): ReactPortal | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(visible ? document.querySelector<HTMLElement>("#react-workbench .wb-git-pane-head") : null);
  }, [visible]);
  return visible && host ? createPortal(<div className="react-branch-graph-nav">
    <button type="button" className="wb-diff-back" aria-label={ariaLabel} onClick={onBack}><ChevronLeft size={15} /></button>
    <span className="react-branch-graph-title">Branch graph{projectLabel ? ` · ${projectLabel}` : ""}</span>
  </div>, host) : null;
}

function ResizeHandle({ label, onDelta }: { label: string; onDelta: (delta: number) => void }): React.JSX.Element {
  const start = useRef<number | null>(null);
  return <button
    type="button"
    className="pane-resizer"
    aria-label={label}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      start.current = event.clientX;
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.classList.add("is-pane-resizing");
    }}
    onPointerMove={(event) => {
      if (start.current === null) return;
      const delta = event.clientX - start.current;
      start.current = event.clientX;
      onDelta(delta);
    }}
    onPointerUp={(event) => {
      start.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      document.body.classList.remove("is-pane-resizing");
    }}
    onPointerCancel={() => { start.current = null; document.body.classList.remove("is-pane-resizing"); }}
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      onDelta(event.key === "ArrowLeft" ? -8 : 8);
    }}
  />;
}

function TerminalView({ pane, active, onPty, onInput }: {
  pane: TerminalPane;
  active: boolean;
  onPty: (key: string, id: number, terminal: Terminal) => void;
  onInput: (key: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon | null>(null);
  const ptyId = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const hostEl = host.current;
    setReady(false);
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      scrollback: 10_000,
      theme: { background: "#1e1e1e", foreground: "#f2f2f7" }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostEl);
    fit.current = fitAddon;

    // FitAddon only updates xterm cols/rows. PTY must be told separately so
    // fullscreen TUIs and shell line wrapping track window zoom / pane resize.
    const onTermResize = terminal.onResize(({ cols, rows }) => {
      if (ptyId.current === null) return;
      void desktopApi().terminalResize({ id: ptyId.current, cols, rows });
    });

    const fitHost = () => {
      if (hostEl.clientWidth < 2 || hostEl.clientHeight < 2) return;
      try {
        fitAddon.fit();
      } catch {
        /* hidden panes fit after activation */
      }
    };

    fitHost();
    const observer = new ResizeObserver(fitHost);
    observer.observe(hostEl);
    // Window zoom / electron zoom-factor changes do not always re-fire RO alone.
    window.addEventListener("resize", fitHost);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", fitHost);

    const input = terminal.onData((data) => {
      if (ptyId.current !== null) void desktopApi().terminalInput({ id: ptyId.current, data });
      onInput(pane.key);
    });
    let alive = true;
    void desktopApi().terminalSpawn({ cwd: pane.cwd, command: pane.command, cols: terminal.cols, rows: terminal.rows })
      .then(({ id }) => {
        if (!alive) { void desktopApi().terminalDestroy({ id }); return; }
        ptyId.current = id;
        onPty(pane.key, id, terminal);
        setReady(true);
        // Re-fit after attach in case layout settled during spawn.
        fitHost();
        void desktopApi().terminalResize({ id, cols: terminal.cols, rows: terminal.rows });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        terminal.write(`\r\n${statusError(error)}\r\n`);
        setReady(true);
      });
    return () => {
      alive = false;
      observer.disconnect();
      window.removeEventListener("resize", fitHost);
      viewport?.removeEventListener("resize", fitHost);
      onTermResize.dispose();
      input.dispose();
      if (ptyId.current !== null) void desktopApi().terminalDestroy({ id: ptyId.current });
      terminal.dispose();
    };
  }, [onInput, onPty, pane.command, pane.cwd, pane.key]);

  useEffect(() => {
    if (!active) return;
    // Double rAF: wait until the pane is display:flex and has real metrics.
    let outer = 0;
    let inner = 0;
    outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        try { fit.current?.fit(); } catch { /* fit guard */ }
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [active]);

  return <div className={`wb-terminal-pane${active ? " active" : ""}`} hidden={!active}>
    <div className="wb-terminal-host" ref={host} />
    {!ready ? (
      <div className="wb-terminal-loading" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={18} aria-hidden="true" />
        <span>{t("desktop.common.loading")}</span>
      </div>
    ) : null}
  </div>;
}

export function WorkbenchPanel(): ReactPortal | null {
  const host = document.getElementById("react-workbench");
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [catalogProjects, setCatalogProjects] = useState<CatalogProject[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [gtdStatuses, setGtdStatuses] = useState<Record<string, GtdStatus>>({});
  const [selectedProject, setSelectedProject] = useState<string | null>(storageString(PROJECT_KEY) || null);
  const [sidebarView, setSidebarView] = useState<WorkbenchSidebarView>(
    () => storageString(SIDEBAR_VIEW_KEY) === "gtd" ? "gtd" : "projects"
  );
  const [selectedGtdStatus, setSelectedGtdStatus] = useState<GtdStatus>("inbox");
  const [completedGtdExpanded, setCompletedGtdExpanded] = useState(false);
  const [pinnedProjects, setPinnedProjects] = useState<Set<string>>(loadPinnedProjects);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [projectQuery, setProjectQuery] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [activeSessionKey, setActiveSessionKey] = useState("");
  const [foldersCollapsed, setFoldersCollapsed] = useState(() => storageBoolean(FOLDERS_COLLAPSED_KEY));
  const [foldersWidth, setFoldersWidth] = useState(() => storedWidth(FOLDERS_WIDTH_KEY, 220, 140, 400));
  const [listWidth, setListWidth] = useState(() => storedWidth(LIST_WIDTH_KEY, 320, 240, 520));
  const [sideWidth, setSideWidth] = useState(() => storedWidth(SIDE_WIDTH_KEY, 320, 240, 600));
  const [terminals, setTerminals] = useState<TerminalPane[]>([]);
  const [terminalCreating, setTerminalCreating] = useState(false);
  const [editors, setEditors] = useState<EditorPane[]>([]);
  const [diffs, setDiffs] = useState<DiffPane[]>([]);
  const [activePanes, setActivePanes] = useState<Record<string, string>>({});
  const [side, setSide] = useState<SideView>(null);
  const [directories, setDirectories] = useState<Record<string, DirectoryEntry[]>>({});
  const [openDirectories, setOpenDirectories] = useState<Set<string>>(new Set());
  const [git, setGit] = useState<GitStatusResult | null>(null);
  const [gitRoot, setGitRoot] = useState("");
  const [gitExpandedDirs, setGitExpandedDirs] = useState<Set<string>>(new Set());
  const [gitLog, setGitLog] = useState<GitLog | null>(null);
  const [gitShow, setGitShow] = useState<GitShow | null>(null);
  const [gitRefreshing, setGitRefreshing] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitSuggestion, setCommitSuggestion] = useState<CommitSuggestion | null>(null);
  const [selectedGitPaths, setSelectedGitPaths] = useState<Set<string>>(() => new Set());
  const gitSelectionKnownRef = useRef<Set<string>>(new Set());
  const [branchPane, setBranchPane] = useState<TerminalPane | null>(null);
  const [branchMenuPosition, setBranchMenuPosition] = useState<BranchMenuPosition | null>(null);
  const [branchResult, setBranchResult] = useState<TerminalGitBranches | null>(null);

  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [contextMenu, setContextMenu] = useState<WorkbenchContextMenu | null>(null);
  const [renameDialog, setRenameDialog] = useState<WorkbenchRenameDialog | null>(null);
  const [projectPickDialog, setProjectPickDialog] = useState<ProjectPickDialog | null>(null);
  const terminalRefs = useRef(new Map<number, Terminal>());
  const gitRefreshTimers = useRef(new Map<string, number>());
  const gitStatusInFlightRef = useRef(false);
  const gitFetchInFlightRef = useRef(false);
  const gitLastFetchAtRef = useRef(0);
  const gitRootsRef = useRef<string[]>([]);
  const terminalsRef = useRef<TerminalPane[]>([]);
  const openingSessionKeysRef = useRef(new Set<string>());
  const settingsRef = useRef<PanelSettings | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const sessionSearchInputRef = useRef<HTMLInputElement>(null);
  const sessionSearchButtonRef = useRef<HTMLButtonElement>(null);
  const sessionSearchToolbarRef = useRef<HTMLDivElement>(null);

  const notifyGitSuccess = useCallback((key: string, ...args: Array<string | number>) => {
    notifyDesktop({ text: t(key, ...args), kind: "ok" });
  }, [t]);

  const notifyGitFailure = useCallback((key: string, error: unknown) => {
    const message = t(key, gitOperationError(error));
    setStatus({ text: message, kind: "error" });
    notifyDesktop({ text: message, kind: "error" });
  }, [t]);

  useEffect(() => { terminalsRef.current = terminals; }, [terminals]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const openSessionKeys = useMemo(() => new Set(
    terminals.flatMap((pane) => pane.sessionKey ? [pane.sessionKey] : [])
  ), [terminals]);

  const loadSessions = useCallback(async () => {
    try {
      const listProjects = typeof desktopApi().listProjects === "function"
        ? desktopApi().listProjects()
        : Promise.resolve([] as CatalogProject[]);
      const listGtdStatuses = typeof desktopApi().listSessionGtdStatuses === "function"
        ? desktopApi().listSessionGtdStatuses()
        : Promise.resolve({} as Record<string, GtdStatus>);
      const [next, nextAliases, nextSettings, nextProjects, nextGtdStatuses] = await Promise.all([
        desktopApi().listSessions(2_000),
        desktopApi().listProjectAliases(),
        desktopApi().getSettings(),
        listProjects,
        listGtdStatuses
      ]);
      setSessions(next);
      setAliases(nextAliases);
      setSettings(nextSettings);
      setCatalogProjects(nextProjects || []);
      setGtdStatuses(nextGtdStatuses || {});
      setSelectedProject((current) => {
        const withSessions = (nextProjects || []).filter((item) => (item.sessionCount || 0) > 0);
        if (current) {
          const match = withSessions.find((item) => item.localPath === current || item.projectId === current || item.portableKey === current);
          if (match) return match.localPath || match.portableKey || current;
          if (next.some((item) => item.projectPath === current)) return current;
        }
        const firstProject = withSessions.find((item) => item.localPath || item.portableKey);
        if (firstProject) return firstProject.localPath || firstProject.portableKey;
        return next.find((item) => item.projectPath)?.projectPath || null;
      });
      setStatus({ text: "" });
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  }, []);

  useEffect(() => {
    const onTab = (event: Event) => {
      const show = (event as CustomEvent<string>).detail === "workbench";
      setActive(show);
      if (show) void loadSessions();
    };
    const onSettingsSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ settings?: PanelSettings; section?: string }>).detail;
      if (detail?.section === "workbench" && detail.settings) setSettings(detail.settings);
    };
    window.addEventListener("agent-resume:tab-change", onTab);
    window.addEventListener("agent-resume:settings-saved", onSettingsSaved);
    return () => {
      window.removeEventListener("agent-resume:tab-change", onTab);
      window.removeEventListener("agent-resume:settings-saved", onSettingsSaved);
    };
  }, [loadSessions]);

  useEffect(() => () => {
    gitRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

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
    if (!branchPane) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".wb-git-branch-popover")) {
        setBranchPane(null);
        setBranchResult(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBranchPane(null);
        setBranchResult(null);
      }
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [branchPane]);

  useEffect(() => {
    if (!renameDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !renameDialog.autoBusy) setRenameDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [renameDialog?.kind, renameDialog?.projectPath, renameDialog?.session?.id, renameDialog?.session?.provider]);

  const projects = useMemo((): WorkbenchProject[] => {
    if (catalogProjects.length) {
      return catalogProjects.flatMap((project) => {
        const group = sessions.filter((session) =>
          (session.projectId && session.projectId === project.projectId)
          || (!session.projectId && project.localPath && session.projectPath === project.localPath)
        );
        // Hide catalog rows with no session data (catalog count and joined list both empty).
        if ((project.sessionCount || 0) === 0 && group.length === 0) return [];
        const path = project.localPath || project.portableKey;
        return [{
          id: project.projectId,
          path,
          portableKey: project.portableKey,
          pathMissing: project.pathMissing,
          sessions: group,
          label: project.alias || aliases[path] || aliases[project.projectId] || basename(path),
          active: group.some((session) => openSessionKeys.has(sessionKey(session))),
          pinned: project.pinned === true || pinnedProjects.has(path) || pinnedProjects.has(project.projectId),
          updatedAt: group.length
            ? Math.max(...group.map((item) => item.updatedAt))
            : (project.lastSeenAtMs || project.updatedAtMs || 0)
        }];
      }).filter((project) => {
        const query = projectQuery.trim().toLowerCase();
        return (!query || `${project.label} ${project.path} ${project.portableKey}`.toLowerCase().includes(query))
          && (projectFilter === "all" || (projectFilter === "pinned" ? project.pinned : project.active));
      }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.label.localeCompare(b.label));
    }

    const grouped = new Map<string, AgentSession[]>();
    for (const session of sessions) {
      if (!session.projectPath) continue;
      const group = grouped.get(session.projectPath) || [];
      group.push(session);
      grouped.set(session.projectPath, group);
    }
    return [...grouped.entries()].map(([path, group]) => ({
      id: path,
      path,
      portableKey: path,
      pathMissing: false,
      sessions: group,
      label: aliases[path] || basename(path),
      active: group.some((session) => openSessionKeys.has(sessionKey(session))),
      pinned: pinnedProjects.has(path),
      updatedAt: Math.max(...group.map((item) => item.updatedAt))
    })).filter((project) => {
      const query = projectQuery.trim().toLowerCase();
      return (!query || `${project.label} ${project.path}`.toLowerCase().includes(query))
        && (projectFilter === "all" || (projectFilter === "pinned" ? project.pinned : project.active));
    }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.label.localeCompare(b.label));
  }, [aliases, catalogProjects, openSessionKeys, pinnedProjects, projectFilter, projectQuery, sessions]);

  const selectedProjectMeta = useMemo(
    () => projects.find((project) => project.path === selectedProject || project.id === selectedProject) || null,
    [projects, selectedProject]
  );

  const selectedSessions = useMemo(() => {
    if (sidebarView === "gtd") {
      const query = projectQuery.trim().toLowerCase();
      return sessions.filter((session) => {
        const matchesQuery = !query || `${session.title} ${session.projectPath} ${session.provider}`.toLowerCase().includes(query);
        return matchesQuery && effectiveGtdStatus(gtdStatuses, session) === selectedGtdStatus;
      });
    }
    if (!selectedProject) return sessions;
    if (selectedProjectMeta) {
      return sessions.filter((session) =>
        (session.projectId && session.projectId === selectedProjectMeta.id)
        || session.projectPath === selectedProjectMeta.path
        || session.projectPath === selectedProject
      );
    }
    return sessions.filter((session) => session.projectPath === selectedProject);
  }, [gtdStatuses, projectQuery, selectedGtdStatus, selectedProject, selectedProjectMeta, sessions, sidebarView]);
  const gtdStatusCounts = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    const counts = new Map<GtdStatus, number>(GTD_STATUSES.map((status) => [status, 0] as const));
    for (const session of sessions) {
      const matchesQuery = !query || `${session.title} ${session.projectPath} ${session.provider}`.toLowerCase().includes(query);
      if (matchesQuery) {
        const status = effectiveGtdStatus(gtdStatuses, session);
        counts.set(status, (counts.get(status) || 0) + 1);
      }
    }
    return counts;
  }, [gtdStatuses, projectQuery, sessions]);
  const selectedSessionScope = sidebarView === "gtd"
    ? t(`desktop.workbench.gtdStatus.${selectedGtdStatus}`)
    : selectedProject ? basename(selectedProject) : t("desktop.workbench.allSessions");
  const visibleSessions = useMemo(() => selectedSessions.filter((session) => {
    const matchesQuery = `${session.title} ${session.id} ${session.provider}`.toLowerCase().includes(sessionQuery.trim().toLowerCase());
    return matchesQuery && (sessionFilter === "all" || openSessionKeys.has(sessionKey(session)));
  }).sort((a, b) => b.updatedAt - a.updatedAt), [openSessionKeys, selectedSessions, sessionFilter, sessionQuery]);
  const currentTerminals = terminals.filter((pane) => pane.projectPath === selectedProject);
  const currentEditors = editors.filter((pane) => pane.projectPath === selectedProject);
  const currentDiffs = diffs.filter((pane) => pane.projectPath === selectedProject);
  const activePane = activePanes[paneProjectKey(selectedProject)] || "";
  const currentEditor = currentEditors.find((pane) => pane.key === activePane);
  const currentDiff = currentDiffs.find((pane) => pane.key === activePane);

  const setActivePane = useCallback((paneKey: string, projectPath = selectedProject) => {
    const projectKey = paneProjectKey(projectPath);
    setActivePanes((current) => current[projectKey] === paneKey ? current : { ...current, [projectKey]: paneKey });
  }, [selectedProject]);

  const selectProject = (project: string | null) => {
    setSelectedProject(project);
    try {
      if (project) localStorage.setItem(PROJECT_KEY, project);
      else localStorage.removeItem(PROJECT_KEY);
    } catch { /* persistence is optional */ }
    setActiveSessionKey("");
    setSide(null);
    setGit(null);
    setGitLog(null);
    setGitShow(null);
  };

  const selectSidebarView = (view: WorkbenchSidebarView) => {
    setSidebarView(view);
    try { localStorage.setItem(SIDEBAR_VIEW_KEY, view); } catch { /* persistence is optional */ }
  };

  const togglePinnedProject = async (path: string, projectId?: string) => {
    const currentlyPinned = pinnedProjects.has(path)
      || (projectId ? pinnedProjects.has(projectId) : false)
      || catalogProjects.some((item) => item.projectId === projectId && item.pinned);
    const nextPinned = !currentlyPinned;
    setPinnedProjects((current) => {
      const next = new Set(current);
      if (nextPinned) {
        next.add(path);
        if (projectId) next.add(projectId);
      } else {
        next.delete(path);
        if (projectId) next.delete(projectId);
      }
      savePinnedProjects(next);
      return next;
    });
    if (projectId && typeof desktopApi().setProjectPinned === "function") {
      try {
        await desktopApi().setProjectPinned({ projectId, pinned: nextPinned });
        setCatalogProjects((current) =>
          current.map((item) => item.projectId === projectId ? { ...item, pinned: nextPinned } : item)
        );
      } catch (error) {
        setStatus({ text: statusError(error), kind: "error" });
      }
    }
  };

  const addTerminal = useCallback((title: string, cwd: string, command?: string, projectPath = selectedProject || cwd, openedSessionKey?: string) => {
    const key = `terminal:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const pane = { key, title, cwd, command, projectPath, sessionKey: openedSessionKey };
    terminalsRef.current = [...terminalsRef.current, pane];
    setTerminals((current) => [...current, pane]);
    setActivePane(key, projectPath);
  }, [selectedProject, setActivePane]);

  const refreshTerminalGit = useCallback(async (key: string) => {
    const pane = terminalsRef.current.find((item) => item.key === key);
    if (!pane) return;
    try {
      const workbench = settingsRef.current?.workbench;
      const info = await desktopApi().terminalGitInfo({
        cwd: pane.cwd,
        nestedScan: {
          maxDepth: workbench?.gitNestedScanMaxDepth,
          ignoreDirs: workbench?.gitNestedScanIgnoreDirs
        }
      });
      setTerminals((current) => current.map((item) => item.key === key ? {
        ...item,
        branch: info.branch,
        repoRoot: info.repoRoot,
        gitMode: info.mode,
        nestedRepos: info.nestedRepos
      } : item));
    } catch { /* Git status is supplementary to the terminal */ }
  }, []);

  const onTerminalInput = useCallback((key: string) => {
    const existing = gitRefreshTimers.current.get(key);
    if (existing) window.clearTimeout(existing);
    gitRefreshTimers.current.set(key, window.setTimeout(() => {
      gitRefreshTimers.current.delete(key);
      void refreshTerminalGit(key);
    }, 500));
  }, [refreshTerminalGit]);

  const onPty = useCallback((key: string, id: number, terminal: Terminal) => {
    terminalRefs.current.set(id, terminal);
    setTerminals((current) => current.map((pane) => pane.key === key ? { ...pane, ptyId: id } : pane));
    void refreshTerminalGit(key);
  }, [refreshTerminalGit]);

  const closeTerminal = useCallback((key: string) => {
    const pane = terminals.find((item) => item.key === key);
    if (pane?.ptyId) terminalRefs.current.delete(pane.ptyId);
    terminalsRef.current = terminalsRef.current.filter((item) => item.key !== key);
    setTerminals((current) => current.filter((item) => item.key !== key));
    if (pane) {
      const projectKey = paneProjectKey(pane.projectPath);
      const nextPane = currentTerminals.find((item) => item.key !== key)?.key || currentEditors[0]?.key || currentDiffs[0]?.key || "";
      setActivePanes((current) => current[projectKey] === key ? { ...current, [projectKey]: nextPane } : current);
    }
  }, [currentDiffs, currentEditors, currentTerminals, terminals]);

  const closeActivePane = useCallback(() => {
    if (!activePane) return;
    if (activePane.startsWith("terminal:")) {
      closeTerminal(activePane);
    } else if (activePane.startsWith("editor:")) {
      setEditors((current) => current.filter((item) => item.key !== activePane));
    } else {
      setDiffs((current) => current.filter((item) => item.key !== activePane));
    }
  }, [activePane, closeTerminal]);

  const openBlankTerminal = useCallback(async () => {
    if (terminalCreating) return;
    setTerminalCreating(true);
    try {
      const cwd = selectedProject || await desktopApi().createScratchDir();
      if (!selectedProject) selectProject(cwd);
      addTerminal(t("desktop.workbench.terminalLabel", currentTerminals.length + 1), cwd, undefined, cwd);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    finally { setTerminalCreating(false); }
  }, [addTerminal, currentTerminals.length, selectedProject, t, terminalCreating]);

  const newSession = useCallback(async () => {
    if (terminalCreating) return;
    setTerminalCreating(true);
    try {
      const cwd = selectedProject || await desktopApi().createScratchDir();
      if (!selectedProject) selectProject(cwd);
      const provider = (settings?.workbench?.defaultNewSessionProvider || "codex") as AgentProvider;
      const result = await desktopApi().workbenchNewSession({ cwd, provider });
      if (result.mode === "xterm" && result.command) addTerminal(t("desktop.workbench.newSessionTitle", basename(cwd)), result.cwd, result.command, cwd);
      await loadSessions();
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    finally { setTerminalCreating(false); }
  }, [addTerminal, loadSessions, selectedProject, settings?.workbench?.defaultNewSessionProvider, t, terminalCreating]);

  const newSessionForProject = useCallback(async (cwd: string, projectId?: string) => {
    if (terminalCreating) return;
    setTerminalCreating(true);
    try {
      let resolvedCwd = cwd;
      if (projectId && typeof desktopApi().resolveProjectCwd === "function") {
        const resolved = await desktopApi().resolveProjectCwd({ projectId });
        if (resolved.source === "missing" || !resolved.cwd) {
          setStatus({ text: t("desktop.workbench.pathMissingHint"), kind: "error" });
          return;
        }
        resolvedCwd = resolved.cwd;
      }
      const provider = (settings?.workbench?.defaultNewSessionProvider || "codex") as AgentProvider;
      const result = await desktopApi().workbenchNewSession({ cwd: resolvedCwd, provider });
      selectProject(resolvedCwd);
      if (result.mode === "xterm" && result.command) addTerminal(t("desktop.workbench.newSessionTitle", basename(resolvedCwd)), result.cwd, result.command, resolvedCwd);
      await loadSessions();
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    finally { setTerminalCreating(false); }
  }, [addTerminal, loadSessions, settings?.workbench?.defaultNewSessionProvider, t, terminalCreating]);

  const openSessionSearch = () => {
    setSessionSearchOpen(true);
    window.requestAnimationFrame(() => {
      sessionSearchInputRef.current?.focus();
      if (sessionSearchInputRef.current?.value) sessionSearchInputRef.current.select();
    });
  };

  const closeSessionSearch = () => {
    setSessionSearchOpen(false);
    window.requestAnimationFrame(() => sessionSearchButtonRef.current?.focus());
  };

  useEffect(() => desktopApi().onWorkbenchCmdT(() => {
    if (!active) return;
    if (settings?.workbench?.cmdTAction === "newSession") void newSession();
    else void openBlankTerminal();
  }), [active, newSession, openBlankTerminal, settings?.workbench?.cmdTAction]);

  useEffect(() => {
    if (typeof window.agentResume.setWorkbenchActive !== "function") return;
    window.agentResume.setWorkbenchActive(active && Boolean(activePane));
    return () => window.agentResume.setWorkbenchActive(false);
  }, [active, activePane]);

  useEffect(() => desktopApi().onWorkbenchCmdW(() => {
    if (active) closeActivePane();
  }), [active, closeActivePane]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!active || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "w") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      closeActivePane();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, closeActivePane]);

  const openSession = async (session: AgentSession) => {
    const key = sessionKey(session);
    const existing = terminalsRef.current.find((pane) => pane.sessionKey === key);
    if (existing) {
      selectProject(existing.projectPath);
      setActivePane(existing.key, existing.projectPath);
      setActiveSessionKey(key);
      return;
    }
    if (openingSessionKeysRef.current.has(key)) return;
    openingSessionKeysRef.current.add(key);
    setActiveSessionKey(key);
    try {
      const result = await desktopApi().workbenchOpenSession({ provider: session.provider, id: session.id });
      if (result.external) {
        setStatus({ text: result.command || t("desktop.workbench.externalTerminalHint"), kind: "ok" });
        return;
      }
      const projectPath = session.projectPath || result.cwd;
      selectProject(projectPath);
      addTerminal(session.title || session.id, result.cwd, result.command, projectPath, key);
      setActiveSessionKey(key);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    finally { openingSessionKeysRef.current.delete(key); }
  };

  /** Complete xterm resume from Agent citation/tool (command already resolved by main). */
  const openResumeFromAgent = useCallback((detail: {
    provider: string;
    id: string;
    command: string;
    cwd: string;
    title?: string;
    projectPath?: string;
  }) => {
    const key = `${detail.provider}:${detail.id}`;
    const existing = terminalsRef.current.find((pane) => pane.sessionKey === key);
    if (existing) {
      selectProject(existing.projectPath);
      setActivePane(existing.key, existing.projectPath);
      setActiveSessionKey(key);
      return;
    }
    const projectPath = detail.projectPath || detail.cwd;
    selectProject(projectPath);
    addTerminal(detail.title || detail.id, detail.cwd, detail.command, projectPath, key);
    setActiveSessionKey(key);
  }, [addTerminal, selectProject, setActivePane]);

  useEffect(() => {
    const onWindowResume = (event: Event) => {
      const detail = (event as CustomEvent<{
        provider: string;
        id: string;
        command: string;
        cwd: string;
        title?: string;
        projectPath?: string;
      }>).detail;
      if (!detail?.command || !detail?.cwd) return;
      openResumeFromAgent(detail);
    };
    window.addEventListener("agent-resume:workbench-resume", onWindowResume);
    const stopIpc =
      typeof desktopApi().onWorkbenchResumeFromAgent === "function"
        ? desktopApi().onWorkbenchResumeFromAgent((payload) => {
            window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
            openResumeFromAgent(payload);
          })
        : () => undefined;
    return () => {
      window.removeEventListener("agent-resume:workbench-resume", onWindowResume);
      stopIpc();
    };
  }, [openResumeFromAgent]);

  const projectMenu = (event: React.MouseEvent, project: WorkbenchProject) => {
    event.preventDefault();
    const menu: WorkbenchContextMenu = {
      kind: "project",
      projectPath: project.path,
      projectId: project.id,
      x: event.clientX,
      y: event.clientY
    };
    setContextMenu(menu);
    void desktopApi().workbenchGetProjectEditor().then((info) => {
      if (!info.editor || (!info.available && info.selected === "auto")) return;
      setContextMenu((current) => current === menu ? { ...current, editorLabel: info.editor!.label } : current);
    }).catch(() => undefined);
  };

  const sessionMenu = (event: React.MouseEvent, session: AgentSession) => {
    event.preventDefault();
    setContextMenu({ kind: "session", session, x: event.clientX, y: event.clientY });
  };

  const openMountedNote = async (owner: { scope: "project" | "session"; projectPath: string; provider?: string; sessionId?: string }) => {
    try {
      const result = await desktopApi().notesCreate(owner);
      window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" }));
      window.dispatchEvent(new CustomEvent("agent-resume:open-note", { detail: result.noteId }));
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  };

  const applyRename = async () => {
    if (!renameDialog) return;
    const title = renameDialog.title.trim();
    if (!title) {
      setRenameDialog((current) => current ? { ...current, status: t(current.kind === "project" ? "desktop.workbench.nameEmpty" : "desktop.workbench.titleEmpty") } : current);
      return;
    }
    try {
      if (renameDialog.kind === "project" && renameDialog.projectPath) {
        const base = basename(renameDialog.projectPath);
        await desktopApi().setProjectAlias({ projectPath: renameDialog.projectPath, alias: title === base ? "" : title });
        setAliases(await desktopApi().listProjectAliases());
      }
      if (renameDialog.kind === "session" && renameDialog.session) {
        await desktopApi().renameSession({ provider: renameDialog.session.provider, id: renameDialog.session.id, title });
        await loadSessions();
        window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
      }
      setRenameDialog(null);
    } catch (error) { setRenameDialog((current) => current ? { ...current, status: statusError(error) } : current); }
  };

  const autoRename = async () => {
    if (!renameDialog?.session) return;
    setRenameDialog((current) => current ? { ...current, autoBusy: true, status: t("desktop.workbench.generatingTitle") } : current);
    try {
      const result = await desktopApi().autoRenameSession({ provider: renameDialog.session.provider, id: renameDialog.session.id, persist: false });
      setRenameDialog((current) => current ? { ...current, title: result.title, autoBusy: false, status: t("desktop.workbench.titleSuggested") } : current);
    } catch (error) { setRenameDialog((current) => current ? { ...current, autoBusy: false, status: statusError(error) } : current); }
  };

  const runContextAction = async (action: string) => {
    const menu = contextMenu;
    setContextMenu(null);
    if (!menu) return;
    if (menu.kind === "project" && menu.projectPath) {
      if (action === "pin" || action === "unpin") await togglePinnedProject(menu.projectPath, menu.projectId);
      if (action === "new") await newSessionForProject(menu.projectPath, menu.projectId);
      if (action === "editor") {
        try {
          let projectPath = menu.projectPath;
          if (menu.projectId && typeof desktopApi().resolveProjectCwd === "function") {
            const resolved = await desktopApi().resolveProjectCwd({ projectId: menu.projectId });
            if (resolved.source === "missing" || !resolved.cwd) {
              setStatus({ text: t("desktop.workbench.pathMissingHint"), kind: "error" });
              return;
            }
            projectPath = resolved.cwd;
          }
          await desktopApi().workbenchOpenProjectInEditor({ projectPath });
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      if (action === "note") await openMountedNote({ scope: "project", projectPath: menu.projectPath });
      if (action === "rename") setRenameDialog({
        kind: "project",
        projectPath: menu.projectPath,
        projectId: menu.projectId,
        title: aliases[menu.projectPath] || basename(menu.projectPath),
        autoBusy: false,
        status: ""
      });
      if (action === "setLocalPath" && menu.projectId && typeof desktopApi().pickProjectLocalPath === "function") {
        try {
          const result = await desktopApi().pickProjectLocalPath({
            projectId: menu.projectId,
            title: t("desktop.workbench.setLocalFolderTitle")
          });
          if (!result.ok) return;
          selectProject(result.absolutePath);
          setStatus({ text: t("desktop.workbench.localPathSet", result.absolutePath) });
          await loadSessions();
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      if (action === "copyPath" && typeof desktopApi().copyProjectLocalPath === "function") {
        try {
          const result = await desktopApi().copyProjectLocalPath({
            projectId: menu.projectId,
            projectPath: menu.projectPath
          });
          setStatus({ text: t("desktop.workbench.pathCopied", result.path) });
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      if (action === "reveal" && typeof desktopApi().revealProjectInFinder === "function") {
        try {
          await desktopApi().revealProjectInFinder({
            projectId: menu.projectId,
            projectPath: menu.projectPath
          });
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      if (action === "merge" && menu.projectId && typeof desktopApi().mergeProjects === "function") {
        const options = projects
          .filter((project) => project.id !== menu.projectId)
          .map((project) => ({ id: project.id, label: project.label, path: project.path }));
        if (!options.length) {
          setStatus({ text: t("desktop.workbench.mergeNoTargets"), kind: "error" });
          return;
        }
        setProjectPickDialog({
          kind: "merge",
          sourceId: menu.projectId,
          sourceLabel: aliases[menu.projectPath] || basename(menu.projectPath),
          options,
          query: "",
          busy: false,
          status: ""
        });
      }
      if (action === "split" && menu.projectId && typeof desktopApi().listProjectPathVariants === "function") {
        try {
          const variants = await desktopApi().listProjectPathVariants({ projectId: menu.projectId });
          const options = variants.filter((item) => item.absolutePath);
          if (options.length < 2) {
            setStatus({ text: t("desktop.workbench.splitNeedVariants"), kind: "error" });
            return;
          }
          setProjectPickDialog({
            kind: "split",
            sourceId: menu.projectId,
            sourceLabel: aliases[menu.projectPath] || basename(menu.projectPath),
            options,
            query: "",
            busy: false,
            status: ""
          });
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      if (action === "remove") {
        const label = aliases[menu.projectPath] || basename(menu.projectPath);
        const sessionCount = sessions.filter((session) =>
          (menu.projectId && session.projectId === menu.projectId) || session.projectPath === menu.projectPath
        ).length;
        if (!window.confirm(t("desktop.workbench.removeProjectConfirm", label, sessionCount))) return;
        try {
          if (typeof desktopApi().hideProject === "function") {
            await desktopApi().hideProject({ projectId: menu.projectId, projectPath: menu.projectPath });
          }
          if (selectedProject === menu.projectPath || selectedProject === menu.projectId) {
            selectProject(null);
          }
          setPinnedProjects((current) => {
            const next = new Set(current);
            next.delete(menu.projectPath!);
            if (menu.projectId) next.delete(menu.projectId);
            savePinnedProjects(next);
            return next;
          });
          await loadSessions();
          window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      return;
    }
    const session = menu.session;
    if (!session) return;
    if (action.startsWith("gtd:")) {
      const status = action === "gtd:clear"
        ? null
        : GTD_STATUSES.includes(action.slice(4) as GtdStatus)
          ? action.slice(4) as GtdStatus
          : null;
      if (action !== "gtd:clear" && !status) return;
      try {
        await desktopApi().setSessionGtdStatus({ provider: session.provider, id: session.id, status });
        setGtdStatuses((current) => {
          const next = { ...current };
          const key = sessionKey(session);
          if (status) next[key] = status;
          else delete next[key];
          return next;
        });
        setStatus({ text: "" });
        window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
      } catch (error) {
        const message = t("desktop.workbench.gtdStatusSaveFailed", statusError(error));
        setStatus({ text: message, kind: "error" });
        notifyDesktop({ text: message, kind: "error" });
      }
      return;
    }
    if (action === "note") await openMountedNote({ scope: "session", projectPath: session.projectPath, provider: session.provider, sessionId: session.id });
    if (action === "codex") {
      try { await desktopApi().workbenchOpenCodexApp({ provider: session.provider, id: session.id }); }
      catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    }
    if (action === "preview") window.dispatchEvent(new CustomEvent("agent-resume:sessions-preview", { detail: session }));
    if (action === "rename") setRenameDialog({ kind: "session", session, title: session.title || "", autoBusy: false, status: "" });
    if (action === "remove" && window.confirm(t("desktop.workbench.removeConfirm", session.title || session.id))) {
      try {
        await desktopApi().hideSession({ provider: session.provider, id: session.id });
        await loadSessions();
        window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
      } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    }
  };

  const loadDirectory = useCallback(async (rootPath: string, dirPath: string) => {
    try {
      const result = await desktopApi().workbenchListDirectory({ rootPath, dirPath });
      setDirectories((current) => ({ ...current, [dirPath]: result.entries }));
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  }, []);

  useEffect(() => {
    if (active && side === "files" && selectedProject && !directories[selectedProject]) void loadDirectory(selectedProject, selectedProject);
  }, [active, directories, loadDirectory, selectedProject, side]);

  const toggleDirectory = async (path: string) => {
    if (!selectedProject) return;
    const next = new Set(openDirectories);
    if (next.has(path)) next.delete(path);
    else {
      next.add(path);
      if (!directories[path]) await loadDirectory(selectedProject, path);
    }
    setOpenDirectories(next);
  };

  const editorSettings = settings?.workbench?.editor;
  const saveEditor = async (key: string, force = false) => {
    const editor = editors.find((item) => item.key === key);
    if (!editor || !editor.dirty) return true;
    setEditors((current) => current.map((item) => item.key === key ? { ...item, saving: true } : item));
    try {
      const result = await desktopApi().workbenchSaveFileText({
        rootPath: editor.projectPath,
        filePath: editor.path,
        content: editor.content,
        encoding: editor.encoding,
        expectedVersion: editor.version,
        force
      });
      if (!result.ok) {
        if (window.confirm(t("desktop.workbench.fileConflict"))) return saveEditor(key, true);
        setEditors((current) => current.map((item) => item.key === key ? { ...item, saving: false } : item));
        return false;
      }
      setEditors((current) => current.map((item) => item.key === key ? { ...item, version: result.version, dirty: false, saving: false } : item));
      return true;
    } catch (error) {
      setEditors((current) => current.map((item) => item.key === key ? { ...item, saving: false } : item));
      setStatus({ text: t("desktop.workbench.fileSaveFailed", statusError(error)), kind: "error" });
      return false;
    }
  };

  const saveTimers = useRef(new Map<string, number>());
  useEffect(() => () => saveTimers.current.forEach((timer) => window.clearTimeout(timer)), []);
  const updateEditorContent = (key: string, content: string) => {
    setEditors((current) => current.map((item) => item.key === key ? { ...item, content, dirty: true } : item));
    const existing = saveTimers.current.get(key);
    if (existing) window.clearTimeout(existing);
    const delay = editorSettings?.autoSaveDelayMs ?? 600;
    saveTimers.current.set(key, window.setTimeout(() => {
      saveTimers.current.delete(key);
      void saveEditor(key);
    }, delay));
  };

  const openFile = async (path: string) => {
    if (!selectedProject) return;
    try {
      const inspected = await desktopApi().workbenchInspectFile({ rootPath: selectedProject, filePath: path });
      if (inspected.kind === "external") { await desktopApi().workbenchOpenPath({ rootPath: selectedProject, filePath: path }); return; }
      const key = `editor:${path}`;
      if (!editors.some((item) => item.key === key)) {
        setEditors((current) => [...current, { ...inspected, key, path, projectPath: selectedProject, content: inspected.content, dirty: false }]);
      }
      setActivePane(key);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  };

  const collectGitRoots = useCallback((result: GitStatusResult, preferredRoot = ""): string[] => {
    const roots = new Set<string>();
    if (preferredRoot) roots.add(preferredRoot);
    if (result.root) roots.add(result.root);
    (result.nestedRepos || []).forEach((repo) => roots.add(repo.root));
    [...result.staged, ...result.unstaged].forEach((change) => {
      if (change.repoRoot) roots.add(change.repoRoot);
    });
    (result.tracking || []).forEach((item) => {
      if (item.repoRoot) roots.add(item.repoRoot);
    });
    return [...roots].filter(Boolean);
  }, []);

  const refreshGit = useCallback(async (withNotification = false) => {
    if (!selectedProject) return;
    if (gitStatusInFlightRef.current) {
      if (!withNotification) return;
      // Manual refresh waits for the in-flight call to finish, then runs once more.
      while (gitStatusInFlightRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
    }
    gitStatusInFlightRef.current = true;
    if (withNotification) setGitRefreshing(true);
    try {
      const result = await desktopApi().terminalGitStatus({
        cwd: selectedProject,
        nestedScan: {
          maxDepth: settings?.workbench?.gitNestedScanMaxDepth,
          ignoreDirs: settings?.workbench?.gitNestedScanIgnoreDirs
        }
      });
      setGit(result);
      const roots = collectGitRoots(result);
      gitRootsRef.current = roots;
      setGitRoot((current) => {
        if (current && roots.includes(current)) return current;
        return result.root || result.nestedRepos?.[0]?.root || roots[0] || "";
      });
      setGitExpandedDirs(expandedGitDirectories([...result.staged, ...result.unstaged]));
      const currentKeys = new Set([...result.staged, ...result.unstaged].map(gitChangeKey));
      setSelectedGitPaths((previous) => {
        const known = gitSelectionKnownRef.current;
        const next = new Set<string>();
        for (const key of currentKeys) {
          // Keep prior check state for known paths; brand-new paths default to checked.
          if (previous.has(key) || !known.has(key)) next.add(key);
        }
        // Update inside the updater so it stays atomic with the derived selection.
        gitSelectionKnownRef.current = currentKeys;
        return next;
      });
      if (withNotification) notifyGitSuccess("desktop.workbench.gitStatusRefreshed");
    } catch (error) {
      if (withNotification) notifyGitFailure("desktop.workbench.gitStatusRefreshFailed", error);
      else if (side === "git") setStatus({ text: gitOperationError(error), kind: "error" });
      // Silent background polls: ignore transient failures (no toast / status spam).
    } finally {
      gitStatusInFlightRef.current = false;
      if (withNotification) setGitRefreshing(false);
    }
  }, [collectGitRoots, notifyGitFailure, notifyGitSuccess, selectedProject, settings?.workbench?.gitNestedScanIgnoreDirs, settings?.workbench?.gitNestedScanMaxDepth, side]);

  const autoFetchGit = useCallback(async (force = false) => {
    if (!selectedProject || gitFetchInFlightRef.current) return;
    const now = Date.now();
    if (!force && now - gitLastFetchAtRef.current < GIT_AUTO_FETCH_MS) return;
    gitFetchInFlightRef.current = true;
    try {
      // Always refresh once when forcing so roots match the current project.
      if (force || !gitRootsRef.current.length) {
        await refreshGit(false);
      }
      const roots = gitRootsRef.current.slice(0, GIT_AUTO_FETCH_MAX_ROOTS);
      for (const root of roots) {
        try {
          await desktopApi().terminalGitFetch({ repoRoot: root });
        } catch {
          // Soft-fail per root (offline remotes, auth prompts, etc.).
        }
      }
      gitLastFetchAtRef.current = Date.now();
      await refreshGit(false);
    } finally {
      gitFetchInFlightRef.current = false;
    }
  }, [refreshGit, selectedProject]);

  // Reset cached roots/fetch clock when the selected project changes.
  useEffect(() => {
    gitRootsRef.current = [];
    gitLastFetchAtRef.current = 0;
    setGit(null);
    setGitRoot("");
  }, [selectedProject]);

  // Keep status fresh while Workbench is active (Git side panel need not be open).
  useEffect(() => {
    if (!active || !selectedProject) return;
    void refreshGit(false);
    const poll = window.setInterval(() => {
      void refreshGit(false);
    }, GIT_STATUS_POLL_MS);
    return () => window.clearInterval(poll);
  }, [active, refreshGit, selectedProject]);

  // Periodic remote fetch while Workbench is active.
  useEffect(() => {
    if (!active || !selectedProject) return;
    void autoFetchGit(true);
    const timer = window.setInterval(() => {
      void autoFetchGit(false);
    }, GIT_AUTO_FETCH_MS);
    return () => window.clearInterval(timer);
  }, [active, autoFetchGit, selectedProject]);

  // Focus / visibility: status immediately; fetch only if stale.
  useEffect(() => {
    if (!active || !selectedProject) return;
    const onFocus = () => {
      void refreshGit(false);
      void autoFetchGit(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, autoFetchGit, refreshGit, selectedProject]);

  const openDiff = async (change: GitChange, staged: boolean) => {
    if (!selectedProject) return;
    const key = `diff:${change.repoRoot}:${change.repoPath}:${staged}`;
    if (diffs.some((item) => item.key === key)) { setActivePane(key); return; }
    try {
      const result = await desktopApi().terminalGitDiffSides({ cwd: change.repoRoot, path: change.repoPath, staged });
      setDiffs((current) => [...current, { key, projectPath: selectedProject, repoRoot: change.repoRoot, path: change.path, ...result }]);
      setActivePane(key);
      notifyGitSuccess("desktop.workbench.gitDiffOpened", change.path);
    } catch (error) { notifyGitFailure("desktop.workbench.sidePanelDiffFailed", error); }
  };

  const openGitShowFileDiff = async (hash: string, path: string) => {
    if (!gitRoot) return;
    try {
      const result = await desktopApi().terminalGitShowFileDiffSides({ repoRoot: gitRoot, hash, path });
      if (!selectedProject) return;
      const key = `logdiff:${hash}:${path}`;
      setDiffs((current) => current.some((item) => item.key === key) ? current : [...current, { key, projectPath: selectedProject, repoRoot: gitRoot, path, ...result }]);
      setActivePane(key);
      notifyGitSuccess("desktop.workbench.gitDiffOpened", path);
    } catch (error) { notifyGitFailure("desktop.workbench.sidePanelDiffFailed", error); }
  };

  const toggleGitDirectory = (path: string) => {
    setGitExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const gitRepositories = useMemo(() => {
    const roots = new Set<string>();
    if (git?.root) roots.add(git.root);
    git?.nestedRepos?.forEach((repository) => roots.add(repository.root));
    [...(git?.staged || []), ...(git?.unstaged || [])].forEach((change) => roots.add(change.repoRoot));
    return [...roots].filter(Boolean).sort((left, right) => left.localeCompare(right)).map((root) => ({
      root,
      label: git?.nestedRepos?.find((repository) => repository.root === root)?.displayPath || basename(root)
    }));
  }, [git]);

  const runGit = async (action: "push" | "pull") => {
    if (!gitRoot) return;
    try {
      if (action === "push") await desktopApi().terminalGitPush({ repoRoot: gitRoot });
      else await desktopApi().terminalGitPull({ repoRoot: gitRoot });
      notifyGitSuccess(action === "push" ? "desktop.workbench.gitPushSucceeded" : "desktop.workbench.gitPullSucceeded");
      await refreshGit();
      currentTerminals.forEach((pane) => void refreshTerminalGit(pane.key));
    } catch (error) { notifyGitFailure(action === "push" ? "desktop.workbench.gitPushFailed" : "desktop.workbench.gitPullFailed", error); }
  };

  const toggleGitSelectionKeys = useCallback((keys: string[], checked: boolean) => {
    setSelectedGitPaths((previous) => {
      const next = new Set(previous);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }, []);

  const selectedCommitPaths = useMemo(() => {
    if (!gitRoot || !git) return [] as string[];
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const change of [...git.staged, ...git.unstaged]) {
      if (change.repoRoot !== gitRoot) continue;
      const key = gitChangeKey(change);
      if (!selectedGitPaths.has(key) || seen.has(change.repoPath)) continue;
      seen.add(change.repoPath);
      paths.push(change.repoPath);
    }
    return paths;
  }, [git, gitRoot, selectedGitPaths]);

  const canCommit = Boolean(gitRoot && commitMessage.trim() && selectedCommitPaths.length && !commitBusy);

  const suggestCommit = async () => {
    if (!gitRoot) return;
    try {
      setCommitBusy(true);
      setCommitSuggestion(null);
      const result = await desktopApi().terminalGitSuggestCommit({ repoRoot: gitRoot });
      setCommitMessage(result.message);
      setCommitSuggestion(result);
      notifyGitSuccess("desktop.workbench.gitCommitMessageGenerated");
    } catch (error) { notifyGitFailure("desktop.workbench.gitCommitGenerateFailed", error); }
    finally { setCommitBusy(false); }
  };

  const commit = async (pushAfter = false) => {
    if (!gitRoot || !commitMessage.trim() || !selectedCommitPaths.length) return;
    try {
      setCommitBusy(true);
      await desktopApi().terminalGitCommit({
        repoRoot: gitRoot,
        message: commitMessage.trim(),
        paths: selectedCommitPaths
      });
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitCommitFailed", error);
      setCommitBusy(false);
      return;
    }
    notifyGitSuccess("desktop.workbench.gitCommitSucceeded");
    setCommitMessage("");
    setCommitSuggestion(null);
    if (pushAfter) {
      try {
        await desktopApi().terminalGitPush({ repoRoot: gitRoot });
        notifyGitSuccess("desktop.workbench.gitPushSucceeded");
      } catch (error) { notifyGitFailure("desktop.workbench.gitPushFailed", error); }
    }
    await refreshGit();
    currentTerminals.forEach((pane) => void refreshTerminalGit(pane.key));
    setCommitBusy(false);
  };

  const loadGitLog = async () => {
    if (!gitRoot) return;
    try {
      setGitShow(null);
      setGitLog(await desktopApi().terminalGitLog({ repoRoot: gitRoot, limit: 150 }));
      notifyGitSuccess("desktop.workbench.gitLogLoaded");
    } catch (error) { notifyGitFailure("desktop.workbench.gitLogLoadFailed", error); }
  };

  const showCommit = async (hash: string) => {
    if (!gitRoot) return;
    try {
      setGitShow(await desktopApi().terminalGitShow({ repoRoot: gitRoot, hash }));
      notifyGitSuccess("desktop.workbench.gitShowLoaded");
    } catch (error) { notifyGitFailure("desktop.workbench.gitShowLoadFailed", error); }
  };

  const openBranchMenu = async (pane: TerminalPane, anchor: HTMLButtonElement) => {
    try {
      const rect = anchor.getBoundingClientRect();
      setBranchMenuPosition({
        right: Math.max(8, window.innerWidth - rect.right),
        bottom: Math.max(8, window.innerHeight - rect.top + 6)
      });
      setBranchPane(pane);
      setBranchResult(null);
      const workbench = settingsRef.current?.workbench;
      const result = await desktopApi().terminalGitBranches({
        cwd: pane.cwd,
        nestedScan: {
          maxDepth: workbench?.gitNestedScanMaxDepth,
          ignoreDirs: workbench?.gitNestedScanIgnoreDirs
        }
      });
      setBranchResult(result);
      notifyGitSuccess("desktop.workbench.gitBranchesLoaded");
    } catch (error) { notifyGitFailure("desktop.workbench.loadBranchesFailed", error); }
  };

  const checkoutBranch = async (branch: string, repoRoot?: string | null) => {
    if (!branchPane) return;
    try {
      await desktopApi().terminalGitCheckout({ cwd: branchPane.cwd, branch, repoRoot: repoRoot || branchPane.repoRoot || undefined });
      setBranchPane(null);
      setBranchResult(null);
      await refreshTerminalGit(branchPane.key);
      await refreshGit();
      notifyGitSuccess("desktop.workbench.checkoutBranchSucceeded", branch);
    } catch (error) { notifyGitFailure("desktop.workbench.checkoutBranchFailed", error); }
  };

  const renderBranchMenu = (): React.JSX.Element | React.JSX.Element[] => {
    if (!branchResult) return <p className="wb-git-branch-empty muted">{t("desktop.common.loading")}</p>;
    if (branchResult.mode === "nested") {
      if (!branchResult.repos?.length) return <p className="wb-git-branch-empty muted">{t("desktop.workbench.noGitBranches")}</p>;
      return branchResult.repos.map((repo) => <div className="wb-git-branch-repo-group" key={repo.root}>
        <div className="wb-git-branch-repo-head">{repo.displayPath || repo.root || t("desktop.workbench.nestedRepoUntitled")}</div>
        {repo.branches.length ? repo.branches.map((branch) => <button type="button" className={`wb-git-branch-item${branch === repo.current ? " active" : ""}`} key={branch} onClick={() => void checkoutBranch(branch, repo.root)}>{branch}</button>) : <p className="wb-git-branch-empty muted">{t("desktop.workbench.noGitBranches")}</p>}
      </div>);
    }
    const branches = branchResult.branches || [];
    if (!branches.length) return <p className="wb-git-branch-empty muted">{t("desktop.workbench.noGitBranches")}</p>;
    return branches.map((branch) => <button type="button" className={`wb-git-branch-item${branch === (branchResult.current ?? branchPane?.branch) ? " active" : ""}`} key={branch} onClick={() => void checkoutBranch(branch, branchResult.repoRoot)}>{branch}</button>);
  };

  useEffect(() => {
    const data = desktopApi().onTerminalData(({ id, data: value }) => terminalRefs.current.get(id)?.write(value));
    const exited = desktopApi().onTerminalExit(({ id }) => terminalRefs.current.get(id)?.write(`\r\n${t("desktop.workbench.terminalClosed")}\r\n`));
    const respawned = desktopApi().onTerminalRespawned(({ id }) => terminalRefs.current.get(id)?.write(`\r\n${t("desktop.workbench.shellRestored")}\r\n`));
    return () => { data(); exited(); respawned(); };
  }, [t]);

  const renderTree = (dirPath: string, depth: number): React.JSX.Element[] => (directories[dirPath] || []).flatMap((entry) => {
    const expanded = entry.isDirectory && openDirectories.has(entry.path);
    const toggle = () => entry.isDirectory ? void toggleDirectory(entry.path) : void openFile(entry.path);
    const row = <div
      className="wb-file-tree-row"
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      key={entry.path}
      role="treeitem"
      tabIndex={0}
      aria-expanded={entry.isDirectory ? expanded : undefined}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggle();
      }}
      onContextMenu={(event) => {
        if (entry.isDirectory) return;
        event.preventDefault();
        void desktopApi().workbenchRevealPath({ rootPath: selectedProject || "", targetPath: entry.path });
      }}
    >
      {entry.isDirectory ? <button type="button" className={`wb-file-tree-chevron${expanded ? " is-expanded" : ""}`} aria-label={expanded ? "Collapse folder" : "Expand folder"} onClick={(event) => { event.stopPropagation(); void toggleDirectory(entry.path); }}><ChevronRight size={14} /></button> : <span className="wb-file-tree-chevron is-placeholder" />}
      {entry.isDirectory ? <Folder size={15} className="wb-file-tree-icon" /> : <FileCode2 size={15} className="wb-file-tree-icon" />}
      <span className="wb-file-tree-label" title={entry.path}>{entry.name}</span>
    </div>;
    return expanded ? [row, ...renderTree(entry.path, depth + 1)] : [row];
  });

  const changes = git ? [{ title: t("desktop.workbench.sidePanelStaged"), staged: true, entries: git.staged }, { title: t("desktop.workbench.sidePanelChanges"), staged: false, entries: git.unstaged }] : [];
  const setWidth = (kind: "folders" | "list" | "side", delta: number) => {
    const current = kind === "folders" ? foldersWidth : kind === "list" ? listWidth : sideWidth;
    const limits = kind === "folders" ? [140, 400] : kind === "list" ? [240, 520] : [240, 600];
    const next = Math.max(limits[0], Math.min(limits[1], current + delta));
    if (kind === "folders") { setFoldersWidth(next); localStorage.setItem(FOLDERS_WIDTH_KEY, String(next)); }
    else if (kind === "list") { setListWidth(next); localStorage.setItem(LIST_WIDTH_KEY, String(next)); }
    else { setSideWidth(next); localStorage.setItem(SIDE_WIDTH_KEY, String(next)); }
  };

  const contextMenuWidth = contextMenu?.kind === "session" ? 180 : 240;
  const contextMenuLeft = contextMenu
    ? Math.max(8, Math.min(contextMenu.x, window.innerWidth - contextMenuWidth - 8))
    : 8;

  if (!host) return null;
  return createPortal(<section className="panel workbench-panel react-workbench-panel" hidden={!active}>
    <div className="workbench-layout" style={{ "--sidebar-folders-width": `${foldersCollapsed ? 0 : foldersWidth}px`, "--wb-list-width": `${listWidth}px`, "--wb-side-panel-width": `${sideWidth}px` } as React.CSSProperties}>
      <aside className={`sidebar-folders-pane wb-folders-pane${foldersCollapsed ? " is-collapsed" : ""}`}>
        <div className="sidebar-project-filter-wrap">
          <SegmentedControl aria-label={t("desktop.workbench.sidebarView")} value={sidebarView} options={["projects", "gtd"] as const satisfies readonly WorkbenchSidebarView[]} onChange={selectSidebarView} getLabel={(view) => t(view === "projects" ? "desktop.workbench.projectsView" : "desktop.workbench.gtdView")} className="sidebar-project-filter-segmented wb-sidebar-view-segmented" />
          <div className="sidebar-project-search-wrap"><input type="search" className="sidebar-project-search" aria-label={t(sidebarView === "projects" ? "desktop.workbench.filterProjects" : "desktop.workbench.filterGtdSessions")} placeholder={t(sidebarView === "projects" ? "desktop.workbench.filterProjects" : "desktop.workbench.filterGtdSessions")} value={projectQuery} autoComplete="off" spellCheck={false} onChange={(event) => setProjectQuery(event.target.value)} /></div>
          {sidebarView === "projects" ? <SegmentedControl
              aria-label={t("desktop.notes.projectFilter")}
              value={projectFilter}
              options={["all", "pinned", "active"] as const satisfies readonly ProjectFilter[]}
              onChange={setProjectFilter}
              getLabel={(filter) => t(`desktop.common.${filter}`)}
            /> : null}
        </div>
        <div className="wb-folders">
          {sidebarView === "projects" ? <>
            <button type="button" className={`wb-folder-row${!selectedProject ? " active" : ""}`} onClick={() => selectProject(null)}><span className="wb-folder-row-label">{t("desktop.workbench.allSessions")}</span><span className="wb-folder-row-count">{sessions.length}</span></button>
            {projects.length ? <div className="wb-folder-section"><div className="wb-folder-section-label">{t("desktop.notes.projectFilter")}</div>{projects.map((project) => <button type="button" className={`wb-folder-row${selectedProject === project.path || selectedProject === project.id ? " active" : ""}${project.pinned ? " is-pinned" : ""}${project.active ? " has-wb-activity" : ""}${project.pathMissing ? " is-path-missing" : ""}`} key={project.id} title={project.pathMissing ? t("desktop.workbench.pathMissingHint") : project.path} onContextMenu={(event) => projectMenu(event, project)} onClick={() => selectProject(project.path)}>{project.pinned ? <Pin className="project-pin-icon" size={12} aria-hidden="true" /> : null}{project.active ? <span className="wb-folder-activity-dot" aria-hidden="true" /> : null}<span className="wb-folder-row-text"><span className="wb-folder-row-label">{project.label}</span><span className="wb-folder-row-desc">{project.pathMissing ? t("desktop.workbench.pathMissingLabel", project.portableKey) : project.path}</span></span><span className="wb-folder-row-count">{project.sessions.length}</span></button>)}</div> : <p className="muted wb-folders-empty">{t("desktop.workbench.noProjects")}</p>}
          </> : <div className="wb-folder-section wb-gtd-folder-section"><div className="wb-folder-section-label">{t("desktop.workbench.gtdView")}</div>{GTD_ACTIVE_STATUSES.map((gtdStatus) => <button type="button" className={`wb-folder-row wb-gtd-folder-row${selectedGtdStatus === gtdStatus ? " active" : ""}`} key={gtdStatus} onClick={() => setSelectedGtdStatus(gtdStatus)}><span className={`wb-gtd-status-dot is-${gtdStatus}`} aria-hidden="true" /><span className="wb-folder-row-label">{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</span><span className="wb-folder-row-count">{gtdStatusCounts.get(gtdStatus) || 0}</span></button>)}<div className="wb-gtd-completed-group"><button type="button" className="wb-folder-row wb-gtd-folder-row wb-gtd-completed-toggle" aria-expanded={completedGtdExpanded} onClick={() => setCompletedGtdExpanded((value) => !value)}><ChevronRight className={completedGtdExpanded ? "is-expanded" : ""} size={14} aria-hidden="true" /><span className="wb-folder-row-label">{t("desktop.workbench.gtdCompleted")}</span><span className="wb-folder-row-count">{gtdStatusCounts.get("done") || 0}</span></button>{completedGtdExpanded ? <button type="button" className={`wb-folder-row wb-gtd-folder-row wb-gtd-completed-child${selectedGtdStatus === "done" ? " active" : ""}`} onClick={() => setSelectedGtdStatus("done")}><span className="wb-gtd-status-dot is-done" aria-hidden="true" /><span className="wb-folder-row-label">{t("desktop.workbench.gtdStatus.done")}</span><span className="wb-folder-row-count">{gtdStatusCounts.get("done") || 0}</span></button> : null}</div></div>}
        </div>
      </aside>
      <ResizeHandle label={t("desktop.workbench.resizeProjects")} onDelta={(delta) => setWidth("folders", delta)} />
      <aside className="wb-list-pane">
        <div ref={sessionSearchToolbarRef} className={`sidebar-project-filter-wrap wb-session-filter-wrap${sessionSearchOpen ? " is-search-open" : ""}`}>
          <button type="button" className={`sidebar-collapse-toggle${foldersCollapsed ? " is-active" : ""}`} aria-label={t("desktop.workbench.resizeProjects")} onClick={() => setFoldersCollapsed((current) => { const next = !current; localStorage.setItem(FOLDERS_COLLAPSED_KEY, String(next)); return next; })}><PanelRight size={17} /></button>
          <button ref={sessionSearchButtonRef} type="button" className={`wb-icon-btn wb-session-search-btn${sessionQuery && !sessionSearchOpen ? " has-query" : ""}`} aria-label={t("desktop.common.search")} title={t("desktop.common.search")} aria-expanded={sessionSearchOpen} aria-controls="wb-session-search" onClick={openSessionSearch}><Search size={15} /></button>
          <input ref={sessionSearchInputRef} id="wb-session-search" type="search" className="wb-search wb-session-search-input" aria-label={t("desktop.common.search")} placeholder={t("desktop.common.search")} value={sessionQuery} hidden={!sessionSearchOpen} autoComplete="off" spellCheck={false} onChange={(event) => setSessionQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (sessionQuery.trim()) { setSessionQuery(""); return; }
            closeSessionSearch();
          }} onBlur={() => {
            window.setTimeout(() => {
              if (!sessionSearchToolbarRef.current?.contains(document.activeElement)) setSessionSearchOpen(false);
            }, 0);
          }} />
          <SegmentedControl
            aria-label={t("desktop.workbench.sessionFilter")}
            value={sessionFilter}
            options={["all", "active"] as const satisfies readonly SessionFilter[]}
            onChange={setSessionFilter}
            getLabel={(filter) => t(`desktop.common.${filter}`)}
          />
        </div>
        <div className="wb-list-meta-row"><p className="wb-list-meta">{sessionQuery ? t("desktop.workbench.listMetaSearch", selectedSessionScope, sessionQuery, visibleSessions.length) : `${visibleSessions.length} / ${selectedSessions.length}`}</p><button type="button" className="wb-icon-btn" aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")} onClick={() => void loadSessions()}><RefreshCw size={15} /></button></div>
        <div className="wb-list">{visibleSessions.length ? visibleSessions.map((session) => {
          const isOpen = openSessionKeys.has(sessionKey(session));
          const otherMachine = isOtherMachineSession(session, selectedProjectMeta?.path || selectedProject);
          const gtdStatus = effectiveGtdStatus(gtdStatuses, session);
          return <button type="button" className={`wb-list-item${activeSessionKey === sessionKey(session) ? " active" : ""}${isOpen ? " has-wb-activity" : ""}${otherMachine ? " is-other-machine" : ""}`} key={sessionKey(session)} onContextMenu={(event) => sessionMenu(event, session)} onClick={() => void openSession(session)} title={otherMachine ? t("desktop.workbench.otherMachineSessionHint", session.projectPath) : undefined}><span className="wb-list-item-top"><span className="wb-session-title-wrap">{isOpen ? <span className="wb-session-activity-dot" aria-hidden="true" /> : null}<span className="wb-list-item-title">{session.title || session.id}</span>{otherMachine ? <span className="wb-other-machine-badge" aria-label={t("desktop.workbench.otherMachineBadge")}>{t("desktop.workbench.otherMachineBadge")}</span> : null}</span><span className="wb-list-item-date">{relativeTime(session.updatedAt)}</span></span><span className="wb-list-item-preview"><span className="s-provider-tag" data-provider={session.provider}>{session.provider}</span><span className={`wb-gtd-status-badge is-${gtdStatus}`} aria-label={t("desktop.workbench.gtdStatusLabel", t(`desktop.workbench.gtdStatus.${gtdStatus}`))}>{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</span>{" · "}{aliases[session.projectPath] || basename(session.projectPath)}</span></button>;
        }) : <p className="muted wb-list-empty">{sessionFilter === "active" ? t("desktop.workbench.noFilterSessions") : sessionQuery ? t("desktop.workbench.noMatchingSessions") : t("desktop.workbench.noSessionsInProject")}</p>}</div>
      </aside>
      <ResizeHandle label={t("desktop.workbench.resizeSessions")} onDelta={(delta) => setWidth("list", delta)} />
      <main className="wb-detail">
        <div className="wb-detail-head"><span className="wb-detail-project-label"><span className="wb-detail-project-label-text">{selectedProject ? aliases[selectedProject] || basename(selectedProject) : t("desktop.workbench.allSessions")}</span>{selectedProject ? <span className="wb-detail-project-path">{selectedProject}</span> : null}</span><div className="wb-detail-tools"><button type="button" className={`wb-detail-tool${side === "files" ? " active" : ""}`} aria-pressed={side === "files"} aria-label={t("desktop.workbench.sidePanelExplorer")} title={t("desktop.workbench.sidePanelExplorer")} onClick={() => setSide((current) => current === "files" ? null : "files")}><FolderTree size={16} /></button><button type="button" className={`wb-detail-tool${side === "git" ? " active" : ""}`} aria-pressed={side === "git"} aria-label={t("desktop.workbench.sidePanelGit")} title={t("desktop.workbench.sidePanelGit")} onClick={() => setSide((current) => current === "git" ? null : "git")}><GitBranch size={16} /></button></div></div>
        <div className="wb-detail-body">
          <div className="wb-terminal-shell"><div className="wb-terminal-tabs"><div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.workbench.terminalTabs")}>{currentTerminals.map((pane) => <div className={`wb-terminal-tab${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}>{pane.title}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeTerminal")} onClick={() => closeTerminal(pane.key)}><X size={13} /></button></div>)}{currentEditors.map((pane) => <div className={`wb-terminal-tab${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}>{pane.dirty ? "* " : ""}{basename(pane.path)}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeFile")} onClick={() => { if (!pane.dirty || window.confirm(t("desktop.workbench.fileDiscardConfirm", basename(pane.path)))) { setEditors((current) => current.filter((item) => item.key !== pane.key)); setActivePane(currentTerminals[0]?.key || ""); } }}><X size={13} /></button></div>)}{currentDiffs.map((pane) => <div className={`wb-terminal-tab${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}>{basename(pane.path)}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeDiff")} onClick={() => { setDiffs((current) => current.filter((item) => item.key !== pane.key)); setActivePane(currentTerminals[0]?.key || ""); }}><X size={13} /></button></div>)}</div><div className="wb-terminal-tabs-actions"><button type="button" className={`wb-terminal-tab-action${terminalCreating ? " is-busy" : ""}`} disabled={terminalCreating} aria-label={t("desktop.workbench.newTerminal")} title={t("desktop.workbench.newTerminal")} onClick={() => void openBlankTerminal()}>{terminalCreating ? <LoaderCircle className="spin" size={17} /> : <TerminalSquare size={17} />}</button><button type="button" className={`wb-terminal-tab-action${terminalCreating ? " is-busy" : ""}`} disabled={terminalCreating} aria-label={t("desktop.workbench.newSession")} title={t("desktop.workbench.newSession")} onClick={() => void newSession()}>{terminalCreating ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}</button></div></div><div className="wb-terminal-stack">{terminals.map((pane) => {
            const visible = pane.projectPath === selectedProject && activePane === pane.key;
            return <div key={pane.key} className="wb-terminal-pane-wrap" hidden={!visible}><TerminalView pane={pane} active={active && visible} onPty={onPty} onInput={onTerminalInput} />{visible ? <div className="wb-terminal-status"><span className="wb-terminal-status-path">{pane.cwd}</span>{pane.branch || (pane.gitMode === "nested" && pane.nestedRepos?.length) ? <><span className="wb-terminal-status-sep">·</span><button type="button" className="wb-terminal-status-branch" title={pane.gitMode === "nested" ? pane.nestedRepos?.map((repo) => `${repo.displayPath || repo.root}: ${repo.branch || "-"}`).join(", ") : pane.branch || undefined} onClick={(event) => void openBranchMenu(pane, event.currentTarget)}><GitBranch size={12} />{pane.gitMode === "nested" ? t("desktop.workbench.nestedRepoCount", pane.nestedRepos?.length || 0) : pane.branch}</button></> : null}</div> : null}</div>;
          })}{currentEditor ? <div className="wb-editor-pane"><CodeEditor className="wb-editor-host" value={currentEditor.content} onChange={(value) => updateEditorContent(currentEditor.key, value)} onBlur={() => { if (currentEditor.dirty) void saveEditor(currentEditor.key); }} ariaLabel={currentEditor.path} filePath={currentEditor.path} readOnly={editorSettings?.editable === false} fontSize={editorSettings?.fontSize ?? 13} wordWrap={editorSettings?.wordWrap ?? false} tabSize={editorSettings?.tabSize ?? 4} /><div className="wb-editor-status"><span className="wb-editor-status-path">{currentEditor.path}</span><span className="wb-editor-status-state">{currentEditor.saving ? t("desktop.workbench.fileSaving") : currentEditor.dirty ? t("desktop.workbench.fileModified") : t("desktop.workbench.fileSaved")}</span><button type="button" className="wb-git-action-btn" disabled={!currentEditor.dirty || currentEditor.saving || editorSettings?.editable === false} onClick={() => void saveEditor(currentEditor.key)} aria-label={t("desktop.common.save")}><Save size={15} /></button></div></div> : null}{currentDiff ? <div className="wb-git-diff-pane"><div className="wb-diff-head"><strong className="wb-diff-title">{currentDiff.path}</strong></div><div className="wb-diff-labels"><span className="wb-diff-label">{currentDiff.oldLabel}</span><span className="wb-diff-label">{currentDiff.newLabel}</span></div><div className="wb-diff-content"><pre className="wb-git-diff-host">{currentDiff.oldText || ""}</pre><pre className="wb-git-diff-host">{currentDiff.newText || ""}</pre></div></div> : null}{terminalCreating && !currentTerminals.some((pane) => pane.projectPath === selectedProject && !pane.ptyId) ? <div className="wb-terminal-loading wb-terminal-loading-stack" role="status" aria-live="polite"><LoaderCircle className="spin" size={18} aria-hidden="true" /><span>{t("desktop.common.loading")}</span></div> : null}{!terminalCreating && !currentTerminals.length && !currentEditors.length && !currentDiffs.length ? <p className="muted wb-terminal-hint">{selectedProject ? t("desktop.workbench.selectSessionHint") : t("desktop.workbench.selectProjectHint")}</p> : null}</div></div>
          {side ? <><ResizeHandle label={t("desktop.workbench.resizeSidePanel")} onDelta={(delta) => setWidth("side", -delta)} /><aside className="wb-side-panel">{side === "files" ? <div className="wb-side-pane"><div className="wb-side-pane-head"><span className="wb-side-pane-title">{t("desktop.workbench.sidePanelExplorer")}</span></div><div className="wb-file-tree" role="tree">{selectedProject ? <><div className="wb-file-tree-row"><FolderOpen size={15} className="wb-file-tree-icon" /><span className="wb-file-tree-label">{basename(selectedProject)}</span></div>{renderTree(selectedProject, 1)}</> : <p className="muted wb-file-tree-empty">{t("desktop.workbench.sidePanelNoRoot")}</p>}</div></div> : <div className="wb-side-pane"><div className="wb-side-pane-head wb-git-pane-head"><span className="wb-side-pane-title">{gitLog ? t("desktop.workbench.gitLogTitle") : t("desktop.workbench.sidePanelGit")}</span><div className="wb-git-actions">{gitLog ? <button type="button" className="wb-git-action-btn" onClick={() => { setGitLog(null); setGitShow(null); }} aria-label={t("desktop.workbench.gitLogBackToChanges")}><ChevronLeft size={15} /></button> : <><button type="button" className="wb-git-action-btn" disabled={!gitRoot} onClick={() => void runGit("push")} aria-label={t("desktop.workbench.gitPush")}><ChevronRight size={15} /></button><button type="button" className="wb-git-action-btn" disabled={!gitRoot} onClick={() => void runGit("pull")} aria-label={t("desktop.workbench.gitPull")}><ChevronDown size={15} /></button><button type="button" className="wb-git-action-btn" disabled={!gitRoot} onClick={() => void loadGitLog()} aria-label={t("desktop.workbench.gitLog")}><History size={15} /></button><button type="button" className="wb-git-action-btn" disabled={gitRefreshing} onClick={() => void refreshGit(true)} aria-label={t("desktop.common.refresh")}><RefreshCw size={15} className={gitRefreshing ? "spin" : undefined} /></button></>}</div></div>{gitLog ? <div className="wb-log-body">{gitShow ? <><button type="button" className="wb-diff-back" onClick={() => setGitShow(null)} aria-label={t("desktop.workbench.gitLogBackToList")}><ChevronLeft size={15} /></button><h4 className="wb-git-log-detail-subject">{gitShow.subject}</h4><p className="wb-git-log-meta">{gitShow.shortHash} · {gitShow.author}</p><pre className="wb-git-log-detail-body">{gitShow.body}</pre><div className="wb-git-log-files">{gitShow.files.map((file) => <button type="button" className="wb-git-log-file" key={file.path} onClick={() => void openGitShowFileDiff(gitShow.hash, file.path)}><span className="wb-git-file-status">{file.status}</span>{file.path}</button>)}</div></> : <div className="wb-git-log-graph-list">{gitLog.commits.map((commit, index) => <button type="button" className="wb-git-log-graph-row" key={commit.hash} onClick={() => void showCommit(commit.hash)}><span className={`wb-git-graph-node wb-git-graph-lane-${gitLog.layout.rows[index]?.colorIndex ?? 0}`}><Circle size={10} fill="currentColor" /></span><span className="wb-git-log-graph-content"><span className="wb-git-log-subject">{commit.subject || t("desktop.workbench.gitLogUntitled")}</span><span className="wb-git-log-meta">{commit.shortHash} · {commit.author}</span></span></button>)}</div>}</div> : <div className="wb-git-panel">{git?.isRepo || git?.nestedRepos?.length ? <>{gitRoot ? <p className="muted wb-git-repo-root">{gitRoot}</p> : null}{changes.map((section) => section.entries.length ? <section className="wb-git-section" key={section.title}><h4 className="wb-git-section-title">{section.title}</h4>{section.entries.map((change, index) => <button type="button" className="wb-git-file" key={`${change.repoRoot}:${change.repoPath}:${index}`} onClick={() => void openDiff(change, section.staged)}><span className={`wb-git-file-status is-${change.status.toLowerCase().slice(0, 3)}`}>{change.status}</span><span className="wb-git-file-path">{change.path}</span></button>)}</section> : null)}{!changes.some((section) => section.entries.length) ? <p className="muted wb-git-empty">{t("desktop.workbench.sidePanelNoChanges")}</p> : null}</> : <p className="muted wb-git-empty">{selectedProject ? t("desktop.workbench.sidePanelGitUnavailable") : t("desktop.workbench.sidePanelNoRoot")}</p>}</div>}</div>}</aside></> : null}
        </div>
      </main>
    </div>
    {branchPane ? <div className="wb-git-branch-popover" style={branchMenuPosition || undefined}>{branchResult?.mode === "nested" ? <div className="wb-git-branch-list">{renderBranchMenu()}</div> : <><div className="wb-git-branch-repo-head">{branchResult?.repoRoot || branchPane.repoRoot || branchPane.cwd}</div><div className="wb-git-branch-list">{renderBranchMenu()}</div></>}<button type="button" className="wb-git-branch-item" onClick={() => { setBranchPane(null); setBranchResult(null); }}>{t("desktop.common.close")}</button></div> : null}
    {contextMenu ? <div className={`wb-context-menu${contextMenu.kind === "session" ? " wb-session-context-menu" : ""}`} role="menu" style={{ left: contextMenuLeft, top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 320)) }} onContextMenu={(event) => event.preventDefault()}>
      {contextMenu.kind === "project" ? (() => {
        const enabled = enabledProjectMenuActions(settings);
        const isPinned = (contextMenu.projectId && catalogProjects.some((item) => item.projectId === contextMenu.projectId && item.pinned))
          || pinnedProjects.has(contextMenu.projectPath || "")
          || (contextMenu.projectId ? pinnedProjects.has(contextMenu.projectId) : false);
        const groups: ReactNode[][] = [];
        const group1: ReactNode[] = [];
        if (enabled.has("pin")) {
          group1.push(<button type="button" role="menuitem" key="pin" onClick={() => void runContextAction(isPinned ? "unpin" : "pin")}>{t(isPinned ? "desktop.workbench.unpinProject" : "desktop.workbench.pinProject")}</button>);
        }
        if (group1.length) groups.push(group1);
        const group2: ReactNode[] = [];
        if (enabled.has("newSession")) {
          group2.push(<button type="button" role="menuitem" key="new" onClick={() => void runContextAction("new")}>{t("desktop.workbench.newSession")}</button>);
        }
        if (enabled.has("editor") && contextMenu.editorLabel) {
          group2.push(<button type="button" role="menuitem" key="editor" onClick={() => void runContextAction("editor")}>{t("desktop.workbench.openInApp", contextMenu.editorLabel)}</button>);
        }
        if (enabled.has("note")) {
          group2.push(<button type="button" role="menuitem" key="note" onClick={() => void runContextAction("note")}>{t("desktop.workbench.mountNote")}</button>);
        }
        if (group2.length) groups.push(group2);
        const group3: ReactNode[] = [];
        if (enabled.has("rename")) {
          group3.push(<button type="button" role="menuitem" key="rename" onClick={() => void runContextAction("rename")}>{t("desktop.workbench.renameProject")}</button>);
        }
        if (enabled.has("setLocalPath")) {
          group3.push(<button type="button" role="menuitem" key="setLocalPath" onClick={() => void runContextAction("setLocalPath")}>{t("desktop.workbench.setLocalFolder")}</button>);
        }
        if (enabled.has("copyPath")) {
          group3.push(<button type="button" role="menuitem" key="copyPath" onClick={() => void runContextAction("copyPath")}>{t("desktop.workbench.copyLocalPath")}</button>);
        }
        if (enabled.has("reveal")) {
          group3.push(<button type="button" role="menuitem" key="reveal" onClick={() => void runContextAction("reveal")}>{t("desktop.common.revealInFinder")}</button>);
        }
        if (group3.length) groups.push(group3);
        const group4: ReactNode[] = [];
        if (enabled.has("merge")) {
          group4.push(<button type="button" role="menuitem" key="merge" onClick={() => void runContextAction("merge")}>{t("desktop.workbench.mergeIntoProject")}</button>);
        }
        if (enabled.has("split")) {
          group4.push(<button type="button" role="menuitem" key="split" onClick={() => void runContextAction("split")}>{t("desktop.workbench.splitProjectPath")}</button>);
        }
        if (group4.length) groups.push(group4);
        const group5: ReactNode[] = [];
        if (enabled.has("remove")) {
          group5.push(<button type="button" role="menuitem" key="remove" className="context-menu-item-danger" onClick={() => void runContextAction("remove")}>{t("desktop.workbench.removeProjectFromPanel")}</button>);
        }
        if (group5.length) groups.push(group5);
        if (!groups.length) {
          return <p className="muted" style={{ margin: 0, padding: "8px 12px", fontSize: 12 }}>{t("desktop.settings.projectContextMenuEmpty")}</p>;
        }
        return groups.map((group, index) => (
          <Fragment key={index}>
            {index > 0 ? <div className="context-menu-separator" role="separator" /> : null}
            {group}
          </Fragment>
        ));
      })() : <>
        {contextMenu.session?.provider === "codex" ? <button type="button" role="menuitem" onClick={() => void runContextAction("codex")}>{t("desktop.workbench.openInChatGpt")}</button> : null}
        <button type="button" role="menuitem" onClick={() => void runContextAction("preview")}>{t("desktop.workbench.preview")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("note")}>{t("desktop.workbench.mountNote")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("rename")}>{t("desktop.common.rename")}</button>
        <div className="context-menu-separator" role="separator" />
        <span className="wb-context-menu-label">{t("desktop.workbench.setGtdStatus")}</span>
        <div className="wb-gtd-context-tags" role="group" aria-label={t("desktop.workbench.setGtdStatus")}>
          {GTD_STATUSES.map((gtdStatus) => <button type="button" role="menuitemradio" className={`wb-gtd-context-tag is-${gtdStatus}`} aria-checked={contextMenu.session ? effectiveGtdStatus(gtdStatuses, contextMenu.session) === gtdStatus : false} key={gtdStatus} onClick={() => void runContextAction(`gtd:${gtdStatus}`)}>{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</button>)}
        </div>
        {contextMenu.session && gtdStatuses[sessionKey(contextMenu.session)] ? <button type="button" role="menuitem" onClick={() => void runContextAction("gtd:clear")}>{t("desktop.workbench.clearGtdStatus")}</button> : null}
        <div className="context-menu-separator" role="separator" />
        <button type="button" role="menuitem" className="context-menu-item-danger" onClick={() => void runContextAction("remove")}>{t("desktop.workbench.removeFromPanel")}</button>
      </>}
    </div> : null}
    {renameDialog ? <div className="wb-note-created-overlay"><div className="wb-note-created-backdrop" onClick={() => !renameDialog.autoBusy && setRenameDialog(null)} /><form className="wb-note-created-panel" role="dialog" aria-modal="true" aria-label={t(renameDialog.kind === "project" ? "desktop.workbench.renameProject" : "desktop.workbench.renameSession")} onSubmit={(event) => { event.preventDefault(); void applyRename(); }}><div className="wb-rename-head"><p className="wb-note-created-title">{t(renameDialog.kind === "project" ? "desktop.workbench.renameProject" : "desktop.workbench.renameSession")}</p>{renameDialog.kind === "session" ? <button type="button" className="wb-rename-auto-btn" disabled={renameDialog.autoBusy} onClick={() => void autoRename()}>{renameDialog.autoBusy ? <LoaderCircle className="spin" size={14} /> : null}{t(renameDialog.autoBusy ? "desktop.workbench.autoRenaming" : "desktop.workbench.autoRename")}</button> : null}</div>{renameDialog.status ? <p className="wb-rename-status muted">{renameDialog.status}</p> : null}<input ref={renameInputRef} type="text" className="wb-rename-input" value={renameDialog.title} disabled={renameDialog.autoBusy} autoComplete="off" spellCheck={false} aria-label={t(renameDialog.kind === "project" ? "desktop.workbench.renameProjectDisplay" : "desktop.workbench.renameSessionTitle")} onChange={(event) => setRenameDialog((current) => current ? { ...current, title: event.target.value, status: "" } : current)} /><div className="wb-note-created-actions"><button type="button" className="wb-note-created-btn" disabled={renameDialog.autoBusy} onClick={() => setRenameDialog(null)}>{t("desktop.common.cancel")}</button><button type="submit" className="wb-note-created-btn primary" disabled={renameDialog.autoBusy}>{t("desktop.common.confirm")}</button></div></form></div> : null}
    {projectPickDialog ? <div className="wb-note-created-overlay"><div className="wb-note-created-backdrop" onClick={() => !projectPickDialog.busy && setProjectPickDialog(null)} /><div className="wb-note-created-panel wb-project-pick-panel" role="dialog" aria-modal="true" aria-label={t(projectPickDialog.kind === "merge" ? "desktop.workbench.mergeIntoProject" : "desktop.workbench.splitProjectPath")}><p className="wb-note-created-title">{projectPickDialog.kind === "merge" ? t("desktop.workbench.mergeDialogTitle", projectPickDialog.sourceLabel) : t("desktop.workbench.splitDialogTitle", projectPickDialog.sourceLabel)}</p><p className="muted wb-rename-status">{projectPickDialog.kind === "merge" ? t("desktop.workbench.mergeDialogHint") : t("desktop.workbench.splitDialogHint")}</p><input type="search" className="wb-rename-input" value={projectPickDialog.query} placeholder={t("desktop.common.search")} autoComplete="off" spellCheck={false} disabled={projectPickDialog.busy} onChange={(event) => setProjectPickDialog((current) => current ? { ...current, query: event.target.value } : current)} />{projectPickDialog.status ? <p className="wb-rename-status muted">{projectPickDialog.status}</p> : null}<div className="wb-project-pick-list" role="listbox">{(projectPickDialog.kind === "merge"
      ? projectPickDialog.options.filter((item) => `${item.label} ${item.path}`.toLowerCase().includes(projectPickDialog.query.trim().toLowerCase()))
      : projectPickDialog.options.filter((item) => `${item.absolutePath} ${item.portableKey}`.toLowerCase().includes(projectPickDialog.query.trim().toLowerCase()))
    ).map((item) => {
      if (projectPickDialog.kind === "merge" && "id" in item) {
        return <button type="button" className="wb-project-pick-item" key={item.id} disabled={projectPickDialog.busy} onClick={() => {
          void (async () => {
            setProjectPickDialog((current) => current ? { ...current, busy: true, status: t("desktop.workbench.mergeRunning") } : current);
            try {
              const result = await desktopApi().mergeProjects({ sourceProjectId: projectPickDialog.sourceId, targetProjectId: item.id });
              setProjectPickDialog(null);
              setStatus({ text: t("desktop.workbench.mergeDone", result.mergedSessions) });
              await loadSessions();
              window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
            } catch (error) {
              setProjectPickDialog((current) => current ? { ...current, busy: false, status: statusError(error) } : current);
            }
          })();
        }}><span className="wb-project-pick-label">{item.label}</span><span className="wb-project-pick-path">{item.path}</span></button>;
      }
      if (projectPickDialog.kind === "split" && "absolutePath" in item) {
        return <button type="button" className="wb-project-pick-item" key={item.absolutePath} disabled={projectPickDialog.busy} onClick={() => {
          void (async () => {
            setProjectPickDialog((current) => current ? { ...current, busy: true, status: t("desktop.workbench.splitRunning") } : current);
            try {
              const result = await desktopApi().splitProjectPath({ sourceProjectId: projectPickDialog.sourceId, absolutePath: item.absolutePath });
              setProjectPickDialog(null);
              setStatus({ text: t("desktop.workbench.splitDone", result.movedSessions) });
              await loadSessions();
              window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
            } catch (error) {
              setProjectPickDialog((current) => current ? { ...current, busy: false, status: statusError(error) } : current);
            }
          })();
        }}><span className="wb-project-pick-label">{item.portableKey}</span><span className="wb-project-pick-path">{item.absolutePath} · {item.sessionCount}</span></button>;
      }
      return null;
    })}</div><div className="wb-note-created-actions"><button type="button" className="wb-note-created-btn" disabled={projectPickDialog.busy} onClick={() => setProjectPickDialog(null)}>{t("desktop.common.cancel")}</button></div></div></div> : null}
    <GitChangesPanel
      visible={side === "git" && !gitLog}
      git={git}
      gitRoot={gitRoot}
      expanded={gitExpandedDirs}
      selected={selectedGitPaths}
      commitMessage={commitMessage}
      commitBusy={commitBusy}
      commitSuggestion={commitSuggestion}
      canCommit={canCommit}
      onToggleDir={toggleGitDirectory}
      onToggleKeys={toggleGitSelectionKeys}
      onOpenDiff={(change, staged) => void openDiff(change, staged)}
      onCommitMessageChange={setCommitMessage}
      onSuggestCommit={() => void suggestCommit()}
      onCommit={(pushAfter) => void commit(pushAfter)}
      labels={{
        stagedTitle: t("desktop.workbench.sidePanelStaged"),
        changesTitle: t("desktop.workbench.sidePanelChanges"),
        noChanges: t("desktop.workbench.sidePanelNoChanges"),
        unavailable: selectedProject ? t("desktop.workbench.sidePanelGitUnavailable") : t("desktop.workbench.sidePanelNoRoot"),
        messageLabel: t("desktop.workbench.gitCommitDialogTitle"),
        autoGenerate: t("desktop.workbench.gitCommitAutoGenerate"),
        commit: t("desktop.workbench.gitCommit"),
        commitAndPush: t("desktop.workbench.gitCommitAndPush"),
        suggestedLlm: t("desktop.workbench.gitCommitSuggestedLlm"),
        suggestedUnconfigured: t("desktop.workbench.gitCommitSuggestedUnconfigured"),
        suggestedFallback: t("desktop.workbench.gitCommitSuggestedFallback")
      }}
    />
    <GitDiffMergePanel diff={currentDiff} />
    <GitGraphPortals gitLog={gitLog} gitShow={gitShow} />
    <GitActionIcons visible={side === "git" && !gitLog} />
    <GitRepositorySelector visible={side === "git" && !gitLog} repositories={gitRepositories} value={gitRoot} ariaLabel={t("desktop.workbench.gitRepoSelect")} onChange={(root) => { setGitRoot(root); setGitLog(null); setGitShow(null); }} />
    <BranchGraphNavigation visible={side === "git" && Boolean(gitLog)} projectLabel={basename(gitRoot)} ariaLabel={t("desktop.workbench.gitLogBackToChanges")} onBack={() => { setGitLog(null); setGitShow(null); }} />
    <Status kind={status.kind}>{status.text}</Status>
  </section>, host);
}
