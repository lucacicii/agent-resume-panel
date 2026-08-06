import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactPortal } from "react";
import type { AgentSession } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Status, type StatusKind } from "../../components/Status";
import { KanbanCardModal } from "./KanbanCardModal";
import { ThemeIcon } from "../../components/ThemeIcon";
import { GTD_STATUSES, type GtdStatus } from "../../gtd";
import { useI18n } from "../../i18n";
import { storedWidth } from "../../storage";
import { FloatingSessionNote, type FloatingNoteTarget } from "../workbench/FloatingSessionNote";

type Note = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesList"]>>[number];
type Session = AgentSession;

type KanbanCard =
  | { kind: "session"; key: string; session: Session; status: GtdStatus }
  | { kind: "note"; key: string; note: Note; status: GtdStatus };

type SourceFilter = "all" | "sessions" | "notes";
type PanelStatus = { text: string; kind?: StatusKind };

type CatalogProject = {
  projectId: string;
  portableKey: string;
  alias: string;
  hidden: boolean;
  pinned: boolean;
  lastSeenAtMs: number | null;
  updatedAtMs: number;
  localPath: string | null;
  pathMissing: boolean;
  sessionCount: number;
};

const SIDEBAR_COLLAPSED_KEY = "kanban-sidebar-collapsed";
const SIDEBAR_WIDTH_KEY = "kanban-sidebar-width";
const SELECTED_PROJECT_KEY = "kanban-selected-project";

function storageBoolean(key: string): boolean {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}

function sessionKey(session: Pick<Session, "provider" | "id">): string {
  return `${session.provider}:${session.id}`;
}

function basename(value = ""): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

function relativeTime(ms: number, t: (key: string, ...args: Array<string | number>) => string): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return t("desktop.common.justNow");
  if (diff < 3_600_000) return t("desktop.common.minutesAgo", Math.floor(diff / 60_000));
  if (diff < 86_400_000) return t("desktop.common.hoursAgo", Math.floor(diff / 3_600_000));
  return t("desktop.common.daysAgo", Math.floor(diff / 86_400_000));
}

function titleOf(card: KanbanCard): string {
  if (card.kind === "session") return card.session.title.trim() || card.session.id;
  const note = card.note;
  return (note.title || note.filename.replace(/\.md$/i, "") || note.noteId).trim();
}

function matchesQuery(card: KanbanCard, query: string): boolean {
  if (!query) return true;
  const haystack = `${titleOf(card)} ${card.kind === "session" ? card.session.projectPath : card.note.projectPath || ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function projectPathOf(project: CatalogProject): string {
  return project.localPath || project.portableKey;
}

/** Resolves a card to the projectId it belongs to, or null if it has no project. */
export function cardProjectId(card: KanbanCard, projects: CatalogProject[]): string | null {
  if (card.kind === "session") {
    if (card.session.projectId) {
      const byId = projects.find((project) => project.projectId === card.session.projectId);
      if (byId) return byId.projectId;
    }
    const path = card.session.projectPath;
    if (path) {
      const byPath = projects.find((project) => {
        const pp = projectPathOf(project);
        return pp && (pp === path || project.localPath === path || project.portableKey === path);
      });
      if (byPath) return byPath.projectId;
    }
    return null;
  }
  // Library / session-scoped notes are not attached to a project.
  if (card.note.scope !== "project" || !card.note.projectPath) return null;
  const notePath = card.note.projectPath;
  const byPath = projects.find((project) => {
    const pp = projectPathOf(project);
    return pp && (pp === notePath || project.localPath === notePath || project.portableKey === notePath);
  });
  return byPath ? byPath.projectId : null;
}

export function KanbanPanel(): ReactPortal | null {
  const host = document.getElementById("react-kanban");
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [status, setStatus] = useState<PanelStatus>({ text: "" });
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [loading, setLoading] = useState(false);
  const draggingKey = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [doneCollapsed, setDoneCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("kanban-done-collapsed") !== "0"; } catch { return true; }
  });
  const [projects, setProjects] = useState<CatalogProject[]>([]);
  const [detail, setDetail] = useState<{ kind: "note"; note: Note } | { kind: "session"; session: Session } | null>(null);
  const [floatingNoteTarget, setFloatingNoteTarget] = useState<FloatingNoteTarget | null>(null);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    try { return localStorage.getItem(SELECTED_PROJECT_KEY) || ""; } catch { return ""; }
  });
  const [projectQuery, setProjectQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => storageBoolean(SIDEBAR_COLLAPSED_KEY));
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => storedWidth(SIDEBAR_WIDTH_KEY, 260, 160, 360));
  const toggleDone = useCallback(() => {
    setDoneCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem("kanban-done-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const selectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    try { localStorage.setItem(SELECTED_PROJECT_KEY, projectId); } catch { /* ignore */ }
  }, []);
  const resizeSidebar = useCallback((delta: number) => {
    setSidebarWidth((current) => {
      const next = Math.min(360, Math.max(160, Math.round(current + delta)));
      try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const addNoteTarget = useCallback((statusValue: GtdStatus): FloatingNoteTarget => {
    const project = projects.find((item) => item.projectId === selectedProjectId);
    if (project) {
      const path = projectPathOf(project);
      return {
        kind: "project",
        projectPath: path,
        projectName: aliases[path] || project.alias || basename(path),
        initialGtdStatus: statusValue
      };
    }
    return { kind: "library", initialGtdStatus: statusValue };
  }, [aliases, projects, selectedProjectId]);

  const setError = useCallback((error: unknown) => {
    setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const listProjects = typeof desktopApi().listProjects === "function"
        ? desktopApi().listProjects()
        : Promise.resolve([] as CatalogProject[]);
      const listAliases = typeof desktopApi().listProjectAliases === "function"
        ? desktopApi().listProjectAliases()
        : Promise.resolve({} as Record<string, string>);
      const [sessions, statuses, notes, nextProjects, nextAliases] = await Promise.all([
        desktopApi().listSessions(),
        desktopApi().listSessionGtdStatuses(),
        desktopApi().notesList(),
        listProjects,
        listAliases
      ]);
      setProjects(nextProjects);
      setAliases(nextAliases);
      setSelectedProjectId((current) => {
        if (!current || nextProjects.some((project) => project.projectId === current)) return current;
        try { localStorage.setItem(SELECTED_PROJECT_KEY, ""); } catch { /* ignore */ }
        return "";
      });
      const next: KanbanCard[] = [];
      for (const session of sessions) {
        const mapped = statuses[sessionKey(session)];
        if (mapped) next.push({ kind: "session", key: `session:${session.provider}:${session.id}`, session, status: mapped });
      }
      for (const note of notes) {
        if (note.gtdStatus) next.push({ kind: "note", key: `note:${note.noteId}`, note, status: note.gtdStatus });
      }
      setCards(next);
      setStatus({ text: "" });
    } catch (error) {
      setError(error);
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    const onTab = (event: Event) => {
      const show = (event as CustomEvent<string>).detail === "kanban";
      setActive(show);
      if (show) void load();
    };
    window.addEventListener("agent-resume:tab-change", onTab);
    return () => window.removeEventListener("agent-resume:tab-change", onTab);
  }, [load]);

  // Keep the board fresh when sessions are synced elsewhere in the app.
  useEffect(() => {
    if (!active || typeof desktopApi().onSessionsSynced !== "function") return;
    return desktopApi().onSessionsSynced(() => { void load(); });
  }, [active, load]);

  const visible = useMemo(() => {
    const q = query.trim();
    return cards.filter((card) => {
      if (source === "sessions" && card.kind !== "session") return false;
      if (source === "notes" && card.kind !== "note") return false;
      if (selectedProjectId) {
        const pid = cardProjectId(card, projects);
        if (pid !== selectedProjectId) return false;
      }
      return matchesQuery(card, q);
    });
  }, [cards, query, selectedProjectId, projects, source]);

  // Project counts use the source-filtered set (before text query and project selection),
  // matching the Notes/Workbench project-folder count behavior.
  const sourceFiltered = useMemo(() => cards.filter((card) => {
    if (source === "sessions" && card.kind !== "session") return false;
    if (source === "notes" && card.kind !== "note") return false;
    return true;
  }), [cards, source]);

  const projectRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of sourceFiltered) {
      const pid = cardProjectId(card, projects);
      if (pid) counts.set(pid, (counts.get(pid) || 0) + 1);
    }
    const q = projectQuery.trim().toLowerCase();
    return projects
      .map((project) => ({
        project,
        path: projectPathOf(project),
        label: aliases[projectPathOf(project)] || project.alias || basename(projectPathOf(project)),
        count: counts.get(project.projectId) || 0
      }))
      .filter((row) => !q
        || row.label.toLowerCase().includes(q)
        || row.path.toLowerCase().includes(q));
  }, [aliases, projectQuery, projects, sourceFiltered]);

  const byStatus = useMemo(() => {
    const groups = new Map<GtdStatus, KanbanCard[]>(GTD_STATUSES.map((s) => [s, []]));
    for (const card of visible) groups.get(card.status)?.push(card);
    return groups;
  }, [visible]);

  const cardIndex = useMemo(() => {
    const map = new Map<string, KanbanCard>();
    for (const card of cards) map.set(card.key, card);
    return map;
  }, [cards]);

  const moveCard = useCallback(async (card: KanbanCard, target: GtdStatus) => {
    if (card.status === target) return;
    // Optimistic local move for snappy feedback.
    setCards((current) => current.map((item) => item.key === card.key ? { ...item, status: target } as KanbanCard : item));
    try {
      if (card.kind === "session") {
        await desktopApi().setSessionGtdStatus({ provider: card.session.provider, id: card.session.id, status: target });
      } else {
        await desktopApi().notesSetGtdStatus({ noteId: card.note.noteId, status: target });
      }
      setStatus({ text: t("desktop.kanban.moved"), kind: "ok" });
    } catch (error) {
      setError(error);
      void load();
    }
  }, [load, setError, t]);

  const onDrop = useCallback((statusValue: GtdStatus) => {
    const key = draggingKey.current;
    setDropTarget(null);
    draggingKey.current = null;
    if (!key) return;
    const card = cardIndex.get(key);
    if (card) void moveCard(card, statusValue);
  }, [cardIndex, moveCard]);

  const openCard = useCallback((card: KanbanCard) => {
    if (card.kind === "note") {
      setDetail({ kind: "note", note: card.note });
    } else {
      setDetail({ kind: "session", session: card.session });
    }
  }, []);

  const archiveCard = useCallback(async (card: KanbanCard) => {
    setCards((current) => current.filter((item) => item.key !== card.key));
    try {
      if (card.kind === "session") {
        await desktopApi().setSessionGtdStatus({ provider: card.session.provider, id: card.session.id, status: null });
      } else {
        await desktopApi().notesSetGtdStatus({ noteId: card.note.noteId, status: null });
      }
      setStatus({ text: t("desktop.kanban.archived"), kind: "ok" });
    } catch (error) {
      setError(error);
      void load();
    }
  }, [load, setError, t]);

  const archiveAllDone = useCallback(async () => {
    const done = cards.filter((card) => card.status === "done");
    if (!done.length) return;
    if (!window.confirm(t("desktop.kanban.archiveAllConfirm", done.length))) return;
    setCards((current) => current.filter((card) => card.status !== "done"));
    try {
      await Promise.all(done.map((card) =>
        card.kind === "session"
          ? desktopApi().setSessionGtdStatus({ provider: card.session.provider, id: card.session.id, status: null })
          : desktopApi().notesSetGtdStatus({ noteId: card.note.noteId, status: null })
      ));
      setStatus({ text: t("desktop.kanban.archived"), kind: "ok" });
    } catch (error) {
      setError(error);
      void load();
    }
  }, [cards, load, setError, t]);

  if (!host) return null;

  const total = visible.length;

  return createPortal(
    <section className="react-kanban-panel panel" hidden={!active} aria-label={t("desktop.kanban.title")}>
      <div className="kanban-toolbar">
        <div className="kanban-toolbar-controls">
          <button
            type="button"
            className="tool-btn ghost-btn"
            onClick={toggleSidebar}
            aria-label={t(sidebarCollapsed ? "desktop.common.showSidebar" : "desktop.common.hideSidebar")}
            title={t(sidebarCollapsed ? "desktop.common.showSidebar" : "desktop.common.hideSidebar")}
            aria-expanded={!sidebarCollapsed}
          >
            <ThemeIcon name="panel-right" size={16} />
          </button>
          <SegmentedControl<SourceFilter>
            value={source}
            options={["all", "sessions", "notes"]}
            onChange={setSource}
            aria-label={t("desktop.kanban.sourceFilter")}
            className="sidebar-project-filter-segmented kanban-source-filter"
            getLabel={(value) => t(`desktop.kanban.source.${value}`)}
          />
          <input
            type="search"
            className="kanban-search"
            placeholder={t("desktop.common.search")}
            aria-label={t("desktop.common.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="tool-btn"
            onClick={() => void load()}
            aria-label={t("desktop.common.refresh")}
            title={t("desktop.common.refresh")}
            disabled={loading}
          >
            {t("desktop.common.refresh")}
          </button>
        </div>
        <div className="kanban-toolbar-title">
          <strong>{t("desktop.kanban.title")}</strong>
          <span className="kanban-toolbar-count">{t("desktop.kanban.itemCount", total)}</span>
        </div>
      </div>

      <div className="kanban-split">
        <aside
          className={`sidebar-folders-pane kanban-folders-pane${sidebarCollapsed ? " is-collapsed" : ""}`}
          style={sidebarCollapsed ? undefined : { width: sidebarWidth }}
          aria-label={t("desktop.kanban.projects")}
        >
          {!sidebarCollapsed && (
            <div className="kanban-folders">
              <label className="sidebar-project-search-wrap">
                <input
                  type="search"
                  className="sidebar-project-search"
                  placeholder={t("desktop.notes.filterProjects")}
                  aria-label={t("desktop.notes.filterProjects")}
                  value={projectQuery}
                  onChange={(event) => setProjectQuery(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={`kanban-folder-row${selectedProjectId === "" ? " active" : ""}`}
                onClick={() => selectProject("")}
                aria-label={t("desktop.kanban.allProjects")}
              >
                <span className="kanban-folder-label">{t("desktop.kanban.allProjects")}</span>
                <span className="kanban-folder-count">{sourceFiltered.length}</span>
              </button>
              {projectRows.length ? projectRows.map((row) => (
                <button
                  type="button"
                  key={row.project.projectId}
                  title={row.path}
                  className={`kanban-folder-row${selectedProjectId === row.project.projectId ? " active" : ""}`}
                  onClick={() => selectProject(row.project.projectId)}
                  aria-label={row.label}
                >
                  {row.project.pinned ? <ThemeIcon name="pin" size={12} className="kanban-folder-pin" aria-hidden="true" /> : null}
                  <span className="kanban-folder-label">{row.label}</span>
                  <span className="kanban-folder-count">{row.count}</span>
                </button>
              )) : <p className="kanban-folder-empty">{t("desktop.kanban.noProjects")}</p>}
            </div>
          )}
        </aside>
        {!sidebarCollapsed && (
          <div
            className="pane-resizer kanban-pane-resizer"
            role="separator"
            aria-label={t("desktop.common.showSidebar")}
            onPointerDown={(event) => {
              event.preventDefault();
              let previous = event.clientX;
              document.body.classList.add("is-pane-resizing");
              const move = (next: PointerEvent) => {
                resizeSidebar(next.clientX - previous);
                previous = next.clientX;
              };
              const up = () => {
                document.body.classList.remove("is-pane-resizing");
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          />
        )}
      <div className="kanban-board">
        {GTD_STATUSES.map((statusValue) => {
          const column = byStatus.get(statusValue) || [];
          const isTarget = dropTarget === statusValue;
          const isDone = statusValue === "done";
          const collapsed = isDone && doneCollapsed;
          return (
            <div
              key={statusValue}
              className={`kanban-column is-${statusValue}${isTarget ? " is-drop-target" : ""}${collapsed ? " is-collapsed" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDropTarget(statusValue); }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget((current) => current === statusValue ? null : current);
              }}
              onDrop={(event) => { event.preventDefault(); onDrop(statusValue); }}
            >
              <div className="kanban-column-head">
                {isDone ? (
                  <button
                    type="button"
                    className="kanban-column-toggle"
                    onClick={toggleDone}
                    aria-expanded={!collapsed}
                    aria-label={t(`desktop.workbench.gtdStatus.${statusValue}`)}
                  >
                    <ThemeIcon name={collapsed ? "chevron-right" : "chevron-down"} size={12} aria-hidden="true" />
                    <span className={`kanban-status-dot is-${statusValue}`} aria-hidden="true" />
                    <span className="kanban-column-title">{t(`desktop.workbench.gtdStatus.${statusValue}`)}</span>
                    <span className="kanban-column-count">{column.length}</span>
                  </button>
                ) : (
                  <>
                    <span className={`kanban-status-dot is-${statusValue}`} aria-hidden="true" />
                    <span className="kanban-column-title">{t(`desktop.workbench.gtdStatus.${statusValue}`)}</span>
                    <span className="kanban-column-count">{column.length}</span>
                    {source === "notes" ? (
                      <button
                        type="button"
                        className="kanban-column-add-note"
                        onClick={() => setFloatingNoteTarget(addNoteTarget(statusValue))}
                        title={t("desktop.kanban.addNote", t(`desktop.workbench.gtdStatus.${statusValue}`))}
                        aria-label={t("desktop.kanban.addNote", t(`desktop.workbench.gtdStatus.${statusValue}`))}
                      >
                        <ThemeIcon name="file-plus" size={13} aria-hidden="true" />
                      </button>
                    ) : null}
                  </>
                )}
                {isDone && column.length > 0 && (
                  <button
                    type="button"
                    className="kanban-archive-all"
                    onClick={() => void archiveAllDone()}
                    title={t("desktop.kanban.archiveAll")}
                    aria-label={t("desktop.kanban.archiveAll")}
                  >
                    <ThemeIcon name="archive" size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
              {!collapsed && (
              <div className="kanban-column-body">
                {column.map((card) => (
                  <article
                    key={card.key}
                    className={`kanban-card is-${card.kind}${card.status === "done" ? " is-done" : ""}`}
                    draggable
                    onDragStart={(event) => {
                      draggingKey.current = card.key;
                      event.dataTransfer.setData("text/plain", card.key);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => { draggingKey.current = null; setDropTarget(null); }}
                    onClick={() => openCard(card)}
                    onKeyDown={(event) => { if (event.key === "Enter") openCard(card); }}
                    tabIndex={0}
                    role="button"
                    title={titleOf(card)}
                  >
                    <button
                      type="button"
                      className="kanban-card-archive"
                      onClick={(event) => { event.stopPropagation(); void archiveCard(card); }}
                      title={t("desktop.kanban.archive")}
                      aria-label={t("desktop.kanban.archive")}
                    >
                      <ThemeIcon name="archive" size={13} aria-hidden="true" />
                    </button>
                    <p className="kanban-card-title">{titleOf(card)}</p>
                    <div className="kanban-card-meta">
                      <span className="kanban-card-tag">{card.kind === "session" ? card.session.provider : t(`desktop.kanban.scope.${card.note.scope}`)}</span>
                      <span className="kanban-card-time">{relativeTime(card.kind === "session" ? card.session.updatedAt : card.note.updatedAtMs, t)}</span>
                    </div>
                    {card.kind === "session" && card.session.projectPath && (
                      <p className="kanban-card-sub">{basename(card.session.projectPath)}</p>
                    )}
                    {card.kind === "note" && card.note.projectPath && (
                      <p className="kanban-card-sub">{basename(card.note.projectPath)}</p>
                    )}
                  </article>
                ))}
                {column.length === 0 && (
                  <p className="kanban-column-empty">{t("desktop.kanban.emptyColumn")}</p>
                )}
              </div>
              )}
            </div>
          );
        })}
      </div>
      </div>

      <div className="kanban-status">
        {total === 0 && !loading ? (
          <Status>{t("desktop.kanban.empty")}</Status>
        ) : (
         <Status kind={status.kind}>{status.text}</Status>
        )}
      </div>
      <KanbanCardModal
        note={detail?.kind === "note" ? detail.note : null}
        session={detail?.kind === "session" ? detail.session : null}
        onClose={() => setDetail(null)}
      />
      {floatingNoteTarget ? (
        <FloatingSessionNote
          target={floatingNoteTarget}
          onClose={() => {
            setFloatingNoteTarget(null);
            void load();
          }}
        />
      ) : null}
    </section>,
    host
  );
}
