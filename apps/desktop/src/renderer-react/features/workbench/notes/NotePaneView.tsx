import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { ResizeHandle } from "../../../components/ResizeHandle";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GtdStatus } from "@agent-resume/core";
import { desktopApi } from "../../../bridge";
import { confirmDestructive } from "../../../confirmAction";
import { CodeEditor, type CodeEditorHandle, type CodeEditorSearchResult } from "../../../components/CodeEditor";
import { StreamdownRenderer } from "../../../components/StreamdownRenderer";
import { posixDirname, posixJoin } from "../../../components/markdownImage";
import { DESKTOP_GTD_STATUSES, desktopGtdColumn } from "../../../gtd";
import { useI18n } from "../../../i18n";
import { notifyDesktop } from "../../../components/Notifications";
import { useOverlayState } from "../../../components/useOverlayMotion";
import { useMenuKeyboard, useMenuPosition } from "../../../components/menuOverlay";
import { SelectionSendMenu, type SelectionSendMenuState } from "../../../selection/SelectionSendMenu";
import { NoteLinkTree } from "./NoteLinkTree";

type Note = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesRead"]>>["record"];
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

const LINK_TREE_HEIGHT_KEY = "notes-link-tree-height";

function titleFor(note: Note): string {
  return note.title || note.filename.replace(/\.md$/i, "") || note.noteId;
}

/** Notes that can hold a link tree: project notes group notes per repository, tasks group notes per unit of work. */
function isLinkable(note: Note): boolean {
  return Boolean(note.work);
}

function storedLinkTreeHeight(): number {
  try {
    const raw = Number(localStorage.getItem(LINK_TREE_HEIGHT_KEY));
    return Number.isFinite(raw) && raw >= 120 && raw <= 520 ? raw : 220;
  } catch {
    return 220;
  }
}

const PREVIEW_SEARCH_HIGHLIGHT = "notes-search-match";
const PREVIEW_SEARCH_CURRENT_HIGHLIGHT = "notes-search-current";

type PreviewSearchSession = { query: string; matches: Range[]; currentIndex: number };
type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): boolean };

type ContextMenuState = { note: Note; x: number; y: number };
type RenameDialogState = { note: Note; title: string };

function previewHighlightRegistry(): HighlightRegistry | null {
  return ((globalThis as typeof globalThis & { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights) || null;
}

/** Collects case-insensitive matches across rendered text nodes without mutating Markdown HTML. */
function collectPreviewSearchRanges(root: HTMLElement | null, query: string): Range[] {
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

type NotePaneViewProps = {
  noteId: string;
  active: boolean;
  onOpenNote: (noteId: string) => void;
  onTitleChange: (noteId: string, title: string) => void;
  onDirtyChange?: (noteId: string, dirty: boolean) => void;
  /** Called after the pane's own note is deleted, so the host can close the tab. */
  onClose?: () => void;
};

export function NotePaneView({ noteId, active, onOpenNote, onTitleChange, onDirtyChange, onClose }: NotePaneViewProps): React.JSX.Element {
  const { t } = useI18n();
  const [record, setRecord] = useState<Note | null>(null);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [view, setView] = useState<"edit" | "view">("edit");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [subtree, setSubtree] = useState<NoteSubtree | null>(null);
  const [treeRootId, setTreeRootId] = useState<string | null>(null);
  const [linkedChildIds, setLinkedChildIds] = useState<Set<string>>(() => new Set());
  const [childCounts, setChildCounts] = useState<Record<string, number>>({});
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [panelHome, setPanelHome] = useState("");
  const [linkTreeHeight, setLinkTreeHeight] = useState(storedLinkTreeHeight);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResult, setFindResult] = useState<CodeEditorSearchResult | null>(null);
  const [contextMenu, setContextMenu, contextMenuClosing] = useOverlayState<ContextMenuState>();
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), [setContextMenu]);
  // A DOM menu (the GTD status grid has no NSMenu equivalent) still has to behave
  // like a macOS menu: measure it, flip it, and drive it from the keyboard.
  useMenuPosition(
    Boolean(contextMenu) && !contextMenuClosing,
    contextMenuRef,
    { x: contextMenu?.x ?? 0, y: contextMenu?.y ?? 0 }
  );
  useMenuKeyboard(Boolean(contextMenu) && !contextMenuClosing, contextMenuRef, closeContextMenu);
  const [renameDialog, setRenameDialog, renameDialogClosing] = useOverlayState<RenameDialogState>();
  const [imagePreview, setImagePreview, imagePreviewClosing] = useOverlayState<string>();
  const [selectionMenu, setSelectionMenu] = useState<SelectionSendMenuState | null>(null);

  const editorRef = useRef<CodeEditorHandle>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewSearchRef = useRef<PreviewSearchSession | null>(null);
  const previewSelectedRangeRef = useRef<Range | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const treeRootIdRef = useRef<string | null>(null);
  const contentRef = useRef(content);
  const recordRef = useRef<Note | null>(record);
  const dirtyRef = useRef(dirty);
  const viewRef = useRef(view);
  const findQueryRef = useRef(findQuery);
  contentRef.current = content;
  recordRef.current = record;
  dirtyRef.current = dirty;
  viewRef.current = view;
  findQueryRef.current = findQuery;
  treeRootIdRef.current = treeRootId;

  const setStatus = useCallback((text: string, kind: "error" | "ok" | "info" = "info") => {
    if (text) notifyDesktop({ text, kind });
  }, []);

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

  const persist = useCallback(async (): Promise<void> => {
    const note = recordRef.current;
    if (!note || !dirtyRef.current) return;
    const contentToSave = contentRef.current;
    setSaving(true);
    try {
      const updated = await desktopApi().notesWrite({ noteId: note.noteId, content: contentToSave });
      if (contentRef.current === contentToSave) {
        if (typeof updated.content === "string" && updated.content !== contentRef.current) {
          setContent(updated.content);
          contentRef.current = updated.content;
        }
        dirtyRef.current = false;
        setDirty(false);
        onDirtyChange?.(note.noteId, false);
      }
      // Content changed again while saving: stay dirty; the next debounce flushes it.
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [onDirtyChange]);

  const flushSave = useCallback(async (): Promise<void> => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    while (dirtyRef.current) {
      const before = contentRef.current;
      await persist();
      if (contentRef.current === before && dirtyRef.current) break;
    }
  }, [persist]);

  const hydrate = useCallback(async (result: { record: Note; content: string }) => {
    setRecord(result.record);
    setContent(result.content);
    contentRef.current = result.content;
    dirtyRef.current = false;
    setDirty(false);
    onDirtyChange?.(result.record.noteId, false);
    const nextTitle = titleFor(result.record);
    setTitle(nextTitle);
    onTitleChange(result.record.noteId, nextTitle);
    setEditingTitle(false);
    setView("edit");
    setFindOpen(false);
    setFindQuery("");
    setError("");
    if (isLinkable(result.record)) {
      let rootId: string | null = null;
      if (typeof desktopApi().notesResolveLinkRoot === "function") {
        rootId = (await desktopApi().notesResolveLinkRoot({ noteId: result.record.noteId })).rootNoteId;
      } else {
        rootId = result.record.noteId;
      }
      await loadSubtree(rootId);
    } else {
      setTreeRootId(null);
      setSubtree(null);
    }
    await refreshLinkMeta();
  }, [loadSubtree, onDirtyChange, onTitleChange, refreshLinkMeta]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void desktopApi().notesRead({ noteId }).then(async (result) => {
      if (cancelled) return;
      await hydrate(result);
      setLoading(false);
    }).catch((loadError) => {
      if (cancelled) return;
      setLoading(false);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  useEffect(() => {
    if (typeof desktopApi().getPanelHome !== "function") return;
    void desktopApi().getPanelHome().then((home) => {
      if (typeof home === "string") setPanelHome(home.replace(/\\/g, "/").replace(/\/$/, ""));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (typeof desktopApi().listProjectAliases !== "function") return;
    void desktopApi().listProjectAliases().then((next) => {
      if (next && typeof next === "object") setAliases(next);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onNotesMutated = () => {
      if (!recordRef.current) return;
      void refreshLinkMeta();
      // A child created elsewhere (e.g. the pane tab group “+”) must appear here.
      if (treeRootIdRef.current) void loadSubtree(treeRootIdRef.current);
    };
    window.addEventListener("agent-resume:notes-mutated", onNotesMutated);
    return () => window.removeEventListener("agent-resume:notes-mutated", onNotesMutated);
  }, [refreshLinkMeta, loadSubtree]);

  // Flush any pending buffer when the pane unmounts (tab closed / project switched).
  useEffect(() => () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (dirtyRef.current && recordRef.current) {
      void desktopApi().notesWrite({ noteId: recordRef.current.noteId, content: contentRef.current }).catch(() => undefined);
      dirtyRef.current = false;
    }
  }, []);

  const editContent = useCallback((value: string) => {
    setContent(value);
    contentRef.current = value;
    dirtyRef.current = true;
    setDirty(true);
    onDirtyChange?.(noteId, true);
    setError("");
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void persist();
    }, 600);
  }, [noteId, onDirtyChange, persist]);

  const runFind = useCallback((
    direction: "forward" | "backward",
    query = findQueryRef.current,
    reset = false
  ): CodeEditorSearchResult => {
    const q = query.trim();
    if (!q) {
      editorRef.current?.clearSearch();
      clearPreviewSearch(previewRef.current);
      previewSearchRef.current = null;
      setFindResult({ current: 0, total: 0 });
      return { current: 0, total: 0 };
    }
    if (viewRef.current === "view") {
      const previous = previewSearchRef.current;
      const reuse = !reset && previous?.query === q.trim().toLocaleLowerCase();
      const session = reuse && previous
        ? { ...previous, currentIndex: previous.currentIndex + (direction === "forward" ? 1 : -1) }
        : createPreviewSearchSession(previewRef.current, q, 0, previewSelectedRangeRef.current);
      if (session.matches.length) {
        session.currentIndex = ((session.currentIndex % session.matches.length) + session.matches.length) % session.matches.length;
      }
      previewSearchRef.current = session;
      const result = applyPreviewSearch(previewRef.current, session);
      setFindResult(result);
      window.requestAnimationFrame(() => findRef.current?.focus());
      return result;
    }
    const result = reset
      ? (editorRef.current?.setSearchQuery(q) ?? { current: 0, total: 0 })
      : (editorRef.current?.navigateSearch(direction) ?? { current: 0, total: 0 });
    setFindResult(result);
    window.requestAnimationFrame(() => findRef.current?.focus());
    return result;
  }, []);

  const openFind = useCallback(() => {
    if (loading || !record) return;
    const selectedText = view === "edit"
      ? (editorRef.current?.getSelectedText() || "")
      : (selectedPreviewRange(previewRef.current)?.toString() || "");
    previewSelectedRangeRef.current = view === "view" ? selectedPreviewRange(previewRef.current) : null;
    const query = selectedText.trim();
    if (query) {
      setFindQuery(query);
      findQueryRef.current = query;
      runFind("forward", query, true);
    } else if (findQueryRef.current.trim()) {
      runFind("forward", findQueryRef.current, true);
    }
    setFindOpen(true);
  }, [loading, record, runFind, view]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    findQueryRef.current = "";
    editorRef.current?.clearSearch();
    clearPreviewSearch(previewRef.current);
    previewSearchRef.current = null;
    setFindResult(null);
  }, []);

  useEffect(() => {
    if (!findOpen) return;
    window.requestAnimationFrame(() => findRef.current?.focus());
  }, [findOpen]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isFind = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f";
      if (isFind) {
        event.preventDefault();
        event.stopPropagation();
        openFind();
        return;
      }
      if (event.key !== "Escape" || !findOpen) return;
      event.preventDefault();
      event.stopPropagation();
      closeFind();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, closeFind, findOpen, openFind]);

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

  const openNoteContextMenu = useCallback((note: Note, clientX: number, clientY: number) => {
    setContextMenu({ note, x: clientX, y: clientY });
  }, []);

  const rename = async () => {
    const note = recordRef.current;
    const trimmed = title.trim();
    if (!note || !trimmed) return;
    try {
      const filename = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
      await desktopApi().notesRename({ noteId: note.noteId, filename });
      const next = await desktopApi().notesRead({ noteId: note.noteId });
      setRecord(next.record);
      setContent(next.content);
      contentRef.current = next.content;
      dirtyRef.current = false;
      setDirty(false);
      const nextTitle = titleFor(next.record);
      setTitle(nextTitle);
      onTitleChange(next.record.noteId, nextTitle);
      setEditingTitle(false);
      setStatus(t("desktop.common.rename"), "ok");
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
    }
  };

  const renameTreeNode = async (targetNoteId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    try {
      const filename = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
      await desktopApi().notesRename({ noteId: targetNoteId, filename });
      if (treeRootId) await loadSubtree(treeRootId);
      if (targetNoteId === recordRef.current?.noteId) {
        setTitle(trimmed);
        onTitleChange(targetNoteId, trimmed);
        setRecord((current) => current ? { ...current, title: trimmed, filename } : current);
      }
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
      throw renameError;
    }
  };

  const applyRenameDialog = async () => {
    if (!renameDialog || !renameDialog.title.trim()) return;
    try {
      const trimmed = renameDialog.title.trim();
      const filename = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
      await desktopApi().notesRename({ noteId: renameDialog.note.noteId, filename });
      if (renameDialog.note.noteId === recordRef.current?.noteId) {
        const next = await desktopApi().notesRead({ noteId: renameDialog.note.noteId });
        setRecord(next.record);
        setTitle(titleFor(next.record));
        onTitleChange(next.record.noteId, titleFor(next.record));
      }
      if (treeRootId) await loadSubtree(treeRootId);
      setRenameDialog(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
    }
  };

  const createLinkedChild = async (parent: Note) => {
    if (!isLinkable(parent)) {
      setStatus(t("desktop.notes.linkProjectOnly"), "error");
      return;
    }
    if (typeof desktopApi().notesCreateLinkedChild !== "function") {
      setStatus(t("desktop.notes.linkApiUnavailable"), "error");
      return;
    }
    try {
      setStatus(t("desktop.notes.creatingLinkedChild"));
      const created = await desktopApi().notesCreateLinkedChild({ parentNoteId: parent.noteId });
      await refreshLinkMeta();
      const rootId = treeRootId
        || (typeof desktopApi().notesResolveLinkRoot === "function"
          ? (await desktopApi().notesResolveLinkRoot({ noteId: parent.noteId })).rootNoteId
          : parent.noteId);
      await loadSubtree(rootId);
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      const createdResult = await desktopApi().notesRead({ noteId: created.noteId });
      setStatus(t("desktop.notes.linkedChildCreated", titleFor(createdResult.record)), "ok");
      onOpenNote(created.noteId);
    } catch (createError) {
      setStatus(createError instanceof Error ? createError.message : String(createError), "error");
    }
  };

  const remove = async (note: Note | null = recordRef.current) => {
    if (!note) return;
    const childCount = childCounts[note.noteId] ?? 0;
    const message = childCount > 0
      ? t("desktop.notes.deleteWithChildren", titleFor(note), childCount)
      : t("desktop.notes.deleteConfirm", titleFor(note));
    if (!(await confirmDestructive(message, t("desktop.common.delete")))) return;
    try {
      saveTimer.current !== null && window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      dirtyRef.current = false;
      setDirty(false);
      onDirtyChange?.(note.noteId, false);
      await desktopApi().notesDelete({ noteId: note.noteId });
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      const rootId = treeRootId;
      if (note.noteId === recordRef.current?.noteId) {
        setRecord(null);
        setContent("");
        onClose?.();
        return;
      }
      if (rootId && rootId !== note.noteId) {
        await loadSubtree(rootId);
        await refreshLinkMeta();
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const setNoteGtdStatus = async (note: Note, status: GtdStatus | null) => {
    try {
      const updated = await desktopApi().notesSetGtdStatus({ noteId: note.noteId, status });
      if (note.noteId === recordRef.current?.noteId) setRecord(updated);
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      setContextMenu(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : String(statusError));
    }
  };

  const openStandalone = async (targetNoteId: string) => {
    const api = desktopApi();
    if (typeof api.standaloneNoteOpen !== "function") {
      setStatus(t("desktop.notes.openStandaloneUnavailable"), "error");
      return;
    }
    try {
      await flushSave();
      await api.standaloneNoteOpen({ noteId: targetNoteId });
    } catch (openError) {
      setStatus(openError instanceof Error ? openError.message : String(openError), "error");
    }
  };

  const pasteImage = async (): Promise<string | null> => {
    const note = recordRef.current;
    if (!note) return null;
    try { return (await desktopApi().notesPasteImage({ noteId: note.noteId }))?.snippet || null; }
    catch (pasteError) { setStatus(pasteError instanceof Error ? pasteError.message : String(pasteError), "error"); return null; }
  };

  const selected = record;
  const treeRootSelectedId = selected?.noteId || "";
  const linkable = selected ? isLinkable(selected) && Boolean(subtree) : false;

  const previewImageOptions = useMemo(() => {
    if (!selected) return undefined;
    return panelHome
      ? {
        baseDir: posixDirname(posixJoin(panelHome, selected.relMdPath)),
        rootDir: posixJoin(panelHome, "notes")
      }
      : undefined;
  }, [panelHome, selected]);

  const previewImageLabels = useMemo(() => ({
    openInBrowser: t("desktop.markdown.openInBrowser"),
    unavailable: t("desktop.markdown.imageUnavailable"),
    remoteImage: t("desktop.markdown.remoteImage")
  }), [t]);

  const handlePreviewImageClick = useCallback((src: string) => setImagePreview(src), []);

  // Re-collect the find session when the rendered content changes underneath
  // an open find bar: React reconciliation replaces text nodes and the Range
  // objects held by the previous session go stale.
  useEffect(() => {
    if (!findOpen || viewRef.current !== "view" || !findQueryRef.current.trim()) return;
    runFind("forward", findQueryRef.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, previewImageOptions]);

  if (loading) {
    return <div className="notes-empty-state" role="status" aria-live="polite">
      <ThemeIcon name="loader" size={ICON_SIZE.default} className="spin" aria-hidden="true" />
      <p className="muted notes-hint">{t("desktop.common.loading")}</p>
    </div>;
  }

  if (!selected) {
    return <div className="notes-empty-state">
      <p className="muted notes-hint" role={error ? "alert" : undefined}>{error || t("desktop.notes.selectOrCreate")}</p>
      <button type="button" className="tool-btn" onClick={() => void desktopApi().notesOpenFolder()}>{t("desktop.common.revealInFinder")}</button>
    </div>;
  }

  return (
    <div className={`notes-detail wb-note-pane${active ? " is-active" : ""}`}>
      {linkable && subtree ? (
        <>
          <div className="notes-link-tree-panel" style={{ height: linkTreeHeight }} aria-label={t("desktop.notes.linkTree")}>
            <div className="notes-link-tree-head">
              <span className="notes-link-tree-label">{t("desktop.notes.linkTree")}</span>
              <button
                type="button"
                className="notes-icon-btn"
                aria-label={t("desktop.notes.newLinkedChild")}
                title={t("desktop.notes.newLinkedChild")}
                onClick={() => void createLinkedChild(selected)}
              >
                <ThemeIcon name="file-plus" size={ICON_SIZE.default} />
              </button>
            </div>
            <NoteLinkTree
              root={subtree.root}
              selectedNoteId={treeRootSelectedId}
              treeRootId={treeRootId || subtree.rootNoteId}
              aliases={aliases}
              onSelect={(targetNoteId) => { if (targetNoteId !== treeRootSelectedId) onOpenNote(targetNoteId); }}
              onReparent={(childNoteId, parentNoteId) => {
                void desktopApi().notesSetParent({ childNoteId, parentNoteId })
                  .then(() => { if (treeRootId) return loadSubtree(treeRootId); return undefined; })
                  .then(() => refreshLinkMeta())
                  .catch((reparentError: unknown) => setStatus(reparentError instanceof Error ? reparentError.message : String(reparentError), "error"));
              }}
              onRename={(targetNoteId, newTitle) => renameTreeNode(targetNoteId, newTitle)}
              onContextMenu={(targetNoteId, clientX, clientY) => {
                void desktopApi().notesRead({ noteId: targetNoteId }).then((result) => openNoteContextMenu(result.record, clientX, clientY)).catch(() => undefined);
              }}
              truncatedHint={t("desktop.notes.linkTreeTruncated")}
              detachLabel={t("desktop.notes.dragToDetach")}
              renameAriaLabel={t("desktop.common.rename")}
            />
          </div>
          <ResizeHandle
            orientation="horizontal"
            label={t("desktop.notes.resizeLinkTree")}
            onDelta={(delta) => {
              setLinkTreeHeight((previous) => {
                const next = Math.max(120, Math.min(520, previous + delta));
                try { localStorage.setItem(LINK_TREE_HEIGHT_KEY, String(next)); } catch { /* persistence is optional */ }
                return next;
              });
            }}
          />
        </>
      ) : null}
      <div className="notes-detail-head">
        {editingTitle
          ? <form onSubmit={(event) => { event.preventDefault(); void rename(); }}>
            <input className="notes-detail-title-input" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
            <button type="submit" className="notes-icon-btn" aria-label={t("desktop.common.confirm")}><ThemeIcon name="save" size={ICON_SIZE.default} /></button>
          </form>
          : <h1 className="notes-detail-title" onDoubleClick={() => setEditingTitle(true)} title={t("desktop.notes.dblClickEdit")}>{title}</h1>}
        <div className="notes-segmented" role="tablist">
          <button type="button" role="tab" className={view === "edit" ? "active" : ""} aria-label={t("desktop.common.edit")} onClick={() => setView("edit")}><ThemeIcon name="pencil" size={ICON_SIZE.dense} /></button>
          <button type="button" role="tab" className={view === "view" ? "active" : ""} aria-label={t("desktop.common.view")} onClick={() => { void flushSave(); setView("view"); }}><ThemeIcon name="eye" size={ICON_SIZE.dense} /></button>
          <button type="button" className="notes-icon-btn" aria-label={t("desktop.notes.findInNote")} onClick={openFind}><ThemeIcon name="search" size={ICON_SIZE.dense} /></button>
          <button type="button" className="notes-icon-btn" aria-label={t("desktop.notes.openAsFloating")} title={t("desktop.notes.openAsFloating")} onClick={() => void openStandalone(selected.noteId)}><ThemeIcon name="external-link" size={ICON_SIZE.dense} /></button>
          <button type="button" className="notes-icon-btn" aria-label={t("desktop.notes.copyPath")} onClick={() => void desktopApi().notesCopyPath({ noteId: selected.noteId })}><ThemeIcon name="clipboard" size={ICON_SIZE.dense} /></button>
          <button type="button" className="notes-icon-btn" aria-label={t("desktop.common.revealInFinder")} onClick={() => void desktopApi().notesReveal({ noteId: selected.noteId })}><ThemeIcon name="folder-open" size={ICON_SIZE.dense} /></button>
          <button type="button" className="notes-icon-btn" aria-label={t("desktop.notes.deleteNote")} onClick={() => void remove(selected)}><ThemeIcon name="trash" size={ICON_SIZE.dense} /></button>
        </div>
      </div>
      <div className="notes-editor-body">
        {findOpen ? (
          <div className="notes-find-bar app-inline-search" role="search">
            <ThemeIcon name="search" size={ICON_SIZE.default} aria-hidden="true" />
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
              {findQuery.trim() && findResult ? t("desktop.common.findCount", findResult.current, findResult.total) : ""}
            </span>
            <button type="button" className="notes-find-btn app-inline-search-btn" aria-label={t("desktop.common.findPrev")} onClick={() => runFind("backward")}><ThemeIcon name="arrow-up" size={ICON_SIZE.dense} /></button>
            <button type="button" className="notes-find-btn app-inline-search-btn" aria-label={t("desktop.common.findNext")} onClick={() => runFind("forward")}><ThemeIcon name="arrow-down" size={ICON_SIZE.dense} /></button>
            <button type="button" className="notes-find-btn app-inline-search-btn" aria-label={t("desktop.common.closeFind")} onClick={closeFind}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button>
          </div>
        ) : null}
        <div
          className="notes-editor-surface"
          onContextMenu={(event) => {
            const selectedText = view === "edit"
              ? editorRef.current?.getSelectedText() || ""
              : (selectedPreviewRange(previewRef.current)?.toString() || "");
            const text = selectedText.trim();
            if (!text) return;
            event.preventDefault();
            setSelectionMenu({
              x: event.clientX,
              y: event.clientY,
              text,
              ...(selected.projectPath ? { projectPath: selected.projectPath } : {})
            });
          }}
        >
          {view === "edit"
            ? <CodeEditor
              ref={editorRef}
              className="notes-editor-host"
              value={content}
              language="markdown"
              selectionProjectPath={selected.projectPath}
              ariaLabel={t("desktop.notes.editorPlaceholder")}
              onChange={editContent}
              onBlur={() => void flushSave()}
              shouldHandlePaste={() => desktopApi().notesClipboardHasImage()}
              onPasteImage={pasteImage}
            />
            : <div
              ref={previewRef}
              className="notes-preview"
            >
              <StreamdownRenderer
                className="notes-preview-body markdown-body"
                content={content}
                hardBreaks
                imageOptions={previewImageOptions}
                imageLabels={previewImageLabels}
                onImageClick={handlePreviewImageClick}
              />
            </div>}
        </div>
      </div>
      <footer className="wb-note-pane-foot" role="status" aria-live="polite">
        <span className={error ? "is-error" : undefined}>{error || (saving ? t("desktop.standaloneNote.saving") : dirty ? t("desktop.standaloneNote.unsaved") : t("desktop.standaloneNote.saved"))}</span>
      </footer>
      {selectionMenu ? <SelectionSendMenu menu={selectionMenu} onClose={() => setSelectionMenu(null)} /> : null}
      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className={`notes-context-menu${contextMenuClosing ? " is-closing" : ""}`}
          role="menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            visibility: "hidden"
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={() => { void openStandalone(contextMenu.note.noteId); setContextMenu(null); }}>{t("desktop.notes.openAsFloating")}</button>
          <div className="context-menu-separator" role="separator" />
          <div className="notes-context-menu-label">{t("desktop.notes.gtdStatusLabel")}</div>
          {DESKTOP_GTD_STATUSES.map((gtdStatus) => (
            <button type="button" role="menuitem" key={gtdStatus} className={desktopGtdColumn(contextMenu.note.gtdStatus) === gtdStatus ? "is-active" : ""} onClick={() => void setNoteGtdStatus(contextMenu.note, gtdStatus)}>
              <span className={`wb-gtd-status-dot is-${gtdStatus}`} aria-hidden="true" />
              {t(`desktop.workbench.gtdStatus.${gtdStatus}`)}
            </button>
          ))}
          {contextMenu.note.gtdStatus ? <button type="button" role="menuitem" onClick={() => void setNoteGtdStatus(contextMenu.note, null)}>{t("desktop.notes.clearGtdStatus")}</button> : null}
          {isLinkable(contextMenu.note) ? (
            <>
              <div className="context-menu-separator" role="separator" />
              <button type="button" role="menuitem" onClick={() => { void createLinkedChild(contextMenu.note); setContextMenu(null); }}>{t("desktop.notes.newLinkedChild")}</button>
              {linkedChildIds.has(contextMenu.note.noteId) ? (
                <button type="button" role="menuitem" onClick={() => {
                  const childId = contextMenu.note.noteId;
                  setContextMenu(null);
                  void desktopApi().notesSetParent({ childNoteId: childId, parentNoteId: null })
                    .then(() => loadSubtree(treeRootId))
                    .then(() => refreshLinkMeta())
                    .catch((reparentError: unknown) => setStatus(reparentError instanceof Error ? reparentError.message : String(reparentError), "error"));
                }}>{t("desktop.notes.clearParentLink")}</button>
              ) : null}
            </>
          ) : null}
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" onClick={() => { setRenameDialog({ note: contextMenu.note, title: titleFor(contextMenu.note) }); setContextMenu(null); }}>{t("desktop.common.rename")}</button>
          <button type="button" role="menuitem" onClick={() => { void desktopApi().notesReveal({ noteId: contextMenu.note.noteId }); setContextMenu(null); }}>{t("desktop.common.revealInFinder")}</button>
          <div className="context-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="context-menu-item-danger" onClick={() => { void remove(contextMenu.note); setContextMenu(null); }}>{t("desktop.notes.deleteNote")}</button>
        </div>
      ) : null}
      {renameDialog ? (
        <div className={`wb-note-created-overlay${renameDialogClosing ? " is-closing" : ""}`}>
          <div className="wb-note-created-backdrop" onClick={() => setRenameDialog(null)} />
          <form className="wb-note-created-panel" role="dialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); void applyRenameDialog(); }}>
            <p className="wb-note-created-title">{t("desktop.common.rename")}</p>
            <input className="wb-rename-input" autoFocus value={renameDialog.title} onChange={(event) => setRenameDialog((current) => current ? { ...current, title: event.target.value } : current)} />
            <div className="wb-note-created-actions">
              <button type="button" className="wb-note-created-btn" onClick={() => setRenameDialog(null)}>{t("desktop.common.cancel")}</button>
              <button type="submit" className="wb-note-created-btn primary">{t("desktop.common.confirm")}</button>
            </div>
          </form>
        </div>
      ) : null}
      {imagePreview ? (
        <div className={`notes-image-preview${imagePreviewClosing ? " is-closing" : ""}`} role="dialog" aria-modal="true" onClick={() => setImagePreview(null)}>
          <img src={imagePreview} alt="" />
          <button type="button" className="notes-image-preview-close" aria-label={t("desktop.common.close")} onClick={() => setImagePreview(null)}><ThemeIcon name="close" size={ICON_SIZE.default} /></button>
        </div>
      ) : null}
    </div>
  );
}
