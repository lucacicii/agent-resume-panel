import { useCallback, useEffect, useRef, useState } from "react";
import { CodeEditor, type CodeEditorHandle, type CodeEditorSearchResult } from "../../components/CodeEditor";
import { ThemeIcon } from "../../components/ThemeIcon";
import { desktopApi } from "../../bridge";
import { GTD_STATUSES, type GtdStatus } from "../../gtd";
import { useI18n } from "../../i18n";
import { basename, projectMatchesNote, projectPathFor, type Project } from "./noteProject";
import { STANDALONE_NOTE_INITIAL_CONTENT } from "../../../shared/standaloneNote";
import { SelectionSendMenu, type SelectionSendMenuState } from "../../selection/SelectionSendMenu";

type Note = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesList"]>>[number];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function StandaloneNoteWindow({ noteId }: { noteId: string }): React.JSX.Element {
  const { t } = useI18n();
  const [record, setRecord] = useState<Note | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const [selectionMenu, setSelectionMenu] = useState<SelectionSendMenuState | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResult, setFindResult] = useState<CodeEditorSearchResult | null>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const findQueryRef = useRef(findQuery);
  const previousFindContentRef = useRef(content);
  const contentRef = useRef(content);
  const dirtyRef = useRef(dirty);
  const saveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const closingRef = useRef(false);

  contentRef.current = content;
  dirtyRef.current = dirty;
  findQueryRef.current = findQuery;

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
    if ((contentRef.current || "").trim() === STANDALONE_NOTE_INITIAL_CONTENT.trim()) {
      clearSaveTimer();
      try {
        const result = await desktopApi().notesDelete({ noteId });
        if (!result.ok) throw new Error("Note deletion failed.");
        await desktopApi().standaloneNoteClose();
        return;
      } catch (closeError) {
        setError(t("desktop.standaloneNote.deleteFailed", errorMessage(closeError)));
        closingRef.current = false;
        return;
      }
    }
    try {
      if (await flushSave()) {
        await desktopApi().standaloneNoteClose();
        return;
      }
    } catch (closeError) {
      setError(t("desktop.standaloneNote.saveFailed", errorMessage(closeError)));
    }
    closingRef.current = false;
  }, [clearSaveTimer, flushSave, noteId, t]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const projectRequest = typeof desktopApi().listProjects === "function"
      ? desktopApi().listProjects().catch(() => [])
      : Promise.resolve([] as Project[]);
    void Promise.all([
      desktopApi().notesRead({ noteId }),
      desktopApi().standaloneNoteGetState(),
      projectRequest
    ]).then(([result, state, nextProjects]) => {
      if (!active) return;
      if (state.noteId !== noteId) throw new Error("Standalone note identity mismatch.");
      setRecord(result.record);
      setProjects(nextProjects || []);
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
      void (async () => {
        try {
          if ((contentRef.current || "").trim() === STANDALONE_NOTE_INITIAL_CONTENT.trim()) {
            const result = await desktopApi().notesDelete({ noteId });
            if (!result.ok) throw new Error("Note deletion failed.");
            api.standaloneNoteCloseReady({ ok: true });
            return;
          }
          const ok = await flushSave();
          api.standaloneNoteCloseReady({ ok });
        } catch {
          void api.standaloneNoteCloseReady({ ok: false });
        }
      })();
    });
  }, [flushSave, noteId]);

  const clearFindSearch = useCallback(() => {
    editorRef.current?.clearSearch();
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
    const result = reset
      ? (editorRef.current?.setSearchQuery(q) ?? { current: 0, total: 0 })
      : (editorRef.current?.navigateSearch(direction) ?? { current: 0, total: 0 });
    setFindResult(result);
    // Keep keyboard focus on the find field so Enter is not handled by CodeMirror.
    window.requestAnimationFrame(() => findRef.current?.focus());
    return result;
  }, [clearFindSearch]);

  const openFind = useCallback(() => {
    if (loading || !record) return;
    const selectedText = editorRef.current?.getSelectedText() || "";
    const query = selectedText.trim();
    if (query) {
      setFindQuery(query);
      findQueryRef.current = query;
      runFind("forward", query, true);
    } else if (findQueryRef.current.trim()) {
      runFind("forward", findQueryRef.current, true);
    }
    setFindOpen(true);
  }, [loading, record, runFind]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    findQueryRef.current = "";
    clearFindSearch();
  }, [clearFindSearch]);

  useEffect(() => {
    if (!findOpen) return;
    window.requestAnimationFrame(() => findRef.current?.focus());
  }, [findOpen]);

  useEffect(() => {
    if (previousFindContentRef.current === content) return;
    previousFindContentRef.current = content;
    if (!findOpen || !findQueryRef.current.trim()) return;
    window.requestAnimationFrame(() => {
      setFindResult(editorRef.current?.getSearchResult() ?? { current: 0, total: 0 });
    });
  }, [content, findOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isFind = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f";
      if (isFind) {
        event.preventDefault();
        event.stopPropagation();
        openFind();
        return;
      }
      if (findOpen) {
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
          return;
        }
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      void close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [close, closeFind, findOpen, openFind, runFind]);

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

  const currentProjectPath = record?.scope === "project" ? record.projectPath : undefined;
  const matchedProject = currentProjectPath
    ? projects.find((project) => projectMatchesNote(project, currentProjectPath))
    : undefined;
  const projectSelectValue = matchedProject ? projectPathFor(matchedProject) : currentProjectPath || "";
  const projectOptions = projects.map((project) => {
    const value = projectPathFor(project);
    return { value, label: project.alias || basename(value) };
  });
  if (!matchedProject && currentProjectPath) {
    projectOptions.unshift({ value: currentProjectPath, label: basename(currentProjectPath) });
  }

  const updateProject = async (projectPath: string) => {
    if (!record || deleting || projectPath === projectSelectValue) return;
    try {
      setMoving(true);
      if (!(await flushSave())) return;
      await desktopApi().notesMove({
        noteId: record.noteId,
        owner: projectPath ? { scope: "project", projectPath } : { scope: "library" }
      });
      const moved = await desktopApi().notesRead({ noteId: record.noteId });
      setRecord(moved.record);
      setError("");
    } catch (moveError) {
      setError(errorMessage(moveError));
    } finally {
      setMoving(false);
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
          <button
            type="button"
            className="standalone-note-window-button"
            aria-label={t("desktop.notes.findInNote")}
            title={t("desktop.notes.findInNote")}
            disabled={!record || loading || deleting}
            onClick={openFind}
          >
            <ThemeIcon name="search" size={15} aria-hidden="true" />
          </button>
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
          <div className="standalone-note-window-meta">
            <select
              className="standalone-note-window-project"
              aria-label={t("desktop.notes.projectLabel")}
              title={t("desktop.notes.projectLabel")}
              value={projectSelectValue}
              disabled={!record || loading || deleting || moving}
              onChange={(event) => void updateProject(event.target.value)}
            >
              <option value="">{t("desktop.notes.targetLibrary")}</option>
              {projectOptions.map((project) => <option value={project.value} key={project.value}>{project.label}</option>)}
            </select>
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
          </div>
          <div className="standalone-note-window-body">
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
                    runFind("forward", value, true);
                  }}
                  onPaste={(event) => {
                    const value = event.clipboardData.getData("text/plain");
                    if (!value) return;
                    event.preventDefault();
                    setFindQuery(value);
                    findQueryRef.current = value;
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
                  onClick={() => runFind("backward")}
                >
                  <ThemeIcon name="arrow-up" size={14} />
                </button>
                <button
                  type="button"
                  className="notes-find-btn app-inline-search-btn"
                  aria-label={t("desktop.common.findNext")}
                  onClick={() => runFind("forward")}
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
            <div
              className="standalone-note-window-editor-surface"
              onContextMenu={(event) => {
                const text = (editorRef.current?.getSelectedText() || "").trim();
                if (!text) return;
                event.preventDefault();
                setSelectionMenu({
                  x: event.clientX,
                  y: event.clientY,
                  text,
                  ...(record?.projectPath ? { projectPath: record.projectPath } : {})
                });
              }}
            >
              <CodeEditor
                ref={editorRef}
                className="standalone-note-window-editor"
                value={content}
                onChange={updateContent}
                ariaLabel={t("desktop.standaloneNote.editor")}
                language="markdown"
                selectionProjectPath={record?.projectPath}
                fontSize={13}
                wordWrap
              />
            </div>
            {selectionMenu ? <SelectionSendMenu menu={selectionMenu} onClose={() => setSelectionMenu(null)} /> : null}
          </div>
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
