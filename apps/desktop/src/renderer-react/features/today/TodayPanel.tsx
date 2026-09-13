import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState, type ReactPortal } from "react";
import { desktopApi } from "../../bridge";
import { notifyDesktop } from "../../components/Notifications";
import { ThemeIcon } from "../../components/ThemeIcon";
import { sessionDotStatusClass, sessionDotStatusLabel } from "../../components/SessionDotsCluster";
import { useI18n } from "../../i18n";
import { KanbanCardModal } from "../kanban/KanbanCardModal";
import { type ActiveSessionDot } from "../workbench/activeSessionDots";
import type { SessionDotStatus } from "../workbench/sessionStatus";

type WorkItem = Awaited<ReturnType<ReturnType<typeof desktopApi>["notesListWorkItems"]>>[number];

type Section = "needs_you" | "blocked" | "next" | "inbox";

/** Urgency order for a work item's rolled-up live status. */
const LIVE_RANK: Record<SessionDotStatus, number> = {
  awaiting_user: 4,
  error: 3,
  connecting: 2,
  running: 1,
  open: 0
};

/** How many rows Today shows before collapsing the rest behind "more". */
const VISIBLE_LIMIT = 14;

function titleOf(item: WorkItem): string {
  return (item.title || item.filename.replace(/\.md$/i, "") || item.noteId).trim();
}

function basename(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

function rollupDot(item: WorkItem, byKey: ReadonlyMap<string, ActiveSessionDot>): ActiveSessionDot | undefined {
  let best: ActiveSessionDot | undefined;
  for (const key of item.work.sessions ?? []) {
    const dot = byKey.get(key);
    if (dot && (!best || LIVE_RANK[dot.status] > LIVE_RANK[best.status])) best = dot;
  }
  return best;
}

function sectionOf(item: WorkItem): Section {
  const status = item.gtdStatus ?? "inbox";
  if (status === "waiting") return "blocked";
  if (status === "next") return "next";
  if (status === "inbox") return "inbox";
  return "inbox";
}

/**
 * Today — the only push surface.
 *
 * It answers "what needs me right now" without scanning: live waiting/blocked
 * work items first, then committed next actions, then the triage inbox. Live
 * status is a projection of the daemon's broadcast — never stored.
 */
export function TodayPanel(): ReactPortal | null {
  const host = document.getElementById("react-today");
  const { ready, t } = useI18n();
  const [active, setActive] = useState(false);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [dots, setDots] = useState<ActiveSessionDot[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [detail, setDetail] = useState<WorkItem | null>(null);

  const setError = useCallback((error: unknown) => {
    notifyDesktop({ text: error instanceof Error ? error.message : String(error), kind: "error" });
  }, []);

  const load = useCallback(async (): Promise<WorkItem[]> => {
    if (typeof desktopApi().notesListWorkItems !== "function") return [];
    try {
      const list = await desktopApi().notesListWorkItems();
      setItems(list);
      return list;
    } catch (error) {
      setError(error);
      return [];
    }
  }, [setError]);

  useEffect(() => {
    const onTab = (event: Event) => {
      const show = (event as CustomEvent<string>).detail === "today";
      setActive(show);
      if (show) void load();
    };
    window.addEventListener("agent-resume:tab-change", onTab);
    return () => window.removeEventListener("agent-resume:tab-change", onTab);
  }, [load]);

  useEffect(() => {
    const onNotesMutated = () => { void load(); };
    window.addEventListener("agent-resume:notes-mutated", onNotesMutated);
    return () => window.removeEventListener("agent-resume:notes-mutated", onNotesMutated);
  }, [load]);

  useEffect(() => {
    const onActiveSessions = (event: Event) => {
      const detail = (event as CustomEvent<ActiveSessionDot[]>).detail;
      if (Array.isArray(detail)) setDots(detail);
    };
    window.addEventListener("agent-resume:active-sessions", onActiveSessions);
    return () => window.removeEventListener("agent-resume:active-sessions", onActiveSessions);
  }, []);

  const dotByKey = useMemo(() => {
    const map = new Map<string, ActiveSessionDot>();
    for (const dot of dots) if (dot.sessionKey) map.set(dot.sessionKey, dot);
    return map;
  }, [dots]);

  const text = useCallback(
    (key: string, fallback: string) => (ready ? t(key) : fallback),
    [ready, t]
  );

  const grouped = useMemo(() => {
    const sections: Record<Section, WorkItem[]> = { needs_you: [], blocked: [], next: [], inbox: [] };
    for (const item of items) {
      const dot = rollupDot(item, dotByKey);
      if (dot?.status === "awaiting_user") sections.needs_you.push(item);
      else sections[sectionOf(item)].push(item);
    }
    const rank = (item: WorkItem) => {
      const dot = rollupDot(item, dotByKey);
      return (dot ? LIVE_RANK[dot.status] : 0) * 1e15 + item.updatedAtMs;
    };
    for (const list of Object.values(sections)) list.sort((a, b) => rank(b) - rank(a));
    return sections;
  }, [dotByKey, items]);

  const flat = useMemo(
    () => [...grouped.needs_you, ...grouped.blocked, ...grouped.next, ...grouped.inbox],
    [grouped]
  );
  const visible = showAll ? flat : flat.slice(0, VISIBLE_LIMIT);
  const overflow = Math.max(0, flat.length - visible.length);
  const visibleIds = useMemo(() => new Set(visible.map((item) => item.noteId)), [visible]);

  const openWorkItem = useCallback((item: WorkItem) => {
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    window.dispatchEvent(new CustomEvent("agent-resume:workbench-work-item", {
      detail: {
        noteId: item.noteId,
        title: titleOf(item),
        status: item.gtdStatus ?? "inbox",
        next: item.work.next,
        decision: item.work.decision,
        sessions: item.work.sessions ?? [],
        projects: item.work.projects,
        primaryProject: item.work.primaryProject
      }
    }));
  }, []);

  const setStatus = useCallback(async (item: WorkItem, status: "next" | "done" | "someday" | null) => {
    try {
      await desktopApi().notesSetGtdStatus({ noteId: item.noteId, status });
      await load();
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch (error) {
      setError(error);
    }
  }, [load, setError]);

  const createWorkItem = useCallback(async () => {
    try {
      const created = await desktopApi().notesCreateWorkItem({});
      const list = await load();
      const next = list.find((item) => item.noteId === created.noteId);
      if (next) setDetail(next);
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch (error) {
      setError(error);
    }
  }, [load, setError]);

  const focusSessionKey = useCallback((sessionKey: string) => {
    const dot = dotByKey.get(sessionKey);
    if (!dot) return;
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    window.dispatchEvent(new CustomEvent("agent-resume:workbench-focus-session", {
      detail: { paneKey: dot.paneKey, projectPath: dot.projectPath }
    }));
  }, [dotByKey]);

  if (!host) return null;

  const sectionLabels: Array<{ id: Section; label: string }> = [
    { id: "needs_you", label: t("desktop.today.needsYou") },
    { id: "blocked", label: t("desktop.today.blocked") },
    { id: "next", label: t("desktop.today.next") },
    { id: "inbox", label: t("desktop.today.inbox") }
  ];

  const renderRow = (item: WorkItem) => {
    const dot = rollupDot(item, dotByKey);
    const projects = item.work.projects ?? [];
    return (
      <article
        key={item.noteId}
        className={`today-row${dot?.status === "awaiting_user" ? " needs-me" : ""}`}
        onClick={() => openWorkItem(item)}
        onKeyDown={(event) => { if (event.key === "Enter") openWorkItem(item); }}
        role="button"
        tabIndex={0}
        title={titleOf(item)}
      >
        <span className="today-row-live" aria-hidden="true">
          {dot ? <span className={`session-dot${sessionDotStatusClass(dot.status)}`} /> : <span className="session-dot" />}
        </span>
        <div className="today-row-main">
          <div className="today-row-head">
            <span className="today-row-title">{titleOf(item)}</span>
            {projects.length > 0 && (
              <span className="today-row-projects">
                {projects.slice(0, 3).map((path) => <span key={path} className="today-row-project">{basename(path)}</span>)}
              </span>
            )}
          </div>
          <div className="today-row-meta">
            {item.work.next && <span className="today-row-next">{t("desktop.today.nextLabel")} {item.work.next}</span>}
            {item.work.decision && (
              <span className="today-row-decision">
                <ThemeIcon name="message-square-warning" size={12} aria-hidden="true" />
                {item.work.decision}
              </span>
            )}
            {!item.work.next && !item.work.decision && (
              <span className="today-row-muted">{t("desktop.today.noNext")}</span>
            )}
          </div>
        </div>
        {dot && dot.status !== "open" && (
          <span className="today-row-live-label">{sessionDotStatusLabel(dot, text)}</span>
        )}
        <div className="today-row-actions" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="today-action" title={t("desktop.today.edit")} aria-label={t("desktop.today.edit")} onClick={() => setDetail(item)}>
            <ThemeIcon name="pencil" size={13} aria-hidden="true" />
          </button>
          <button type="button" className="today-action" title={t("desktop.today.claim")} aria-label={t("desktop.today.claim")} onClick={() => void setStatus(item, "next")}>
            <ThemeIcon name="play" size={13} aria-hidden="true" />
          </button>
          <button type="button" className="today-action" title={t("desktop.today.done")} aria-label={t("desktop.today.done")} onClick={() => void setStatus(item, "done")}>
            <ThemeIcon name="check" size={13} aria-hidden="true" />
          </button>
          <button type="button" className="today-action" title={t("desktop.today.someday")} aria-label={t("desktop.today.someday")} onClick={() => void setStatus(item, "someday")}>
            <ThemeIcon name="archive" size={13} aria-hidden="true" />
          </button>
        </div>
      </article>
    );
  };

  return createPortal(
    <section className="react-today-panel panel" hidden={!active} aria-label={t("desktop.tabs.today")}>
      <div className="today-toolbar">
        <span className="today-toolbar-title">{t("desktop.tabs.today")}</span>
        <span className="today-toolbar-count">{t("desktop.today.count", flat.length)}</span>
        <span className="today-toolbar-spacer" />
        <button type="button" className="tool-btn" onClick={() => void createWorkItem()}>
          <ThemeIcon name="plus" size={14} aria-hidden="true" />
          {t("desktop.today.newWorkItem")}
        </button>
        <button type="button" className="tool-btn ghost-btn" onClick={() => void load()} aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")}>
          <ThemeIcon name="refresh" size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="today-scroll">
        {flat.length === 0 ? (
          <p className="today-empty">{t("desktop.today.empty")}</p>
        ) : (
          <>
            {sectionLabels.map(({ id, label }) => {
              const rows = visible.filter((item) => {
                if (!visibleIds.has(item.noteId)) return false;
                const dot = rollupDot(item, dotByKey);
                if (id === "needs_you") return dot?.status === "awaiting_user";
                if (dot?.status === "awaiting_user") return false;
                return sectionOf(item) === id;
              });
              if (rows.length === 0) return null;
              return (
                <div key={id} className={`today-section is-${id}`}>
                  <div className="today-section-head">
                    <span className="today-section-label">{label}</span>
                    <span className="today-section-count">{rows.length}</span>
                  </div>
                  {rows.map(renderRow)}
                </div>
              );
            })}
            {overflow > 0 && (
              <button type="button" className="today-more" onClick={() => setShowAll(true)}>
                {t("desktop.today.more", overflow)}
              </button>
            )}
          </>
        )}
      </div>
      <KanbanCardModal
        note={detail}
        session={null}
        sessionDot={null}
        workSessions={detail?.work.sessions ?? null}
        onFocusSession={focusSessionKey}
        onClose={() => { setDetail(null); void load(); }}
        onNoteMoved={(nextNote) => setDetail({ ...(detail as WorkItem), ...nextNote, work: detail?.work ?? {} })}
      />
    </section>,
    host
  );
}
