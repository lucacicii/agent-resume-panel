import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CodeEditor, type CodeEditorHandle } from "../../components/CodeEditor";
import { desktopApi } from "../../bridge";
import { ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";

export interface FloatingSessionNoteTarget {
  provider: string;
  sessionId: string;
  projectPath: string;
  projectName?: string;
  sessionTitle: string;
}

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  target: FloatingSessionNoteTarget;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const displayTitle = sessionNoteTitle(target);
  const projectName = target.projectName?.trim()
    || target.projectPath.replaceAll("\\", "/").split("/").filter(Boolean).at(-1)
    || target.projectPath;
  const sessionTitle = target.sessionTitle.trim() || target.sessionId;
  const [content, setContent] = useState("");
  const [noteId, setNoteId] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<FloatingNotePosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const editorRef = useRef<CodeEditorHandle>(null);
  const noteRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<FloatingNoteDrag | null>(null);
  const contentRef = useRef(content);
  const noteIdRef = useRef(noteId);
  const dirtyRef = useRef(dirty);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const loadSequenceRef = useRef(0);
  const closingRef = useRef(false);

  contentRef.current = content;
  noteIdRef.current = noteId;
  dirtyRef.current = dirty;

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
    const saved = await flushSave();
    if (saved) {
      onClose();
      return;
    }
    closingRef.current = false;
  }, [flushSave, onClose]);

  useEffect(() => {
    const sequence = ++loadSequenceRef.current;
    clearSaveTimer();
    setLoading(true);
    setCreating(false);
    setSaving(false);
    setDirty(false);
    dirtyRef.current = false;
    setError("");
    setContent("");
    contentRef.current = "";
    setNoteId("");
    noteIdRef.current = "";
    closingRef.current = false;

    const load = async () => {
      try {
        const existing = latestSessionNote(await desktopApi().notesList(), target);
        if (existing) {
          const result = await desktopApi().notesRead({ noteId: existing.noteId });
          if (loadSequenceRef.current !== sequence) return;
          setNoteId(result.record.noteId);
          noteIdRef.current = result.record.noteId;
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
        if (loadSequenceRef.current !== sequence) return;
        setNoteId(created.noteId);
        noteIdRef.current = created.noteId;
        setContent(initial);
        contentRef.current = initial;
        await desktopApi().notesWrite({ noteId: created.noteId, content: initial });
        if (loadSequenceRef.current !== sequence) return;
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
  }, [clearSaveTimer, t, target.provider, target.projectPath, target.sessionId, target.sessionTitle]);

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

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button > 0 || (event.target instanceof Element && event.target.closest("button"))) return;
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
  >
    <header className="wb-floating-note-head" onPointerDown={onHeaderPointerDown}>
      <div className="wb-floating-note-heading">
        <strong title={projectName}>{projectName}</strong>
        <span title={displayTitle}>{sessionTitle}</span>
      </div>
      <button
        type="button"
        className="wb-floating-note-close"
        aria-label={t("desktop.workbench.floatingNoteClose")}
        title={t("desktop.workbench.floatingNoteClose")}
        onClick={() => void close()}
      >
        <ThemeIcon name="close" size={15} aria-hidden="true" />
      </button>
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
          {error || (saving
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
