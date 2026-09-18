import { ThemeIcon } from "../../components/ThemeIcon";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { GtdStatus, TaskGtdRollup } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { notifyDesktop } from "../../components/Notifications";
import { useI18n } from "../../i18n";
import { taskFromRecord, type WorkbenchTask } from "../workbench/task";
import { ensureTaskWorkbenches, listAllTaskWorkbenches, workbenchDisplayName, type Workbench } from "../workbench/workbenchModel";
import type { ActiveSessionDot } from "../workbench/activeSessionDots";
import { rollupDot, needsYou } from "../workbench/sessionStatus/taskRollup";
import { sessionDotStatusClass } from "../workbench/sessionStatus/dotStatus";
import { TaskTemplatePanel, type TaskTemplate } from "./TaskTemplatePanel";

/** Board column order — `done` last so active work reads first. */
const GTD_COLUMNS: GtdStatus[] = ["inbox", "next", "waiting", "someday", "reference", "done"];

type GtdCard = WorkbenchTask & { projects: string[] };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function GtdView({ active }: { active: boolean }): React.ReactPortal | null {
  const host = document.getElementById("react-gtd");
  const { ready, t } = useI18n();
  const [items, setItems] = useState<GtdCard[]>([]);
  const [rollups, setRollups] = useState<Record<string, TaskGtdRollup>>({});
  const [dotByKey, setDotByKey] = useState<Map<string, ActiveSessionDot>>(new Map());
  const [query, setQuery] = useState("");
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const [dragTemplate, setDragTemplate] = useState<TaskTemplate | null>(null);
  const [dropColumn, setDropColumn] = useState<GtdStatus | null>(null);
  const [renaming, setRenaming] = useState<{ noteId: string; value: string; busy: boolean } | null>(null);
  const renameCommitSkipRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const [newTask, setNewTask] = useState<{ title: string; projectPath: string; busy: boolean; error: string } | null>(null);
  const [workbenchesByTask, setWorkbenchesByTask] = useState<Record<string, Workbench[]>>({});
  /** Tasks whose workbench already has a window, so the card can say so. */
  const [tasksWithWindows, setTasksWithWindows] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: GtdCard } | null>(null);

  const text = useCallback(
    (key: string, ...args: Array<string | number>) => (ready ? t(key, ...args) : key),
    [ready, t]
  );

  const load = useCallback(async () => {
    if (typeof desktopApi().notesListTasks !== "function") return;
    try {
      const [records, nextRollups] = await Promise.all([
        desktopApi().notesListTasks(),
        typeof desktopApi().listTaskGtdRollups === "function"
          ? desktopApi().listTaskGtdRollups().catch(() => ({} as Record<string, TaskGtdRollup>))
          : Promise.resolve({} as Record<string, TaskGtdRollup>)
      ]);
      setItems(records.map((record) => {
        const item = taskFromRecord(record);
        return { ...item, projects: item.projects ?? [] };
      }));
      setRollups(nextRollups || {});
    } catch {
      /* the board is best-effort; the task list stays the source of truth */
    }
  }, []);

  /** Column status: the rollup unless the task is pinned by its own mark. */
  const statusOf = useCallback(
    (item: GtdCard): GtdStatus => rollups[item.noteId]?.status ?? item.status ?? "inbox",
    [rollups]
  );

  const loadOpenWindows = useCallback(async () => {
    if (typeof desktopApi().taskWindowList !== "function") return;
    try {
      const windows = await desktopApi().taskWindowList();
      setTasksWithWindows(new Set(windows.map((entry) => entry.noteId)));
    } catch {
      /* the board works without the badge */
    }
  }, []);

  const loadWorkbenches = useCallback(async () => {
    const list = await listAllTaskWorkbenches();
    const map: Record<string, Workbench[]> = {};
    for (const workbench of list) {
      (map[workbench.taskNoteId] ??= []).push(workbench);
    }
    setWorkbenchesByTask(map);
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    void loadWorkbenches();
    void loadOpenWindows();
  }, [active, load, loadWorkbenches, loadOpenWindows]);

  // The host broadcasts the window set, so the badge follows open/close.
  useEffect(() => {
    const stop = desktopApi().onTaskWindowsChanged?.((windows) => {
      setTasksWithWindows(new Set(windows.map((entry) => entry.noteId)));
    });
    return () => stop?.();
  }, []);

  useEffect(() => {
    const onMutated = () => { void load(); void loadWorkbenches(); };
    window.addEventListener("agent-resume:notes-mutated", onMutated);
    return () => window.removeEventListener("agent-resume:notes-mutated", onMutated);
  }, [load, loadWorkbenches]);

  useEffect(() => {
    const onActiveSessions = (event: Event) => {
      const detail = (event as CustomEvent<ActiveSessionDot[]>).detail;
      if (!Array.isArray(detail)) return;
      const map = new Map<string, ActiveSessionDot>();
      for (const dot of detail) map.set(dot.sessionKey || dot.paneKey, dot);
      setDotByKey(map);
    };
    window.addEventListener("agent-resume:active-sessions", onActiveSessions);
    return () => window.removeEventListener("agent-resume:active-sessions", onActiveSessions);
  }, []);

  /**
   * Open a task's workbench in its own window, focusing it when it is open.
   *
   * A workbench owns the panes and their ptys, so exactly one of them exists:
   * the board opens and focuses windows instead of mounting a second copy.
   */
  const openTask = useCallback(async (item: GtdCard, workbenchId?: string): Promise<void> => {
    try {
      const workbenches = workbenchId ? [] : await ensureTaskWorkbenches(item.noteId);
      const target = workbenchId ?? workbenches[0]?.workbenchId;
      if (!target) throw new Error(text("desktop.gtd.windowNoWorkbench"));
      const opened = await desktopApi().taskWindowOpen({
        noteId: item.noteId,
        workbenchId: target,
        title: item.title
      });
      if (!opened.ok) {
        notifyDesktop({ text: text("desktop.gtd.windowLimit", opened.limit), kind: "error", durationMs: 6000 });
      }
    } catch (error) {
      notifyDesktop({ text: errorMessage(error), kind: "error" });
    }
  }, [text]);

  /** The task note is a note: it opens in its own floating window. */
  const openTaskNote = useCallback(async (item: GtdCard): Promise<void> => {
    try {
      await desktopApi().standaloneNoteOpen({ noteId: item.noteId });
    } catch (error) {
      notifyDesktop({ text: errorMessage(error), kind: "error" });
    }
  }, []);

  const openNewTask = useCallback(() => {
    setNewTask({ title: "", projectPath: "", busy: false, error: "" });
  }, []);

  useEffect(() => {
    const onNewTask = () => openNewTask();
    window.addEventListener("agent-resume:gtd-new-task", onNewTask);
    return () => window.removeEventListener("agent-resume:gtd-new-task", onNewTask);
  }, [openNewTask]);

  /** The host refuses a fifth workbench window; say so where the user is looking. */
  useEffect(() => {
    const stop = desktopApi().onTaskWindowLimit?.(({ limit }) => {
      notifyDesktop({ text: text("desktop.gtd.windowLimit", limit), kind: "error", durationMs: 6000 });
    });
    return () => stop?.();
  }, [text]);

  const pickProject = useCallback(async () => {
    if (!newTask || newTask.busy) return;
    if (typeof desktopApi().pickDirectory !== "function") return;
    try {
      // Pick a folder for THIS task only — do not register it as a project.
      const result = await desktopApi().pickDirectory({ title: text("desktop.gtd.taskProject") });
      if (!result.ok) return;
      setNewTask((current) => current ? { ...current, projectPath: result.path, error: "" } : current);
    } catch (error) {
      setNewTask((current) => current ? { ...current, error: error instanceof Error ? error.message : String(error) } : current);
    }
  }, [newTask, text]);

  const createTask = useCallback(async () => {
    if (!newTask || newTask.busy) return;
    const title = newTask.title.trim();
    if (!title) {
      setNewTask((current) => current ? { ...current, error: text("desktop.gtd.taskTitleRequired") } : current);
      return;
    }
    if (typeof desktopApi().notesCreateTask !== "function") return;
    setNewTask((current) => current ? { ...current, busy: true, error: "" } : current);
    setCreating(true);
    try {
      const created = await desktopApi().notesCreateTask({
        title,
        ...(newTask.projectPath
          ? { projects: [newTask.projectPath], primaryProject: newTask.projectPath }
          : {})
      });
      await load();
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      setNewTask(null);
      void openTask({ ...taskFromRecord(created), projects: created.work?.projects ?? [] });
    } catch (error) {
      setNewTask((current) => current ? { ...current, busy: false, error: error instanceof Error ? error.message : String(error) } : current);
    } finally {
      setCreating(false);
    }
  }, [newTask, load, openTask, text]);

  const setStatus = useCallback(async (noteId: string, status: GtdStatus) => {
    try {
      await desktopApi().notesSetGtdStatus({ noteId, status });
      setItems((current) => current.map((item) => item.noteId === noteId ? { ...item, status } : item));
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      void load();
    } catch {
      void load();
    }
  }, [load]);

  /** Clear the pin so the task follows its children/sessions again. */
  const clearPin = useCallback(async (noteId: string) => {
    try {
      await desktopApi().notesSetGtdStatus({ noteId, status: null });
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      await load();
    } catch {
      void load();
    }
  }, [load]);

  /** Drop a template onto a column: create the task pre-filled, then rename inline. */
  const createFromTemplate = useCallback(async (template: TaskTemplate, status: GtdStatus) => {
    if (typeof desktopApi().notesCreateTask !== "function") return;
    try {
      const created = await desktopApi().notesCreateTask({
        title: template.title,
        ...(template.projectPaths.length > 0
          ? { projects: template.projectPaths, primaryProject: template.projectPaths[0] }
          : {}),
        status
      });
      await load();
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      renameCommitSkipRef.current = false;
      setRenaming({ noteId: created.noteId, value: created.title || template.title, busy: false });
    } catch {
      /* best-effort; the board reloads on the next mutation */
    }
  }, [load]);

  const startRename = useCallback((item: GtdCard) => {
    renameCommitSkipRef.current = false;
    setRenaming({ noteId: item.noteId, value: item.title, busy: false });
  }, []);

  const commitRename = useCallback(async () => {
    const current = renaming;
    if (!current || current.busy) return;
    const title = current.value.trim();
    const item = items.find((entry) => entry.noteId === current.noteId);
    if (!title || !item || title === item.title) {
      renameCommitSkipRef.current = true;
      setRenaming(null);
      return;
    }
    if (typeof desktopApi().notesRenameTask !== "function") {
      renameCommitSkipRef.current = true;
      setRenaming(null);
      return;
    }
    setRenaming((entry) => entry ? { ...entry, busy: true } : entry);
    try {
      await desktopApi().notesRenameTask({ noteId: current.noteId, title });
      setItems((list) => list.map((entry) => entry.noteId === current.noteId ? { ...entry, title } : entry));
      renameCommitSkipRef.current = true;
      setRenaming(null);
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch {
      setRenaming((entry) => entry ? { ...entry, busy: false } : entry);
    }
  }, [renaming, items]);

  /** Delete a task that has never been linked to a session. */
  const deleteTask = useCallback(async (item: GtdCard) => {
    setContextMenu(null);
    if (item.sessions.length > 0) return;
    if (typeof desktopApi().notesDelete !== "function") return;
    if (!window.confirm(text("desktop.workbench.deleteTaskConfirm", item.title))) return;
    try {
      await desktopApi().notesDelete({ noteId: item.noteId });
      setItems((current) => current.filter((entry) => entry.noteId !== item.noteId));
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      void load();
    } catch {
      /* best-effort; the board reloads on the next mutation */
    }
  }, [text, load]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".wb-context-menu")) setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setContextMenu(null); };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.title} ${item.projects.join(" ")}`.toLowerCase().includes(q));
  }, [items, query]);

  const columns = useMemo(() => GTD_COLUMNS.map((status) => ({
    status,
    items: filtered
      .filter((item) => statusOf(item) === status)
      .sort((a, b) => {
        const rankA = rollupDot({ work: { sessions: a.sessions } }, dotByKey)?.status === "awaiting_user" ? 1 : 0;
        const rankB = rollupDot({ work: { sessions: b.sessions } }, dotByKey)?.status === "awaiting_user" ? 1 : 0;
        return rankB - rankA || (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
      })
  })), [filtered, dotByKey, statusOf]);

  /** Arrow-key navigation across the board: within a column, and to the nearest card in the next column. */
  const onBoardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight") return;
    const card = (event.target as HTMLElement).closest<HTMLElement>("[data-gtd-card]");
    if (!card) return;
    const columnEl = card.closest<HTMLElement>("[data-gtd-column]");
    if (!columnEl) return;
    const cards = [...columnEl.querySelectorAll<HTMLElement>("[data-gtd-card]")];
    const index = cards.indexOf(card);
    if (key === "ArrowUp" || key === "ArrowDown") {
      const next = cards[index + (key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      next.focus();
      return;
    }
    const direction = key === "ArrowRight" ? 1 : -1;
    const status = columnEl.dataset.gtdColumn as GtdStatus;
    let columnIndex = GTD_COLUMNS.indexOf(status) + direction;
    while (columnIndex >= 0 && columnIndex < GTD_COLUMNS.length) {
      const targetColumn = event.currentTarget.querySelector<HTMLElement>(`[data-gtd-column="${GTD_COLUMNS[columnIndex]}"]`);
      const targetCards = targetColumn ? [...targetColumn.querySelectorAll<HTMLElement>("[data-gtd-card]")] : [];
      if (targetCards.length) {
        event.preventDefault();
        targetCards[Math.min(index, targetCards.length - 1)].focus();
        return;
      }
      columnIndex += direction;
    }
  };

  if (!host) return null;

  const headerSlot = document.getElementById("app-header-slot");
  const toolbar = (
    <div className="gtd-toolbar">
      <span className="gtd-toolbar-title">
        <ThemeIcon name="square-kanban" size={15} aria-hidden="true" />
        {text("desktop.gtd.title")}
      </span>
      <div className="gtd-toolbar-actions">
        <input
          className="gtd-search"
          type="search"
          value={query}
          placeholder={text("desktop.gtd.filter")}
          aria-label={text("desktop.gtd.filter")}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="gtd-new-btn"
          aria-label={text("desktop.gtd.newTask")}
          title={text("desktop.gtd.newTask")}
          disabled={creating}
          onClick={openNewTask}
        >
          <ThemeIcon name={creating ? "loader" : "plus"} className={creating ? "spin" : undefined} size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  return createPortal(<>
    {active && headerSlot ? createPortal(toolbar, headerSlot) : null}
    <section className="panel workbench-panel react-gtd-panel" hidden={!active} aria-label={text("desktop.gtd.title")}>
      <TaskTemplatePanel active={active} onDragTemplateChange={setDragTemplate} />
      <div className="gtd-board" onKeyDown={onBoardKeyDown}>
        {columns.map(({ status, items: columnItems }) => (
          <div
            key={status}
            className={`gtd-column${dropColumn === status ? " is-drop-target" : ""}`}
            data-gtd-column={status}
            onDragOver={(event) => {
              if (!dragNoteId && !dragTemplate) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = dragTemplate ? "copy" : "move";
              setDropColumn(status);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setDropColumn((current) => current === status ? null : current);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const template = dragTemplate;
              const noteId = dragNoteId || event.dataTransfer.getData("text/plain");
              setDragNoteId(null);
              setDragTemplate(null);
              setDropColumn(null);
              if (template) {
                void createFromTemplate(template, status);
              } else if (noteId) {
                void setStatus(noteId, status);
              }
            }}
          >
            <div className="gtd-column-head">
              <span className={`wb-gtd-status-dot is-${status}`} aria-hidden="true" />
              <span className="gtd-column-title">{text(`desktop.workbench.gtdStatus.${status}`)}</span>
              <span className="gtd-column-count">{columnItems.length}</span>
            </div>
            <div className="gtd-column-body">
              {columnItems.map((item) => {
                const dot = rollupDot({ work: { sessions: item.sessions } }, dotByKey);
                const waiting = needsYou(dot);
                const taskWorkbenches = workbenchesByTask[item.noteId] ?? [];
                return (
                  <div
                    key={item.noteId}
                    draggable
                    className={`gtd-card${waiting ? " is-needs-you" : ""}`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({ x: event.clientX, y: event.clientY, item });
                    }}
                    onDragStart={(event) => {
                      setDragNoteId(item.noteId);
                      event.dataTransfer.setData("text/plain", item.noteId);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => { setDragNoteId(null); setDropColumn(null); }}
                  >
                    {renaming?.noteId === item.noteId ? (
                      <div className="gtd-card-main gtd-card-main-renaming">
                        <input
                          className="gtd-card-rename"
                          autoFocus
                          value={renaming.value}
                          aria-label={text("desktop.gtd.taskTitle")}
                          disabled={renaming.busy}
                          onFocus={(event) => event.currentTarget.select()}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => setRenaming((current) => current ? { ...current, value: event.target.value } : current)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void commitRename();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              renameCommitSkipRef.current = true;
                              setRenaming(null);
                            }
                          }}
                          onBlur={() => {
                            if (renameCommitSkipRef.current) {
                              renameCommitSkipRef.current = false;
                              return;
                            }
                            void commitRename();
                          }}
                        />
                      </div>
                    ) : (
                    <button
                      type="button"
                      data-gtd-card="true"
                      data-gtd-note-id={item.noteId}
                      className="gtd-card-main"
                      title={item.title}
                      onClick={() => void openTask(item)}
                    >
                      <span className="gtd-card-title">{item.title}</span>
                      {item.next ? <span className="gtd-card-next">{item.next}</span> : null}
                      <span className="gtd-card-meta">
                        {dot && dot.status !== "open" ? <span className={`session-dot${sessionDotStatusClass(dot.status)}`} aria-hidden="true" /> : null}
                        <span className="gtd-card-meta-item">
                          <ThemeIcon name="bot" size={12} aria-hidden="true" />
                          {item.sessions.length}
                        </span>
                        <span className="gtd-card-meta-item">
                          <ThemeIcon name="square-kanban" size={12} aria-hidden="true" />
                          {taskWorkbenches.length || item.projects.length}
                        </span>
                        {rollups[item.noteId]?.total ? (
                          <span className="gtd-card-meta-item gtd-card-rollup" title={text("desktop.gtd.rollupHint")}>
                            {text("desktop.gtd.rollupProgress", rollups[item.noteId].counts.done, rollups[item.noteId].total)}
                          </span>
                        ) : null}
                        {tasksWithWindows.has(item.noteId) ? (
                          <span className="gtd-card-window" title={text("desktop.gtd.windowOpen")}>
                            <ThemeIcon name="app-window" size={12} aria-hidden="true" />
                          </span>
                        ) : null}
                        {rollups[item.noteId]?.override ? (
                          <span className="gtd-card-pin" title={text("desktop.gtd.pinnedHint")}>{text("desktop.gtd.pinned")}</span>
                        ) : null}
                      </span>
                    </button>
                    )}
                    {taskWorkbenches.length > 0 ? (
                      <div className="gtd-card-projects">
                        {taskWorkbenches.slice(0, 3).map((workbench) => (
                          <button
                            key={workbench.workbenchId}
                            type="button"
                            className="gtd-card-project"
                            title={workbench.projectPath || workbenchDisplayName(workbench)}
                            onClick={() => void openTask(item, workbench.workbenchId)}
                          >
                            {workbenchDisplayName(workbench)}
                          </button>
                        ))}
                        {taskWorkbenches.length > 3 ? <span className="gtd-card-project is-more">+{taskWorkbenches.length - 3}</span> : null}
                      </div>
                    ) : item.projects.length > 0 ? (
                      <div className="gtd-card-projects">
                        {item.projects.slice(0, 3).map((projectPath) => (
                          <button
                            key={projectPath}
                            type="button"
                            className="gtd-card-project"
                            title={projectPath}
                            onClick={() => void openTask(item)}
                          >
                            {projectPath.split(/[\\/]/).filter(Boolean).at(-1) || projectPath}
                          </button>
                        ))}
                        {item.projects.length > 3 ? <span className="gtd-card-project is-more">+{item.projects.length - 3}</span> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {columnItems.length === 0 ? <p className="gtd-column-empty">{text("desktop.gtd.emptyColumn")}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
    {newTask ? (
      <div className="wb-note-created-overlay">
        <div className="wb-note-created-backdrop" onClick={() => { if (!newTask.busy) setNewTask(null); }} />
        <form
          className="wb-note-created-panel gtd-new-task-panel"
          role="dialog"
          aria-modal="true"
          aria-label={text("desktop.gtd.newTask")}
          onSubmit={(event) => { event.preventDefault(); void createTask(); }}
        >
          <p className="wb-note-created-title">{text("desktop.gtd.newTask")}</p>
          <label className="gtd-new-task-field">
            <span>{text("desktop.gtd.taskTitle")}</span>
            <input
              className="wb-rename-input"
              autoFocus
              value={newTask.title}
              aria-label={text("desktop.gtd.taskTitle")}
              onChange={(event) => setNewTask((current) => current ? { ...current, title: event.target.value, error: "" } : current)}
            />
          </label>
          <div className="gtd-new-task-field">
            <span>{text("desktop.gtd.taskProject")}</span>
            <div className="gtd-new-task-project">
              <button type="button" className="wb-note-created-btn" onClick={() => void pickProject()}>{text("desktop.gtd.chooseProject")}</button>
              {newTask.projectPath ? (
                <span className="gtd-new-task-project-path" title={newTask.projectPath}>
                  {newTask.projectPath.split(/[\\/]/).filter(Boolean).at(-1) || newTask.projectPath}
                  <button
                    type="button"
                    className="gtd-new-task-project-clear"
                    aria-label={text("desktop.common.close")}
                    onClick={() => setNewTask((current) => current ? { ...current, projectPath: "" } : current)}
                  ><ThemeIcon name="close" size={12} /></button>
                </span>
              ) : null}
            </div>
          </div>
          {newTask.error ? <p className="gtd-new-task-error" role="alert">{newTask.error}</p> : null}
          <div className="wb-note-created-actions">
            <button type="button" className="wb-note-created-btn" disabled={newTask.busy} onClick={() => setNewTask(null)}>{text("desktop.common.cancel")}</button>
            <button type="submit" className="wb-note-created-btn primary" disabled={newTask.busy}>{text("desktop.gtd.createTask")}</button>
          </div>
        </form>
      </div>
    ) : null}
    {contextMenu ? (
      <div
        className="wb-context-menu"
        role="menu"
        style={{
          left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 220)),
          top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 120))
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => { const item = contextMenu.item; setContextMenu(null); startRename(item); }}
        >{text("desktop.common.rename")}</button>
        <button
          type="button"
          role="menuitem"
          onClick={() => { const item = contextMenu.item; setContextMenu(null); void openTaskNote(item); }}
        >{text("desktop.workbench.taskOpenNote")}</button>
        <button
          type="button"
          role="menuitem"
          onClick={() => { const item = contextMenu.item; setContextMenu(null); void openTask(item); }}
        >{text("desktop.gtd.openInWindow")}</button>
        {rollups[contextMenu.item.noteId]?.override ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => { const item = contextMenu.item; setContextMenu(null); void clearPin(item.noteId); }}
          >{text("desktop.gtd.followChildren")}</button>
        ) : null}
        {contextMenu.item.sessions.length === 0 ? (
          <>
            <div className="context-menu-separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="context-menu-item-danger"
              onClick={() => void deleteTask(contextMenu.item)}
            >{text("desktop.workbench.deleteTask")}</button>
          </>
        ) : null}
      </div>
    ) : null}
  </>, host);
}
