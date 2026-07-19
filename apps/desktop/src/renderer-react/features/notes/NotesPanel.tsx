import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactPortal } from "react";
import { Clipboard, Eye, FilePlus2, FolderOpen, Pencil, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import type { AgentSession } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { CodeEditor } from "../../components/CodeEditor";
import { renderMarkdown } from "../../components/Markdown";
import { Status, type StatusKind } from "../../components/Status";
import { useI18n } from "../../i18n";

type Note = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesList"]>>[number];
type Owner = {
  scope: "library" | "project" | "session";
  projectPath?: string;
  provider?: string;
  sessionId?: string;
};

function basename(value?: string): string {
  return String(value || "").replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || "";
}

function titleFor(note: Note): string {
  return note.title || note.filename.replace(/\.md$/i, "") || note.noteId;
}

export function NotesPanel(): ReactPortal | null {
  const host = document.getElementById("react-notes");
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "library" | "project" | "session">("all");
  const [view, setView] = useState<"edit" | "view">("edit");
  const [owner, setOwner] = useState<Owner>({ scope: "library" });
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const saveTimer = useRef<number | null>(null);
  const contentRef = useRef(content);
  const selectedRef = useRef<Note | null>(selected);
  contentRef.current = content;
  selectedRef.current = selected;

  const load = useCallback(async () => {
    try {
      const [nextNotes, nextSessions] = await Promise.all([
        desktopApi().notesList(),
        desktopApi().listSessions(2_000)
      ]);
      setNotes(nextNotes);
      setSessions(nextSessions);
      setStatus({ text: "" });
      setSelected((current) => current ? nextNotes.find((note) => note.noteId === current.noteId) || null : null);
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, []);

  const save = useCallback(async () => {
    const note = selectedRef.current;
    if (!note) return;
    try {
      const updated = await desktopApi().notesWrite({ noteId: note.noteId, content: contentRef.current });
      setNotes((current) => current.map((item) => item.noteId === note.noteId
        ? { ...item, ...updated, contentPreview: contentRef.current.slice(0, 300) }
        : item));
      setStatus({ text: "", kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
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
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [save]);

  useEffect(() => {
    const onTab = (event: Event) => {
      const show = (event as CustomEvent<string>).detail === "notes";
      setActive(show);
      if (show && !notes.length) void load();
    };
    const onOpen = (event: Event) => {
      const noteId = (event as CustomEvent<string>).detail;
      const note = notes.find((item) => item.noteId === noteId);
      if (note) {
        void open(note);
        return;
      }
      void load().then(async () => {
        const result = await desktopApi().notesRead({ noteId });
        setSelected(result.record);
        setContent(result.content);
        setTitle(titleFor(result.record));
      });
    };
    window.addEventListener("agent-resume:tab-change", onTab);
    window.addEventListener("agent-resume:open-note", onOpen);
    return () => {
      window.removeEventListener("agent-resume:tab-change", onTab);
      window.removeEventListener("agent-resume:open-note", onOpen);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [load, notes, open]);

  const editContent = (value: string) => {
    setContent(value);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(), 800);
  };

  const canCreate = owner.scope === "library"
    || (owner.scope === "project" && Boolean(owner.projectPath))
    || (owner.scope === "session" && Boolean(owner.provider && owner.sessionId));

  const create = async () => {
    if (!canCreate) return;
    try {
      const result = await desktopApi().notesCreate(owner);
      await load();
      const next = await desktopApi().notesRead({ noteId: result.noteId });
      setSelected(next.record);
      setContent(next.content);
      setTitle(titleFor(next.record));
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  };

  const rename = async () => {
    if (!selected || !title.trim()) return;
    const filename = title.trim().endsWith(".md") ? title.trim() : `${title.trim()}.md`;
    try {
      const result = await desktopApi().notesRename({ noteId: selected.noteId, filename });
      setNotes((current) => current.map((note) => note.noteId === selected.noteId
        ? { ...note, filename: result.filename, title: title.trim() }
        : note));
      setSelected((current) => current ? { ...current, filename: result.filename, title: title.trim() } : current);
      setEditingTitle(false);
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(t("desktop.notes.deleteConfirm", titleFor(selected)))) return;
    try {
      await desktopApi().notesDelete({ noteId: selected.noteId });
      setSelected(null);
      setContent("");
      await load();
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  };

  const visible = useMemo(() => notes.filter((note) => (
    (scope === "all" || note.scope === scope)
    && `${titleFor(note)} ${note.contentPreview || ""}`.toLowerCase().includes(query.toLowerCase())
  )), [notes, query, scope]);
  const ownerOptions = useMemo(() => ({
    projects: [...new Set(sessions.map((session) => session.projectPath).filter(Boolean))],
    sessions
  }), [sessions]);

  if (!host) return null;
  return createPortal(
    <section className="panel active notes-panel react-notes-panel" hidden={!active}>
      <div className="notes-layout">
        <aside className="sidebar-folders-pane notes-folders-pane">
          <div className="sidebar-project-filter-wrap">
            <label className="sidebar-project-search-wrap">
              <Search size={15} />
              <input type="search" className="sidebar-project-search" placeholder={t("desktop.notes.filterProjects")} value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className="sidebar-project-filter-segmented" role="tablist">
              {(["all", "library", "project", "session"] as const).map((value) => (
                <button type="button" role="tab" className={scope === value ? "active" : ""} key={value} onClick={() => setScope(value)}>
                  {value === "all" ? t("desktop.common.all") : value === "library" ? t("desktop.notes.librarySection") : value === "project" ? t("desktop.notes.projectLabel") : t("desktop.notes.sessionsSection")}
                </button>
              ))}
            </div>
          </div>
          <div className="notes-folders">
            <p className="muted">{t("desktop.notes.listMeta", visible.length, notes.length)}</p>
            {(["library", "project", "session"] as const).map((kind) => (
              <button type="button" className="notes-folder-row" key={kind} onClick={() => setScope(kind)}>
                <span className="notes-folder-row-label">{kind === "library" ? t("desktop.notes.librarySection") : kind === "project" ? t("desktop.notes.projectLabel") : t("desktop.notes.sessionsSection")}</span>
                <span className="notes-folder-row-count">{notes.filter((note) => note.scope === kind).length}</span>
              </button>
            ))}
          </div>
        </aside>
        <aside className="notes-list-pane">
          <div className="notes-list-search-wrap">
            <select className="quiet-select" value={owner.scope} onChange={(event) => setOwner({ scope: event.target.value as Owner["scope"] })}>
              <option value="library">{t("desktop.notes.targetLibrary")}</option>
              <option value="project">{t("desktop.notes.targetProject")}</option>
              <option value="session">{t("desktop.notes.targetSession")}</option>
            </select>
            {owner.scope === "project" ? <select className="quiet-select" value={owner.projectPath || ""} onChange={(event) => setOwner({ scope: "project", projectPath: event.target.value })}>
              <option value="">{t("desktop.notes.targetProject")}</option>
              {ownerOptions.projects.map((project) => <option value={project} key={project}>{basename(project)}</option>)}
            </select> : null}
            {owner.scope === "session" ? <select className="quiet-select" value={`${owner.provider || ""}:${owner.sessionId || ""}`} onChange={(event) => {
              const session = ownerOptions.sessions.find((item) => `${item.provider}:${item.id}` === event.target.value);
              setOwner({ scope: "session", provider: session?.provider, sessionId: session?.id, projectPath: session?.projectPath });
            }}>
              <option value="">{t("desktop.notes.targetSession")}</option>
              {ownerOptions.sessions.map((session) => <option value={`${session.provider}:${session.id}`} key={`${session.provider}:${session.id}`}>{session.title}</option>)}
            </select> : null}
            <button type="button" className="notes-icon-btn" aria-label={t("desktop.common.newNote")} title={t("desktop.common.newNote")} disabled={!canCreate} onClick={() => void create()}><FilePlus2 size={18} /></button>
            <button type="button" className="notes-icon-btn" aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")} onClick={() => void load()}><RefreshCw size={18} /></button>
          </div>
          <div className="notes-list">
            {visible.length ? visible.map((note) => <button type="button" className={`notes-list-item${selected?.noteId === note.noteId ? " active" : ""}`} key={note.noteId} onClick={() => void open(note)}>
              <span className="notes-list-item-title">{titleFor(note)}</span>
              <span className="notes-list-item-preview">{note.contentPreview || note.relDir}</span>
              <span className="notes-list-item-date">{new Date(note.updatedAtMs).toLocaleDateString()}</span>
            </button>) : <p className="muted notes-list-empty">{t("desktop.notes.noMatchingNotes")}</p>}
          </div>
        </aside>
        <main className="notes-detail">
          {selected ? <div className="notes-editor-shell">
            <div className="notes-detail-head">
              {editingTitle ? <form onSubmit={(event) => { event.preventDefault(); void rename(); }}>
                <input className="notes-detail-title-input" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
                <button type="submit" className="icon-btn" aria-label={t("desktop.common.confirm")}><Save size={15} /></button>
              </form> : <h1 className="notes-detail-title" onDoubleClick={() => setEditingTitle(true)}>{title}</h1>}
              <div className="notes-segmented" role="tablist">
                <button type="button" role="tab" className={view === "edit" ? "active" : ""} aria-label={t("desktop.common.edit")} onClick={() => setView("edit")}><Pencil size={16} /></button>
                <button type="button" role="tab" className={view === "view" ? "active" : ""} aria-label={t("desktop.common.view")} onClick={() => { void save(); setView("view"); }}><Eye size={16} /></button>
                <button type="button" className="notes-icon-btn" aria-label={t("desktop.notes.copyPath")} onClick={() => void desktopApi().notesCopyPath({ noteId: selected.noteId })}><Clipboard size={15} /></button>
                <button type="button" className="notes-icon-btn" aria-label={t("desktop.common.revealInFinder")} onClick={() => void desktopApi().notesReveal({ noteId: selected.noteId })}><FolderOpen size={15} /></button>
                <button type="button" className="notes-icon-btn" aria-label={t("desktop.notes.deleteNote")} onClick={() => void remove()}><Trash2 size={15} /></button>
              </div>
            </div>
            {view === "edit" ? <CodeEditor className="notes-editor-host" value={content} ariaLabel={t("desktop.notes.editorPlaceholder")} onChange={editContent} onBlur={() => void save()} /> : <div className="notes-preview markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />}
          </div> : <div className="notes-empty-state">
            <p className="muted notes-hint">{t("desktop.notes.selectOrCreate")}</p>
            <button type="button" className="tool-btn" onClick={() => void desktopApi().notesOpenFolder()}>{t("desktop.common.revealInFinder")}</button>
          </div>}
          <Status kind={status.kind}>{status.text}</Status>
        </main>
      </div>
    </section>,
    host
  );
}
