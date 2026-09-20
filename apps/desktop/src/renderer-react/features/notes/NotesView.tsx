import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { useGlideHighlight } from "../../components/useGlideHighlight";
import { SegmentedControl } from "../../components/SegmentedControl";
import { NotePaneView } from "../workbench/notes/NotePaneView";

type RootNote = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesListRoot"]>>[number];
type AnyNote = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesList"]>>[number];

function noteTitle(note: { title?: string; filename: string }): string {
  return note.title || note.filename.replace(/\.md$/i, "");
}

type NotesKind = "task" | "project" | "library";
/** The list's top-level segment: tasks, or the notes library (project + library). */
type NotesSegment = "task" | "library";

/** Tasks (`work` present), project notes (path, no `work`), plain library notes. */
function noteKind(note: { work?: unknown; projectPath?: string }): NotesKind {
  if (note.work) return "task";
  if (note.projectPath) return "project";
  return "library";
}

const KIND_ORDER: NotesKind[] = ["task", "project", "library"];
const SEGMENT_OPTIONS = ["task", "library"] as const;
const SEGMENT_KINDS: Record<NotesSegment, NotesKind[]> = {
  task: ["task"],
  library: ["project", "library"]
};

/**
 * The board's Notes module: a searchable list of root notes (grouped into
 * tasks, project notes, and library notes) beside the shared note editor.
 * List rows, search, and section labels follow the sidebar-nav / search
 * patterns from beautifului.dev, expressed in the app's design tokens.
 */
export function NotesView({ active }: { active: boolean }): React.JSX.Element | null {
  const host = document.getElementById("react-notes");
  const { ready, t } = useI18n();
  const [roots, setRoots] = useState<RootNote[]>([]);
  const [childCounts, setChildCounts] = useState<Record<string, number>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [segment, setSegment] = useState<NotesSegment>("task");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AnyNote[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedOnceRef = useRef(false);
  const { containerRef, setRow, glide, moveGlide, hideGlide } = useGlideHighlight(selectedId);

  const text = useCallback(
    (key: string, ...args: Array<string | number>) => (ready ? t(key, ...args) : key),
    [ready, t]
  );

  const load = useCallback(async () => {
    if (typeof desktopApi().notesListRoot !== "function") return;
    try {
      const [nextRoots, nextCounts] = await Promise.all([
        desktopApi().notesListRoot(),
        typeof desktopApi().notesListChildCounts === "function"
          ? desktopApi().notesListChildCounts().catch(() => ({} as Record<string, number>))
          : Promise.resolve({} as Record<string, number>)
      ]);
      setRoots(nextRoots);
      setChildCounts(nextCounts || {});
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  // Everything that mutates notes dispatches this event; keep the list fresh.
  useEffect(() => {
    const onMutated = () => { void load(); };
    window.addEventListener("agent-resume:notes-mutated", onMutated);
    return () => window.removeEventListener("agent-resume:notes-mutated", onMutated);
  }, [load]);

  // Live search: with a query, search the whole index (children included).
  useEffect(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) {
      setResults(null);
      return;
    }
    if (typeof desktopApi().notesList !== "function") return;
    const timer = window.setTimeout(() => {
      void desktopApi().notesList().then((all) => {
        setResults(all.filter((note) =>
          noteTitle(note).toLocaleLowerCase().includes(needle)
          || (note.contentPreview ?? "").toLocaleLowerCase().includes(needle)
        ));
      }).catch(() => setResults([]));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  const grouped = useMemo(() => {
    const groups: Record<NotesKind, RootNote[]> = { task: [], project: [], library: [] };
    if (results !== null) return null;
    for (const note of roots) groups[noteKind(note)].push(note);
    for (const kind of KIND_ORDER) {
      groups[kind].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    }
    return groups;
  }, [results, roots]);

  // The segment filters the grouped roots; search always spans the whole index.
  const visibleSections = useMemo(() => {
    if (results !== null || !grouped) return null;
    return SEGMENT_KINDS[segment]
      .map((kind) => ({ kind, notes: grouped[kind] }))
      .filter((section) => section.notes.length > 0);
  }, [results, grouped, segment]);

  // First load selects the first note of the active segment so the right pane is never dead.
  useEffect(() => {
    if (selectedOnceRef.current || loading || !roots.length) return;
    selectedOnceRef.current = true;
    const preferred = SEGMENT_KINDS[segment].flatMap((kind) => grouped?.[kind] ?? [])[0];
    setSelectedId((prev) => prev ?? preferred?.noteId ?? roots[0].noteId);
  }, [grouped, loading, roots, segment]);

  const changeSegment = (next: NotesSegment) => {
    setSegment(next);
    const visible = SEGMENT_KINDS[next].flatMap((kind) => grouped?.[kind] ?? []);
    setSelectedId(visible.length ? visible[0].noteId : null);
  };

  const displayTitle = (noteId: string, fallback: { title?: string; filename: string }): string =>
    titles[noteId] ?? noteTitle(fallback);

  const createNote = async () => {
    if (typeof desktopApi().notesCreate !== "function") return;
    try {
      const created = await desktopApi().notesCreate({ scope: "library" });
      await load();
      selectedOnceRef.current = true;
      setSelectedId(created.noteId);
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    }
  };

  const importNotes = async () => {
    if (typeof desktopApi().notesImport !== "function") return;
    try {
      await desktopApi().notesImport({ scope: "library" });
      await load();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    }
  };

  if (!host) return null;
  return createPortal(
    <div className={`notes-view${active ? " is-active" : ""}`}>
      <div className="notes-view-list">
        <div className="notes-view-search">
          <ThemeIcon name="search" size={ICON_SIZE.dense} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={text("desktop.notes.viewSearch", "Search notes…")}
            aria-label={text("desktop.notes.viewSearch", "Search notes…")}
          />
          <button
            type="button"
            className="notes-view-action"
            aria-label={text("desktop.workbench.newNote", "New note")}
            title={text("desktop.workbench.newNote", "New note")}
            onClick={() => void createNote()}
          >
            <ThemeIcon name="plus" size={ICON_SIZE.default} />
          </button>
          <button
            type="button"
            className="notes-view-action"
            aria-label={text("desktop.notes.viewImport", "Import notes…")}
            title={text("desktop.notes.viewImport", "Import notes…")}
            onClick={() => void importNotes()}
          >
            <ThemeIcon name="upload" size={ICON_SIZE.default} />
          </button>
        </div>
        {results === null ? (
          <div className="notes-view-segment">
            <SegmentedControl
              value={segment}
              options={SEGMENT_OPTIONS}
              onChange={changeSegment}
              getLabel={(value) => value === "task"
                ? text("desktop.notes.segmentTasks", "Tasks")
                : text("desktop.notes.segmentLibrary", "Notes")}
              aria-label={text("desktop.notes.segmentLabel", "Tasks and notes library")}
            />
          </div>
        ) : null}
        {error ? <p className="notes-view-error" role="alert">{error}</p> : null}
        <div ref={containerRef} className="notes-view-rows" onPointerLeave={hideGlide}>
          <span
            className="notes-view-glide"
            style={{ top: glide.top, height: glide.height, opacity: glide.visible ? 1 : 0 }}
            aria-hidden="true"
          />
          {results !== null ? (
            <>
              <p className="notes-view-section">{text("desktop.notes.sectionResults", "Results")}</p>
              {results.length === 0
                ? <p className="notes-view-empty">{text("desktop.notes.viewEmptySearch", "No notes match your search.")}</p>
                : results.map((note) => (
                  <button
                    key={note.noteId}
                    ref={(node) => { setRow(note.noteId, node); }}
                    type="button"
                    className={`notes-view-row${note.noteId === selectedId ? " is-active" : ""}`}
                    aria-current={note.noteId === selectedId ? "true" : undefined}
                    onClick={() => setSelectedId(note.noteId)}
                    onPointerEnter={() => moveGlide(note.noteId)}
                  >
                    <span className="notes-view-row-title">{displayTitle(note.noteId, note)}</span>
                  </button>
                ))}
            </>
          ) : loading ? (
            <p className="notes-view-empty" role="status">{text("desktop.common.loading", "Loading…")}</p>
          ) : roots.length === 0 ? (
            <div className="notes-view-empty-block">
              <p className="notes-view-empty">{text("desktop.notes.viewEmptyTitle", "No notes yet")}</p>
              <p className="notes-view-hint">{text("desktop.notes.viewEmptyHint", "Create your first note to get started.")}</p>
            </div>
          ) : visibleSections && visibleSections.length > 0 ? (
            visibleSections.map(({ kind, notes }) => (
              <section key={kind}>
                {kind === "project"
                  ? <p className="notes-view-section">{text("desktop.notes.sectionProjects", "Project notes")}</p>
                  : null}
                {notes.map((note) => (
                    <button
                      key={note.noteId}
                      ref={(node) => { setRow(note.noteId, node); }}
                      type="button"
                      className={`notes-view-row${note.noteId === selectedId ? " is-active" : ""}`}
                      aria-current={note.noteId === selectedId ? "true" : undefined}
                      onClick={() => setSelectedId(note.noteId)}
                      onPointerEnter={() => moveGlide(note.noteId)}
                    >
                      <span className="notes-view-row-title">{displayTitle(note.noteId, note)}</span>
                      {(childCounts[note.noteId] ?? 0) > 0 ? (
                        <span className="notes-view-count" aria-hidden="true">{childCounts[note.noteId]}</span>
                      ) : null}
                  </button>
                ))}
              </section>
            ))
          ) : (
            <div className="notes-view-empty-block">
              <p className="notes-view-empty">
                {segment === "task"
                  ? text("desktop.notes.segmentTasksEmpty", "No tasks yet")
                  : text("desktop.notes.segmentLibraryEmpty", "No notes here yet")}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="notes-view-detail">
        {selectedId
          ? <NotePaneView
              key={selectedId}
              noteId={selectedId}
              active={active}
              onOpenNote={(noteId) => setSelectedId(noteId)}
              onTitleChange={(noteId, title) => setTitles((prev) => ({ ...prev, [noteId]: title }))}
              onDirtyChange={() => undefined}
              onClose={() => setSelectedId(null)}
            />
          : <div className="notes-view-detail-empty">
              <ThemeIcon name="notebook" size={ICON_SIZE.prominent} aria-hidden="true" />
              <p className="notes-view-empty">{text("desktop.notes.selectOrCreate", "Select or create a note")}</p>
            </div>}
      </div>
    </div>,
    host
  );
}
