import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactPortal } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { EditorState } from "@codemirror/state";
import { MergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import type { AgentProvider, AgentSession, PanelSettings } from "@agent-resume/core";
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Circle, FileCode2, Folder,
  FolderOpen, GitBranch, History, LoaderCircle, PanelRight, Pin,
  Plus, RefreshCw, Save, Search, TerminalSquare, X, GitCommitHorizontal
} from "lucide-react";
import { desktopApi } from "../../bridge";
import { CodeEditor } from "../../components/CodeEditor";
import { Status, type StatusKind } from "../../components/Status";
import { useI18n } from "../../i18n";

type DesktopApi = ReturnType<typeof desktopApi>;
type DirectoryEntry = Awaited<ReturnType<DesktopApi["workbenchListDirectory"]>>["entries"][number];
type FileInspection = Awaited<ReturnType<DesktopApi["workbenchInspectFile"]>>;
type GitStatusResult = Awaited<ReturnType<DesktopApi["terminalGitStatus"]>>;
type GitChange = GitStatusResult["staged"][number];
type GitLog = Awaited<ReturnType<DesktopApi["terminalGitLog"]>>;
type GitShow = Awaited<ReturnType<DesktopApi["terminalGitShow"]>>;
type GitGraphLayout = GitLog["layout"];
type GitGraphRow = GitGraphLayout["rows"][number];
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
  projectPath: string;
  cwd: string;
  command?: string;
  ptyId?: number;
  branch?: string | null;
  repoRoot?: string | null;
};
type SideView = "files" | "git" | null;
type ProjectFilter = "all" | "pinned" | "active";
type SessionFilter = "all" | "active";

const PROJECT_KEY = "workbench-selected-project";
const PINNED_PROJECTS_KEY = "pinned-projects";
const FOLDERS_COLLAPSED_KEY = "wb-folders-collapsed";
const FOLDERS_WIDTH_KEY = "sidebar-folders-width";
const LIST_WIDTH_KEY = "wb-list-pane-width";
const SIDE_WIDTH_KEY = "wb-side-panel-width";

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

function providerLabel(provider: string): string {
  return provider === "agy" ? "antigravity" : provider;
}

function statusError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function activeSession(session: AgentSession): boolean {
  return Date.now() - session.updatedAt < 15 * 60_000;
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

function GitChangeTree({
  nodes,
  depth,
  expanded,
  onToggle,
  onOpen
}: {
  nodes: GitTreeNode[];
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (change: GitChange) => void;
}): React.JSX.Element {
  return <>{nodes.map((node) => {
    const isExpanded = node.isDirectory && expanded.has(node.path);
    if (node.isDirectory) return <div key={node.path}>
      <button type="button" className="wb-file-tree-row wb-git-tree-row" style={{ paddingLeft: `${8 + depth * 14}px` }} aria-expanded={isExpanded} onClick={() => onToggle(node.path)}>
        <span className={`wb-file-tree-chevron${isExpanded ? " is-expanded" : ""}`}><ChevronRight size={12} /></span>
        <Folder size={14} className="wb-file-tree-icon" />
        <span className="wb-file-tree-label" title={node.path}>{node.name}</span>
      </button>
      {isExpanded ? <div className="wb-file-tree-children"><GitChangeTree nodes={node.children} depth={depth + 1} expanded={expanded} onToggle={onToggle} onOpen={onOpen} /></div> : null}
    </div>;
    if (!node.change) return null;
    return <button type="button" className="wb-file-tree-row wb-git-tree-file" key={node.path} style={{ paddingLeft: `${8 + depth * 14}px` }} title={node.change.path} onClick={() => onOpen(node.change!)}>
      <span className="wb-file-tree-chevron is-placeholder" aria-hidden="true" />
      <span className={`wb-git-file-status ${gitStatusClass(node.change.status)}`}>{gitStatusLetter(node.change.status)}</span>
      <span className="wb-file-tree-label">{node.name}</span>
    </button>;
  })}</>;
}

function GitChangesPanel({
  visible,
  git,
  expanded,
  onToggle,
  onOpenDiff,
  stagedTitle,
  changesTitle,
  noChanges,
  unavailable
}: {
  visible: boolean;
  git: GitStatusResult | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenDiff: (change: GitChange, staged: boolean) => void;
  stagedTitle: string;
  changesTitle: string;
  noChanges: string;
  unavailable: string;
}): ReactPortal | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(visible ? document.querySelector<HTMLElement>("#react-workbench .wb-git-panel") : null);
  }, [visible]);

  if (!visible || !host) return null;
  if (!git?.isRepo && !git?.nestedRepos?.length) {
    return createPortal(<div className="react-git-panel"><p className="muted wb-git-empty">{unavailable}</p></div>, host);
  }

  const sections = [
    { title: stagedTitle, staged: true, entries: git.staged },
    { title: changesTitle, staged: false, entries: git.unstaged }
  ];
  return createPortal(<div className="react-git-panel">{sections.map((section) => <section className="wb-git-section" key={section.title}>
    <h4 className="wb-git-section-title">{section.title}</h4>
    {section.entries.length ? <div className="wb-git-tree" role="tree"><GitChangeTree nodes={buildGitChangeTree(section.entries)} depth={0} expanded={expanded} onToggle={onToggle} onOpen={(change) => onOpenDiff(change, section.staged)} /></div> : <p className="muted wb-git-empty">{noChanges}</p>}
  </section>)}</div>, host);
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
    { label: "Commit", icon: <GitCommitHorizontal size={16} /> },
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
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon | null>(null);
  const ptyId = useRef<number | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      scrollback: 10_000,
      theme: { background: "#1e1e1e", foreground: "#f2f2f7" }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host.current);
    fit.current = fitAddon;
    const resize = () => { try { fitAddon.fit(); } catch { /* hidden panes fit after activation */ } };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
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
        void desktopApi().terminalResize({ id, cols: terminal.cols, rows: terminal.rows });
      })
      .catch((error: unknown) => terminal.write(`\r\n${statusError(error)}\r\n`));
    return () => {
      alive = false;
      observer.disconnect();
      input.dispose();
      if (ptyId.current !== null) void desktopApi().terminalDestroy({ id: ptyId.current });
      terminal.dispose();
    };
  }, [onInput, onPty, pane.command, pane.cwd, pane.key]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => { try { fit.current?.fit(); } catch { /* fit guard */ } });
  }, [active]);

  return <div className={`wb-terminal-pane${active ? " active" : ""}`} hidden={!active}>
    <div className="wb-terminal-host" ref={host} />
  </div>;
}

export function WorkbenchPanel(): ReactPortal | null {
  const host = document.getElementById("react-workbench");
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [selectedProject, setSelectedProject] = useState<string | null>(storageString(PROJECT_KEY) || null);
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
  const [editors, setEditors] = useState<EditorPane[]>([]);
  const [diffs, setDiffs] = useState<DiffPane[]>([]);
  const [activePane, setActivePane] = useState("");
  const [side, setSide] = useState<SideView>(null);
  const [directories, setDirectories] = useState<Record<string, DirectoryEntry[]>>({});
  const [openDirectories, setOpenDirectories] = useState<Set<string>>(new Set());
  const [git, setGit] = useState<GitStatusResult | null>(null);
  const [gitRoot, setGitRoot] = useState("");
  const [gitExpandedDirs, setGitExpandedDirs] = useState<Set<string>>(new Set());
  const [gitLog, setGitLog] = useState<GitLog | null>(null);
  const [gitShow, setGitShow] = useState<GitShow | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [branchPane, setBranchPane] = useState<TerminalPane | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const terminalRefs = useRef(new Map<number, Terminal>());
  const gitRefreshTimers = useRef(new Map<string, number>());
  const terminalsRef = useRef<TerminalPane[]>([]);
  const settingsRef = useRef<PanelSettings | null>(null);

  useEffect(() => { terminalsRef.current = terminals; }, [terminals]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const loadSessions = useCallback(async () => {
    try {
      const [next, nextAliases, nextSettings] = await Promise.all([
        desktopApi().listSessions(2_000),
        desktopApi().listProjectAliases(),
        desktopApi().getSettings()
      ]);
      setSessions(next);
      setAliases(nextAliases);
      setSettings(nextSettings);
      setSelectedProject((current) => {
        if (current && next.some((item) => item.projectPath === current)) return current;
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

  const projects = useMemo(() => {
    const grouped = new Map<string, AgentSession[]>();
    for (const session of sessions) {
      if (!session.projectPath) continue;
      const group = grouped.get(session.projectPath) || [];
      group.push(session);
      grouped.set(session.projectPath, group);
    }
    return [...grouped.entries()].map(([path, group]) => ({
      path,
      sessions: group,
      label: aliases[path] || basename(path),
      active: group.some(activeSession),
      pinned: pinnedProjects.has(path),
      updatedAt: Math.max(...group.map((item) => item.updatedAt))
    })).filter((project) => {
      const query = projectQuery.trim().toLowerCase();
      return (!query || `${project.label} ${project.path}`.toLowerCase().includes(query))
        && (projectFilter === "all" || (projectFilter === "pinned" ? project.pinned : project.active));
    }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.label.localeCompare(b.label));
  }, [aliases, pinnedProjects, projectFilter, projectQuery, sessions]);

  const selectedSessions = useMemo(() => sessions.filter((session) => !selectedProject || session.projectPath === selectedProject), [selectedProject, sessions]);
  const visibleSessions = useMemo(() => selectedSessions.filter((session) => {
    const matchesQuery = `${session.title} ${session.id} ${session.provider}`.toLowerCase().includes(sessionQuery.trim().toLowerCase());
    return matchesQuery && (sessionFilter === "all" || activeSession(session));
  }).sort((a, b) => b.updatedAt - a.updatedAt), [selectedSessions, sessionFilter, sessionQuery]);
  const currentTerminals = terminals.filter((pane) => pane.projectPath === selectedProject);
  const currentEditors = editors.filter((pane) => pane.projectPath === selectedProject);
  const currentDiffs = diffs.filter((pane) => pane.projectPath === selectedProject);
  const currentEditor = currentEditors.find((pane) => pane.key === activePane);
  const currentDiff = currentDiffs.find((pane) => pane.key === activePane);

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
    setActivePane("");
  };

  const togglePinnedProject = (path: string) => {
    setPinnedProjects((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      savePinnedProjects(next);
      return next;
    });
  };

  const addTerminal = useCallback((title: string, cwd: string, command?: string, projectPath = selectedProject || cwd) => {
    const key = `terminal:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    setTerminals((current) => [...current, { key, title, cwd, command, projectPath }]);
    setActivePane(key);
  }, [selectedProject]);

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
        branch: info.mode === "nested" ? `${info.nestedRepos.length} repos` : info.branch,
        repoRoot: info.repoRoot
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

  const closeTerminal = (key: string) => {
    const pane = terminals.find((item) => item.key === key);
    if (pane?.ptyId) terminalRefs.current.delete(pane.ptyId);
    setTerminals((current) => current.filter((item) => item.key !== key));
    setActivePane((current) => current === key ? currentTerminals.find((item) => item.key !== key)?.key || currentEditors[0]?.key || "" : current);
  };

  const openBlankTerminal = useCallback(async () => {
    try {
      const cwd = selectedProject || await desktopApi().createScratchDir();
      if (!selectedProject) selectProject(cwd);
      addTerminal(t("desktop.workbench.terminalLabel", currentTerminals.length + 1), cwd, undefined, cwd);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  }, [addTerminal, currentTerminals.length, selectedProject, t]);

  const newSession = useCallback(async () => {
    try {
      const cwd = selectedProject || await desktopApi().createScratchDir();
      if (!selectedProject) selectProject(cwd);
      const provider = (settings?.workbench?.defaultNewSessionProvider || "codex") as AgentProvider;
      const result = await desktopApi().workbenchNewSession({ cwd, provider });
      if (result.mode === "xterm" && result.command) addTerminal(t("desktop.workbench.newSessionTitle", basename(cwd)), result.cwd, result.command, cwd);
      await loadSessions();
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  }, [addTerminal, loadSessions, selectedProject, settings?.workbench?.defaultNewSessionProvider, t]);

  useEffect(() => desktopApi().onWorkbenchCmdT(() => {
    if (!active) return;
    if (settings?.workbench?.cmdTAction === "newSession") void newSession();
    else void openBlankTerminal();
  }), [active, newSession, openBlankTerminal, settings?.workbench?.cmdTAction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!active || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "w") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (!activePane) return;
      event.preventDefault();
      if (activePane.startsWith("terminal:")) closeTerminal(activePane);
      else if (activePane.startsWith("editor:")) setEditors((current) => current.filter((item) => item.key !== activePane));
      else setDiffs((current) => current.filter((item) => item.key !== activePane));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, activePane, currentEditors, currentTerminals, terminals]);

  const openSession = async (session: AgentSession) => {
    setActiveSessionKey(sessionKey(session));
    try {
      const result = await desktopApi().workbenchOpenSession({ provider: session.provider, id: session.id });
      if (result.external) {
        setStatus({ text: result.command || t("desktop.workbench.externalTerminalHint"), kind: "ok" });
        return;
      }
      addTerminal(session.title || session.id, result.cwd, result.command, session.projectPath || result.cwd);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  };

  const renameProject = async (path: string) => {
    const next = window.prompt(t("desktop.workbench.renameProjectDisplay"), aliases[path] || basename(path));
    if (next === null) return;
    try {
      await desktopApi().setProjectAlias({ projectPath: path, alias: next.trim() === basename(path) ? "" : next.trim() });
      setAliases(await desktopApi().listProjectAliases());
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  };

  const projectMenu = (event: React.MouseEvent, path: string) => {
    event.preventDefault();
    const action = window.prompt(`${t("desktop.workbench.pinProject")} / ${t("desktop.workbench.renameProject")} / ${t("desktop.workbench.openInEditor")}`, pinnedProjects.has(path) ? "unpin" : "pin");
    if (action === "pin" || action === "unpin") togglePinnedProject(path);
    if (action === "rename") void renameProject(path);
    if (action === "editor") void desktopApi().workbenchOpenProjectInEditor({ projectPath: path }).catch((error: unknown) => setStatus({ text: statusError(error), kind: "error" }));
    if (action === "new") { selectProject(path); void newSession(); }
  };

  const sessionMenu = (event: React.MouseEvent, session: AgentSession) => {
    event.preventDefault();
    const action = window.prompt("rename / auto / note / open / remove", "rename");
    if (action === "rename") {
      const title = window.prompt(t("desktop.workbench.renameSessionTitle"), session.title);
      if (title?.trim()) void desktopApi().renameSession({ provider: session.provider, id: session.id, title: title.trim() }).then(loadSessions);
      return;
    }
    if (action === "auto") {
      void desktopApi().autoRenameSession({ provider: session.provider, id: session.id, persist: true }).then(loadSessions).catch((error: unknown) => setStatus({ text: statusError(error), kind: "error" }));
      return;
    }
    if (action === "note") {
      void desktopApi().notesCreate({ scope: "session", projectPath: session.projectPath, provider: session.provider, sessionId: session.id })
        .then(() => window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" })))
        .catch((error: unknown) => setStatus({ text: statusError(error), kind: "error" }));
      return;
    }
    if (action === "open" && session.provider === "codex") {
      void desktopApi().workbenchOpenCodexApp({ provider: session.provider, id: session.id }).catch((error: unknown) => setStatus({ text: statusError(error), kind: "error" }));
      return;
    }
    if (action === "remove" && window.confirm(t("desktop.workbench.removeConfirm", session.title || session.id))) {
      void desktopApi().hideSession({ provider: session.provider, id: session.id }).then(loadSessions);
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

  const refreshGit = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const result = await desktopApi().terminalGitStatus({
        cwd: selectedProject,
        nestedScan: {
          maxDepth: settings?.workbench?.gitNestedScanMaxDepth,
          ignoreDirs: settings?.workbench?.gitNestedScanIgnoreDirs
        }
      });
      setGit(result);
      setGitRoot((current) => {
        const roots = new Set<string>([result.root || "", ...(result.nestedRepos || []).map((repo) => repo.root)]);
        [...result.staged, ...result.unstaged].forEach((change) => roots.add(change.repoRoot));
        return current && roots.has(current) ? current : result.root || result.nestedRepos?.[0]?.root || "";
      });
      setGitExpandedDirs(expandedGitDirectories([...result.staged, ...result.unstaged]));
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  }, [selectedProject, settings?.workbench?.gitNestedScanIgnoreDirs, settings?.workbench?.gitNestedScanMaxDepth]);

  useEffect(() => { if (active && side === "git") void refreshGit(); }, [active, refreshGit, side]);

  const openDiff = async (change: GitChange, staged: boolean) => {
    if (!selectedProject) return;
    const key = `diff:${change.repoRoot}:${change.repoPath}:${staged}`;
    if (diffs.some((item) => item.key === key)) { setActivePane(key); return; }
    try {
      const result = await desktopApi().terminalGitDiffSides({ cwd: change.repoRoot, path: change.repoPath, staged });
      setDiffs((current) => [...current, { key, projectPath: selectedProject, repoRoot: change.repoRoot, path: change.path, ...result }]);
      setActivePane(key);
    } catch (error) { setStatus({ text: t("desktop.workbench.sidePanelDiffFailed", statusError(error)), kind: "error" }); }
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
      await refreshGit();
      currentTerminals.forEach((pane) => void refreshTerminalGit(pane.key));
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  };

  const suggestCommit = async () => {
    if (!gitRoot) return;
    try {
      setCommitBusy(true);
      const result = await desktopApi().terminalGitSuggestCommit({ repoRoot: gitRoot });
      setCommitMessage(result.message);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    finally { setCommitBusy(false); }
  };

  const commit = async (pushAfter = false) => {
    if (!gitRoot || !commitMessage.trim()) return;
    try {
      setCommitBusy(true);
      await desktopApi().terminalGitCommit({ repoRoot: gitRoot, message: commitMessage.trim() });
      if (pushAfter) await desktopApi().terminalGitPush({ repoRoot: gitRoot });
      setCommitMessage("");
      setCommitOpen(false);
      await refreshGit();
      currentTerminals.forEach((pane) => void refreshTerminalGit(pane.key));
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    finally { setCommitBusy(false); }
  };

  const loadGitLog = async () => {
    if (!gitRoot) return;
    try {
      setGitShow(null);
      setGitLog(await desktopApi().terminalGitLog({ repoRoot: gitRoot, limit: 150 }));
    } catch (error) { setStatus({ text: t("desktop.workbench.gitLogLoadFailed", statusError(error)), kind: "error" }); }
  };

  const showCommit = async (hash: string) => {
    if (!gitRoot) return;
    try { setGitShow(await desktopApi().terminalGitShow({ repoRoot: gitRoot, hash })); }
    catch (error) { setStatus({ text: t("desktop.workbench.gitShowLoadFailed", statusError(error)), kind: "error" }); }
  };

  const openBranchMenu = async (pane: TerminalPane) => {
    try {
      setBranchPane(pane);
      const result = await desktopApi().terminalGitBranches({ cwd: pane.cwd });
      setBranches(result.branches || result.repos?.flatMap((repo) => repo.branches) || []);
    } catch (error) { setStatus({ text: t("desktop.workbench.loadBranchesFailed", statusError(error)), kind: "error" }); }
  };

  const checkoutBranch = async (branch: string) => {
    if (!branchPane) return;
    try {
      const result = await desktopApi().terminalGitCheckout({ cwd: branchPane.cwd, branch, repoRoot: branchPane.repoRoot || undefined });
      setTerminals((current) => current.map((pane) => pane.key === branchPane.key ? { ...pane, branch: result.branch, repoRoot: result.repoRoot } : pane));
      setBranchPane(null);
      await refreshGit();
    } catch (error) { setStatus({ text: t("desktop.workbench.checkoutBranchFailed", statusError(error)), kind: "error" }); }
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

  if (!host) return null;
  return createPortal(<section className="panel workbench-panel react-workbench-panel" hidden={!active}>
    <div className="workbench-layout" style={{ "--sidebar-folders-width": `${foldersCollapsed ? 0 : foldersWidth}px`, "--wb-list-width": `${listWidth}px`, "--wb-side-panel-width": `${sideWidth}px` } as React.CSSProperties}>
      <aside className={`sidebar-folders-pane wb-folders-pane${foldersCollapsed ? " is-collapsed" : ""}`}>
        <div className="sidebar-project-filter-wrap">
          <label className="sidebar-project-search-wrap"><Search size={15} /><input type="search" className="sidebar-project-search" placeholder={t("desktop.workbench.filterProjects")} value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} /></label>
          <div className="sidebar-project-filter-segmented" role="tablist" aria-label={t("desktop.notes.projectFilter")}>
            {(["all", "pinned", "active"] as ProjectFilter[]).map((filter) => <button type="button" role="tab" key={filter} className={projectFilter === filter ? "active" : ""} aria-selected={projectFilter === filter} onClick={() => setProjectFilter(filter)}>{t(`desktop.common.${filter}`)}</button>)}
          </div>
        </div>
        <div className="wb-folders">
          <button type="button" className={`wb-folder-row${!selectedProject ? " active" : ""}`} onClick={() => selectProject(null)}><span className="wb-folder-row-label">{t("desktop.workbench.allSessions")}</span><span className="wb-folder-row-count">{sessions.length}</span></button>
          {projects.length ? <div className="wb-folder-section"><div className="wb-folder-section-label">{t("desktop.notes.projectFilter")}</div>{projects.map((project) => <button type="button" className={`wb-folder-row${selectedProject === project.path ? " active" : ""}${project.pinned ? " is-pinned" : ""}${project.active ? " has-wb-activity" : ""}`} key={project.path} title={project.path} onContextMenu={(event) => projectMenu(event, project.path)} onClick={() => selectProject(project.path)}>{project.pinned ? <Pin className="project-pin-icon" size={12} aria-hidden="true" /> : null}{project.active ? <span className="wb-folder-activity-dot" aria-hidden="true" /> : null}<span className="wb-folder-row-text"><span className="wb-folder-row-label">{project.label}</span><span className="wb-folder-row-desc">{project.path}</span></span><span className="wb-folder-row-count">{project.sessions.length}</span></button>)}</div> : <p className="muted wb-folders-empty">{t("desktop.workbench.noProjects")}</p>}
        </div>
      </aside>
      <ResizeHandle label={t("desktop.workbench.resizeProjects")} onDelta={(delta) => setWidth("folders", delta)} />
      <aside className="wb-list-pane">
        <div className={`sidebar-project-filter-wrap wb-session-filter-wrap${sessionSearchOpen ? " is-search-open" : ""}`}>
          <button type="button" className={`sidebar-collapse-toggle${foldersCollapsed ? " is-active" : ""}`} aria-label={t("desktop.workbench.resizeProjects")} onClick={() => setFoldersCollapsed((current) => { const next = !current; localStorage.setItem(FOLDERS_COLLAPSED_KEY, String(next)); return next; })}><PanelRight size={16} /></button>
          <button type="button" className={`wb-icon-btn wb-session-search-btn${sessionQuery ? " has-query" : ""}`} aria-label={t("desktop.common.search")} title={t("desktop.common.search")} onClick={() => setSessionSearchOpen((current) => !current)}><Search size={15} /></button>
          <input type="search" className="wb-search wb-session-search-input" placeholder={t("desktop.common.search")} value={sessionQuery} onChange={(event) => setSessionQuery(event.target.value)} />
          <div className="sidebar-project-filter-segmented" role="tablist" aria-label={t("desktop.workbench.sessionFilter")}>
            {(["all", "active"] as SessionFilter[]).map((filter) => <button type="button" role="tab" key={filter} className={sessionFilter === filter ? "active" : ""} aria-selected={sessionFilter === filter} onClick={() => setSessionFilter(filter)}>{t(`desktop.common.${filter}`)}</button>)}
          </div>
        </div>
        <div className="wb-list-meta-row"><p className="wb-list-meta">{sessionQuery ? t("desktop.workbench.listMetaSearch", selectedProject ? basename(selectedProject) : t("desktop.workbench.allSessions"), sessionQuery, visibleSessions.length) : `${visibleSessions.length} / ${selectedSessions.length}`}</p><button type="button" className="wb-icon-btn" aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")} onClick={() => void loadSessions()}><RefreshCw size={15} /></button></div>
        <div className="wb-list">{visibleSessions.length ? visibleSessions.map((session) => <button type="button" className={`wb-list-item${activeSessionKey === sessionKey(session) ? " active" : ""}${activeSession(session) ? " has-wb-activity" : ""}`} key={sessionKey(session)} onContextMenu={(event) => sessionMenu(event, session)} onClick={() => void openSession(session)}><span className="wb-list-item-top"><span className="wb-session-title-wrap">{activeSession(session) ? <span className="wb-session-activity-dot" aria-hidden="true" /> : null}<span className="wb-list-item-title">{session.title || session.id}</span></span><span className="wb-list-item-date">{relativeTime(session.updatedAt)}</span></span><span className="wb-list-item-preview">{providerLabel(session.provider)} · {aliases[session.projectPath] || basename(session.projectPath)}</span></button>) : <p className="muted wb-list-empty">{sessionFilter === "active" ? t("desktop.workbench.noFilterSessions") : sessionQuery ? t("desktop.workbench.noMatchingSessions") : t("desktop.workbench.noSessionsInProject")}</p>}</div>
      </aside>
      <ResizeHandle label={t("desktop.workbench.resizeSessions")} onDelta={(delta) => setWidth("list", delta)} />
      <main className="wb-detail">
        <div className="wb-detail-head"><span className="wb-detail-project-label"><span className="wb-detail-project-label-text">{selectedProject ? aliases[selectedProject] || basename(selectedProject) : t("desktop.workbench.allSessions")}</span>{selectedProject ? <span className="wb-detail-project-path">{selectedProject}</span> : null}</span><div className="wb-detail-tools"><button type="button" className={`wb-detail-tool${side === "files" ? " active" : ""}`} aria-pressed={side === "files"} aria-label={t("desktop.workbench.sidePanelExplorer")} title={t("desktop.workbench.sidePanelExplorer")} onClick={() => setSide((current) => current === "files" ? null : "files")}><FolderOpen size={16} /></button><button type="button" className={`wb-detail-tool${side === "git" ? " active" : ""}`} aria-pressed={side === "git"} aria-label={t("desktop.workbench.sidePanelGit")} title={t("desktop.workbench.sidePanelGit")} onClick={() => setSide((current) => current === "git" ? null : "git")}><GitBranch size={16} /></button></div></div>
        <div className="wb-detail-body">
          <div className="wb-terminal-shell"><div className="wb-terminal-tabs"><div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.workbench.terminalTabs")}>{currentTerminals.map((pane) => <div className={`wb-terminal-tab${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}>{pane.title}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeTerminal")} onClick={() => closeTerminal(pane.key)}><X size={13} /></button></div>)}{currentEditors.map((pane) => <div className={`wb-terminal-tab${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}>{pane.dirty ? "* " : ""}{basename(pane.path)}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeFile")} onClick={() => { if (!pane.dirty || window.confirm(t("desktop.workbench.fileDiscardConfirm", basename(pane.path)))) { setEditors((current) => current.filter((item) => item.key !== pane.key)); setActivePane(currentTerminals[0]?.key || ""); } }}><X size={13} /></button></div>)}{currentDiffs.map((pane) => <div className={`wb-terminal-tab${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}>{basename(pane.path)}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeDiff")} onClick={() => { setDiffs((current) => current.filter((item) => item.key !== pane.key)); setActivePane(currentTerminals[0]?.key || ""); }}><X size={13} /></button></div>)}</div><div className="wb-terminal-tabs-actions"><button type="button" className="wb-terminal-tab-action" aria-label={t("desktop.workbench.newTerminal")} title={t("desktop.workbench.newTerminal")} onClick={() => void openBlankTerminal()}><TerminalSquare size={17} /></button><button type="button" className="wb-terminal-tab-action" aria-label={t("desktop.workbench.newSession")} title={t("desktop.workbench.newSession")} onClick={() => void newSession()}><Plus size={17} /></button></div></div><div className="wb-terminal-stack">{currentTerminals.map((pane) => <div key={pane.key} className="wb-terminal-pane-wrap" hidden={activePane !== pane.key}><TerminalView pane={pane} active={activePane === pane.key} onPty={onPty} onInput={onTerminalInput} />{activePane === pane.key ? <div className="wb-terminal-status"><span className="wb-terminal-status-path">{pane.cwd}</span>{pane.branch ? <><span className="wb-terminal-status-sep">·</span><button type="button" className="wb-terminal-status-branch" onClick={() => void openBranchMenu(pane)}><GitBranch size={12} />{pane.branch}</button></> : null}</div> : null}</div>)}{currentEditor ? <div className="wb-editor-pane"><CodeEditor className="wb-editor-host" value={currentEditor.content} onChange={(value) => updateEditorContent(currentEditor.key, value)} onBlur={() => { if (currentEditor.dirty) void saveEditor(currentEditor.key); }} ariaLabel={currentEditor.path} readOnly={editorSettings?.editable === false} fontSize={editorSettings?.fontSize ?? 13} wordWrap={editorSettings?.wordWrap ?? false} tabSize={editorSettings?.tabSize ?? 4} /><div className="wb-editor-status"><span className="wb-editor-status-path">{currentEditor.path}</span><span className="wb-editor-status-state">{currentEditor.saving ? t("desktop.workbench.fileSaving") : currentEditor.dirty ? t("desktop.workbench.fileModified") : t("desktop.workbench.fileSaved")}</span><button type="button" className="wb-git-action-btn" disabled={!currentEditor.dirty || currentEditor.saving || editorSettings?.editable === false} onClick={() => void saveEditor(currentEditor.key)} aria-label={t("desktop.common.save")}><Save size={15} /></button></div></div> : null}{currentDiff ? <div className="wb-git-diff-pane"><div className="wb-diff-head"><strong className="wb-diff-title">{currentDiff.path}</strong></div><div className="wb-diff-labels"><span className="wb-diff-label">{currentDiff.oldLabel}</span><span className="wb-diff-label">{currentDiff.newLabel}</span></div><div className="wb-diff-content"><pre className="wb-git-diff-host">{currentDiff.oldText || ""}</pre><pre className="wb-git-diff-host">{currentDiff.newText || ""}</pre></div></div> : null}{!currentTerminals.length && !currentEditors.length && !currentDiffs.length ? <p className="muted wb-terminal-hint">{selectedProject ? t("desktop.workbench.selectSessionHint") : t("desktop.workbench.selectProjectHint")}</p> : null}</div></div>
          {side ? <><ResizeHandle label={t("desktop.workbench.resizeSidePanel")} onDelta={(delta) => setWidth("side", -delta)} /><aside className="wb-side-panel">{side === "files" ? <div className="wb-side-pane"><div className="wb-side-pane-head"><span className="wb-side-pane-title">{t("desktop.workbench.sidePanelExplorer")}</span></div><div className="wb-file-tree" role="tree">{selectedProject ? <><div className="wb-file-tree-row"><FolderOpen size={15} className="wb-file-tree-icon" /><span className="wb-file-tree-label">{basename(selectedProject)}</span></div>{renderTree(selectedProject, 1)}</> : <p className="muted wb-file-tree-empty">{t("desktop.workbench.sidePanelNoRoot")}</p>}</div></div> : <div className="wb-side-pane"><div className="wb-side-pane-head wb-git-pane-head"><span className="wb-side-pane-title">{gitLog ? t("desktop.workbench.gitLogTitle") : t("desktop.workbench.sidePanelGit")}</span><div className="wb-git-actions">{gitLog ? <button type="button" className="wb-git-action-btn" onClick={() => { setGitLog(null); setGitShow(null); }} aria-label={t("desktop.workbench.gitLogBackToChanges")}><ChevronLeft size={15} /></button> : <><button type="button" className="wb-git-action-btn" disabled={!gitRoot} onClick={() => setCommitOpen(true)} aria-label={t("desktop.workbench.gitCommit")}><Save size={15} /></button><button type="button" className="wb-git-action-btn" disabled={!gitRoot} onClick={() => void runGit("push")} aria-label={t("desktop.workbench.gitPush")}><ChevronRight size={15} /></button><button type="button" className="wb-git-action-btn" disabled={!gitRoot} onClick={() => void runGit("pull")} aria-label={t("desktop.workbench.gitPull")}><ChevronDown size={15} /></button><button type="button" className="wb-git-action-btn" disabled={!gitRoot} onClick={() => void loadGitLog()} aria-label={t("desktop.workbench.gitLog")}><History size={15} /></button><button type="button" className="wb-git-action-btn" onClick={() => void refreshGit()} aria-label={t("desktop.common.refresh")}><RefreshCw size={15} /></button></>}</div></div>{gitLog ? <div className="wb-log-body">{gitShow ? <><button type="button" className="wb-diff-back" onClick={() => setGitShow(null)} aria-label={t("desktop.workbench.gitLogBackToList")}><ChevronLeft size={15} /></button><h4 className="wb-git-log-detail-subject">{gitShow.subject}</h4><p className="wb-git-log-meta">{gitShow.shortHash} · {gitShow.author}</p><pre className="wb-git-log-detail-body">{gitShow.body}</pre><div className="wb-git-log-files">{gitShow.files.map((file) => <button type="button" className="wb-git-log-file" key={file.path} onClick={() => void desktopApi().terminalGitShowFileDiffSides({ repoRoot: gitRoot, hash: gitShow.hash, path: file.path }).then((result) => { if (!selectedProject) return; const key = `logdiff:${gitShow.hash}:${file.path}`; setDiffs((current) => current.some((item) => item.key === key) ? current : [...current, { key, projectPath: selectedProject, repoRoot: gitRoot, path: file.path, ...result }]); setActivePane(key); })}><span className="wb-git-file-status">{file.status}</span>{file.path}</button>)}</div></> : <div className="wb-git-log-graph-list">{gitLog.commits.map((commit, index) => <button type="button" className="wb-git-log-graph-row" key={commit.hash} onClick={() => void showCommit(commit.hash)}><span className={`wb-git-graph-node wb-git-graph-lane-${gitLog.layout.rows[index]?.colorIndex ?? 0}`}><Circle size={10} fill="currentColor" /></span><span className="wb-git-log-graph-content"><span className="wb-git-log-subject">{commit.subject || t("desktop.workbench.gitLogUntitled")}</span><span className="wb-git-log-meta">{commit.shortHash} · {commit.author}</span></span></button>)}</div>}</div> : <div className="wb-git-panel">{git?.isRepo || git?.nestedRepos?.length ? <>{gitRoot ? <p className="muted wb-git-repo-root">{gitRoot}</p> : null}{changes.map((section) => section.entries.length ? <section className="wb-git-section" key={section.title}><h4 className="wb-git-section-title">{section.title}</h4>{section.entries.map((change, index) => <button type="button" className="wb-git-file" key={`${change.repoRoot}:${change.repoPath}:${index}`} onClick={() => void openDiff(change, section.staged)}><span className={`wb-git-file-status is-${change.status.toLowerCase().slice(0, 3)}`}>{change.status}</span><span className="wb-git-file-path">{change.path}</span></button>)}</section> : null)}{!changes.some((section) => section.entries.length) ? <p className="muted wb-git-empty">{t("desktop.workbench.sidePanelNoChanges")}</p> : null}</> : <p className="muted wb-git-empty">{selectedProject ? t("desktop.workbench.sidePanelGitUnavailable") : t("desktop.workbench.sidePanelNoRoot")}</p>}</div>}</div>}</aside></> : null}
        </div>
      </main>
    </div>
    {branchPane ? <div className="wb-git-branch-popover"><div className="wb-git-branch-repo-head">{branchPane.repoRoot || branchPane.cwd}</div><div className="wb-git-branch-list">{branches.length ? branches.map((branch) => <button type="button" className={`wb-git-branch-item${branch === branchPane.branch ? " active" : ""}`} key={branch} onClick={() => void checkoutBranch(branch)}>{branch}</button>) : <p className="wb-git-branch-empty muted">{t("desktop.workbench.noGitBranches")}</p>}</div><button type="button" className="wb-git-branch-item" onClick={() => setBranchPane(null)}>{t("desktop.common.close")}</button></div> : null}
    {commitOpen ? <div className="wb-note-created-overlay"><div className="wb-note-created-backdrop" onClick={() => !commitBusy && setCommitOpen(false)} /><div className="wb-note-created-panel" role="dialog" aria-modal="true" aria-label={t("desktop.workbench.gitCommitDialogTitle")}><div className="wb-rename-head"><p className="wb-note-created-title">{t("desktop.workbench.gitCommitDialogTitle")}</p><button type="button" className="wb-rename-auto-btn" disabled={commitBusy} onClick={() => void suggestCommit()}>{commitBusy ? <LoaderCircle className="spin" size={14} /> : null}{t("desktop.workbench.gitCommitAutoGenerate")}</button></div><textarea className="wb-git-commit-input" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} aria-label={t("desktop.workbench.gitCommitDialogTitle")} /><div className="wb-note-created-actions"><button type="button" className="wb-note-created-btn" disabled={commitBusy} onClick={() => setCommitOpen(false)}>{t("desktop.common.cancel")}</button><button type="button" className="wb-note-created-btn" disabled={commitBusy || !commitMessage.trim()} onClick={() => void commit()}>{t("desktop.workbench.gitCommit")}</button><button type="button" className="wb-note-created-btn primary" disabled={commitBusy || !commitMessage.trim()} onClick={() => void commit(true)}>{t("desktop.workbench.gitCommitAndPush")}</button></div></div></div> : null}
    <GitChangesPanel visible={side === "git" && !gitLog} git={git} expanded={gitExpandedDirs} onToggle={toggleGitDirectory} onOpenDiff={(change, staged) => void openDiff(change, staged)} stagedTitle={t("desktop.workbench.sidePanelStaged")} changesTitle={t("desktop.workbench.sidePanelChanges")} noChanges={t("desktop.workbench.sidePanelNoChanges")} unavailable={selectedProject ? t("desktop.workbench.sidePanelGitUnavailable") : t("desktop.workbench.sidePanelNoRoot")} />
    <GitDiffMergePanel diff={currentDiff} />
    <GitGraphPortals gitLog={gitLog} gitShow={gitShow} />
    <GitActionIcons visible={side === "git" && !gitLog} />
    <GitRepositorySelector visible={side === "git" && !gitLog} repositories={gitRepositories} value={gitRoot} ariaLabel={t("desktop.workbench.gitRepoSelect")} onChange={(root) => { setGitRoot(root); setGitLog(null); setGitShow(null); }} />
    <BranchGraphNavigation visible={side === "git" && Boolean(gitLog)} projectLabel={basename(gitRoot)} ariaLabel={t("desktop.workbench.gitLogBackToChanges")} onBack={() => { setGitLog(null); setGitShow(null); }} />
    <Status kind={status.kind}>{status.text}</Status>
  </section>, host);
}
