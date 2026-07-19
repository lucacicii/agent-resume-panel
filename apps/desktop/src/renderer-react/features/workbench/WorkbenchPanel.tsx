import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactPortal } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { AgentSession, AgentProvider } from "@agent-resume/core";
import {
  ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen, GitBranch, History,
  PanelRight, Plus, RefreshCw, Save, TerminalSquare, X
} from "lucide-react";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { useI18n } from "../../i18n";

type DirectoryEntry = Awaited<ReturnType<ReturnType<typeof desktopApi>["workbenchListDirectory"]>>["entries"][number];
type FileInspection = Awaited<ReturnType<ReturnType<typeof desktopApi>["workbenchInspectFile"]>>;
type GitStatusResult = Awaited<ReturnType<ReturnType<typeof desktopApi>["terminalGitStatus"]>>;
type GitStatus = Omit<GitStatusResult, "root"> & { root: string };
type TerminalPane = { key: string; title: string; cwd: string; command?: string; ptyId?: number };
type EditorPane = Extract<FileInspection, { kind: "text" }> & { path: string; content: string; dirty: boolean };
type SideView = "files" | "git" | null;

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

function TerminalView({ pane, active, onPty, onClose }: {
  pane: TerminalPane;
  active: boolean;
  onPty: (key: string, id: number, terminal: Terminal) => void;
  onClose: (key: string) => void;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon | null>(null);
  const ptyId = useRef<number | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      scrollback: 10_000,
      theme: { background: "#1e1e1e", foreground: "#f2f2f7" }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host.current);
    fit.current = fitAddon;
    const resize = () => {
      try { fitAddon.fit(); } catch { /* hidden hosts are fitted after activation */ }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    const input = terminal.onData((data) => {
      if (ptyId.current !== null) void desktopApi().terminalInput({ id: ptyId.current, data });
    });
    let alive = true;
    void desktopApi().terminalSpawn({ cwd: pane.cwd, command: pane.command, cols: terminal.cols, rows: terminal.rows })
      .then(({ id }) => {
        if (!alive) { void desktopApi().terminalDestroy({ id }); return; }
        ptyId.current = id;
        onPty(pane.key, id, terminal);
        void desktopApi().terminalResize({ id, cols: terminal.cols, rows: terminal.rows });
      })
      .catch((error: unknown) => terminal.write(`\r\n${error instanceof Error ? error.message : String(error)}\r\n`));
    return () => {
      alive = false;
      observer.disconnect();
      input.dispose();
      if (ptyId.current !== null) void desktopApi().terminalDestroy({ id: ptyId.current });
      terminal.dispose();
    };
  }, [onPty, pane.command, pane.cwd, pane.key]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => { try { fit.current?.fit(); } catch { /* see mount resize guard */ } });
  }, [active]);

  return <div className={`wb-terminal-pane${active ? " active" : ""}`} hidden={!active}>
    <div className="wb-terminal-host" ref={host} />
    <button type="button" className="wb-terminal-tab-close" aria-label="Close terminal" title="Close terminal" onClick={() => onClose(pane.key)}><X size={14} /></button>
  </div>;
}

export function WorkbenchPanel(): ReactPortal | null {
  const host = document.getElementById("react-workbench");
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [extraProjects, setExtraProjects] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sessionFilter, setSessionFilter] = useState<"all" | "active">("all");
  const [activeSession, setActiveSession] = useState<string>("");
  const [terminals, setTerminals] = useState<TerminalPane[]>([]);
  const [activePane, setActivePane] = useState<string>("");
  const [editor, setEditor] = useState<EditorPane | null>(null);
  const [side, setSide] = useState<SideView>(null);
  const [directories, setDirectories] = useState<Record<string, DirectoryEntry[]>>({});
  const [openDirectories, setOpenDirectories] = useState<Set<string>>(new Set());
  const [git, setGit] = useState<GitStatus | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const terminalRefs = useRef(new Map<number, Terminal>());

  const loadSessions = useCallback(async () => {
    try {
      const next = await desktopApi().listSessions(2_000);
      setSessions(next);
      setProject((current) => current && (next.some((session) => session.projectPath === current) || extraProjects.includes(current)) ? current : next.find((session) => session.projectPath)?.projectPath || null);
      setStatus({ text: "" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [extraProjects]);

  useEffect(() => {
    const onTab = (event: Event) => {
      const show = (event as CustomEvent<string>).detail === "workbench";
      setActive(show);
      if (show) void loadSessions();
    };
    window.addEventListener("agent-resume:tab-change", onTab);
    return () => {
      window.removeEventListener("agent-resume:tab-change", onTab);
    };
  // The listener intentionally registers once; loadSessions is stable for the relevant state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projects = useMemo(() => [...new Set([...sessions.map((session) => session.projectPath).filter(Boolean), ...extraProjects])].sort((a, b) => basename(a).localeCompare(basename(b))), [extraProjects, sessions]);
  const visibleSessions = useMemo(() => sessions.filter((session) => (!project || session.projectPath === project) && (sessionFilter !== "active" || sessionKey(session) === activeSession) && `${session.title} ${session.id} ${session.provider}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt), [activeSession, project, query, sessionFilter, sessions]);
  const currentPane = activePane.startsWith("editor:") ? "editor" : "terminal";

  const selectProject = (next: string | null) => {
    setProject(next); setActiveSession(""); setSide(null); setEditor(null); setActivePane(""); setDirectories({}); setOpenDirectories(new Set()); setGit(null);
  };
  const onPty = useCallback((key: string, id: number, terminal: Terminal) => {
    terminalRefs.current.set(id, terminal);
    setTerminals((current) => current.map((pane) => pane.key === key ? { ...pane, ptyId: id } : pane));
  }, []);
  const closeTerminal = async (key: string) => {
    const pane = terminals.find((item) => item.key === key);
    if (pane?.ptyId) terminalRefs.current.delete(pane.ptyId);
    setTerminals((current) => current.filter((item) => item.key !== key));
    setActivePane((current) => current === key ? terminals.find((item) => item.key !== key)?.key || "" : current);
  };
  const addTerminal = (title: string, cwd: string, command?: string) => {
    const key = `terminal:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    setTerminals((current) => [...current, { key, title, cwd, command }]); setEditor(null); setActivePane(key);
  };
  const openBlankTerminal = async () => {
    try {
      const cwd = project || await desktopApi().createScratchDir();
      if (!project) { setExtraProjects((current) => current.includes(cwd) ? current : [...current, cwd]); setProject(cwd); }
      addTerminal(t("desktop.workbench.terminalLabel", terminals.length + 1), cwd);
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };
  useEffect(() => {
    const onCmdT = () => { if (active) void openBlankTerminal(); };
    return desktopApi().onWorkbenchCmdT(onCmdT);
  }, [active, openBlankTerminal]);
  const openSession = async (session: AgentSession) => {
    setActiveSession(sessionKey(session));
    try {
      const result = await desktopApi().workbenchOpenSession({ provider: session.provider, id: session.id });
      if (result.external) { setStatus({ text: result.command || t("desktop.workbench.externalTerminalHint"), kind: "ok" }); return; }
      addTerminal(session.title || session.id, result.cwd, result.command);
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };
  const newSession = async () => {
    try {
      const cwd = project || await desktopApi().createScratchDir();
      if (!project) { setExtraProjects((current) => current.includes(cwd) ? current : [...current, cwd]); setProject(cwd); }
      const settings = await desktopApi().getSettings();
      const provider = (settings.workbench?.defaultNewSessionProvider || "codex") as AgentProvider;
      const result = await desktopApi().workbenchNewSession({ cwd, provider });
      if (result.mode !== "external-system" && result.mode !== "external-ghostty" && result.command) addTerminal(t("desktop.workbench.newSessionTitle", basename(cwd)), result.cwd, result.command);
      await loadSessions();
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };

  const loadDirectory = useCallback(async (rootPath: string, dirPath: string) => {
    try {
      const result = await desktopApi().workbenchListDirectory({ rootPath, dirPath });
      setDirectories((current) => ({ ...current, [dirPath]: result.entries }));
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  }, []);
  useEffect(() => { if (active && side === "files" && project && !directories[project]) void loadDirectory(project, project); }, [active, directories, loadDirectory, project, side]);
  const toggleDirectory = async (path: string) => {
    if (!project) return;
    const next = new Set(openDirectories);
    if (next.has(path)) next.delete(path); else { next.add(path); if (!directories[path]) await loadDirectory(project, path); }
    setOpenDirectories(next);
  };
  const openFile = async (path: string) => {
    if (!project) return;
    try {
      const inspected = await desktopApi().workbenchInspectFile({ rootPath: project, filePath: path });
      if (inspected.kind === "external") { await desktopApi().workbenchOpenPath({ rootPath: project, filePath: path }); return; }
      setEditor({ ...inspected, path, content: inspected.content, dirty: false }); setActivePane(`editor:${path}`);
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };
  const saveFile = async () => {
    if (!project || !editor) return;
    try {
      let result = await desktopApi().workbenchSaveFileText({ rootPath: project, filePath: editor.path, content: editor.content, encoding: editor.encoding, expectedVersion: editor.version });
      if (!result.ok && window.confirm("The file changed on disk. Replace it with the editor contents?")) result = await desktopApi().workbenchSaveFileText({ rootPath: project, filePath: editor.path, content: editor.content, encoding: editor.encoding, expectedVersion: editor.version, force: true });
      if (!result.ok) { setStatus({ text: "The file changed on disk.", kind: "error" }); return; }
      setEditor((current) => current ? { ...current, version: result.version, dirty: false } : current); setStatus({ text: "", kind: "ok" });
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };

  const loadGit = useCallback(async () => {
    if (!project) return;
    try {
      const result = await desktopApi().terminalGitStatus({ cwd: project });
      setGit({ ...result, root: result.root || "" });
      setStatus({ text: "" });
    }
    catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  }, [project]);
  useEffect(() => { if (active && side === "git") void loadGit(); }, [active, loadGit, side]);
  const gitAction = async (action: "commit" | "push" | "pull") => {
    if (!git?.root) return;
    try {
      if (action === "commit") { if (!commitMessage.trim()) return; await desktopApi().terminalGitCommit({ repoRoot: git.root, message: commitMessage.trim() }); setCommitMessage(""); }
      if (action === "push") await desktopApi().terminalGitPush({ repoRoot: git.root });
      if (action === "pull") await desktopApi().terminalGitPull({ repoRoot: git.root });
      await loadGit();
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };
  useEffect(() => {
    const data = desktopApi().onTerminalData(({ id, data: value }) => terminalRefs.current.get(id)?.write(value));
    const exited = desktopApi().onTerminalExit(({ id }) => terminalRefs.current.get(id)?.write("\r\nTerminal closed.\r\n"));
    const respawned = desktopApi().onTerminalRespawned(({ id }) => terminalRefs.current.get(id)?.write("\r\nShell restored.\r\n"));
    return () => { data(); exited(); respawned(); };
  }, []);

  if (!host) return null;
  const renderTree = (dirPath: string, depth: number): React.JSX.Element[] => (directories[dirPath] || []).flatMap((entry) => {
    const expanded = entry.isDirectory && openDirectories.has(entry.path);
    const row = <div className="wb-file-tree-row" style={{ paddingLeft: `${8 + depth * 14}px` }} key={entry.path}>
      {entry.isDirectory ? <button type="button" className={`wb-file-tree-chevron${expanded ? " is-expanded" : ""}`} aria-label={expanded ? "Collapse folder" : "Expand folder"} onClick={() => void toggleDirectory(entry.path)}><ChevronRight size={14} /></button> : <span className="wb-file-tree-chevron is-placeholder" />}
      {entry.isDirectory ? <Folder size={15} className="wb-file-tree-icon" /> : <FileCode2 size={15} className="wb-file-tree-icon" />}
      <button type="button" className="wb-file-tree-label" title={entry.path} onClick={() => entry.isDirectory ? void toggleDirectory(entry.path) : void openFile(entry.path)}>{entry.name}</button>
    </div>;
    return expanded ? [row, ...renderTree(entry.path, depth + 1)] : [row];
  });
  const changes = git ? [...git.staged, ...git.unstaged] : [];

  return createPortal(<section className="panel workbench-panel react-workbench-panel" hidden={!active}>
    <div className="workbench-layout">
      <aside className="sidebar-folders-pane wb-folders-pane">
        <div className="sidebar-project-filter-wrap"><label className="sidebar-project-search-wrap"><FolderOpen size={15} /><input type="search" className="sidebar-project-search" placeholder={t("desktop.notes.filterProjects")} value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
        <div className="wb-folders"><button type="button" className={`wb-folder-row${!project ? " active" : ""}`} onClick={() => selectProject(null)}><span>All sessions</span><span>{sessions.length}</span></button>{projects.map((path) => <button type="button" className={`wb-folder-row${project === path ? " active" : ""}`} key={path} title={path} onClick={() => selectProject(path)}><span>{basename(path)}</span><span>{sessions.filter((session) => session.projectPath === path).length}</span></button>)}</div>
      </aside>
      <aside className="wb-list-pane">
        <div className="sidebar-project-filter-wrap wb-session-filter-wrap"><input type="search" className="wb-search" placeholder={t("desktop.common.search")} value={query} onChange={(event) => setQuery(event.target.value)} /><div className="sidebar-project-filter-segmented" role="tablist"><button type="button" className={sessionFilter === "all" ? "active" : ""} onClick={() => setSessionFilter("all")}>{t("desktop.common.all")}</button><button type="button" className={sessionFilter === "active" ? "active" : ""} onClick={() => setSessionFilter("active")}>{t("desktop.common.active")}</button></div></div>
        <div className="wb-list-meta-row"><p className="wb-list-meta">{visibleSessions.length} / {sessions.length}</p><button type="button" className="wb-icon-btn" aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")} onClick={() => void loadSessions()}><RefreshCw size={15} /></button></div>
        <div className="wb-list">{visibleSessions.length ? visibleSessions.map((session) => <button type="button" className={`wb-list-item${activeSession === sessionKey(session) ? " active" : ""}`} key={sessionKey(session)} onClick={() => void openSession(session)}><span className="wb-list-item-top"><span className="wb-list-item-title">{session.title || session.id}</span><span className="wb-list-item-date">{relativeTime(session.updatedAt)}</span></span><span className="wb-list-item-preview">{session.provider} · {basename(session.projectPath)}</span></button>) : <p className="muted wb-list-empty">{t("desktop.workbench.noSessionsInProject")}</p>}</div>
      </aside>
      <main className="wb-detail">
        <div className="wb-detail-head"><span className="wb-detail-project-label"><span className="wb-detail-project-label-text">{project ? basename(project) : t("desktop.workbench.allSessions")}</span>{project ? <span className="wb-detail-project-path">{project}</span> : null}</span><div className="wb-detail-tools"><button type="button" className={`wb-detail-tool${side === "files" ? " active" : ""}`} aria-pressed={side === "files"} aria-label={t("desktop.workbench.sidePanelExplorer")} title={t("desktop.workbench.sidePanelExplorer")} onClick={() => setSide((current) => current === "files" ? null : "files")}><FolderOpen size={16} /></button><button type="button" className={`wb-detail-tool${side === "git" ? " active" : ""}`} aria-pressed={side === "git"} aria-label={t("desktop.workbench.sidePanelGit")} title={t("desktop.workbench.sidePanelGit")} onClick={() => setSide((current) => current === "git" ? null : "git")}><GitBranch size={16} /></button></div></div>
        <div className="wb-detail-body"><div className="wb-terminal-shell"><div className="wb-terminal-tabs"><div className="wb-terminal-tabs-list" role="tablist">{terminals.map((pane) => <div className={`wb-terminal-tab${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => { setEditor(null); setActivePane(pane.key); }}>{pane.title}</button><button type="button" className="wb-terminal-tab-close" aria-label="Close" onClick={() => void closeTerminal(pane.key)}><X size={13} /></button></div>)}{editor ? <div className={`wb-terminal-tab${currentPane === "editor" ? " active" : ""}`} role="tab" aria-selected={currentPane === "editor"}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(`editor:${editor.path}`)}>{editor.dirty ? "* " : ""}{basename(editor.path)}</button><button type="button" className="wb-terminal-tab-close" aria-label="Close file" onClick={() => { setEditor(null); setActivePane(terminals[0]?.key || ""); }}><X size={13} /></button></div> : null}</div><div className="wb-terminal-tabs-actions"><button type="button" className="wb-terminal-tab-action" aria-label={t("desktop.workbench.newTerminal")} title={t("desktop.workbench.newTerminal")} onClick={() => void openBlankTerminal()}><TerminalSquare size={17} /></button><button type="button" className="wb-terminal-tab-action" aria-label={t("desktop.workbench.newSession")} title={t("desktop.workbench.newSession")} onClick={() => void newSession()}><Plus size={17} /></button></div></div><div className="wb-terminal-stack">{terminals.map((pane) => <TerminalView key={pane.key} pane={pane} active={activePane === pane.key} onPty={onPty} onClose={(key) => void closeTerminal(key)} />)}{editor && currentPane === "editor" ? <div className="wb-editor-pane"><div className="wb-diff-head"><strong>{editor.path}</strong><button type="button" className="wb-git-action-btn" disabled={!editor.dirty} onClick={() => void saveFile()} aria-label={t("desktop.common.save")} title={t("desktop.common.save")}><Save size={15} /></button></div><textarea className="wb-editor-host" value={editor.content} spellCheck={false} onChange={(event) => setEditor({ ...editor, content: event.target.value, dirty: true })} onBlur={() => { if (editor.dirty) void saveFile(); }} /></div> : null}{!terminals.length && !editor ? <p className="muted wb-terminal-hint">{project ? t("desktop.workbench.selectSessionHint") : t("desktop.workbench.selectProjectHint")}</p> : null}</div></div>{side ? <aside className="wb-side-panel"><div className="wb-side-pane">{side === "files" ? <><div className="wb-side-pane-head"><span className="wb-side-pane-title">{t("desktop.workbench.sidePanelExplorer")}</span></div><div className="wb-file-tree" role="tree">{project ? <><div className="wb-file-tree-row"><FolderOpen size={15} className="wb-file-tree-icon" /><span className="wb-file-tree-label">{basename(project)}</span></div>{renderTree(project, 1)}</> : <p className="muted wb-file-tree-empty">{t("desktop.workbench.sidePanelNoRoot")}</p>}</div></> : <><div className="wb-side-pane-head wb-git-pane-head"><span className="wb-side-pane-title">{t("desktop.workbench.sidePanelGit")}</span><div className="wb-git-actions"><button type="button" className="wb-git-action-btn" disabled={!git?.root} onClick={() => void gitAction("push")} aria-label={t("desktop.workbench.gitPush")} title={t("desktop.workbench.gitPush")}><ChevronRight size={15} /></button><button type="button" className="wb-git-action-btn" disabled={!git?.root} onClick={() => void gitAction("pull")} aria-label={t("desktop.workbench.gitPull")} title={t("desktop.workbench.gitPull")}><ChevronDown size={15} /></button><button type="button" className="wb-git-action-btn" onClick={() => void loadGit()} aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")}><RefreshCw size={15} /></button></div></div><div className="wb-git-panel">{git?.isRepo ? <><p className="muted">{git.root}</p>{changes.length ? <div className="wb-git-section"><strong className="wb-git-section-title">Changes</strong>{changes.map((change, index) => <button type="button" className="wb-git-file" key={`${change.repoRoot}:${change.path}:${index}`} onClick={() => void desktopApi().terminalGitDiffSides({ cwd: project || "", path: change.path, staged: change.staged }).then((diff) => { setEditor({ kind: "text", path: change.path, content: `${diff.oldLabel}\n${diff.oldText}\n\n${diff.newLabel}\n${diff.newText}`, encoding: "utf8", version: "", size: 0, mtimeMs: 0, dirty: false }); setActivePane(`editor:${change.path}`); })}><span className="wb-git-file-status">{change.status}</span><span className="wb-git-file-path">{change.path}</span></button>)}</div> : <p className="muted wb-git-empty">No changes</p>}<div className="wb-git-section"><input className="quiet-input" placeholder="Commit message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void gitAction("commit"); }} /><button type="button" className="tool-btn" disabled={!commitMessage.trim()} onClick={() => void gitAction("commit")}>{t("desktop.workbench.gitCommit")}</button></div><button type="button" className="tool-btn ghost-btn" onClick={() => void desktopApi().terminalGitLog({ repoRoot: git.root, limit: 50 }).then((log) => setStatus({ text: log.commits.map((commit) => `${commit.shortHash} ${commit.subject}`).join("\n"), kind: "ok" }))}><History size={15} /> {t("desktop.workbench.gitLog")}</button></> : <p className="muted wb-git-empty">{project ? "Not a Git repository" : t("desktop.workbench.sidePanelNoRoot")}</p>}</div></>}</div></aside> : null}</div>
      </main>
    </div>
    <Status kind={status.kind}>{status.text}</Status>
  </section>, host);
}
