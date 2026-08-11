import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { desktopApi } from "../../bridge";
import { CodeEditor } from "../../components/CodeEditor";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Sheet } from "../../components/Sheet";
import { Status, type StatusKind } from "../../components/Status";
import { ThemeIcon } from "../../components/ThemeIcon";
import { renderMarkdown } from "../../components/Markdown";
import { isNoteSessionResumable } from "./noteSessionResume";
import { useI18n } from "../../i18n";
import { basename, projectMatchesNote, projectPathFor, type Project } from "../notes/noteProject";

type Note = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesList"]>>[number];
type Session = Awaited<ReturnType<ReturnType<typeof desktopApi>["listSessions"]>>[number];

interface SessionPreview {
  title: string;
  messages: Array<{ role: string; text: string; timestamp?: string }>;
  truncated?: boolean;
  warning?: string;
}

interface KanbanCardModalProps {
  note: Note | null;
  session: Session | null;
  onClose: () => void;
  /** Called after the note is moved between library and projects so the board stays in sync. */
  onNoteMoved?: (note: Note) => void;
}

export function KanbanCardModal({ note, session, onClose, onNoteMoved }: KanbanCardModalProps): ReactNode | null {
  const { t } = useI18n();
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });

  // Note: edit/preview state.
  const [noteView, setNoteView] = useState<"preview" | "edit">("edit");
  const [noteContent, setNoteContent] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const noteContentRef = useRef("");
  const loadedRef = useRef("");
  const dirtyRef = useRef(false);

  // Session: preview state (the "reference" detail, no list).
  const [preview, setPreview] = useState<SessionPreview | null>(null);
  const [previewSummary, setPreviewSummary] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [assist, setAssist] = useState<"summary" | "rename" | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!note) return;
    setNoteLoading(true);
    setStatus({ text: "" });
    const projectRequest = typeof desktopApi().listProjects === "function"
      ? desktopApi().listProjects().catch(() => [])
      : Promise.resolve([] as Project[]);
    void Promise.all([desktopApi().notesRead({ noteId: note.noteId }), projectRequest])
      .then(([result, nextProjects]) => {
        const content = result.content || "";
        noteContentRef.current = content;
        loadedRef.current = content;
        dirtyRef.current = false;
        setNoteContent(content);
        setDirty(false);
        setNoteView("edit");
        setProjects(nextProjects || []);
        setNoteLoading(false);
      })
      .catch((error) => {
        setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
        setNoteLoading(false);
      });
  }, [note]);

  useEffect(() => {
    if (!session) return;
    setPreviewLoading(true);
    setStatus({ text: "" });
    void desktopApi().previewSession({ provider: session.provider, id: session.id })
      .then((result) => {
        setPreview(result.preview);
        setPreviewSummary(result.session.sessionSummary || "");
        setAssist(null);
        setPreviewLoading(false);
      })
      .catch((error) => {
        setPreview(null);
        setPreviewSummary("");
        setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
        setPreviewLoading(false);
      });
  }, [session]);

  const editNote = useCallback((value: string) => {
    noteContentRef.current = value;
    const next = value !== loadedRef.current;
    dirtyRef.current = next;
    setDirty(next);
    setNoteContent(value);
  }, []);

  const saveNote = useCallback(async () => {
    if (!note || !dirtyRef.current) return;
    dirtyRef.current = false;
    setDirty(false);
    try {
      const result = await desktopApi().notesWrite({ noteId: note.noteId, content: noteContentRef.current });
      loadedRef.current = result.content ?? noteContentRef.current;
      setStatus({ text: t("desktop.common.saved"), kind: "ok" });
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch (error) {
      dirtyRef.current = true;
      setDirty(true);
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [note, t]);

  const currentProjectPath = note?.scope === "project" ? note.projectPath : undefined;
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
    if (!note || moving || projectPath === projectSelectValue) return;
    try {
      setMoving(true);
      // Flush pending edits before the note file is relocated.
      if (dirtyRef.current) {
        await saveNote();
        if (dirtyRef.current) return; // save failed; keep the note in place
      }
      await desktopApi().notesMove({
        noteId: note.noteId,
        owner: projectPath ? { scope: "project", projectPath } : { scope: "library" }
      });
      const moved = await desktopApi().notesRead({ noteId: note.noteId });
      onNoteMoved?.(moved.record);
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      setStatus({ text: t("desktop.kanban.moved"), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setMoving(false);
    }
  };

  const openInNotes = useCallback(() => {
    if (!note) return;
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" }));
    window.dispatchEvent(new CustomEvent("agent-resume:open-note", { detail: note.noteId }));
    onClose();
  }, [note, onClose]);

  const resumeNoteSession = useCallback(async (note: Note) => {
    if (!note.provider || !note.agentSessionId) return;
    try {
      const result = await desktopApi().notesResumeSession({ provider: note.provider, sessionId: note.agentSessionId });
      if (result.ok === false) {
        setStatus({ text: result.error || t("desktop.kanban.resumeFailed"), kind: "error" });
        return;
      }
      // Close only for the in-workbench xterm resume (mirrors session branch); external opens don't switch tabs.
      if (!result.external && result.command) onClose();
      setStatus({ text: t("desktop.agent.resumeStarted", note.provider, note.agentSessionId), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [onClose, t]);

  const summarize = useCallback(async () => {
    if (!session) return;
    setAssist("summary");
    try {
      const result = await desktopApi().summarizeSession({ provider: session.provider, id: session.id });
      setPreviewSummary(result.summary);
      setStatus({ text: t("desktop.sessions.summaryGenerated"), kind: "ok" });
      window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setAssist(null);
    }
  }, [session, t]);

  const autoRename = useCallback(async () => {
    if (!session) return;
    setAssist("rename");
    try {
      const result = await desktopApi().autoRenameSession({ provider: session.provider, id: session.id });
      if (preview) setPreview({ ...preview, title: result.title });
      let text = t("desktop.sessions.renamed", result.title);
      if (!result.nativeRenamed && result.nativeError) text += t("desktop.sessions.renamedNativeError", result.nativeError);
      setStatus({ text, kind: result.nativeRenamed || !result.nativeError ? "ok" : "error" });
      window.dispatchEvent(new CustomEvent("agent-resume:sessions-mutated", { detail: { kind: "session-title" } }));
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setAssist(null);
    }
  }, [preview, session, t]);

  const resumeSession = useCallback(async () => {
    if (!session) return;
    const { provider, id, title, projectPath } = session;
    try {
      const result = await desktopApi().workbenchOpenSession({ provider, id });
      if (!result.external && result.command) {
        onClose();
        window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
        window.dispatchEvent(new CustomEvent("agent-resume:workbench-resume", {
          detail: {
            provider,
            id,
            command: result.command,
            cwd: result.cwd,
            title: title || id,
            projectPath: projectPath || result.cwd
          }
        }));
      }
      setStatus({ text: t("desktop.agent.resumeStarted", provider, id), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [onClose, session, t]);

  if (!note && !session) return null;

  const title = note
    ? note.title || note.filename.replace(/\.md$/i, "") || note.noteId
    : session!.title.trim() || session!.id;

  const deleteNote = async () => {
    if (!note || deleting) return;
    let childCount = 0;
    try {
      if (typeof desktopApi().notesListChildCounts === "function") {
        childCount = (await desktopApi().notesListChildCounts())[note.noteId] ?? 0;
      }
    } catch { /* child count is best-effort; fall back to the plain confirmation */ }
    const message = childCount > 0
      ? t("desktop.notes.deleteWithChildren", title, childCount)
      : t("desktop.notes.deleteConfirm", title);
    if (!window.confirm(message)) return;
    setDeleting(true);
    try {
      const result = await desktopApi().notesDelete({ noteId: note.noteId });
      if (!result.ok) throw new Error("Note deletion failed.");
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      onClose();
    } catch (error) {
      setDeleting(false);
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  };

  const actions = note ? (
    <>
      {isNoteSessionResumable(note) ? (
        <button type="button" className="tool-btn" onClick={() => void resumeNoteSession(note)}>
          <ThemeIcon name="play" size={14} aria-hidden="true" />
          {t("desktop.kanban.resumeSession")}
        </button>
      ) : null}
      {dirty ? (
        <button type="button" className="tool-btn" onClick={() => void saveNote()}>
          {t("desktop.common.save")}
        </button>
      ) : null}
      <button type="button" className="tool-btn" onClick={openInNotes}>
        {t("desktop.agent.openInNotes")}
      </button>
      <button
        type="button"
        className="tool-btn is-danger"
        onClick={() => void deleteNote()}
        disabled={deleting}
        aria-label={t("desktop.notes.deleteNote")}
        title={t("desktop.notes.deleteNote")}
      >
        <ThemeIcon name="trash" size={14} aria-hidden="true" />
        {deleting ? t("desktop.notes.deletingNote") : t("desktop.notes.deleteNote")}
      </button>
    </>
  ) : (
    <div className="session-preview-actions">
      <button type="button" className="tool-btn" onClick={() => void summarize()} disabled={assist !== null}>
        {assist === "summary" ? t("desktop.sessions.summarizing") : "Summarize"}
      </button>
      <button type="button" className="tool-btn" onClick={() => void autoRename()} disabled={assist !== null}>
        {assist === "rename" ? t("desktop.sessions.renaming") : "Auto Rename"}
      </button>
      <button type="button" className="tool-btn" onClick={() => void resumeSession()}>
        {t("desktop.agent.resumeSession")}
      </button>
    </div>
  );

  return (
    <Sheet open title={title} onClose={onClose} modal wide bodyClassName="kanban-detail-body" actions={actions}>
      {note ? (
        <>
          <div className="kanban-note-meta">
            <div className="muted session-preview-meta">
              {t(`desktop.kanban.scope.${note.scope}`)}
              {note.projectPath ? ` · ${note.projectPath}` : ""}
              {` · ${note.filename}`}
            </div>
            <SegmentedControl<"preview" | "edit">
              value={noteView}
              options={["preview", "edit"]}
              onChange={setNoteView}
              aria-label={t("desktop.kanban.noteView")}
              getLabel={(value) => (
                <span title={t(value === "edit" ? "desktop.common.edit" : "desktop.common.preview")}>
                  <ThemeIcon name={value === "edit" ? "pencil" : "eye"} size={16} aria-hidden="true" />
                </span>
              )}
              className="notes-segmented"
            />
            <select
              className="kanban-note-project"
              aria-label={t("desktop.notes.projectLabel")}
              title={t("desktop.notes.projectLabel")}
              value={projectSelectValue}
              disabled={noteLoading || moving}
              onChange={(event) => void updateProject(event.target.value)}
            >
              <option value="">{t("desktop.notes.targetLibrary")}</option>
              {projectOptions.map((project) => <option value={project.value} key={project.value}>{project.label}</option>)}
            </select>
          </div>
          <Status kind={status.kind}>{status.text}</Status>
          {noteLoading ? (
            <p className="muted">{t("desktop.common.loadingPreview")}</p>
          ) : noteView === "edit" ? (
            <CodeEditor
              className="notes-editor-host kanban-note-editor"
              value={noteContent}
              language="markdown"
              ariaLabel={t("desktop.notes.editorPlaceholder")}
              onChange={editNote}
              onBlur={() => void saveNote()}
              shouldHandlePaste={() => desktopApi().notesClipboardHasImage()}
              onPasteImage={async () => {
                if (!note) return null;
                try { return (await desktopApi().notesPasteImage({ noteId: note.noteId }))?.snippet || null; }
                catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); return null; }
              }}
            />
          ) : (
            <div className="kanban-note-preview markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(noteContent) }} />
          )}
        </>
      ) : (
        <div className="kanban-session-detail">
          {previewLoading && <p className="muted">{t("desktop.common.loadingPreview")}</p>}
          {!previewLoading && preview && (
            <>
              <div className="session-preview-head">
                <h3 className="session-preview-title">{preview.title || session!.title}</h3>
              </div>
              <div className="muted session-preview-meta">
                {session!.provider}{" · "}{session!.id}{" · "}{session!.projectPath}
              </div>
              <Status kind={status.kind}>{status.text}</Status>
              {previewSummary && (
                <div className="session-summary-box">
                  <div className="session-summary-label">Summary</div>
                  <div className="session-summary-body">{previewSummary}</div>
                </div>
              )}
              {preview.warning && <Status kind="error">{preview.warning}</Status>}
              {!preview.messages.length ? (
                <p className="muted">{t("desktop.sessions.noMessages")}</p>
              ) : (
                preview.messages.map((message, index) => (
                  <div key={`${message.timestamp || index}-${message.role}`} className={`preview-msg ${message.role}`}>
                    <div className="role">{message.role}</div>
                    <div>{message.text}</div>
                  </div>
                ))
              )}
              {preview.truncated && <p className="muted">{t("desktop.sessions.truncated")}</p>}
            </>
          )}
          {!previewLoading && !preview && status.text && <Status kind={status.kind}>{status.text}</Status>}
        </div>
      )}
    </Sheet>
  );
}
