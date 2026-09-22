import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSession, GtdStatus } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { notifyDesktop } from "../../components/Notifications";
import { taskFromRecord } from "../workbench/task";
import { SessionDetailSheet } from "./SessionDetailSheet";
import { projectLabel, relativeTime, sessionKey, sessionSubtitle } from "./sessionFormat";
import {
  DESKTOP_GTD_STATUSES,
  desktopGtdColumn,
  desktopGtdColumnStatuses,
  desktopGtdLabelKey,
  type DesktopGtdStatus
} from "../../gtd";

const PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Age filter → the oldest `updatedAt` the page may return. */
type AgeFilter = "all" | "7" | "30" | "90";

/** GTD chip: every session, only unmarked ones, or one column's statuses. */
type GtdFilter = "all" | "untagged" | DesktopGtdStatus;

type SessionCursor = { updatedAt: number; provider: string; id: string };

interface FacetCounts {
  total: number;
  byProvider: Record<string, number>;
  byGtdStatus: Record<string, number>;
  untagged: number;
  byTask: Record<string, number>;
  unassigned: number;
}

/** Task filter: every session, only unassigned ones, or one work item's. */
const TASK_ALL = "all";
const TASK_UNASSIGNED = "unassigned";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every session in the catalog, newest first.
 *
 * The catalog can hold tens of thousands of sessions, so the list never loads
 * them all: it reads keyset-paginated pages from the main process and appends
 * until the user stops scrolling. Every filter (search, age, provider, GTD) is
 * applied in SQL, so narrowing the query covers the whole catalog rather than
 * the few pages already on screen.
 */
export function SessionsView({ active }: { active: boolean }): React.JSX.Element | null {
  const host = document.getElementById("react-sessions");
  const { ready, t, locale } = useI18n();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<SessionCursor | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [age, setAge] = useState<AgeFilter>("all");
  const [providers, setProviders] = useState<string[]>([]);
  const [gtdFilter, setGtdFilter] = useState<GtdFilter>("all");
  const [taskFilter, setTaskFilter] = useState<string>(TASK_ALL);
  const [tasks, setTasks] = useState<Array<{ noteId: string; title: string }>>([]);
  const [facets, setFacets] = useState<FacetCounts | null>(null);
  const [gtdByKey, setGtdByKey] = useState<Record<string, GtdStatus>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  /** The session whose detail sheet is open. */
  const [selected, setSelected] = useState<AgentSession | null>(null);
  const sequenceRef = useRef(0);
  const sentinelRef = useRef<HTMLButtonElement | null>(null);

  const text = useCallback(
    (key: string, ...args: Array<string | number>) => (ready ? t(key, ...args) : key),
    [ready, t]
  );

  // Debounce the search box: every keystroke otherwise triggers a full count.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  /** Everything the SQL layer needs, snapshot at call time so age stays exact. */
  const buildRequest = useCallback((cursorArg?: SessionCursor) => ({
    limit: PAGE_SIZE,
    cursor: cursorArg,
    search: search || undefined,
    ...(age === "all" ? {} : { toMs: Date.now() - Number(age) * DAY_MS }),
    ...(taskFilter === TASK_ALL
      ? {}
      : taskFilter === TASK_UNASSIGNED
        ? { unassignedOnly: true }
        : { taskNoteId: taskFilter }),
    ...(providers.length ? { providers } : {}),
    ...(gtdFilter === "all"
      ? {}
      : gtdFilter === "untagged"
        ? { gtdUntagged: true }
        : { gtdStatuses: desktopGtdColumnStatuses(gtdFilter) })
  }), [search, age, providers, gtdFilter, taskFilter]);

  const loadFirstPage = useCallback(async () => {
    if (typeof desktopApi().querySessionsPage !== "function") {
      setLoading(false);
      return;
    }
    const sequence = ++sequenceRef.current;
    setLoading(true);
    try {
      const page = await desktopApi().querySessionsPage(buildRequest());
      if (sequence !== sequenceRef.current) return;
      setSessions(page.sessions);
      setTotal(page.total);
      setCursor(page.nextCursor);
    } catch (error) {
      if (sequence === sequenceRef.current) {
        setSessions([]);
        setTotal(0);
        setCursor(undefined);
        notifyDesktop({ text: errorMessage(error), kind: "error" });
      }
    } finally {
      if (sequence === sequenceRef.current) setLoading(false);
    }
  }, [buildRequest]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const sequence = sequenceRef.current;
    setLoadingMore(true);
    try {
      const page = await desktopApi().querySessionsPage(buildRequest(cursor));
      if (sequence !== sequenceRef.current) return;
      setSessions((current) => {
        const known = new Set(current.map(sessionKey));
        return [...current, ...page.sessions.filter((session) => !known.has(sessionKey(session)))];
      });
      setTotal(page.total);
      setCursor(page.nextCursor);
    } catch (error) {
      notifyDesktop({ text: errorMessage(error), kind: "error" });
    } finally {
      setLoadingMore(false);
    }
  }, [buildRequest, cursor, loadingMore]);

  /** Chip counts and row badges live outside the paged query. */
  const loadFacets = useCallback(async () => {
    try {
      const [nextFacets, nextGtd, taskRecords] = await Promise.all([
        typeof desktopApi().sessionFacets === "function"
          ? desktopApi().sessionFacets()
          : Promise.resolve(null as FacetCounts | null),
        typeof desktopApi().listSessionGtdStatuses === "function"
          ? desktopApi().listSessionGtdStatuses()
          : Promise.resolve({} as Record<string, GtdStatus>),
        typeof desktopApi().notesListTasks === "function"
          ? desktopApi().notesListTasks()
          : Promise.resolve([] as Array<Parameters<typeof taskFromRecord>[0]>)
      ]);
      if (nextFacets) setFacets(nextFacets);
      setGtdByKey(nextGtd || {});
      setTasks(taskRecords.map((record) => {
        const task = taskFromRecord(record);
        return { noteId: task.noteId, title: task.title };
      }));
    } catch {
      /* the list works without chip counts */
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadFacets();
    void loadFirstPage();
  }, [active, loadFacets, loadFirstPage]);

  // A mutation may link, rename or re-mark a session; refresh both layers.
  useEffect(() => {
    if (!active) return;
    const onMutated = () => {
      void loadFacets();
      void loadFirstPage();
    };
    window.addEventListener("agent-resume:notes-mutated", onMutated);
    return () => window.removeEventListener("agent-resume:notes-mutated", onMutated);
  }, [active, loadFacets, loadFirstPage]);

  // Auto-load the next page when the sentinel scrolls into view.
  useEffect(() => {
    if (!cursor || typeof IntersectionObserver === "undefined") return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  /** Pull fresh sessions from disk (the extension's "Resync"). */
  const resync = useCallback(async () => {
    if (typeof desktopApi().syncSessions !== "function") return;
    setSyncing(true);
    try {
      await desktopApi().syncSessions();
      await loadFacets();
      await loadFirstPage();
    } catch (error) {
      notifyDesktop({ text: errorMessage(error), kind: "error" });
    } finally {
      setSyncing(false);
    }
  }, [loadFacets, loadFirstPage]);

  const toggleProvider = useCallback((provider: string) => {
    setProviders((current) =>
      current.includes(provider)
        ? current.filter((value) => value !== provider)
        : [...current, provider]
    );
  }, []);

  /** Keep a renamed session readable in both the list and the open sheet. */
  const handleTitleChanged = useCallback((key: string, title: string) => {
    setSelected((current) => (current && sessionKey(current) === key ? { ...current, title } : current));
    setSessions((current) => current.map((session) => (sessionKey(session) === key ? { ...session, title } : session)));
  }, []);

  const providerEntries = useMemo(() => {
    const byProvider = facets?.byProvider ?? {};
    return Object.entries(byProvider).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [facets]);

  /** Stored statuses behind one desktop column, summed for its chip count. */
  const columnCount = useCallback((status: DesktopGtdStatus): number => {
    const counts = facets?.byGtdStatus ?? {};
    return desktopGtdColumnStatuses(status).reduce((sum, stored) => sum + (counts[stored] ?? 0), 0);
  }, [facets]);

  /** Work items that own at least one session, busiest first. */
  const taskOptions = useMemo(() => {
    const byTask = facets?.byTask ?? {};
    const titles = new Map(tasks.map((task) => [task.noteId, task.title]));
    const listed = Object.entries(byTask)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([noteId, count]) => ({ noteId, count, title: titles.get(noteId) ?? noteId }));
    // Keep a selection that dropped out of the counts (deleted work item).
    const selected = taskFilter === TASK_ALL || taskFilter === TASK_UNASSIGNED ? null : taskFilter;
    if (selected && !listed.some((option) => option.noteId === selected)) {
      listed.unshift({
        noteId: selected,
        count: facets?.byTask?.[selected] ?? 0,
        title: titles.get(selected) ?? selected
      });
    }
    return listed;
  }, [facets, tasks, taskFilter]);

  if (!host) return null;

  const toolbar = (
    <div className="sessions-view-toolbar">
      <input
        className="sessions-view-search"
        type="search"
        value={query}
        placeholder={text("desktop.sessions.search")}
        aria-label={text("desktop.sessions.search")}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        className="sessions-view-age"
        aria-label={text("desktop.sessions.ageFilterLabel")}
        value={age}
        onChange={(event) => setAge(event.target.value as AgeFilter)}
      >
        <option value="all">{text("desktop.sessions.ageAll")}</option>
        <option value="7">{text("desktop.sessions.age7")}</option>
        <option value="30">{text("desktop.sessions.age30")}</option>
        <option value="90">{text("desktop.sessions.age90")}</option>
      </select>
      <button
        type="button"
        className="sessions-view-resync"
        disabled={syncing}
        onClick={() => void resync()}
      >
        <ThemeIcon name={syncing ? "loader" : "history"} className={syncing ? "spin" : undefined} size={ICON_SIZE.dense} aria-hidden="true" />
        {text("desktop.sessions.resync")}
      </button>
      <span className="sessions-view-count">{text("desktop.sessions.count", total)}</span>
    </div>
  );

  const filters = (
    <div className="sessions-view-filters">
      <div className="sessions-view-filter-group" role="group" aria-label={text("desktop.sessions.taskFilter")}>
        <select
          className="sessions-view-task"
          aria-label={text("desktop.sessions.taskFilter")}
          value={taskFilter}
          onChange={(event) => setTaskFilter(event.target.value)}
        >
          <option value={TASK_ALL}>{text("desktop.sessions.taskAll")}</option>
          <option value={TASK_UNASSIGNED}>
            {`${text("desktop.sessions.taskUnassigned")} (${facets?.unassigned ?? 0})`}
          </option>
          {taskOptions.map((option) => (
            <option key={option.noteId} value={option.noteId}>
              {`${option.title} (${option.count})`}
            </option>
          ))}
        </select>
      </div>
      <div className="sessions-view-filter-group" role="group" aria-label={text("desktop.sessions.providerFilter")}>
        {providerEntries.map(([provider, count]) => {
          const selected = providers.includes(provider);
          return (
            <button
              key={provider}
              type="button"
              className={`sessions-view-chip${selected ? " is-active" : ""}`}
              aria-pressed={selected}
              onClick={() => toggleProvider(provider)}
            >
              <span className="sessions-view-chip-label">{provider}</span>
              <span className="sessions-view-chip-count">{count}</span>
            </button>
          );
        })}
      </div>
      <div className="sessions-view-filter-group" role="group" aria-label={text("desktop.sessions.gtdFilter")}>
        <button
          type="button"
          className={`sessions-view-chip${gtdFilter === "all" ? " is-active" : ""}`}
          aria-pressed={gtdFilter === "all"}
          onClick={() => setGtdFilter("all")}
        >
          <span className="sessions-view-chip-label">{text("desktop.common.all")}</span>
        </button>
        <button
          type="button"
          className={`sessions-view-chip${gtdFilter === "untagged" ? " is-active" : ""}`}
          aria-pressed={gtdFilter === "untagged"}
          onClick={() => setGtdFilter("untagged")}
        >
          <span className="sessions-view-chip-label">{text("desktop.gtd.unmarked")}</span>
          <span className="sessions-view-chip-count">{facets?.untagged ?? 0}</span>
        </button>
        {DESKTOP_GTD_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={`sessions-view-chip${gtdFilter === status ? " is-active" : ""}`}
            aria-pressed={gtdFilter === status}
            onClick={() => setGtdFilter(status)}
          >
            <span className={`wb-gtd-status-dot is-${status}`} aria-hidden="true" />
            <span className="sessions-view-chip-label">{text(desktopGtdLabelKey(status))}</span>
            <span className="sessions-view-chip-count">{columnCount(status)}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return createPortal(
    <section className="sessions-view" aria-label={text("desktop.sessions.title")}>
      {toolbar}
      {filters}
      <div className="sessions-view-header" aria-hidden="true">
        <span className="sessions-view-col-provider">{text("desktop.sessions.colProvider")}</span>
        <span className="sessions-view-col-title">{text("desktop.sessions.colTitle")}</span>
        <span className="sessions-view-col-project">{text("desktop.sessions.colProject")}</span>
        <span className="sessions-view-col-time">{text("desktop.sessions.colUpdated")}</span>
      </div>
      <div className="sessions-view-body">
        {loading ? (
          <p className="sessions-view-empty">{text("desktop.sessions.loading")}</p>
        ) : sessions.length === 0 ? (
          <div className="sessions-view-empty-state">
            <ThemeIcon name="history" size={ICON_SIZE.prominent} aria-hidden="true" />
            <p className="sessions-view-empty">
              {search || providers.length > 0 || gtdFilter !== "all" || age !== "all" || taskFilter !== TASK_ALL
                ? text("desktop.sessions.emptySearch")
                : text("desktop.sessions.empty")}
            </p>
          </div>
        ) : (
          <>
            {sessions.map((session) => {
              const project = projectLabel(session.projectPath);
              const gtdStatus = gtdByKey[`${session.provider}:${session.id}`];
              const subtitle = sessionSubtitle(session);
              return (
                <button
                  type="button"
                  className="sessions-view-row"
                  key={sessionKey(session)}
                  title={session.title || session.id}
                  onClick={() => setSelected(session)}
                >
                  <span className="sessions-view-badges">
                    <span className="s-provider-tag" data-provider={session.acpProvider || session.provider}>
                      {session.acpProvider ? `acp/${session.acpProvider}` : session.provider}
                    </span>
                    {gtdStatus ? (
                      <span className={`wb-gtd-status-badge is-${desktopGtdColumn(gtdStatus)}`}>
                        {text(desktopGtdLabelKey(gtdStatus))}
                      </span>
                    ) : null}
                  </span>
                  <span className="sessions-view-main">
                    <span className="sessions-view-title">{session.title || session.id}</span>
                    {subtitle ? <span className="sessions-view-subtitle">{subtitle}</span> : null}
                  </span>
                  <span className="sessions-view-project" title={session.projectPath || ""}>{project}</span>
                  <span className="sessions-view-time">{relativeTime(session.updatedAt, locale)}</span>
                </button>
              );
            })}
            {cursor ? (
              <button
                ref={sentinelRef}
                type="button"
                className="sessions-view-more"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? text("desktop.sessions.loading") : text("desktop.sessions.loadMore", sessions.length, total)}
              </button>
            ) : (
              <p className="sessions-view-end">{text("desktop.sessions.allLoaded")}</p>
            )}
          </>
        )}
      </div>
      <SessionDetailSheet
        session={selected}
        gtdStatus={selected ? gtdByKey[sessionKey(selected)] : undefined}
        onClose={() => setSelected(null)}
        onTitleChanged={handleTitleChanged}
      />
    </section>,
    host
  );
}
