import { useCallback, useEffect, useRef, useState } from "react";
import { CodeEditor, type CodeEditorHandle } from "../../components/CodeEditor";
import { ThemeIcon } from "../../components/ThemeIcon";
import { desktopApi } from "../../bridge";
import { GTD_STATUSES, type GtdStatus } from "../../gtd";
import { useI18n } from "../../i18n";

type Note = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesList"]>>[number];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function StandaloneNoteWindow({ noteId }: { noteId: string }): React.JSX.Element {
  const { t } = useI18n();
  const [record, setRecord] = useState<Note | null>(null);
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const editorRef = useRef<CodeEditorHandle>(null);
  const contentRef = useRef(content);
  const dirtyRef = useRef(dirty);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const closingRef = useRef(false);

  contentRef.current = content;
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
    if (!dirtyRef.current) return Promise.resolve(true);
    const contentToSave = contentRef.current;
    let request = Promise.resolve(false);
    request = (async () => {
      setSaving(true);
      try {
        await desktopApi().notesWrite({ noteId, content: contentToSave });
        if (contentRef.current === contentToSave) {
          dirtyRef.current = false;
          setDirty(false);
        }
        setError("");
        return true;
      } catch (saveError) {
        setError(t("desktop.standaloneNote.saveFailed", errorMessage(saveError)));
        return false;
      } finally {
        setSaving(false);
        if (saveInFlightRef.current === request) saveInFlightRef.current = null;
      }
    })();
    saveInFlightRef.current = request;
    return request;
  }, [noteId, t]);

  const flushSave = useCallback(async (): Promise<boolean> => {
    clearSaveTimer();
    while (dirtyRef.current) {
      if (!(await persistOnce())) return false;
    }
    return true;
  }, [clearSaveTimer, persistOnce]);

  const close = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      if (await flushSave()) {
        await desktopApi().standaloneNoteClose();
        return;
      }
    } catch (closeError) {
      setError(t("desktop.standaloneNote.saveFailed", errorMessage(closeError)));
    }
    closingRef.current = false;
  }, [flushSave, t]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      desktopApi().notesRead({ noteId }),
      desktopApi().standaloneNoteGetState()
    ]).then(([result, state]) => {
      if (!active) return;
      if (state.noteId !== noteId) throw new Error("Standalone note identity mismatch.");
      setRecord(result.record);
      setContent(result.content);
      contentRef.current = result.content;
      setPinned(state.pinned);
      setLoading(false);
      window.requestAnimationFrame(() => editorRef.current?.focus());
    }).catch((loadError) => {
      if (!active) return;
      setLoading(false);
      setError(t("desktop.standaloneNote.loadError", errorMessage(loadError)));
    });
    return () => {
      active = false;
      clearSaveTimer();
    };
  }, [clearSaveTimer, noteId, t]);

  useEffect(() => {
    const api = desktopApi();
    return api.onStandaloneNoteCloseRequested(() => {
      void flushSave().then((ok) => api.standaloneNoteCloseReady({ ok })).catch(() => {
        void api.standaloneNoteCloseReady({ ok: false });
      });
    });
  }, [flushSave]);

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

  const title = record?.title || record?.filename || t("desktop.standaloneNote.title");

  const deleteNote = useCallback(async () => {
    if (!record || deleting) return;
    if (!window.confirm(t("desktop.notes.deleteConfirm", title))) return;
    setDeleting(true);
    clearSaveTimer();
    try {
      const pendingSave = saveInFlightRef.current;
      if (pendingSave) await pendingSave;
      const result = await desktopApi().notesDelete({ noteId });
      if (!result.ok) throw new Error("Note deletion failed.");
      await desktopApi().standaloneNoteClose();
    } catch (deleteError) {
      setDeleting(false);
      setError(t("desktop.standaloneNote.deleteFailed", errorMessage(deleteError)));
    }
  }, [clearSaveTimer, deleting, noteId, record, t, title]);

  const togglePinned = async () => {
    try {
      const result = await desktopApi().standaloneNoteSetAlwaysOnTop({ pinned: !pinned });
      setPinned(result.pinned);
      setError("");
    } catch (pinError) {
      setError(errorMessage(pinError));
    }
  };

  const updateGtdStatus = async (status: GtdStatus | null) => {
    if (!record || deleting) return;
    try {
      const updated = await desktopApi().notesSetGtdStatus({ noteId: record.noteId, status });
      setRecord(updated);
      setError("");
    } catch (statusError) {
      setError(errorMessage(statusError));
    }
  };

  return (
    <section className="standalone-note-window" aria-label={t("desktop.standaloneNote.editor")}>
      <header className="standalone-note-window-head">
        <div className="standalone-note-window-heading">
          <strong>{title}</strong>
          <span>{record?.relMdPath || t("desktop.standaloneNote.title")}</span>
        </div>
        <div className="standalone-note-window-actions">
          <select
            className="standalone-note-window-status"
            aria-label={t("desktop.notes.gtdStatusLabel")}
            title={t("desktop.notes.gtdStatusLabel")}
            value={record?.gtdStatus ?? ""}
            disabled={!record || loading || deleting}
            onChange={(event) => void updateGtdStatus(event.target.value ? event.target.value as GtdStatus : null)}
          >
            <option value="">{t("desktop.notes.clearGtdStatus")}</option>
            {GTD_STATUSES.map((status) => <option value={status} key={status}>{t(`desktop.workbench.gtdStatus.${status}`)}</option>)}
          </select>
          <button
            type="button"
            className="standalone-note-window-button standalone-note-window-delete"
            aria-label={t("desktop.notes.deleteNote")}
            title={t("desktop.notes.deleteNote")}
            disabled={!record || loading || deleting}
            onClick={() => void deleteNote()}
          >
            <ThemeIcon name="trash" size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`standalone-note-window-button${pinned ? " is-active" : ""}`}
            aria-label={t(pinned ? "desktop.standaloneNote.unpin" : "desktop.standaloneNote.pin")}
            aria-pressed={pinned}
            title={t(pinned ? "desktop.standaloneNote.unpin" : "desktop.standaloneNote.pin")}
            disabled={deleting}
            onClick={() => void togglePinned()}
          >
            <ThemeIcon name="pin" size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="standalone-note-window-button"
            aria-label={t("desktop.standaloneNote.close")}
            title={t("desktop.standaloneNote.close")}
            disabled={deleting}
            onClick={() => void close()}
          >
            <ThemeIcon name="close" size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      {loading ? (
        <div className="standalone-note-window-state" role="status" aria-live="polite">
          <ThemeIcon name="loader" size={15} className="spin" aria-hidden="true" />
          <span>{t("desktop.standaloneNote.loading")}</span>
        </div>
      ) : record ? (
        <>
          <CodeEditor
            ref={editorRef}
            className="standalone-note-window-editor"
            value={content}
            onChange={updateContent}
            ariaLabel={t("desktop.standaloneNote.editor")}
            language="markdown"
            fontSize={13}
            wordWrap
          />
          <footer className="standalone-note-window-foot">
            <span className={error ? "is-error" : undefined} role={error ? "alert" : "status"} aria-live="polite">
              {error || (deleting
                ? t("desktop.standaloneNote.deleting")
                : saving
                  ? t("desktop.standaloneNote.saving")
                  : dirty
                    ? t("desktop.standaloneNote.unsaved")
                    : t("desktop.standaloneNote.saved"))}
            </span>
          </footer>
        </>
      ) : (
        <div className="standalone-note-window-state is-error" role="alert">
          <span>{error || t("desktop.standaloneNote.loadFailed")}</span>
        </div>
      )}
    </section>
  );
}
