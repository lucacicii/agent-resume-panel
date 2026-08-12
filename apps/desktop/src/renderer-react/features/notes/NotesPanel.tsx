import { ThemeIcon } from "../../components/ThemeIcon";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactPortal } from "react";
import type { AgentSession, GtdStatus } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { CodeEditor, type CodeEditorHandle, type CodeEditorSearchResult } from "../../components/CodeEditor";
import { renderMarkdown } from "../../components/Markdown";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Status, type StatusKind } from "../../components/Status";
import { GTD_STATUSES } from "../../gtd";
import { useI18n } from "../../i18n";
import { storedWidth } from "../../storage";
import { NoteLinkTree } from "./NoteLinkTree";

type Note = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesList"]>>[number];
type NoteTreeNode = {
  noteId: string;
  title: string;
  filename: string;
  projectPath?: string;
  children: NoteTreeNode[];
};
type NoteSubtree = {
  rootNoteId: string;
  root: NoteTreeNode;
  nodesById: Record<string, NoteTreeNode>;
  edges: Array<{ parentNoteId: string; childNoteId: string }>;
};
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
type ContextMenu =
  | { kind: "project"; projectPath: string; projectId?: string; x: number; y: number }
  | { kind: "note"; note: Note; x: number; y: number };
type RenameDialog = { kind: "project"; projectPath: string; projectId?: string; title: string } | { kind: "note"; note: Note; title: string };
type ParentPicker = { child: Note; query: string };

const PINNED_PROJECTS_KEY = "pinned-projects";
const PINNED_NOTES_KEY = "pinned-notes";
const FOLDERS_COLLAPSED_KEY = "notes-folders-collapsed";
const FOLDERS_WIDTH_KEY = "sidebar-folders-width";
const LIST_WIDTH_KEY = "notes-list-pane-width";
const LINK_TREE_HEIGHT_KEY = "notes-link-tree-height";
const SIDEBAR_VIEW_KEY = "notes-sidebar-view";
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

const PREVIEW_SEARCH_HIGHLIGHT = "notes-search-match";
const PREVIEW_SEARCH_CURRENT_HIGHLIGHT = "notes-search-current";

type PreviewSearchSession = {
  query: string;
  matches: Range[];
  currentIndex: number;
};

type HighlightRegistry = {
  set(name: string, value: unknown): void;
  delete(name: string): boolean;
};

function previewHighlightRegistry(): HighlightRegistry | null {
  return ((globalThis as typeof globalThis & { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights) || null;
}

/** Collects case-insensitive matches across rendered text nodes without mutating Markdown HTML. */
export function collectPreviewSearchRanges(root: HTMLElement | null, query: string): Range[] {
  if (!root) return [];
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  type Piece = { node: Text; start: number; end: number };
  const pieces: Piece[] = [];
  let full = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const value = node.data;
    if (value) {
      pieces.push({ node, start: full.length, end: full.length + value.length });
      full += value;
    }
    current = walker.nextNode();
  }
  if (!full) return [];

  const haystack = full.toLocaleLowerCase();
  const ranges: Range[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const match = haystack.indexOf(needle, from);
    if (match < 0) break;
    const matchEnd = match + needle.length;
    const startPiece = pieces.find((piece) => match >= piece.start && match < piece.end);
    const endPiece = pieces.find((piece) => matchEnd > piece.start && matchEnd <= piece.end)
      || pieces.find((piece) => matchEnd > piece.start && matchEnd - 1 < piece.end);
    if (startPiece && endPiece) {
      const range = document.createRange();
      range.setStart(startPiece.node, match - startPiece.start);
      range.setEnd(endPiece.node, matchEnd - endPiece.start);
      ranges.push(range);
    }
    from = match + Math.max(1, needle.length);
  }
  return ranges;
}

function clearPreviewSearch(root: HTMLElement | null): void {
  const registry = previewHighlightRegistry();
  registry?.delete(PREVIEW_SEARCH_HIGHLIGHT);
  registry?.delete(PREVIEW_SEARCH_CURRENT_HIGHLIGHT);
  const selection = window.getSelection();
  if (selection?.rangeCount && root?.contains(selection.anchorNode)) selection.removeAllRanges();
}

function applyPreviewSearch(root: HTMLElement | null, session: PreviewSearchSession): CodeEditorSearchResult {
  clearPreviewSearch(root);
  const current = session.matches[session.currentIndex];
  const HighlightConstructor = (globalThis as typeof globalThis & {
    Highlight?: new (...ranges: Range[]) => unknown;
  }).Highlight;
  const registry = previewHighlightRegistry();
  if (HighlightConstructor && registry && session.matches.length) {
    registry.set(PREVIEW_SEARCH_HIGHLIGHT, new HighlightConstructor(...session.matches));
    if (current) registry.set(PREVIEW_SEARCH_CURRENT_HIGHLIGHT, new HighlightConstructor(current));
  }
  if (current) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(current);
    const anchor = current.startContainer.parentElement || root;
    anchor?.scrollIntoView?.({ block: "center", inline: "nearest" });
  }
  return {
    current: current ? session.currentIndex + 1 : 0,
    total: session.matches.length
  };
}

function createPreviewSearchSession(
  root: HTMLElement | null,
  query: string,
  currentIndex = 0,
  selectedRange: Range | null = null
): PreviewSearchSession {
  const matches = collectPreviewSearchRanges(root, query);
  const selectedIndex = selectedRange ? matches.findIndex((match) =>
    match.startContainer === selectedRange.startContainer
      && match.startOffset === selectedRange.startOffset
      && match.endContainer === selectedRange.endContainer
      && match.endOffset === selectedRange.endOffset
  ) : -1;
  return {
    query: query.trim().toLocaleLowerCase(),
    matches,
    currentIndex: matches.length
      ? (selectedIndex >= 0 ? selectedIndex : Math.min(Math.max(0, currentIndex), matches.length - 1))
      : -1
  };
}

function selectedPreviewRange(root: HTMLElement | null): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount || !root?.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
  return selection.getRangeAt(0).cloneRange();
}

function PaneResizer({
  label,
  onDelta,
  orientation = "vertical"
}: {
  label: string;
  onDelta: (delta: number) => void;
  /** vertical = width (sidebar); horizontal = height (stacked panes). */
  orientation?: "vertical" | "horizontal";
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false);
  const horizontal = orientation === "horizontal";
  return <div
    className={`pane-resizer${horizontal ? " is-horizontal" : ""}${dragging ? " is-dragging" : ""}`}
    role="separator"
    aria-label={label}
    aria-orientation={horizontal ? "horizontal" : "vertical"}
    onPointerDown={(event) => {
      event.preventDefault();
      let previous = horizontal ? event.clientY : event.clientX;
      setDragging(true);
      document.body.classList.add("is-pane-resizing");
      if (horizontal) document.body.classList.add("is-pane-resizing-row");
      const move = (next: PointerEvent) => {
        const current = horizontal ? next.clientY : next.clientX;
        onDelta(current - previous);
        previous = current;
      };
      const end = () => {
        setDragging(false);
        document.body.classList.remove("is-pane-resizing");
        document.body.classList.remove("is-pane-resizing-row");
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
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Note | null>(null);
  /** Root note for the association tree (list selection). May differ from `selected` when browsing child nodes. */
  const [treeRootId, setTreeRootId] = useState<string | null>(null);
  const [subtree, setSubtree] = useState<NoteSubtree | null>(null);
  const [linkedChildIds, setLinkedChildIds] = useState<Set<string>>(() => new Set());
  const [childCounts, setChildCounts] = useState<Record<string, number>>({});
  const [parentPicker, setParentPicker] = useState<ParentPicker | null>(null);
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
  const [foldersWidth, setFoldersWidth] = useState(() => storedWidth(FOLDERS_WIDTH_KEY, 260, 140, 400));
  const [listWidth, setListWidth] = useState(() => storedWidth(LIST_WIDTH_KEY, 324, 240, 520));
  const [linkTreeHeight, setLinkTreeHeight] = useState(() => storedWidth(LINK_TREE_HEIGHT_KEY, 220, 120, 520));
  const [target, setTarget] = useState<TargetState | null>(null);
  const [targetQuery, setTargetQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialog | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResult, setFindResult] = useState<CodeEditorSearchResult | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const saveTimer = useRef<number | null>(null);
  const contentRef = useRef(content);
  const selectedRef = useRef<Note | null>(selected);
  const activeRef = useRef(active);
  activeRef.current = active;
  const editorRef = useRef<CodeEditorHandle>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewSearchRef = useRef<PreviewSearchSession | null>(null);
  const previewSelectedRangeRef = useRef<Range | null>(null);
  const listSearchRef = useRef<HTMLInputElement>(null);
  const listSearchButtonRef = useRef<HTMLButtonElement>(null);
  const listSearchToolbarRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef(view);
  const previousFindViewRef = useRef(view);
  const previousFindContentRef = useRef(content);
  viewRef.current = view;
  const findQueryRef = useRef(findQuery);
  findQueryRef.current = findQuery;
  contentRef.current = content;
  selectedRef.current = selected;
  const refreshLinkMeta = useCallback(async () => {
    const api = desktopApi();
    if (typeof api.notesListLinkedChildIds !== "function") {
      setLinkedChildIds(new Set());
      setChildCounts({});
      return;
    }
    const [childIds, counts] = await Promise.all([
      api.notesListLinkedChildIds(),
      typeof api.notesListChildCounts === "function" ? api.notesListChildCounts() : Promise.resolve({} as Record<string, number>)
    ]);
    setLinkedChildIds(new Set(childIds || []));
    setChildCounts(counts || {});
  }, []);

  const loadSubtree = useCallback(async (rootNoteId: string | null) => {
    if (!rootNoteId || typeof desktopApi().notesGetSubtree !== "function") {
      setSubtree(null);
      return;
    }
    try {
      const next = await desktopApi().notesGetSubtree({ rootNoteId }) as NoteSubtree;
      setSubtree(next);
      setTreeRootId(rootNoteId);
    } catch {
      setSubtree(null);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const listProjects = typeof desktopApi().listProjects === "function"
        ? desktopApi().listProjects()
        : Promise.resolve([] as CatalogProject[]);
      const [nextNotes, nextSessions, nextAliases, nextProjects] = await Promise.all([
        desktopApi().notesList(),
        desktopApi().listSessions(),
        desktopApi().listProjectAliases(),
        listProjects
      ]);
      setNotes(nextNotes);
      setSessions(nextSessions);
      setAliases(nextAliases);
      setCatalogProjects(nextProjects || []);
      setSelected((current) => current ? nextNotes.find((item) => item.noteId === current.noteId) || null : null);
      await refreshLinkMeta();
      setStatus({ text: "" });
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  }, [refreshLinkMeta]);

  const save = useCallback(async () => {
    const note = selectedRef.current;
    if (!note) return;
    try {
      const updated = await desktopApi().notesWrite({ noteId: note.noteId, content: contentRef.current });
      const nextContent = typeof updated.content === "string" ? updated.content : contentRef.current;
      if (typeof updated.content === "string" && updated.content !== contentRef.current) {
        setContent(updated.content);
      }
      setNotes((current) => current.map((item) => item.noteId === note.noteId
        ? { ...item, ...updated, contentPreview: nextContent.slice(0, 300) }
        : item));
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  }, [refreshLinkMeta]);

  const reloadSelectedContent = useCallback(async (noteId: string) => {
    const result = await desktopApi().notesRead({ noteId });
    if (selectedRef.current?.noteId === noteId) {
      setSelected(result.record);
      setContent(result.content);
      contentRef.current = result.content;
      setTitle(titleFor(result.record));
    }
    setNotes((current) => current.map((item) => item.noteId === noteId ? { ...item, ...result.record } : item));
    await refreshLinkMeta();
  }, [refreshLinkMeta]);

  /** Re-read disk when returning to Notes and discard any pending stale autosave. */
  const refreshFromDiskOnActivate = useCallback(async () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await load();
    const selectedId = selectedRef.current?.noteId;
    if (selectedId) {
      try {
        await reloadSelectedContent(selectedId);
      } catch {
        // Keep list refresh even if one note read fails.
      }
    }
  }, [load, reloadSelectedContent]);

  /** Open the shared note context menu from either the note list or link tree. */
  const openNoteContextMenu = useCallback(
    async (noteId: string, clientX: number, clientY: number) => {
      const existing = notes.find((item) => item.noteId === noteId);
      let note: Note | undefined = existing;
      if (!note) {
        try {
          const result = await desktopApi().notesRead({ noteId });
          note = result.record;
        } catch {
          return;
        }
      }
      setContextMenu({ kind: "note", note, x: clientX, y: clientY });
    },
    [notes]
  );

  const open = useCallback(async (note: Note, options?: { asTreeRoot?: boolean; treeRootId?: string }) => {
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

      const asTreeRoot = options?.asTreeRoot !== false && !options?.treeRootId;
      if (result.record.scope === "project") {
        let rootId = options?.treeRootId;
        if (!rootId && asTreeRoot) {
          if (typeof desktopApi().notesResolveLinkRoot === "function") {
            rootId = (await desktopApi().notesResolveLinkRoot({ noteId: result.record.noteId })).rootNoteId;
          } else {
            rootId = result.record.noteId;
          }
        }
        if (rootId) {
          await loadSubtree(rootId);
        }
      } else {
        setTreeRootId(null);
        setSubtree(null);
      }
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  }, [loadSubtree, save]);

  const openTreeNode = useCallback(async (noteId: string) => {
    const existing = notes.find((item) => item.noteId === noteId);
    if (existing) {
      await open(existing, { asTreeRoot: false, treeRootId: treeRootId || undefined });
      return;
    }
    try {
      const result = await desktopApi().notesRead({ noteId });
      await open(result.record, { asTreeRoot: false, treeRootId: treeRootId || undefined });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [notes, open, treeRootId]);

  useEffect(() => {
    const onTab = (event: Event) => {
      const show = (event as CustomEvent<string>).detail === "notes";
      setActive(show);
      if (show) void refreshFromDiskOnActivate();
    };
    const onOpen = (event: Event) => {
      const noteId = (event as CustomEvent<string>).detail;
      void desktopApi().notesRead({ noteId }).then(async (result) => {
        setFolder(result.record.scope === "project" && result.record.projectPath
          ? { kind: "project", projectPath: result.record.projectPath }
          : result.record.scope === "session" && result.record.provider && result.record.agentSessionId
            ? { kind: "session", provider: result.record.provider, sessionId: result.record.agentSessionId }
            : { kind: "library" });
        await open(result.record, { asTreeRoot: true });
      }).catch((error) => setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }));
    };
    const onWindowFocus = () => {
      if (activeRef.current) void refreshFromDiskOnActivate();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && activeRef.current) {
        void refreshFromDiskOnActivate();
      }
    };
    const onSessionsSynced = () => {
      if (!activeRef.current) return;
      const selectedId = selectedRef.current?.noteId;
      if (selectedId) void reloadSelectedContent(selectedId).catch(() => undefined);
    };
    window.addEventListener("agent-resume:tab-change", onTab);
    window.addEventListener("agent-resume:open-note", onOpen);
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const stopSessions =
      typeof desktopApi().onSessionsSynced === "function"
        ? desktopApi().onSessionsSynced(() => onSessionsSynced())
        : undefined;
    return () => {
      window.removeEventListener("agent-resume:tab-change", onTab);
      window.removeEventListener("agent-resume:open-note", onOpen);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      stopSessions?.();
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [open, refreshFromDiskOnActivate, reloadSelectedContent]);

  useEffect(() => {
    if (!treeRootId) return;
    void loadSubtree(treeRootId);
  }, [notes, treeRootId, loadSubtree]);

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

  const clearFindSearch = useCallback(() => {
    editorRef.current?.clearSearch();
    clearPreviewSearch(previewRef.current);
    previewSearchRef.current = null;
    setFindResult(null);
  }, []);

  const runFind = useCallback((
    direction: "forward" | "backward",
    query = findQueryRef.current,
    reset = false
  ) => {
    const q = query.trim();
    if (!q) {
      clearFindSearch();
      return { current: 0, total: 0 };
    }
    let result: CodeEditorSearchResult;
    if (viewRef.current === "edit") {
      result = reset
        ? (editorRef.current?.setSearchQuery(q) ?? { current: 0, total: 0 })
        : (editorRef.current?.navigateSearch(direction) ?? { current: 0, total: 0 });
    } else {
      const normalized = q.toLocaleLowerCase();
      let session = previewSearchRef.current;
      if (reset || !session || session.query !== normalized) {
        session = createPreviewSearchSession(previewRef.current, q, 0, previewSelectedRangeRef.current);
        previewSelectedRangeRef.current = null;
      } else if (session.matches.length) {
        const delta = direction === "forward" ? 1 : -1;
        session = { ...session, currentIndex: (session.currentIndex + delta + session.matches.length) % session.matches.length };
      }
      previewSearchRef.current = session;
      result = applyPreviewSearch(previewRef.current, session);
    }
    setFindResult(result);
    // Keep keyboard focus on the find field so Enter is not handled by CodeMirror.
    // rAF: selection updates can steal focus synchronously into contenteditable.
    window.requestAnimationFrame(() => findRef.current?.focus());
    return result;
  }, [clearFindSearch]);

  const openFind = useCallback(() => {
    if (!selectedRef.current) return;
    const selectedText = viewRef.current === "edit"
      ? editorRef.current?.getSelectedText() || ""
      : (() => {
        const range = selectedPreviewRange(previewRef.current);
        previewSelectedRangeRef.current = range;
        return range?.toString() || "";
      })();
    const query = selectedText.trim();
    if (query) {
      setFindQuery(query);
      findQueryRef.current = query;
      runFind("forward", query, true);
    } else if (findQueryRef.current.trim()) {
      runFind("forward", findQueryRef.current, true);
    }
    setFindOpen(true);
  }, [runFind]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    findQueryRef.current = "";
    previewSelectedRangeRef.current = null;
    clearFindSearch();
  }, [clearFindSearch]);

  useEffect(() => {
    if (!active || !selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isFind = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f";
      if (isFind) {
        event.preventDefault();
        event.stopPropagation();
        openFind();
        return;
      }
      if (!findOpen) return;

      // Capture-phase: even if CodeMirror stole focus after a match, Enter must
      // advance find — never insert a newline into the note body.
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        runFind(event.shiftKey ? "backward" : "forward");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeFind();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, selected, findOpen, openFind, closeFind, runFind]);

  useEffect(() => {
    if (previousFindViewRef.current === view) return;
    previousFindViewRef.current = view;
    if (!findOpen || !findQueryRef.current.trim()) return;
    editorRef.current?.clearSearch();
    clearPreviewSearch(previewRef.current);
    previewSearchRef.current = null;
    previewSelectedRangeRef.current = null;
    // Mode changes start a fresh search in the newly visible surface.
    window.requestAnimationFrame(() => runFind("forward", findQueryRef.current, true));
  }, [view, findOpen, runFind]);

  useEffect(() => {
    if (previousFindContentRef.current === content) return;
    previousFindContentRef.current = content;
    if (!findOpen || !findQueryRef.current.trim()) return;
    window.requestAnimationFrame(() => {
      if (viewRef.current === "edit") setFindResult(editorRef.current?.getSearchResult() ?? { current: 0, total: 0 });
      else runFind("forward", findQueryRef.current, true);
    });
  }, [content, findOpen, runFind]);

  useEffect(() => {
    closeFind();
  // Changing notes must discard the previous note's search session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.noteId]);

  const projects = useMemo(() => {
    if (catalogProjects.length) {
      const sessionsByProjectId = new Map<string, AgentSession[]>();
      const sessionsByPath = new Map<string, AgentSession[]>();
      for (const session of sessions) {
        if (session.projectId) {
          const group = sessionsByProjectId.get(session.projectId) || [];
          group.push(session);
          sessionsByProjectId.set(session.projectId, group);
        }
        if (session.projectPath) {
          const group = sessionsByPath.get(session.projectPath) || [];
          group.push(session);
          sessionsByPath.set(session.projectPath, group);
        }
      }
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
        const projectSessions = new Map<string, AgentSession>();
        for (const session of sessionsByProjectId.get(project.projectId) || []) projectSessions.set(sessionKey(session), session);
        for (const session of sessionsByPath.get(path) || []) projectSessions.set(sessionKey(session), session);
        if (project.localPath && project.localPath !== path) {
          for (const session of sessionsByPath.get(project.localPath) || []) projectSessions.set(sessionKey(session), session);
        }
        const projectSessionList = [...projectSessions.values()];
        return {
          id: project.projectId,
          path,
          pathMissing: project.pathMissing,
          portableKey: project.portableKey,
          label: project.alias || aliases[path] || basename(path),
          count: projectNotes.length,
          active: projectSessionList.some(activeSession),
          pinned: project.pinned === true || pinnedProjects.has(path) || pinnedProjects.has(project.projectId),
          updatedAt: Math.max(
            0,
            project.lastSeenAtMs || 0,
            project.updatedAtMs || 0,
            ...projectNotes.map((note) => note.updatedAtMs),
            ...projectSessionList.map((session) => session.updatedAt)
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

  const folderSessions = useMemo(() => {
    const sessionNoteKeys = new Set(notes.flatMap((note) =>
      note.scope === "session" && note.provider && note.agentSessionId
        ? [`${note.provider}:${note.agentSessionId}`]
        : []
    ));
    return sessions
      .filter((session) => sessionNoteKeys.has(sessionKey(session)))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [notes, sessions]);

  const visibleNotes = useMemo(() => notes.filter((note) => {
    // List shows only root/main notes: hide project notes that have a parent link.
    if (note.scope === "project" && linkedChildIds.has(note.noteId)) return false;
    const inFolder = folder.kind === "all"
      || (folder.kind === "library" && note.scope === "library")
      || (folder.kind === "project" && note.scope === "project" && note.projectPath === folder.projectPath)
      || (folder.kind === "session" && note.scope === "session" && note.provider === folder.provider && note.agentSessionId === folder.sessionId);
    const matchesQuery = `${titleFor(note)} ${note.filename} ${note.contentPreview || ""}`.toLocaleLowerCase().includes(listQuery.trim().toLocaleLowerCase());
    return inFolder && matchesQuery && (listFilter === "all" || pinnedNotes.has(note.noteId) || treeRootId === note.noteId || selected?.noteId === note.noteId);
  }).sort((left, right) => Number(pinnedNotes.has(right.noteId)) - Number(pinnedNotes.has(left.noteId)) || right.updatedAtMs - left.updatedAtMs), [folder, linkedChildIds, listFilter, listQuery, notes, pinnedNotes, selected?.noteId, treeRootId]);

  const parentPickerCandidates = useMemo(() => {
    if (!parentPicker) return [] as Note[];
    const childId = parentPicker.child.noteId;
    const query = parentPicker.query.trim().toLocaleLowerCase();
    return notes
      .filter((note) => note.scope === "project" && note.noteId !== childId)
      .filter((note) => {
        if (!query) return true;
        const hay = `${titleFor(note)} ${note.filename} ${note.projectPath || ""}`.toLocaleLowerCase();
        return hay.includes(query);
      })
      .sort((left, right) => {
        const sameLeft = left.projectPath === parentPicker.child.projectPath ? 1 : 0;
        const sameRight = right.projectPath === parentPicker.child.projectPath ? 1 : 0;
        return sameRight - sameLeft || right.updatedAtMs - left.updatedAtMs;
      });
  }, [notes, parentPicker]);

  const gtdStatusCounts = useMemo(() => {
    const counts = new Map<GtdStatus, number>(GTD_STATUSES.map((status) => [status, 0] as const));
    for (const note of notes) {
      if (note.gtdStatus) counts.set(note.gtdStatus, (counts.get(note.gtdStatus) || 0) + 1);
    }
    return counts;
  }, [notes]);

  const visibleGtdNotes = useMemo(() => {
    const query = gtdQuery.trim().toLocaleLowerCase();
    return notes
      .filter((note) => {
        const matchesStatus = selectedGtdStatus === "all" || note.gtdStatus === selectedGtdStatus;
        const searchable = `${titleFor(note)} ${note.filename} ${note.relMdPath} ${note.projectPath || ""} ${note.contentPreview || ""} ${note.gtdStatus || ""}`.toLocaleLowerCase();
        return note.gtdStatus && matchesStatus && (!query || searchable.includes(query));
      })
      .sort((left, right) => Number(right.gtdStatus === "done") - Number(left.gtdStatus === "done") || right.updatedAtMs - left.updatedAtMs || titleFor(left).localeCompare(titleFor(right)));
  }, [gtdQuery, notes, selectedGtdStatus]);

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

  const setLinkTreeHeightByDelta = (delta: number) => {
    setLinkTreeHeight((current) => {
      const next = Math.min(520, Math.max(120, current + delta));
      try { localStorage.setItem(LINK_TREE_HEIGHT_KEY, String(next)); } catch { /* persistence is optional */ }
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

  const openGtdNote = (note: Note) => {
    selectSidebarView("notes");
    void open(note);
  };

  const setNoteGtdStatus = async (note: Note, status: GtdStatus | null) => {
    try {
      const updated = await desktopApi().notesSetGtdStatus({ noteId: note.noteId, status });
      setNotes((current) => current.map((item) => item.noteId === note.noteId ? { ...item, ...updated } : item));
      setSelected((current) => current?.noteId === note.noteId ? { ...current, ...updated } : current);
      setContextMenu(null);
      setStatus({ text: "" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
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
        setTarget(null);
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
      if (target.action !== "create") setTarget(null);
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };

  const patchSubtreeTitle = (node: NoteSubtree["root"], noteId: string, nextTitle: string, nextFilename: string): NoteSubtree["root"] => {
    const children = node.children.map((child) => patchSubtreeTitle(child, noteId, nextTitle, nextFilename));
    if (node.noteId !== noteId) {
      return children === node.children ? node : { ...node, children };
    }
    return { ...node, title: nextTitle, filename: nextFilename, children };
  };

  const applyNoteRenameLocal = (noteId: string, nextTitle: string, nextFilename: string) => {
    setNotes((current) => current.map((note) => (
      note.noteId === noteId ? { ...note, filename: nextFilename, title: nextTitle } : note
    )));
    setSelected((current) => (
      current?.noteId === noteId ? { ...current, filename: nextFilename, title: nextTitle } : current
    ));
    if (selected?.noteId === noteId) {
      setTitle(nextTitle);
    }
    setSubtree((current) => {
      if (!current) return current;
      const root = patchSubtreeTitle(current.root, noteId, nextTitle, nextFilename);
      const prev = current.nodesById[noteId];
      return {
        ...current,
        root,
        nodesById: prev
          ? { ...current.nodesById, [noteId]: { ...prev, title: nextTitle, filename: nextFilename } }
          : current.nodesById
      };
    });
  };

  const rename = async () => {
    if (!selected || !title.trim()) return;
    try {
      const filename = title.trim().endsWith(".md") ? title.trim() : `${title.trim()}.md`;
      const result = await desktopApi().notesRename({ noteId: selected.noteId, filename });
      applyNoteRenameLocal(selected.noteId, title.trim(), result.filename);
      setEditingTitle(false);
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };

  const renameTreeNode = async (noteId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    try {
      const filename = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
      const result = await desktopApi().notesRename({ noteId, filename });
      applyNoteRenameLocal(noteId, trimmed, result.filename);
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
      throw error;
    }
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
    if (!note) return;
    const childCount = childCounts[note.noteId] ?? 0;
    const message = childCount > 0
      ? t("desktop.notes.deleteWithChildren", titleFor(note), childCount)
      : t("desktop.notes.deleteConfirm", titleFor(note));
    if (!window.confirm(message)) return;
    try {
      const { deletedNoteIds } = await desktopApi().notesDelete({ noteId: note.noteId });
      const deleted = new Set(deletedNoteIds);
      setPinnedNotes((current) => { const next = new Set(current); for (const id of deletedNoteIds) next.delete(id); savePinned(PINNED_NOTES_KEY, next); return next; });
      if (selected && deleted.has(selected.noteId)) {
        setSelected(null);
        setContent("");
        if (treeRootId && deleted.has(treeRootId)) {
          setTreeRootId(null);
          setSubtree(null);
        } else if (treeRootId) {
          await loadSubtree(treeRootId);
        }
      }
      await load();
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };

  const createLinkedChild = async (parent: Note) => {
    if (parent.scope !== "project") {
      setStatus({ text: t("desktop.notes.linkProjectOnly"), kind: "error" });
      return;
    }
    if (typeof desktopApi().notesCreateLinkedChild !== "function") {
      setStatus({ text: t("desktop.notes.linkApiUnavailable"), kind: "error" });
      return;
    }
    try {
      setStatus({ text: t("desktop.notes.creatingLinkedChild") });
      const created = await desktopApi().notesCreateLinkedChild({ parentNoteId: parent.noteId });
      await load();
      const rootId = treeRootId
        || (typeof desktopApi().notesResolveLinkRoot === "function"
          ? (await desktopApi().notesResolveLinkRoot({ noteId: parent.noteId })).rootNoteId
          : parent.noteId);
      await loadSubtree(rootId);
      const result = await desktopApi().notesRead({ noteId: created.noteId });
      await open(result.record, { asTreeRoot: false, treeRootId: rootId });
      setStatus({ text: t("desktop.notes.linkedChildCreated", titleFor(result.record)), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  };

  const applyParentLink = async (childNoteId: string, parentNoteId: string | null) => {
    if (typeof desktopApi().notesSetParent !== "function") {
      setStatus({ text: t("desktop.notes.linkApiUnavailable"), kind: "error" });
      return;
    }
    try {
      await desktopApi().notesSetParent({ childNoteId, parentNoteId });
      setParentPicker(null);
      await load();
      if (parentNoteId) {
        const rootId = typeof desktopApi().notesResolveLinkRoot === "function"
          ? (await desktopApi().notesResolveLinkRoot({ noteId: parentNoteId })).rootNoteId
          : parentNoteId;
        await loadSubtree(rootId);
        const result = await desktopApi().notesRead({ noteId: childNoteId });
        await open(result.record, { asTreeRoot: false, treeRootId: rootId });
      } else {
        const result = await desktopApi().notesRead({ noteId: childNoteId });
        await open(result.record, { asTreeRoot: true });
      }
      setStatus({ text: parentNoteId ? t("desktop.notes.parentLinkSet") : t("desktop.notes.parentLinkCleared"), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  };

  const pasteImage = async (): Promise<string | null> => {
    const note = selectedRef.current;
    if (!note) return null;
    try { return (await desktopApi().notesPasteImage({ noteId: note.noteId }))?.snippet || null; }
    catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); return null; }
  };

  const find = (direction: "forward" | "backward") => {
    runFind(direction);
  };

  if (!host) return null;

  // The folder-collapse toggle lives in the app header while Notes is active.
  const headerSlot = document.getElementById("app-header-slot");
  const collapseToggle = (
    <button type="button" id="btnNotesToggleFolders" className={`sidebar-collapse-toggle${foldersCollapsed ? " is-active" : ""}`} aria-label={t(foldersCollapsed ? "desktop.common.showSidebar" : "desktop.common.hideSidebar")} title={t(foldersCollapsed ? "desktop.common.showSidebar" : "desktop.common.hideSidebar")} aria-expanded={!foldersCollapsed} onClick={toggleFolders}>
      <ThemeIcon name="panel-right" size={17} />
    </button>
  );

  return createPortal(
    <section className="panel active notes-panel react-notes-panel" hidden={!active}>
      {active && headerSlot && sidebarView === "notes" ? createPortal(collapseToggle, headerSlot) : null}
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
              {project.pinned ? <ThemeIcon name="pin" className="project-pin-icon" size={12} /> : null}{project.active ? <span className="wb-folder-activity-dot" /> : null}<span className="notes-folder-row-text"><span className="notes-folder-row-label">{project.label}</span><span className="notes-folder-row-desc">{project.pathMissing ? t("desktop.workbench.pathMissingLabel", project.portableKey) : project.path}</span></span><span className="notes-folder-row-count">{project.count}</span>
            </button>) : <p className="muted notes-folders-empty">{t("desktop.notes.noMatchingProjects")}</p>}</section>
            <section className="notes-folder-section"><div className="notes-folder-section-label">{t("desktop.notes.sessionsSection")}</div>{folderSessions.map((session) => <button type="button" key={sessionKey(session)} className={`notes-folder-row${folder.kind === "session" && folder.provider === session.provider && folder.sessionId === session.id ? " active" : ""}`} onClick={() => selectFolder({ kind: "session", provider: session.provider, sessionId: session.id })}><span className="notes-folder-row-text"><span className="notes-folder-row-label">{session.title || session.id}</span><span className="notes-folder-row-desc">{session.provider}</span></span></button>)}</section>
          </div>
          </> : <div className="notes-gtd-folders">
            <button type="button" className={`notes-folder-row${selectedGtdStatus === "all" ? " active" : ""}`} onClick={() => setSelectedGtdStatus("all")}><span className="notes-folder-row-label">{t("desktop.common.all")}</span><span className="notes-folder-row-count">{notes.filter((note) => note.gtdStatus).length}</span></button>
            {GTD_STATUSES.filter((status) => status !== "done").map((gtdStatus) => <button type="button" className={`notes-folder-row wb-gtd-folder-row${selectedGtdStatus === gtdStatus ? " active" : ""}`} key={gtdStatus} onClick={() => setSelectedGtdStatus(gtdStatus)}><span className={`wb-gtd-status-dot is-${gtdStatus}`} aria-hidden="true" /><span className="notes-folder-row-label">{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</span><span className="notes-folder-row-count">{gtdStatusCounts.get(gtdStatus) || 0}</span></button>)}
            <div className="wb-gtd-completed-group"><button type="button" className="notes-folder-row wb-gtd-folder-row wb-gtd-completed-toggle" aria-expanded={completedGtdExpanded} onClick={() => setCompletedGtdExpanded((value) => !value)}><ThemeIcon name="chevron-right" className={completedGtdExpanded ? "is-expanded" : ""} size={14} aria-hidden="true" /><span className="notes-folder-row-label">{t("desktop.workbench.gtdCompleted")}</span><span className="notes-folder-row-count">{gtdStatusCounts.get("done") || 0}</span></button>{completedGtdExpanded ? <button type="button" className={`notes-folder-row wb-gtd-folder-row wb-gtd-completed-child${selectedGtdStatus === "done" ? " active" : ""}`} onClick={() => setSelectedGtdStatus("done")}><span className="wb-gtd-status-dot is-done" aria-hidden="true" /><span className="notes-folder-row-label">{t("desktop.workbench.gtdStatus.done")}</span><span className="notes-folder-row-count">{gtdStatusCounts.get("done") || 0}</span></button> : null}</div>
          </div>}
        </aside>
        <PaneResizer label={t("desktop.workbench.resizeProjects")} onDelta={(delta) => setWidth("folders", delta)} />
        <aside className={"notes-list-pane" + (target ? " is-target-open" : "")} style={{ width: listWidth }}>
          {sidebarView === "notes" ? <>
          <div className={`notes-list-toolbar-wrap${target ? " is-target-open" : ""}`}>
            <div ref={listSearchToolbarRef} className={`notes-list-search-wrap${listSearchOpen ? " is-search-open" : ""}`}>
              <button ref={listSearchButtonRef} type="button" className={`notes-icon-btn notes-list-search-btn${listQuery && !listSearchOpen ? " has-query" : ""}`} aria-label={t("desktop.common.search")} title={t("desktop.common.search")} aria-expanded={listSearchOpen} aria-controls="notes-list-search" onClick={openListSearch}><ThemeIcon name="search" size={15} /></button>
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
              <button type="button" className="notes-icon-btn" aria-label={t("desktop.common.close")} onClick={() => setTarget(null)}><ThemeIcon name="close" size={15} /></button>
            </div> : null}
          </div>
          <div className="notes-list-meta-row"><p className="notes-list-meta">{listQuery ? t("desktop.notes.listMetaSearch", folderLabel(folder, aliases, t), listQuery, visibleNotes.length) : listFilter === "pinned" ? t("desktop.notes.listMetaFilter", folderLabel(folder, aliases, t), t("desktop.common.pinned"), visibleNotes.length) : t("desktop.notes.listMeta", folderLabel(folder, aliases, t), visibleNotes.length)}</p><button type="button" className="notes-icon-btn" aria-label={t("desktop.common.newNote")} title={t("desktop.common.newNote")} onClick={() => beginTarget("create")}><ThemeIcon name="file-plus" size={12} /></button><button type="button" className="notes-icon-btn" aria-label={t("desktop.common.importMarkdown")} title={t("desktop.common.importMarkdown")} onClick={() => beginTarget("import")}><ThemeIcon name="upload" size={12} /></button><button type="button" className="notes-icon-btn" aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")} onClick={() => void load()}><ThemeIcon name="refresh" size={12} /></button></div>
          <div className="notes-list">{visibleNotes.length ? visibleNotes.map((note) => <button type="button" key={note.noteId} className={`notes-list-item${treeRootId === note.noteId || (!treeRootId && selected?.noteId === note.noteId) ? " active" : ""}${pinnedNotes.has(note.noteId) ? " is-pinned" : ""}`} onClick={() => void open(note, { asTreeRoot: true })} onContextMenu={(event) => { event.preventDefault(); void openNoteContextMenu(note.noteId, event.clientX, event.clientY); }}><span className="notes-list-item-top"><span className="notes-list-item-title-wrap">{pinnedNotes.has(note.noteId) ? <ThemeIcon name="pin" className="project-pin-icon" size={12} /> : null}{note.gtdStatus ? <span className={`wb-gtd-status-dot is-${note.gtdStatus}`} title={t(`desktop.workbench.gtdStatus.${note.gtdStatus}`)} aria-label={t(`desktop.workbench.gtdStatus.${note.gtdStatus}`)} /> : null}<span className="notes-list-item-title">{titleFor(note)}</span>{childCounts[note.noteId] ? <span className="notes-list-item-child-count" title={t("desktop.notes.linkedChildrenCount", childCounts[note.noteId])}>{childCounts[note.noteId]}</span> : null}</span><span className="notes-list-item-date">{new Date(note.updatedAtMs).toLocaleDateString()}</span></span><span className="notes-list-item-preview">{note.contentPreview || note.relDir}</span></button>) : <p className="muted notes-list-empty">{listQuery ? t("desktop.notes.noMatchingNotes") : listFilter === "pinned" ? t("desktop.notes.noFilterNotes") : t("desktop.notes.noNotesInFolder")}</p>}</div>
          </> : <>
            <div className="notes-list-toolbar-wrap notes-gtd-list-toolbar"><label className="notes-gtd-search-wrap"><ThemeIcon name="search" size={15} aria-hidden="true" /><input type="search" className="notes-search" aria-label={t("desktop.notes.searchGtdNotes")} placeholder={t("desktop.notes.searchGtdNotes")} value={gtdQuery} onChange={(event) => setGtdQuery(event.target.value)} autoComplete="off" spellCheck={false} /></label></div>
            <div className="notes-list-meta-row"><p className="notes-list-meta">{t("desktop.notes.gtdNotesListMeta", visibleGtdNotes.length)}</p><button type="button" className="notes-icon-btn" aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")} onClick={() => void load()}><ThemeIcon name="refresh" size={12} /></button></div>
            <div className="notes-list notes-gtd-list">{visibleGtdNotes.length ? visibleGtdNotes.map((note) => <button type="button" key={note.noteId} className={`notes-list-item notes-gtd-list-item is-${note.gtdStatus}${note.gtdStatus === "done" ? " is-completed" : ""}`} onClick={() => openGtdNote(note)}><span className="notes-list-item-top"><span className="notes-list-item-title-wrap"><span className={`wb-gtd-status-dot is-${note.gtdStatus}`} aria-hidden="true" /><span className="notes-list-item-title">{titleFor(note)}</span></span><span className="notes-list-item-date">{new Date(note.updatedAtMs).toLocaleDateString()}</span></span><span className="notes-list-item-preview">{note.relMdPath} · {t(`desktop.workbench.gtdStatus.${note.gtdStatus}`)}</span></button>) : <p className="muted notes-list-empty">{t("desktop.notes.noGtdNotes")}</p>}</div>
          </>}
        </aside>
        <PaneResizer label={t("desktop.workbench.resizeSessions")} onDelta={(delta) => setWidth("list", delta)} />
        <main className="notes-detail">
          {selected ? <div className="notes-editor-shell">
            {selected.scope === "project" && subtree ? (
              <>
                <div
                  className="notes-link-tree-panel"
                  style={{ height: linkTreeHeight }}
                  aria-label={t("desktop.notes.linkTree")}
                >
                  <div className="notes-link-tree-head">
                    <span className="notes-link-tree-label">{t("desktop.notes.linkTree")}</span>
                    <button
                      type="button"
                      className="notes-icon-btn"
                      aria-label={t("desktop.notes.newLinkedChild")}
                      title={t("desktop.notes.newLinkedChild")}
                      onClick={() => void createLinkedChild(selected)}
                    >
                      <ThemeIcon name="file-plus" size={14} />
                    </button>
                  </div>
                  <NoteLinkTree
                    root={subtree.root}
                    selectedNoteId={selected.noteId}
                    treeRootId={treeRootId || subtree.rootNoteId}
                    aliases={aliases}
                    onSelect={(noteId) => void openTreeNode(noteId)}
                    onReparent={(childNoteId, parentNoteId) => applyParentLink(childNoteId, parentNoteId)}
                    onRename={(noteId, newTitle) => renameTreeNode(noteId, newTitle)}
                    onContextMenu={(noteId, clientX, clientY) => void openNoteContextMenu(noteId, clientX, clientY)}
                    truncatedHint={t("desktop.notes.linkTreeTruncated")}
                    detachLabel={t("desktop.notes.dragToDetach")}
                    renameAriaLabel={t("desktop.common.rename")}
                  />
                </div>
                <PaneResizer
                  orientation="horizontal"
                  label={t("desktop.notes.resizeLinkTree")}
                  onDelta={setLinkTreeHeightByDelta}
                />
              </>
            ) : null}
            <div className="notes-detail-head">{editingTitle ? <form onSubmit={(event) => { event.preventDefault(); void rename(); }}><input className="notes-detail-title-input" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /><button type="submit" className="notes-icon-btn" aria-label={t("desktop.common.confirm")}><ThemeIcon name="save" size={15} /></button></form> : <h1 className="notes-detail-title" onDoubleClick={() => setEditingTitle(true)}>{title}</h1>}<div className="notes-segmented" role="tablist"><button type="button" role="tab" className={view === "edit" ? "active" : ""} aria-label={t("desktop.common.edit")} onClick={() => setView("edit")}><ThemeIcon name="pencil" size={16} /></button><button type="button" role="tab" className={view === "view" ? "active" : ""} aria-label={t("desktop.common.view")} onClick={() => { void save(); setView("view"); }}><ThemeIcon name="eye" size={16} /></button><button type="button" className="notes-icon-btn" aria-label={t("desktop.notes.findInNote")} onClick={openFind}><ThemeIcon name="search" size={15} /></button><button type="button" className="notes-icon-btn" aria-label={t("desktop.notes.copyPath")} onClick={() => void desktopApi().notesCopyPath({ noteId: selected.noteId })}><ThemeIcon name="clipboard" size={15} /></button><button type="button" className="notes-icon-btn" aria-label={t("desktop.common.revealInFinder")} onClick={() => void desktopApi().notesReveal({ noteId: selected.noteId })}><ThemeIcon name="folder-open" size={15} /></button><button type="button" className="notes-icon-btn" aria-label={t("desktop.notes.deleteNote")} onClick={() => void remove()}><ThemeIcon name="trash" size={15} /></button></div></div>
            <div className="notes-editor-body">
            {findOpen ? (
              <div className="notes-find-bar app-inline-search" role="search">
                <ThemeIcon name="search" size={14} aria-hidden="true" />
                <input
                  ref={findRef}
                  className="notes-find-input app-inline-search-input"
                  type="text"
                  value={findQuery}
                  placeholder={t("desktop.notes.findInNote")}
                  aria-label={t("desktop.notes.findInNote")}
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  onChange={(event) => {
                    const value = event.target.value;
                    setFindQuery(value);
                    findQueryRef.current = value;
                    previewSelectedRangeRef.current = null;
                    runFind("forward", value, true);
                  }}
                  onPaste={(event) => {
                    const value = event.clipboardData.getData("text/plain");
                    if (!value) return;
                    event.preventDefault();
                    setFindQuery(value);
                    findQueryRef.current = value;
                    previewSelectedRangeRef.current = null;
                    runFind("forward", value, true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      closeFind();
                    }
                  }}
                />
                <span className={`notes-find-count app-inline-search-meta${findResult?.total === 0 ? " is-empty" : ""}`} aria-live="polite">
                  {findQuery.trim() && findResult
                    ? t("desktop.common.findCount", findResult.current, findResult.total)
                    : ""}
                </span>
                <button
                  type="button"
                  className="notes-find-btn app-inline-search-btn"
                  aria-label={t("desktop.common.findPrev")}
                  onClick={() => find("backward")}
                >
                  <ThemeIcon name="arrow-up" size={14} />
                </button>
                <button
                  type="button"
                  className="notes-find-btn app-inline-search-btn"
                  aria-label={t("desktop.common.findNext")}
                  onClick={() => find("forward")}
                >
                  <ThemeIcon name="arrow-down" size={14} />
                </button>
                <button
                  type="button"
                  className="notes-find-btn app-inline-search-btn"
                  aria-label={t("desktop.common.closeFind")}
                  onClick={closeFind}
                >
                  <ThemeIcon name="close" size={14} />
                </button>
              </div>
            ) : null}
            {view === "edit" ? <CodeEditor ref={editorRef} className="notes-editor-host" value={content} language="markdown" ariaLabel={t("desktop.notes.editorPlaceholder")} onChange={editContent} onBlur={() => void save()} shouldHandlePaste={() => desktopApi().notesClipboardHasImage()} onPasteImage={pasteImage} /> : <div ref={previewRef} className="notes-preview markdown-body" onClick={(event) => { if (event.target instanceof HTMLImageElement) setImagePreview(event.target.src); }} dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />}
            </div>
          </div> : <div className="notes-empty-state"><p className="muted notes-hint">{t("desktop.notes.selectOrCreate")}</p><button type="button" className="tool-btn" onClick={() => void desktopApi().notesOpenFolder()}>{t("desktop.common.revealInFinder")}</button></div>}
          <Status kind={status.kind}>{status.text}</Status>
        </main>
      </div>
      {contextMenu ? <div className="notes-context-menu" role="menu" style={{ left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 220)), top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - (contextMenu.kind === "note" ? 520 : 260))) }} onContextMenu={(event) => event.preventDefault()}>
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
          <div className="notes-context-menu-label">{t("desktop.notes.gtdStatusLabel")}</div>
          {GTD_STATUSES.map((gtdStatus) => <button type="button" role="menuitem" key={gtdStatus} className={contextMenu.note.gtdStatus === gtdStatus ? "is-active" : ""} onClick={() => void setNoteGtdStatus(contextMenu.note, gtdStatus)}><span className={`wb-gtd-status-dot is-${gtdStatus}`} aria-hidden="true" />{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</button>)}
          {contextMenu.note.gtdStatus ? <button type="button" role="menuitem" onClick={() => void setNoteGtdStatus(contextMenu.note, null)}>{t("desktop.notes.clearGtdStatus")}</button> : null}
          {contextMenu.note.scope === "project" ? <>
            <div className="context-menu-separator" role="separator" />
            <button type="button" role="menuitem" onClick={() => { void createLinkedChild(contextMenu.note); setContextMenu(null); }}>{t("desktop.notes.newLinkedChild")}</button>
            <button type="button" role="menuitem" onClick={() => { setParentPicker({ child: contextMenu.note, query: "" }); setContextMenu(null); }}>{t("desktop.notes.setAsLinkedChild")}</button>
            {linkedChildIds.has(contextMenu.note.noteId) ? (
              <button type="button" role="menuitem" onClick={() => { void applyParentLink(contextMenu.note.noteId, null); setContextMenu(null); }}>{t("desktop.notes.clearParentLink")}</button>
            ) : null}
          </> : null}
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" onClick={() => { beginTarget("move", contextMenu.note); setContextMenu(null); }}><span>{t("desktop.notes.changeOwner")}</span><ThemeIcon name="chevron-right" className="context-menu-chevron" size={14} aria-hidden="true" /></button>
          <button type="button" role="menuitem" onClick={() => { setRenameDialog({ kind: "note", note: contextMenu.note, title: titleFor(contextMenu.note) }); setContextMenu(null); }}>{t("desktop.common.rename")}</button>
          <button type="button" role="menuitem" onClick={() => { void desktopApi().notesReveal({ noteId: contextMenu.note.noteId }); setContextMenu(null); }}>{t("desktop.common.revealInFinder")}</button>
          <><div className="context-menu-separator" role="separator" /><button type="button" role="menuitem" className="context-menu-item-danger" onClick={() => { void remove(contextMenu.note); setContextMenu(null); }}>{t("desktop.notes.deleteNote")}</button></>
        </>}
      </div> : null}
      {renameDialog ? <div className="wb-note-created-overlay"><div className="wb-note-created-backdrop" onClick={() => setRenameDialog(null)} /><form className="wb-note-created-panel" role="dialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); void applyRenameDialog(); }}><p className="wb-note-created-title">{t(renameDialog.kind === "project" ? "desktop.notes.renameProject" : "desktop.common.rename")}</p><input className="wb-rename-input" autoFocus value={renameDialog.title} onChange={(event) => setRenameDialog((current) => current ? { ...current, title: event.target.value } : current)} /><div className="wb-note-created-actions"><button type="button" className="wb-note-created-btn" onClick={() => setRenameDialog(null)}>{t("desktop.common.cancel")}</button><button type="submit" className="wb-note-created-btn primary">{t("desktop.common.confirm")}</button></div></form></div> : null}
      {parentPicker ? <div className="wb-note-created-overlay"><div className="wb-note-created-backdrop" onClick={() => setParentPicker(null)} /><div className="wb-note-created-panel notes-parent-picker-panel" role="dialog" aria-modal="true" aria-label={t("desktop.notes.setAsLinkedChild")}><p className="wb-note-created-title">{t("desktop.notes.setAsLinkedChild")}</p><p className="muted notes-parent-picker-hint">{t("desktop.notes.setAsLinkedChildHint", titleFor(parentPicker.child))}</p><input className="wb-rename-input" autoFocus value={parentPicker.query} placeholder={t("desktop.common.search")} onChange={(event) => setParentPicker((current) => current ? { ...current, query: event.target.value } : current)} /><div className="notes-parent-picker-list">{parentPickerCandidates.length ? parentPickerCandidates.map((note) => <button type="button" key={note.noteId} className="notes-parent-picker-item" onClick={() => void applyParentLink(parentPicker.child.noteId, note.noteId)}><span className="notes-parent-picker-item-title">{titleFor(note)}</span><span className="notes-parent-picker-item-meta">{note.projectPath ? (aliases[note.projectPath] || basename(note.projectPath)) : note.filename}</span></button>) : <p className="muted notes-list-empty">{t("desktop.notes.noMatchingNotes")}</p>}</div><div className="wb-note-created-actions"><button type="button" className="wb-note-created-btn" onClick={() => setParentPicker(null)}>{t("desktop.common.cancel")}</button></div></div></div> : null}
      {imagePreview ? <div className="notes-image-preview" role="dialog" aria-modal="true" onClick={() => setImagePreview("")}><img src={imagePreview} alt="" /><button type="button" className="notes-image-preview-close" aria-label={t("desktop.common.close")} onClick={() => setImagePreview("")}><ThemeIcon name="close" size={16} /></button></div> : null}
    </section>, host
  );
}
