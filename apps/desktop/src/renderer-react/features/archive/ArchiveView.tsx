import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { notifyDesktop } from "../../components/Notifications";
import { desktopGtdColumn, desktopGtdLabelKey } from "../../gtd";
import { taskFromRecord, type WorkbenchTask } from "../workbench/task";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectLabel(projectPath: string): string {
  return projectPath.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || projectPath;
}

const ARCHIVED_DATE = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric"
});

/**
 * The archive: tasks that were filed away from the GTD board.
 *
 * It is a flat, searchable list rather than a board — an archived task has no
 * "column" to speak of, only the status it held when it left the board. The
 * primary action is restoring one back onto the board.
 */
export function ArchiveView({ active }: { active: boolean }): React.JSX.Element | null {
  const host = document.getElementById("react-archive");
  const { ready, t } = useI18n();
  const [items, setItems] = useState<WorkbenchTask[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const text = useCallback(
    (key: string, ...args: Array<string | number>) => (ready ? t(key, ...args) : key),
    [ready, t]
  );

  const load = useCallback(async () => {
    if (typeof desktopApi().notesListTasks !== "function") {
      setLoading(false);
      return;
    }
    try {
      const records = await desktopApi().notesListTasks();
      setItems(
        records
          .map((record) => taskFromRecord(record))
          .filter((task) => task.archivedAtMs != null)
          .sort((a, b) => (b.archivedAtMs ?? 0) - (a.archivedAtMs ?? 0))
      );
    } catch {
      /* the archive is best-effort; the task list stays the source of truth */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  useEffect(() => {
    const onMutated = () => { if (active) void load(); };
    window.addEventListener("agent-resume:notes-mutated", onMutated);
    return () => window.removeEventListener("agent-resume:notes-mutated", onMutated);
  }, [active, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const projects = (item.projects ?? []).join(" ");
      return `${item.title} ${projects}`.toLowerCase().includes(q);
    });
  }, [items, query]);

  /** Restore a task: it returns to the board under the status it kept. */
  const unarchive = useCallback(async (item: WorkbenchTask) => {
    if (typeof desktopApi().notesSetArchived !== "function") return;
    setBusyId(item.noteId);
    try {
      await desktopApi().notesSetArchived({ noteIds: [item.noteId], archived: false });
      setItems((current) => current.filter((entry) => entry.noteId !== item.noteId));
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch (error) {
      notifyDesktop({ text: errorMessage(error), kind: "error" });
    } finally {
      setBusyId(null);
    }
  }, []);

  /** The task note is a note: it opens in its own floating window. */
  const openNote = useCallback(async (item: WorkbenchTask) => {
    try {
      await desktopApi().standaloneNoteOpen({ noteId: item.noteId });
    } catch (error) {
      notifyDesktop({ text: errorMessage(error), kind: "error" });
    }
  }, []);

  if (!host) return null;

  return createPortal(
    <section className="archive-view" aria-label={text("desktop.archive.title")}>
      <div className="archive-view-toolbar">
        <input
          className="archive-view-search"
          type="search"
          value={query}
          placeholder={text("desktop.archive.search")}
          aria-label={text("desktop.archive.search")}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="archive-view-count">{text("desktop.archive.count", filtered.length)}</span>
      </div>
      <div className="archive-view-body">
        {loading ? (
          <p className="archive-view-empty">{text("desktop.archive.loading")}</p>
        ) : filtered.length === 0 ? (
          <div className="archive-view-empty-state">
            <ThemeIcon name="archive" size={ICON_SIZE.prominent} aria-hidden="true" />
            <p className="archive-view-empty">
              {items.length === 0 ? text("desktop.archive.empty") : text("desktop.archive.emptySearch")}
            </p>
          </div>
        ) : (
          filtered.map((item) => {
            const projects = item.projects ?? [];
            const project = item.primaryProject ?? projects[0];
            return (
              <div className="archive-view-row" key={item.noteId}>
                <button
                  type="button"
                  className="archive-view-main"
                  title={item.title}
                  onClick={() => void openNote(item)}
                >
                  <span className="archive-view-title">{item.title}</span>
                  <span className="archive-view-meta">
                    <span className={`wb-gtd-status-badge is-${desktopGtdColumn(item.status)}`}>
                      {text(desktopGtdLabelKey(item.status))}
                    </span>
                    {project ? <span className="archive-view-meta-item">{projectLabel(project)}</span> : null}
                    <span className="archive-view-meta-item">
                      <ThemeIcon name="bot" size={ICON_SIZE.inline} aria-hidden="true" />
                      {item.sessions.length}
                    </span>
                    {item.archivedAtMs ? (
                      <span className="archive-view-meta-item">
                        {text("desktop.archive.archivedAt", ARCHIVED_DATE.format(new Date(item.archivedAtMs)))}
                      </span>
                    ) : null}
                  </span>
                </button>
                <button
                  type="button"
                  className="archive-view-restore"
                  title={text("desktop.archive.unarchive")}
                  aria-label={text("desktop.archive.unarchive")}
                  disabled={busyId === item.noteId}
                  onClick={() => void unarchive(item)}
                >
                  <ThemeIcon name="undo" size={ICON_SIZE.default} aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>,
    host
  );
}
