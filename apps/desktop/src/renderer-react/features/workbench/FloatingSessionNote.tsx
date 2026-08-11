import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CodeEditor, type CodeEditorHandle } from "../../components/CodeEditor";
import { desktopApi } from "../../bridge";
import { GTD_STATUSES, type GtdStatus } from "../../gtd";
import { ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";

export interface FloatingSessionNoteTarget {
  provider: string;
  sessionId: string;
  projectPath: string;
  projectName?: string;
  sessionTitle: string;
}

export type FloatingNoteTarget =
  | FloatingSessionNoteTarget
  | { kind: "project"; projectPath: string; projectName?: string; initialGtdStatus: GtdStatus }
  | { kind: "library"; initialGtdStatus: GtdStatus };

type Note = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesList"]>>[number];

export function sessionNoteMatchesTarget(note: Note, target: FloatingSessionNoteTarget): boolean {
  return note.scope === "session"
    && note.provider === target.provider
    && note.agentSessionId === target.sessionId;
}

export function sessionNoteTitle(target: Pick<FloatingSessionNoteTarget, "projectName" | "projectPath" | "sessionTitle" | "sessionId">): string {
  const project = target.projectName?.trim()
    || target.projectPath.replaceAll("\\", "/").split("/").filter(Boolean).at(-1)
    || target.projectPath.trim();
  const session = target.sessionTitle.trim() || target.sessionId;
  return project && session ? `${project} · ${session}` : project || session;
}

export function initialSessionNoteContent(target: Pick<FloatingSessionNoteTarget, "projectName" | "projectPath" | "sessionTitle" | "sessionId">): string {
  const title = sessionNoteTitle(target);
  return `# ${title}\n\n`;
}

export function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function initialFloatingNoteContent(): string {
  return `# ${localDateString()}\n\n`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function basename(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

function isSessionTarget(target: FloatingNoteTarget): target is FloatingSessionNoteTarget {
  return !("kind" in target);
}

function floatingNoteOwnerLabel(target: FloatingNoteTarget, t: (key: string) => string): string {
  if (isSessionTarget(target)) {
    return target.projectName?.trim() || basename(target.projectPath) || target.projectPath;
  }
  if (target.kind === "project") {
    return target.projectName?.trim() || basename(target.projectPath) || target.projectPath;
  }
  return t("desktop.notes.librarySection");
}

function floatingNoteTitle(target: FloatingNoteTarget, t: (key: string) => string): string {
  if (isSessionTarget(target)) return sessionNoteTitle(target);
  return `${floatingNoteOwnerLabel(target, t)} · ${localDateString()}`;
}

function latestSessionNote(notes: Note[], target: FloatingSessionNoteTarget): Note | undefined {
  return notes
    .filter((note) => sessionNoteMatchesTarget(note, target))
    .sort((left, right) => (right.updatedAtMs || 0) - (left.updatedAtMs || 0)
      || (right.createdAtMs || 0) - (left.createdAtMs || 0))[0];
}

type FloatingNotePosition = { left: number; top: number };
type FloatingNoteDrag = {
  pointerId?: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

const FLOATING_NOTE_VIEWPORT_MARGIN = 8;

function clampFloatingNotePosition(
  left: number,
  top: number,
  width: number,
  height: number
): FloatingNotePosition {
  const maxLeft = Math.max(FLOATING_NOTE_VIEWPORT_MARGIN, window.innerWidth - width - FLOATING_NOTE_VIEWPORT_MARGIN);
  const maxTop = Math.max(FLOATING_NOTE_VIEWPORT_MARGIN, window.innerHeight - height - FLOATING_NOTE_VIEWPORT_MARGIN);
  return {
    left: Math.min(Math.max(FLOATING_NOTE_VIEWPORT_MARGIN, left), maxLeft),
    top: Math.min(Math.max(FLOATING_NOTE_VIEWPORT_MARGIN, top), maxTop)
  };
}

export function FloatingSessionNote({
  target,
  onClose
}: {
  target: FloatingNoteTarget;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const displayTitle = floatingNoteTitle(target, t);
  const ownerLabel = floatingNoteOwnerLabel(target, t);
  const secondaryLabel = isSessionTarget(target)
    ? target.sessionTitle.trim() || target.sessionId
    : localDateString();
  const [content, setContent] = useState("");
  const [noteId, setNoteId] = useState("");
  const [gtdStatus, setGtdStatus] = useState<GtdStatus | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<FloatingNotePosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const editorRef = useRef<CodeEditorHandle>(null);
  const noteRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<FloatingNoteDrag | null>(null);
  const contentRef = useRef(content);
  const initialContentRef = useRef("");
  const noteIdRef = useRef(noteId);
  const dirtyRef = useRef(dirty);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const loadSequenceRef = useRef(0);
  const closingRef = useRef(false);

  contentRef.current = content;
  noteIdRef.current = noteId;
  dirtyRef.current = dirty;

  const reportFocused = useCallback((focused: boolean) => {
    if (typeof window.agentResume.setFloatingNoteFocused === "function") {
      window.agentResume.setFloatingNoteFocused(focused);
    }
  }, []);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const persistOnce = useCallback((): Promise<boolean> => {
    const existing = saveInFlightRef.current;
    if (existing) return existing;
    const currentNoteId = noteIdRef.current;
    if (!currentNoteId || !dirtyRef.current) return Promise.resolve(true);
    const contentToSave = contentRef.current;
    let request = Promise.resolve(false);
    request = (async () => {
      setSaving(true);
      try {
        await desktopApi().notesWrite({ noteId: currentNoteId, content: contentToSave });
        if (contentRef.current === contentToSave) {
          dirtyRef.current = false;
          setDirty(false);
        }
        setError("");
        return true;
      } catch (saveError) {
        const message = t("desktop.workbench.floatingNoteSaveFailed", errorMessage(saveError));
        setError(message);
        return false;
      } finally {
        setSaving(false);
        if (saveInFlightRef.current === request) saveInFlightRef.current = null;
      }
    })();
    saveInFlightRef.current = request;
    return request;
  }, [t]);

  const flushSave = useCallback(async (): Promise<boolean> => {
    clearSaveTimer();
    if (!noteIdRef.current) return true;
    while (dirtyRef.current) {
      const saved = await persistOnce();
      if (!saved) return false;
    }
    return true;
  }, [clearSaveTimer, persistOnce]);

  const close = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const currentNoteId = noteIdRef.current;
    if (currentNoteId && (contentRef.current || "").trim() === (initialContentRef.current || "").trim()) {
      clearSaveTimer();
      try {
        const result = await desktopApi().notesDelete({ noteId: currentNoteId });
        if (!result.ok) throw new Error("Note deletion failed.");
        onClose();
        return;
      } catch (deleteError) {
        closingRef.current = false;
        setError(t("desktop.workbench.floatingNoteDeleteFailed", errorMessage(deleteError)));
        return;
      }
    }
    const saved = await flushSave();
    if (saved) {
      onClose();
      return;
    }
    closingRef.current = false;
  }, [clearSaveTimer, flushSave, onClose, t]);

  useEffect(() => {
    const sequence = ++loadSequenceRef.current;
    initialContentRef.current = isSessionTarget(target)
      ? initialSessionNoteContent(target)
      : initialFloatingNoteContent();
    clearSaveTimer();
    setLoading(true);
    setCreating(false);
    setSaving(false);
    setDeleting(false);
    setDirty(false);
    dirtyRef.current = false;
    setError("");
    setContent("");
    contentRef.current = "";
    setNoteId("");
    noteIdRef.current = "";
    setGtdStatus(undefined);
    closingRef.current = false;

    const load = async () => {
      try {
        if (isSessionTarget(target)) {
          const existing = latestSessionNote(await desktopApi().notesList(), target);
          if (existing) {
            const result = await desktopApi().notesRead({ noteId: existing.noteId });
            if (loadSequenceRef.current !== sequence) return;
            setNoteId(result.record.noteId);
            noteIdRef.current = result.record.noteId;
            setGtdStatus(result.record.gtdStatus);
            setContent(result.content);
            contentRef.current = result.content;
            setLoading(false);
            window.requestAnimationFrame(() => editorRef.current?.focus());
            return;
          }

          setCreating(true);
          const initial = initialSessionNoteContent(target);
          const created = await desktopApi().notesCreate({
            scope: "session",
            projectPath: target.projectPath,
            provider: target.provider,
            sessionId: target.sessionId
          });
          if (loadSequenceRef.current !== sequence) {
            void desktopApi().notesDelete({ noteId: created.noteId }).catch(() => undefined);
            return;
          }
          setNoteId(created.noteId);
          noteIdRef.current = created.noteId;
          setGtdStatus("inbox");
          setContent(initial);
          contentRef.current = initial;
          await desktopApi().notesWrite({ noteId: created.noteId, content: initial });
          const inboxRecord = await desktopApi().notesSetGtdStatus({ noteId: created.noteId, status: "inbox" });
          if (loadSequenceRef.current !== sequence) return;
          setGtdStatus(inboxRecord.gtdStatus);
          setCreating(false);
          setLoading(false);
          window.requestAnimationFrame(() => editorRef.current?.focus());
          return;
        }

        setCreating(true);
        const initial = initialFloatingNoteContent();
        const created = await desktopApi().notesCreate({
          scope: target.kind,
          projectPath: target.kind === "project" ? target.projectPath : undefined,
          body: initial
        });
        if (loadSequenceRef.current !== sequence) {
          void desktopApi().notesDelete({ noteId: created.noteId }).catch(() => undefined);
          return;
        }
        setNoteId(created.noteId);
        noteIdRef.current = created.noteId;
        setGtdStatus(target.initialGtdStatus);
        setContent(initial);
        contentRef.current = initial;
        const updated = await desktopApi().notesSetGtdStatus({ noteId: created.noteId, status: target.initialGtdStatus });
        if (loadSequenceRef.current !== sequence) return;
        setGtdStatus(updated.gtdStatus);
        setCreating(false);
        setLoading(false);
        window.requestAnimationFrame(() => editorRef.current?.focus());
      } catch (loadError) {
        if (loadSequenceRef.current !== sequence) return;
        setCreating(false);
        setLoading(false);
        setError(t("desktop.workbench.floatingNoteLoadError", errorMessage(loadError)));
      }
    };

    void load();
    return () => {
      clearSaveTimer();
      loadSequenceRef.current += 1;
    };
  }, [clearSaveTimer, t, target]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      void close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [close]);

  useEffect(() => () => {
    clearSaveTimer();
  }, [clearSaveTimer]);

  // Report the initial focus state (the editor auto-focuses after load via
  // onFocus) and clear it on unmount so main re-enables ⌘+Arrow pane navigation.
  useEffect(() => {
    reportFocused(noteRef.current?.contains(document.activeElement) === true);
    return () => reportFocused(false);
  }, [reportFocused]);

  const updateGtdStatus = async (status: GtdStatus | null) => {
    const currentNoteId = noteIdRef.current;
    if (!currentNoteId || loading || creating || deleting) return;
    try {
      const updated = await desktopApi().notesSetGtdStatus({ noteId: currentNoteId, status });
      setGtdStatus(updated.gtdStatus);
      setError("");
    } catch (statusError) {
      setError(t("desktop.workbench.gtdStatusSaveFailed", errorMessage(statusError)));
    }
  };

  const updateContent = (nextContent: string) => {
    setContent(nextContent);
    contentRef.current = nextContent;
    dirtyRef.current = true;
    setDirty(true);
    setError("");
    clearSaveTimer();
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave();
    }, 800);
  };

  const deleteNote = useCallback(async () => {
    const currentNoteId = noteIdRef.current;
    if (!currentNoteId || loading || creating || deleting) return;
    if (!window.confirm(t("desktop.notes.deleteConfirm", displayTitle))) return;
    setDeleting(true);
    clearSaveTimer();
    try {
      const pendingSave = saveInFlightRef.current;
      if (pendingSave) await pendingSave;
      const result = await desktopApi().notesDelete({ noteId: currentNoteId });
      if (!result.ok) throw new Error("Note deletion failed.");
      onClose();
    } catch (deleteError) {
      setDeleting(false);
      setError(t("desktop.workbench.floatingNoteDeleteFailed", errorMessage(deleteError)));
    }
  }, [clearSaveTimer, creating, deleting, displayTitle, loading, onClose, t]);

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button > 0 || (event.target instanceof Element && event.target.closest("button,select"))) return;
    const note = noteRef.current;
    if (!note) return;
    const rect = note.getBoundingClientRect();
    const width = rect.width || note.offsetWidth;
    const height = rect.height || note.offsetHeight;
    const current = clampFloatingNotePosition(rect.left, rect.top, width, height);
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - current.left,
      offsetY: event.clientY - current.top,
      width,
      height
    };
    setPosition(current);
    setDragging(true);
    event.preventDefault();
  };

  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || (drag.pointerId !== undefined && event.pointerId > 0 && event.pointerId !== drag.pointerId)) return;
      setPosition(clampFloatingNotePosition(
        event.clientX - drag.offsetX,
        event.clientY - drag.offsetY,
        drag.width,
        drag.height
      ));
    };
    const stopDragging = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || (drag.pointerId !== undefined && event.pointerId > 0 && event.pointerId !== drag.pointerId)) return;
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragging]);

  useEffect(() => () => {
    dragRef.current = null;
  }, []);

  return <section
    ref={noteRef}
    className={`wb-floating-note${dragging ? " is-dragging" : ""}`}
    style={position ? { left: `${position.left}px`, top: `${position.top}px`, right: "auto" } : undefined}
    role="dialog"
    aria-label={t("desktop.workbench.floatingNote")}
    onFocus={() => reportFocused(true)}
    onBlur={(event) => {
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (!(next && noteRef.current?.contains(next))) reportFocused(false);
    }}
  >
    <header className="wb-floating-note-head" onPointerDown={onHeaderPointerDown}>
      <div className="wb-floating-note-heading">
        <strong title={ownerLabel}>{ownerLabel}</strong>
        <span title={displayTitle}>{secondaryLabel}</span>
      </div>
      <div className="wb-floating-note-actions">
        <select
          className="wb-floating-note-status"
          aria-label={t("desktop.workbench.setGtdStatus")}
          title={t("desktop.workbench.setGtdStatus")}
          value={gtdStatus ?? ""}
          disabled={!noteId || loading || creating || deleting}
          onChange={(event) => void updateGtdStatus(event.target.value ? event.target.value as GtdStatus : null)}
        >
          <option value="">{t("desktop.workbench.clearGtdStatus")}</option>
          {GTD_STATUSES.map((status) => <option value={status} key={status}>{t(`desktop.workbench.gtdStatus.${status}`)}</option>)}
        </select>
        <button
          type="button"
          className="wb-floating-note-close wb-floating-note-delete"
          aria-label={t("desktop.notes.deleteNote")}
          title={t("desktop.notes.deleteNote")}
          disabled={!noteId || loading || creating || deleting}
          onClick={() => void deleteNote()}
        >
          <ThemeIcon name="trash" size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="wb-floating-note-close"
          aria-label={t("desktop.workbench.floatingNoteClose")}
          title={t("desktop.workbench.floatingNoteClose")}
          disabled={deleting}
          onClick={() => void close()}
        >
          <ThemeIcon name="close" size={15} aria-hidden="true" />
        </button>
      </div>
    </header>
    {loading ? <div className="wb-floating-note-state" role="status" aria-live="polite">
      <ThemeIcon name="loader" size={15} className="spin" aria-hidden="true" />
      <span>{creating ? t("desktop.workbench.floatingNoteCreating") : t("desktop.workbench.floatingNoteLoading")}</span>
    </div> : noteId ? <>
      <CodeEditor
        ref={editorRef}
        className="wb-floating-note-editor"
        value={content}
        onChange={updateContent}
        ariaLabel={t("desktop.workbench.floatingNoteEditor")}
        language="markdown"
        fontSize={13}
        wordWrap
      />
      <footer className="wb-floating-note-foot">
        <span className={error ? "is-error" : undefined} role={error ? "alert" : "status"} aria-live="polite">
          {error || (deleting
            ? t("desktop.workbench.floatingNoteDeleting")
            : saving
              ? t("desktop.workbench.floatingNoteSaving")
              : dirty
                ? t("desktop.workbench.floatingNoteUnsaved")
                : t("desktop.workbench.floatingNoteSaved"))}
        </span>
      </footer>
    </> : <div className="wb-floating-note-state is-error" role="alert">
      <span>{error || t("desktop.workbench.floatingNoteLoadFailed")}</span>
    </div>}
  </section>;
}
