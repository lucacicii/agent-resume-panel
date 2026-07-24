import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactPortal } from "react";
import {
  ChevronLeft, ChevronRight, Clipboard, Eye, FilePlus2, FolderOpen,
  PanelRight, Pencil, Pin, RefreshCw, Save, Search, Trash2, Upload, X
} from "lucide-react";
import type { AgentSession, GtdStatus } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { CodeEditor, type CodeEditorHandle } from "../../components/CodeEditor";
import { renderMarkdown } from "../../components/Markdown";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Status, type StatusKind } from "../../components/Status";
import { useI18n } from "../../i18n";

type Note = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesList"]>>[number];
type GtdTask = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesListGtd"]>>[number];
type Owner = { scope: "library" | "project" | "session"; projectPath?: string; provider?: string; sessionId?: string };
type Folder = { kind: "all" } | { kind: "library" } | { kind: "project"; projectPath: string } | { kind: "session"; provider: string; sessionId: string };
type ProjectFilter = "all" | "pinned" | "active";
type ListFilter = "all" | "pinned";
type NotesSidebarView = "notes" | "gtd";
type TargetState = { action: "create" | "import" | "move"; owner: Owner; note?: Note };
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
type ContextMenu = { kind: "project"; projectPath: string; projectId?: string; x: number; y: number } | { kind: "note"; note: Note; x: number; y: number };
type RenameDialog = { kind: "project"; projectPath: string; projectId?: string; title: string } | { kind: "note"; note: Note; title: string };

const PINNED_PROJECTS_KEY = "pinned-projects";
const PINNED_NOTES_KEY = "pinned-notes";
const FOLDERS_COLLAPSED_KEY = "notes-folders-collapsed";
const FOLDERS_WIDTH_KEY = "sidebar-folders-width";
const LIST_WIDTH_KEY = "notes-list-pane-width";
const SIDEBAR_VIEW_KEY = "notes-sidebar-view";
const GTD_STATUSES = ["inbox", "next", "waiting", "someday", "reference", "done"] as const satisfies readonly GtdStatus[];

function basename(value = ""): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

function titleFor(note: Note): string {
  return note.title || note.filename.replace(/\.md$/i, "") || note.noteId;
}

function sessionKey(session: Pick<AgentSession, "provider" | "id">): string {
  return `${session.provider}:${session.id}`;
}

function activeSession(session: AgentSession): boolean {
  return Date.now() - session.updatedAt < 15 * 60_000;
}

function storageString(key: string): string {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function storedWidth(key: string, fallback: number, min: number, max: number): number {
  const value = Number(storageString(key));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function loadPinned(key: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch { return new Set(); }
}

function savePinned(key: string, values: Set<string>): void {
  try { localStorage.setItem(key, JSON.stringify([...values])); } catch { /* persistence is optional */ }
}

function ownerForFolder(folder: Folder): Owner | null {
  if (folder.kind === "library") return { scope: "library" };
  if (folder.kind === "project") return { scope: "project", projectPath: folder.projectPath };
  if (folder.kind === "session") return { scope: "session", provider: folder.provider, sessionId: folder.sessionId };
  return null;
}

function sameFolder(left: Folder, right: Folder): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function folderLabel(folder: Folder, aliases: Record<string, string>, t: (key: string, ...args: Array<string | number>) => string): string {
  if (folder.kind === "all") return t("desktop.common.all");
  if (folder.kind === "library") return t("desktop.notes.librarySection");
  if (folder.kind === "project") return aliases[folder.projectPath] || basename(folder.projectPath);
  return folder.sessionId;
}

function PaneResizer({ label, onDelta }: { label: string; onDelta: (delta: number) => void }): React.JSX.Element {
  const [dragging, setDragging] = useState(false);
  return <div
    className={`pane-resizer${dragging ? " is-dragging" : ""}`}
    role="separator"
    aria-label={label}
    aria-orientation="vertical"
    onPointerDown={(event) => {
      event.preventDefault();
      let previous = event.clientX;
      setDragging(true);
      document.body.classList.add("is-pane-resizing");
      const move = (next: PointerEvent) => {
        onDelta(next.clientX - previous);
        previous = next.clientX;
      };
      const end = () => {
        setDragging(false);
        document.body.classList.remove("is-pane-resizing");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end, { once: true });
    }}
  />;
}

export function NotesPanel(): ReactPortal | null {
  const host = document.getElementById("react-notes");
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [gtdTasks, setGtdTasks] = useState<GtdTask[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Note | null>(null);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [view, setView] = useState<"edit" | "view">("edit");
  const [folder, setFolder] = useState<Folder>({ kind: "all" });
  const [catalogProjects, setCatalogProjects] = useState<CatalogProject[]>([]);
  const [pinnedProjects, setPinnedProjects] = useState<Set<string>>(() => loadPinned(PINNED_PROJECTS_KEY));
  const [pinnedNotes, setPinnedNotes] = useState<Set<string>>(() => loadPinned(PINNED_NOTES_KEY));
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [projectQuery, setProjectQuery] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [sidebarView, setSidebarView] = useState<NotesSidebarView>(() => storageString(SIDEBAR_VIEW_KEY) === "gtd" ? "gtd" : "notes");
  const [selectedGtdStatus, setSelectedGtdStatus] = useState<GtdStatus | "all">("all");
  const [gtdQuery, setGtdQuery] = useState("");
  const [completedGtdExpanded, setCompletedGtdExpanded] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [listSearchOpen, setListSearchOpen] = useState(false);
  const [foldersCollapsed, setFoldersCollapsed] = useState(() => storageString(FOLDERS_COLLAPSED_KEY) === "true");
  const [foldersWidth, setFoldersWidth] = useState(() => storedWidth(FOLDERS_WIDTH_KEY, 220, 140, 400));
  const [listWidth, setListWidth] = useState(() => storedWidth(LIST_WIDTH_KEY, 320, 240, 520));
  const [target, setTarget] = useState<TargetState | null>(null);
  const [targetQuery, setTargetQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialog | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatch, setFindMatch] = useState<boolean | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const saveTimer = useRef<number | null>(null);
  const contentRef = useRef(content);
  const selectedRef = useRef<Note | null>(selected);
  const editorRef = useRef<CodeEditorHandle>(null);
  const listSearchRef = useRef<HTMLInputElement>(null);
  const listSearchButtonRef = useRef<HTMLButtonElement>(null);
  const listSearchToolbarRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  contentRef.current = content;
  selectedRef.current = selected;
  const gtdSlashCommands = useMemo(() => GTD_STATUSES.map((gtdStatus) => {
    const opener = ":::gtd " + gtdStatus;
    return {
      label: t("desktop.notes.slashGtdTask"),
      tag: { label: "@GTD/" + gtdStatus, toneClassName: "is-" + gtdStatus },
      insert: opener + "\n\n:::",
      cursorOffset: opener.length + 1
    };
  }), [t]);

  const load = useCallback(async () => {
    try {
      const listProjects = typeof desktopApi().listProjects === "function"
        ? desktopApi().listProjects()
        : Promise.resolve([] as CatalogProject[]);
      const listGtd = typeof desktopApi().notesListGtd === "function"
        ? desktopApi().notesListGtd()
        : Promise.resolve([] as GtdTask[]);
      const [nextNotes, nextSessions, nextAliases, nextProjects, nextGtdTasks] = await Promise.all([
        desktopApi().notesList(),
        desktopApi().listSessions(2_000),
        desktopApi().listProjectAliases(),
        listProjects,
        listGtd
      ]);
      setNotes(nextNotes);
      setGtdTasks(nextGtdTasks || []);
      setSessions(nextSessions);
      setAliases(nextAliases);
      setCatalogProjects(nextProjects || []);
      setSelected((current) => current ? nextNotes.find((item) => item.noteId === current.noteId) || null : null);
      setStatus({ text: "" });
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  }, []);

  const save = useCallback(async () => {
    const note = selectedRef.current;
    if (!note) return;
    try {
      const updated = await desktopApi().notesWrite({ noteId: note.noteId, content: contentRef.current });
      setNotes((current) => current.map((item) => item.noteId === note.noteId
        ? { ...item, ...updated, contentPreview: contentRef.current.slice(0, 300) }
        : item));
      if (typeof desktopApi().notesListGtd === "function") {
        setGtdTasks(await desktopApi().notesListGtd());
      }
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  }, []);

  const open = useCallback(async (note: Note) => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await save();
    }
    try {
      const result = await desktopApi().notesRead({ noteId: note.noteId });
      setSelected(result.record);
      setContent(result.content);
      setTitle(titleFor(result.record));
      setEditingTitle(false);
      setView("edit");
      setFindOpen(false);
      setFindQuery("");
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  }, [save]);

  useEffect(() => {
    const onTab = (event: Event) => {
      const show = (event as CustomEvent<string>).detail === "notes";
      setActive(show);
      if (show) void load();
    };
    const onOpen = (event: Event) => {
      const noteId = (event as CustomEvent<string>).detail;
      void desktopApi().notesRead({ noteId }).then((result) => {
        setSelected(result.record);
        setContent(result.content);
        setTitle(titleFor(result.record));
        setView("edit");
        setFolder(result.record.scope === "project" && result.record.projectPath
          ? { kind: "project", projectPath: result.record.projectPath }
          : result.record.scope === "session" && result.record.provider && result.record.agentSessionId
            ? { kind: "session", provider: result.record.provider, sessionId: result.record.agentSessionId }
            : { kind: "library" });
      }).catch((error) => setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }));
    };
    window.addEventListener("agent-resume:tab-change", onTab);
    window.addEventListener("agent-resume:open-note", onOpen);
    return () => {
      window.removeEventListener("agent-resume:tab-change", onTab);
      window.removeEventListener("agent-resume:open-note", onOpen);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [load]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".notes-context-menu")) setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setContextMenu(null); };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("mousedown", dismiss); window.removeEventListener("keydown", onKeyDown); };
  }, [contextMenu]);

  useEffect(() => {
    if (!listSearchOpen) return;
    window.requestAnimationFrame(() => listSearchRef.current?.focus());
  }, [listSearchOpen]);

  useEffect(() => {
    if (!findOpen) return;
    window.requestAnimationFrame(() => findRef.current?.focus());
  }, [findOpen]);

  const projects = useMemo(() => {
    if (catalogProjects.length) {
      return catalogProjects.map((project) => {
        const path = project.localPath || project.portableKey;
        const projectNotes = notes.filter((note) =>
          note.scope === "project"
          && note.projectPath
          && (note.projectPath === path
            || note.projectPath === project.localPath
            || note.projectPath === project.portableKey
            || (project.localPath && note.projectPath.endsWith(project.portableKey.replace(/^~\//, ""))))
        );
        const projectSessions = sessions.filter((session) =>
          (session.projectId && session.projectId === project.projectId)
          || session.projectPath === path
          || session.projectPath === project.localPath
        );
        return {
          id: project.projectId,
          path,
          pathMissing: project.pathMissing,
          portableKey: project.portableKey,
          label: project.alias || aliases[path] || basename(path),
          count: projectNotes.length,
          active: projectSessions.some(activeSession),
          pinned: project.pinned === true || pinnedProjects.has(path) || pinnedProjects.has(project.projectId),
          updatedAt: Math.max(
            0,
            project.lastSeenAtMs || 0,
            project.updatedAtMs || 0,
            ...projectNotes.map((note) => note.updatedAtMs),
            ...projectSessions.map((session) => session.updatedAt)
          )
        };
      }).filter((project) => {
        const query = projectQuery.trim().toLocaleLowerCase();
        return (!query || `${project.label} ${project.path}`.toLocaleLowerCase().includes(query))
          && (projectFilter === "all" || (projectFilter === "pinned" ? project.pinned : project.active));
      }).sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt || left.label.localeCompare(right.label));
    }

    const grouped = new Map<string, { notes: Note[]; sessions: AgentSession[] }>();
    for (const note of notes) {
      if (note.scope !== "project" || !note.projectPath) continue;
      const group = grouped.get(note.projectPath) || { notes: [], sessions: [] };
      group.notes.push(note);
      grouped.set(note.projectPath, group);
    }
    for (const session of sessions) {
      if (!session.projectPath) continue;
      const group = grouped.get(session.projectPath) || { notes: [], sessions: [] };
      group.sessions.push(session);
      grouped.set(session.projectPath, group);
    }
    return [...grouped.entries()].map(([path, group]) => ({
      id: path,
      path,
      pathMissing: false,
      portableKey: path,
      label: aliases[path] || basename(path),
      count: group.notes.length,
      active: group.sessions.some(activeSession),
      pinned: pinnedProjects.has(path),
      updatedAt: Math.max(0, ...group.notes.map((note) => note.updatedAtMs), ...group.sessions.map((session) => session.updatedAt))
    })).filter((project) => {
      const query = projectQuery.trim().toLocaleLowerCase();
      return (!query || `${project.label} ${project.path}`.toLocaleLowerCase().includes(query))
        && (projectFilter === "all" || (projectFilter === "pinned" ? project.pinned : project.active));
    }).sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt || left.label.localeCompare(right.label));
  }, [aliases, catalogProjects, notes, pinnedProjects, projectFilter, projectQuery, sessions]);

  const folderSessions = useMemo(() => sessions.filter((session) => {
    const hasNote = notes.some((note) => note.scope === "session" && note.provider === session.provider && note.agentSessionId === session.id);
    return hasNote;
  }).sort((left, right) => right.updatedAt - left.updatedAt), [notes, sessions]);

  const visibleNotes = useMemo(() => notes.filter((note) => {
    const inFolder = folder.kind === "all"
      || (folder.kind === "library" && note.scope === "library")
      || (folder.kind === "project" && note.scope === "project" && note.projectPath === folder.projectPath)
      || (folder.kind === "session" && note.scope === "session" && note.provider === folder.provider && note.agentSessionId === folder.sessionId);
    const matchesQuery = `${titleFor(note)} ${note.filename} ${note.contentPreview || ""}`.toLocaleLowerCase().includes(listQuery.trim().toLocaleLowerCase());
    return inFolder && matchesQuery && (listFilter === "all" || pinnedNotes.has(note.noteId) || selected?.noteId === note.noteId);
  }).sort((left, right) => Number(pinnedNotes.has(right.noteId)) - Number(pinnedNotes.has(left.noteId)) || right.updatedAtMs - left.updatedAtMs), [folder, listFilter, listQuery, notes, pinnedNotes, selected?.noteId]);

  const gtdStatusCounts = useMemo(() => {
    const counts = new Map<GtdStatus, number>(GTD_STATUSES.map((status) => [status, 0] as const));
    for (const task of gtdTasks) counts.set(task.status, (counts.get(task.status) || 0) + 1);
    return counts;
  }, [gtdTasks]);

  const visibleGtdTasks = useMemo(() => {
    const query = gtdQuery.trim().toLocaleLowerCase();
    return gtdTasks.filter((task) => {
      const matchesStatus = selectedGtdStatus === "all" || task.status === selectedGtdStatus;
      const searchable = `${task.text} ${task.noteTitle} ${task.relMdPath} ${task.projectPath || ""} ${task.status}`.toLocaleLowerCase();
      return matchesStatus && (!query || searchable.includes(query));
    });
  }, [gtdQuery, gtdTasks, selectedGtdStatus]);

  const targetProjects = useMemo(() => projects.filter((project) => `${project.label} ${project.path}`.toLocaleLowerCase().includes(targetQuery.trim().toLocaleLowerCase())), [projects, targetQuery]);
  const targetSessions = useMemo(() => folderSessions.filter((session) => `${session.title} ${session.id} ${session.provider}`.toLocaleLowerCase().includes(targetQuery.trim().toLocaleLowerCase())), [folderSessions, targetQuery]);

  const editContent = (value: string) => {
    setContent(value);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(), 800);
  };

  const openListSearch = () => {
    setListSearchOpen(true);
    window.requestAnimationFrame(() => {
      listSearchRef.current?.focus();
      if (listSearchRef.current?.value) listSearchRef.current.select();
    });
  };

  const closeListSearch = () => {
    setListSearchOpen(false);
    window.requestAnimationFrame(() => listSearchButtonRef.current?.focus());
  };

  const setWidth = (kind: "folders" | "list", delta: number) => {
    if (kind === "folders") setFoldersWidth((current) => {
      const next = Math.min(400, Math.max(140, current + delta));
      try { localStorage.setItem(FOLDERS_WIDTH_KEY, String(next)); } catch { /* persistence is optional */ }
      return next;
    });
    else setListWidth((current) => {
      const next = Math.min(520, Math.max(240, current + delta));
      try { localStorage.setItem(LIST_WIDTH_KEY, String(next)); } catch { /* persistence is optional */ }
      return next;
    });
  };

  const selectFolder = (next: Folder) => {
    if (!sameFolder(folder, next)) setFolder(next);
    setListQuery("");
  };

  const selectSidebarView = (next: NotesSidebarView) => {
    setSidebarView(next);
    try { localStorage.setItem(SIDEBAR_VIEW_KEY, next); } catch { /* persistence is optional */ }
  };

  const openGtdTask = (task: GtdTask) => {
    const note = notes.find((item) => item.noteId === task.noteId);
    if (!note) return;
    selectSidebarView("notes");
    void open(note).then(() => {
      window.requestAnimationFrame(() => editorRef.current?.find(task.text));
    });
  };

  const togglePinnedProject = async (projectPath: string, projectId?: string) => {
    const currentlyPinned = pinnedProjects.has(projectPath)
      || (projectId ? pinnedProjects.has(projectId) : false)
      || catalogProjects.some((item) => item.projectId === projectId && item.pinned);
    const nextPinned = !currentlyPinned;
    setPinnedProjects((current) => {
      const next = new Set(current);
      if (nextPinned) {
        next.add(projectPath);
        if (projectId) next.add(projectId);
      } else {
        next.delete(projectPath);
        if (projectId) next.delete(projectId);
      }
      savePinned(PINNED_PROJECTS_KEY, next);
      return next;
    });
    if (projectId && typeof desktopApi().setProjectPinned === "function") {
      try {
        await desktopApi().setProjectPinned({ projectId, pinned: nextPinned });
        setCatalogProjects((current) =>
          current.map((item) => item.projectId === projectId ? { ...item, pinned: nextPinned } : item)
        );
      } catch (error) {
        setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
      }
    }
  };

  const togglePinnedNote = (noteId: string) => setPinnedNotes((current) => {
    const next = new Set(current);
    if (next.has(noteId)) next.delete(noteId); else next.add(noteId);
    savePinned(PINNED_NOTES_KEY, next);
    return next;
  });

  const toggleFolders = () => setFoldersCollapsed((current) => {
    const next = !current;
    try { localStorage.setItem(FOLDERS_COLLAPSED_KEY, String(next)); } catch { /* persistence is optional */ }
    return next;
  });

  const beginTarget = (action: TargetState["action"], note?: Note, initialOwner = ownerForFolder(folder)) => {
    setTarget({ action, owner: initialOwner || { scope: "library" }, note });
    setTargetQuery("");
  };

  const applyTarget = async (owner: Owner) => {
    if (!target) return;
    try {
      if (target.action === "create") {
        const result = await desktopApi().notesCreate(owner);
        await load();
        const next = await desktopApi().notesRead({ noteId: result.noteId });
        setSelected(next.record); setContent(next.content); setTitle(titleFor(next.record));
      } else if (target.action === "import") {
        await desktopApi().notesImport(owner);
        await load();
      } else if (target.note) {
        await desktopApi().notesMove({ noteId: target.note.noteId, owner });
        await load();
        const moved = await desktopApi().notesRead({ noteId: target.note.noteId });
        setSelected(moved.record); setContent(moved.content); setTitle(titleFor(moved.record));
        selectFolder(owner.scope === "library" ? { kind: "library" } : owner.scope === "project" && owner.projectPath
          ? { kind: "project", projectPath: owner.projectPath }
          : { kind: "session", provider: owner.provider || "", sessionId: owner.sessionId || "" });
      }
      setTarget(null);
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };

  const rename = async () => {
    if (!selected || !title.trim()) return;
    try {
      const filename = title.trim().endsWith(".md") ? title.trim() : `${title.trim()}.md`;
      const result = await desktopApi().notesRename({ noteId: selected.noteId, filename });
      setSelected((current) => current ? { ...current, filename: result.filename, title: title.trim() } : current);
      setNotes((current) => current.map((note) => note.noteId === selected.noteId ? { ...note, filename: result.filename, title: title.trim() } : note));
      setEditingTitle(false);
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };

  const applyRenameDialog = async () => {
    if (!renameDialog || !renameDialog.title.trim()) return;
    try {
      if (renameDialog.kind === "project") {
        const base = basename(renameDialog.projectPath);
        await desktopApi().setProjectAlias({ projectPath: renameDialog.projectPath, alias: renameDialog.title.trim() === base ? "" : renameDialog.title.trim() });
        setAliases(await desktopApi().listProjectAliases());
      } else {
        const filename = renameDialog.title.trim().endsWith(".md") ? renameDialog.title.trim() : `${renameDialog.title.trim()}.md`;
        await desktopApi().notesRename({ noteId: renameDialog.note.noteId, filename });
        await load();
      }
      setRenameDialog(null);
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };

  const remove = async (note = selected) => {
    if (!note || !window.confirm(t("desktop.notes.deleteConfirm", titleFor(note)))) return;
    try {
      await desktopApi().notesDelete({ noteId: note.noteId });
      setPinnedNotes((current) => { const next = new Set(current); next.delete(note.noteId); savePinned(PINNED_NOTES_KEY, next); return next; });
      if (selected?.noteId === note.noteId) { setSelected(null); setContent(""); }
      await load();
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };

  const pasteImage = async (): Promise<string | null> => {
    const note = selectedRef.current;
    if (!note) return null;
    try { return (await desktopApi().notesPasteImage({ noteId: note.noteId }))?.snippet || null; }
    catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); return null; }
  };

  const find = (direction: "forward" | "backward") => setFindMatch(editorRef.current?.find(findQuery, direction) ?? false);

  if (!host) return null;
  return createPortal(
    <section className="panel active notes-panel react-notes-panel" hidden={!active}>
      <div className="notes-layout">
        <aside className={`sidebar-folders-pane notes-folders-pane${foldersCollapsed ? " is-collapsed" : ""}`} style={{ width: foldersCollapsed ? undefined : foldersWidth }}>
          <div className="sidebar-project-filter-wrap">
          <SegmentedControl
            aria-label={t("desktop.notes.sidebarView")}
            value={sidebarView}
            options={["notes", "gtd"] as const satisfies readonly NotesSidebarView[]}
            onChange={selectSidebarView}
            getLabel={(item) => t(item === "notes" ? "desktop.tabs.notes" : "desktop.workbench.gtdView")}
            className="sidebar-project-filter-segmented wb-sidebar-view-segmented"
          />
          {sidebarView === "notes" ? <>
            <label className="sidebar-project-search-wrap"><input type="search" className="sidebar-project-search" aria-label={t("desktop.notes.filterProjects")} placeholder={t("desktop.notes.filterProjects")} value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} /></label>
            <SegmentedControl
              aria-label={t("desktop.notes.projectFilter")}
              value={projectFilter}
              options={["all", "pinned", "active"] as const satisfies readonly ProjectFilter[]}
              onChange={setProjectFilter}
              getLabel={(filter) => t(`desktop.common.${filter}`)}
            />
          </> : null}
          </div>
          {sidebarView === "notes" ? <>
          <div className="notes-folders">
            <button type="button" className={`notes-folder-row${folder.kind === "all" ? " active" : ""}`} onClick={() => selectFolder({ kind: "all" })}><span className="notes-folder-row-label">{t("desktop.common.all")}</span><span className="notes-folder-row-count">{notes.length}</span></button>
            <button type="button" className={`notes-folder-row${folder.kind === "library" ? " active" : ""}`} onClick={() => selectFolder({ kind: "library" })}><span className="notes-folder-row-label">{t("desktop.notes.librarySection")}</span><span className="notes-folder-row-count">{notes.filter((note) => note.scope === "library").length}</span></button>
            <section className="notes-folder-section"><div className="notes-folder-section-label">{t("desktop.notes.projectLabel")}</div>{projects.length ? projects.map((project) => <button type="button" key={project.id} title={project.pathMissing ? t("desktop.workbench.pathMissingHint") : project.path} className={`notes-folder-row${folder.kind === "project" && folder.projectPath === project.path ? " active" : ""}${project.pinned ? " is-pinned" : ""}${project.active ? " has-wb-activity" : ""}${project.pathMissing ? " is-path-missing" : ""}`} onClick={() => selectFolder({ kind: "project", projectPath: project.path })} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ kind: "project", projectPath: project.path, projectId: project.id, x: event.clientX, y: event.clientY }); }}>
              {project.pinned ? <Pin className="project-pin-icon" size={12} /> : null}{project.active ? <span className="wb-folder-activity-dot" /> : null}<span className="notes-folder-row-text"><span className="notes-folder-row-label">{project.label}</span><span className="notes-folder-row-desc">{project.pathMissing ? t("desktop.workbench.pathMissingLabel", project.portableKey) : project.path}</span></span><span className="notes-folder-row-count">{project.count}</span>
            </button>) : <p className="muted notes-folders-empty">{t("desktop.notes.noMatchingProjects")}</p>}</section>
            <section className="notes-folder-section"><div className="notes-folder-section-label">{t("desktop.notes.sessionsSection")}</div>{folderSessions.map((session) => <button type="button" key={sessionKey(session)} className={`notes-folder-row${folder.kind === "session" && folder.provider === session.provider && folder.sessionId === session.id ? " active" : ""}`} onClick={() => selectFolder({ kind: "session", provider: session.provider, sessionId: session.id })}><span className="notes-folder-row-text"><span className="notes-folder-row-label">{session.title || session.id}</span><span className="notes-folder-row-desc">{session.provider}</span></span></button>)}</section>
          </div>
          </> : <div className="notes-gtd-folders">
            <button type="button" className={`notes-folder-row${selectedGtdStatus === "all" ? " active" : ""}`} onClick={() => setSelectedGtdStatus("all")}><span className="notes-folder-row-label">{t("desktop.common.all")}</span><span className="notes-folder-row-count">{gtdTasks.length}</span></button>
            {GTD_STATUSES.filter((status) => status !== "done").map((gtdStatus) => <button type="button" className={`notes-folder-row wb-gtd-folder-row${selectedGtdStatus === gtdStatus ? " active" : ""}`} key={gtdStatus} onClick={() => setSelectedGtdStatus(gtdStatus)}><span className={`wb-gtd-status-dot is-${gtdStatus}`} aria-hidden="true" /><span className="notes-folder-row-label">{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</span><span className="notes-folder-row-count">{gtdStatusCounts.get(gtdStatus) || 0}</span></button>)}
            <div className="wb-gtd-completed-group"><button type="button" className="notes-folder-row wb-gtd-folder-row wb-gtd-completed-toggle" aria-expanded={completedGtdExpanded} onClick={() => setCompletedGtdExpanded((value) => !value)}><ChevronRight className={completedGtdExpanded ? "is-expanded" : ""} size={14} aria-hidden="true" /><span className="notes-folder-row-label">{t("desktop.workbench.gtdCompleted")}</span><span className="notes-folder-row-count">{gtdStatusCounts.get("done") || 0}</span></button>{completedGtdExpanded ? <button type="button" className={`notes-folder-row wb-gtd-folder-row wb-gtd-completed-child${selectedGtdStatus === "done" ? " active" : ""}`} onClick={() => setSelectedGtdStatus("done")}><span className="wb-gtd-status-dot is-done" aria-hidden="true" /><span className="notes-folder-row-label">{t("desktop.workbench.gtdStatus.done")}</span><span className="notes-folder-row-count">{gtdStatusCounts.get("done") || 0}</span></button> : null}</div>
          </div>}
        </aside>
        <PaneResizer label={t("desktop.workbench.resizeProjects")} onDelta={(delta) => setWidth("folders", delta)} />
        <aside className="notes-list-pane" style={{ width: listWidth }}>
          {sidebarView === "notes" ? <>
          <div className="notes-list-toolbar-wrap">
            <div ref={listSearchToolbarRef} className={`notes-list-search-wrap${listSearchOpen ? " is-search-open" : ""}`}>
              <button type="button" id="btnNotesToggleFolders" className={`sidebar-collapse-toggle${foldersCollapsed ? " is-active" : ""}`} aria-label={t(foldersCollapsed ? "desktop.common.showSidebar" : "desktop.common.hideSidebar")} title={t(foldersCollapsed ? "desktop.common.showSidebar" : "desktop.common.hideSidebar")} aria-expanded={!foldersCollapsed} onClick={toggleFolders}>
                <PanelRight size={17} />
              </button>
              <button ref={listSearchButtonRef} type="button" className={`notes-icon-btn notes-list-search-btn${listQuery && !listSearchOpen ? " has-query" : ""}`} aria-label={t("desktop.common.search")} title={t("desktop.common.search")} aria-expanded={listSearchOpen} aria-controls="notes-list-search" onClick={openListSearch}><Search size={15} /></button>
              <input ref={listSearchRef} id="notes-list-search" type="search" className="notes-search notes-list-search-input" aria-label={t("desktop.common.search")} placeholder={t("desktop.common.search")} value={listQuery} hidden={!listSearchOpen} autoComplete="off" spellCheck={false} onChange={(event) => setListQuery(event.target.value)} onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                if (listQuery.trim()) { setListQuery(""); return; }
                closeListSearch();
              }} onBlur={() => {
                window.setTimeout(() => {
                  if (!listSearchToolbarRef.current?.contains(document.activeElement)) setListSearchOpen(false);
                }, 0);
              }} />
              <SegmentedControl
                value={listFilter}
                options={["all", "pinned"] as const satisfies readonly ListFilter[]}
                onChange={setListFilter}
                getLabel={(filter) => t(`desktop.common.${filter}`)}
              />
            </div>
            {target ? <div className="notes-target-popover" role="dialog"><div className="notes-target-tabs">{(["library", "project", "session"] as Owner["scope"][]).map((scope) => <button type="button" className={target.owner.scope === scope ? "active" : ""} key={scope} onClick={() => { setTarget((current) => current ? { ...current, owner: { scope } } : current); setTargetQuery(""); }}>{t(scope === "library" ? "desktop.notes.targetLibrary" : scope === "project" ? "desktop.notes.targetProject" : "desktop.notes.targetSession")}</button>)}</div><input className="notes-target-search" value={targetQuery} onChange={(event) => setTargetQuery(event.target.value)} placeholder={t("desktop.notes.filterProjects")} autoFocus />
              {target.owner.scope === "library" ? <button type="button" className="notes-target-item" onClick={() => void applyTarget({ scope: "library" })}>{t("desktop.notes.targetLibrary")}</button> : <div className="notes-target-list">{target.owner.scope === "project" ? targetProjects.map((project) => <button type="button" className="notes-target-item" key={project.path} onClick={() => void applyTarget({ scope: "project", projectPath: project.path })}>{project.label}</button>) : targetSessions.map((session) => <button type="button" className="notes-target-item" key={sessionKey(session)} onClick={() => void applyTarget({ scope: "session", provider: session.provider, sessionId: session.id, projectPath: session.projectPath })}>{session.title || session.id}</button>)}</div>}
              <button type="button" className="notes-icon-btn" aria-label={t("desktop.common.close")} onClick={() => setTarget(null)}><X size={15} /></button>
            </div> : null}
          </div>
          <div className="notes-list-meta-row"><p className="notes-list-meta">{listQuery ? t("desktop.notes.listMetaSearch", folderLabel(folder, aliases, t), listQuery, visibleNotes.length) : listFilter === "pinned" ? t("desktop.notes.listMetaFilter", folderLabel(folder, aliases, t), t("desktop.common.pinned"), visibleNotes.length) : t("desktop.notes.listMeta", folderLabel(folder, aliases, t), visibleNotes.length)}</p><button type="button" className="notes-icon-btn" aria-label={t("desktop.common.newNote")} title={t("desktop.common.newNote")} onClick={() => beginTarget("create")}><FilePlus2 size={12} /></button><button type="button" className="notes-icon-btn" aria-label={t("desktop.common.importMarkdown")} title={t("desktop.common.importMarkdown")} onClick={() => beginTarget("import")}><Upload size={12} /></button><button type="button" className="notes-icon-btn" aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")} onClick={() => void load()}><RefreshCw size={12} /></button></div>
          <div className="notes-list">{visibleNotes.length ? visibleNotes.map((note) => <button type="button" key={note.noteId} className={`notes-list-item${selected?.noteId === note.noteId ? " active" : ""}${pinnedNotes.has(note.noteId) ? " is-pinned" : ""}`} onClick={() => void open(note)} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ kind: "note", note, x: event.clientX, y: event.clientY }); }}><span className="notes-list-item-top"><span className="notes-list-item-title-wrap">{pinnedNotes.has(note.noteId) ? <Pin className="project-pin-icon" size={12} /> : null}<span className="notes-list-item-title">{titleFor(note)}</span></span><span className="notes-list-item-date">{new Date(note.updatedAtMs).toLocaleDateString()}</span></span><span className="notes-list-item-preview">{note.contentPreview || note.relDir}</span></button>) : <p className="muted notes-list-empty">{listQuery ? t("desktop.notes.noMatchingNotes") : listFilter === "pinned" ? t("desktop.notes.noFilterNotes") : t("desktop.notes.noNotesInFolder")}</p>}</div>
          </> : <>
            <div className="notes-list-toolbar-wrap notes-gtd-list-toolbar"><label className="notes-gtd-search-wrap"><Search size={15} aria-hidden="true" /><input type="search" className="notes-search" aria-label={t("desktop.notes.searchGtd")} placeholder={t("desktop.notes.searchGtd")} value={gtdQuery} onChange={(event) => setGtdQuery(event.target.value)} autoComplete="off" spellCheck={false} /></label></div>
            <div className="notes-list-meta-row"><p className="notes-list-meta">{t("desktop.notes.gtdListMeta", visibleGtdTasks.length)}</p><button type="button" className="notes-icon-btn" aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")} onClick={() => void load()}><RefreshCw size={12} /></button></div>
            <div className="notes-list notes-gtd-list">{visibleGtdTasks.length ? visibleGtdTasks.map((task) => <button type="button" key={`${task.noteId}:${task.line}`} className={`notes-list-item notes-gtd-list-item is-${task.status}${task.status === "done" ? " is-completed" : ""}`} onClick={() => openGtdTask(task)}><span className="notes-list-item-top"><span className="notes-list-item-title-wrap"><span className={`wb-gtd-status-dot is-${task.status}`} aria-hidden="true" /><span className="notes-list-item-title">{task.text}</span></span></span><span className="notes-list-item-preview">{task.noteTitle} · {task.relMdPath}</span></button>) : <p className="muted notes-list-empty">{t("desktop.notes.noGtdTasks")}</p>}</div>
          </>}
        </aside>
        <PaneResizer label={t("desktop.workbench.resizeSessions")} onDelta={(delta) => setWidth("list", delta)} />
        <main className="notes-detail">
          {selected ? <div className="notes-editor-shell"><div className="notes-detail-head">{editingTitle ? <form onSubmit={(event) => { event.preventDefault(); void rename(); }}><input className="notes-detail-title-input" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /><button type="submit" className="notes-icon-btn" aria-label={t("desktop.common.confirm")}><Save size={15} /></button></form> : <h1 className="notes-detail-title" onDoubleClick={() => setEditingTitle(true)}>{title}</h1>}<div className="notes-segmented" role="tablist"><button type="button" role="tab" className={view === "edit" ? "active" : ""} aria-label={t("desktop.common.edit")} onClick={() => setView("edit")}><Pencil size={16} /></button><button type="button" role="tab" className={view === "view" ? "active" : ""} aria-label={t("desktop.common.view")} onClick={() => { void save(); setView("view"); }}><Eye size={16} /></button><button type="button" className="notes-icon-btn" aria-label={t("desktop.notes.findInNote")} onClick={() => setFindOpen(true)}><Search size={15} /></button><button type="button" className="notes-icon-btn" aria-label={t("desktop.notes.copyPath")} onClick={() => void desktopApi().notesCopyPath({ noteId: selected.noteId })}><Clipboard size={15} /></button><button type="button" className="notes-icon-btn" aria-label={t("desktop.common.revealInFinder")} onClick={() => void desktopApi().notesReveal({ noteId: selected.noteId })}><FolderOpen size={15} /></button><button type="button" className="notes-icon-btn" aria-label={t("desktop.notes.deleteNote")} onClick={() => void remove()}><Trash2 size={15} /></button></div></div>
            {findOpen ? <div className="notes-find-bar"><input ref={findRef} className="notes-find-input" value={findQuery} onChange={(event) => { setFindQuery(event.target.value); setFindMatch(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); find(event.shiftKey ? "backward" : "forward"); } if (event.key === "Escape") setFindOpen(false); }} /><span className={`notes-find-count${findMatch === false ? " is-empty" : ""}`}>{findMatch === null ? "" : findMatch ? "1" : "0"}</span><button type="button" className="notes-find-btn" aria-label={t("desktop.common.closeFind")} onClick={() => find("backward")}><ChevronLeft size={15} /></button><button type="button" className="notes-find-btn" aria-label={t("desktop.common.closeFind")} onClick={() => find("forward")}><ChevronRight size={15} /></button><button type="button" className="notes-find-btn" aria-label={t("desktop.common.closeFind")} onClick={() => setFindOpen(false)}><X size={15} /></button></div> : null}
            {view === "edit" ? <CodeEditor ref={editorRef} className="notes-editor-host" value={content} language="markdown" ariaLabel={t("desktop.notes.editorPlaceholder")} onChange={editContent} onBlur={() => void save()} shouldHandlePaste={() => desktopApi().notesClipboardHasImage()} onPasteImage={pasteImage} slashCommands={gtdSlashCommands} /> : <div className="notes-preview markdown-body" onClick={(event) => { if (event.target instanceof HTMLImageElement) setImagePreview(event.target.src); }} dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />}
          </div> : <div className="notes-empty-state"><p className="muted notes-hint">{t("desktop.notes.selectOrCreate")}</p><button type="button" className="tool-btn" onClick={() => void desktopApi().notesOpenFolder()}>{t("desktop.common.revealInFinder")}</button></div>}
          <Status kind={status.kind}>{status.text}</Status>
        </main>
      </div>
      {contextMenu ? <div className="notes-context-menu" role="menu" style={{ left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 220)), top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 260)) }} onContextMenu={(event) => event.preventDefault()}>
        {contextMenu.kind === "project" ? <>
          <button type="button" role="menuitem" onClick={() => { void togglePinnedProject(contextMenu.projectPath, contextMenu.projectId); setContextMenu(null); }}>{t(
            (contextMenu.projectId && catalogProjects.some((item) => item.projectId === contextMenu.projectId && item.pinned))
              || pinnedProjects.has(contextMenu.projectPath)
              || (contextMenu.projectId ? pinnedProjects.has(contextMenu.projectId) : false)
              ? "desktop.notes.unpinProject"
              : "desktop.notes.pinProject"
          )}</button>
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" onClick={() => { beginTarget("create", undefined, { scope: "project", projectPath: contextMenu.projectPath }); setContextMenu(null); }}>{t("desktop.common.newNote")}</button>
          <button type="button" role="menuitem" onClick={() => { beginTarget("import", undefined, { scope: "project", projectPath: contextMenu.projectPath }); setContextMenu(null); }}>{t("desktop.common.importMarkdown")}</button>
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" onClick={() => { setRenameDialog({ kind: "project", projectPath: contextMenu.projectPath, projectId: contextMenu.projectId, title: aliases[contextMenu.projectPath] || basename(contextMenu.projectPath) }); setContextMenu(null); }}>{t("desktop.notes.renameProject")}</button>
          {contextMenu.projectId && typeof desktopApi().pickProjectLocalPath === "function" ? <button type="button" role="menuitem" onClick={() => { void desktopApi().pickProjectLocalPath({ projectId: contextMenu.projectId!, title: t("desktop.workbench.setLocalFolderTitle") }).then((result) => { if (result.ok) { setStatus({ text: t("desktop.workbench.localPathSet", result.absolutePath) }); void load(); } }).catch((error) => setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" })); setContextMenu(null); }}>{t("desktop.workbench.setLocalFolder")}</button> : null}
          {typeof desktopApi().copyProjectLocalPath === "function" ? <button type="button" role="menuitem" onClick={() => { void desktopApi().copyProjectLocalPath({ projectId: contextMenu.projectId, projectPath: contextMenu.projectPath }).then((result) => setStatus({ text: t("desktop.workbench.pathCopied", result.path) })).catch((error) => setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" })); setContextMenu(null); }}>{t("desktop.workbench.copyLocalPath")}</button> : null}
          {typeof desktopApi().revealProjectInFinder === "function" ? <button type="button" role="menuitem" onClick={() => { void desktopApi().revealProjectInFinder({ projectId: contextMenu.projectId, projectPath: contextMenu.projectPath }).catch((error) => setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" })); setContextMenu(null); }}>{t("desktop.common.revealInFinder")}</button> : null}
          {typeof desktopApi().hideProject === "function" ? <><div className="context-menu-separator" role="separator" /><button type="button" role="menuitem" className="context-menu-item-danger" onClick={() => {
            const label = aliases[contextMenu.projectPath] || basename(contextMenu.projectPath);
            if (!window.confirm(t("desktop.workbench.removeProjectConfirm", label, 0))) { setContextMenu(null); return; }
            void desktopApi().hideProject({ projectId: contextMenu.projectId, projectPath: contextMenu.projectPath }).then(() => load()).catch((error) => setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }));
            setContextMenu(null);
          }}>{t("desktop.workbench.removeProjectFromPanel")}</button></> : null}
        </> : <>
          <button type="button" role="menuitem" onClick={() => { togglePinnedNote(contextMenu.note.noteId); setContextMenu(null); }}>{t(pinnedNotes.has(contextMenu.note.noteId) ? "desktop.notes.unpinNote" : "desktop.notes.pinNote")}</button>
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" onClick={() => { beginTarget("move", contextMenu.note); setContextMenu(null); }}><span>{t("desktop.notes.changeOwner")}</span><ChevronRight className="context-menu-chevron" size={14} aria-hidden="true" /></button>
          <button type="button" role="menuitem" onClick={() => { setRenameDialog({ kind: "note", note: contextMenu.note, title: titleFor(contextMenu.note) }); setContextMenu(null); }}>{t("desktop.common.rename")}</button>
          <button type="button" role="menuitem" onClick={() => { void desktopApi().notesReveal({ noteId: contextMenu.note.noteId }); setContextMenu(null); }}>{t("desktop.common.revealInFinder")}</button>
          <><div className="context-menu-separator" role="separator" /><button type="button" role="menuitem" className="context-menu-item-danger" onClick={() => { void remove(contextMenu.note); setContextMenu(null); }}>{t("desktop.notes.deleteNote")}</button></>
        </>}
      </div> : null}
      {renameDialog ? <div className="wb-note-created-overlay"><div className="wb-note-created-backdrop" onClick={() => setRenameDialog(null)} /><form className="wb-note-created-panel" role="dialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); void applyRenameDialog(); }}><p className="wb-note-created-title">{t(renameDialog.kind === "project" ? "desktop.notes.renameProject" : "desktop.common.rename")}</p><input className="wb-rename-input" autoFocus value={renameDialog.title} onChange={(event) => setRenameDialog((current) => current ? { ...current, title: event.target.value } : current)} /><div className="wb-note-created-actions"><button type="button" className="wb-note-created-btn" onClick={() => setRenameDialog(null)}>{t("desktop.common.cancel")}</button><button type="submit" className="wb-note-created-btn primary">{t("desktop.common.confirm")}</button></div></form></div> : null}
      {imagePreview ? <div className="notes-image-preview" role="dialog" aria-modal="true" onClick={() => setImagePreview("")}><img src={imagePreview} alt="" /><button type="button" className="notes-image-preview-close" aria-label={t("desktop.common.close")} onClick={() => setImagePreview("")}><X size={16} /></button></div> : null}
    </section>, host
  );
}
