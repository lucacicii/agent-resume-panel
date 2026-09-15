import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactPortal } from "react";
import type { AgentSession, DigestProgressEvent, GtdStatus, ReportEntry, ReportLinkRow, WorkItemRecord, WorkItemSessionLink } from "@agent-resume/core";
import { ThemeIcon } from "../../components/ThemeIcon";
import { sessionDotStatusClass } from "../../components/SessionDotsCluster";
import type { ActiveSessionDot } from "../workbench/activeSessionDots";
import { rank, rollupDot } from "../workbench/sessionStatus/workItemRollup";
import type { WorkbenchSidebarWorkItem } from "../workbench/layout/WorkbenchSidebar";
import { desktopApi } from "../../bridge";
import { notifyDesktop } from "../../components/Notifications";
import { renderMarkdown as markdown } from "../../components/Markdown";
import { useI18n } from "../../i18n";
import { dayKeyFromDate, dayKeyFromMs, digestIndex, isoWeekLabelFromDate, parseWeekRange, periodKeyFromEntry, rangeForPeriod, type ReportPeriodType } from "./model";

type Focus = { type: ReportPeriodType; key: string };
type SessionPreview = { title: string; messages: Array<{ role: string; text: string; timestamp?: string }>; truncated?: boolean; warning?: string };
type Preview = { session: AgentSession; preview: SessionPreview; summary: string };

function levelFor(type: ReportPeriodType): "daily" | "weekly" | "monthly" { return type === "day" ? "daily" : type === "week" ? "weekly" : "monthly"; }
type Translate = (key: string, ...args: Array<string | number>) => string;

function digestLabel(type: ReportPeriodType, t: Translate): string { return t(type === "day" ? "desktop.report.digestDaily" : type === "week" ? "desktop.report.digestWeekly" : "desktop.report.digestMonthly"); }
function scopeLabel(type: ReportPeriodType, t: Translate): string { return t(type === "day" ? "desktop.report.scopeDay" : type === "week" ? "desktop.report.scopeWeek" : "desktop.report.scopeMonth"); }
function digestProgressKey(type: ReportPeriodType | "daily" | "weekly" | "monthly", key: string): string { return `${type === "day" || type === "daily" ? "daily" : type === "week" || type === "weekly" ? "weekly" : "monthly"}:${key}`; }
function progressKeyFromEvent(event: DigestProgressEvent): string {
  if ((event.level === "weekly" || event.level === "monthly") && event.periodLabel) return digestProgressKey(event.level, event.periodLabel);
  if (event.level === "daily") return digestProgressKey("daily", event.dayKey || event.periodLabel);
  return "";
}
function isLevelRunning(periods: ReadonlySet<string>, level: "daily" | "weekly" | "monthly"): boolean { return Array.from(periods).some((key) => key.startsWith(`${level}:`)); }
function isFuture(type: ReportPeriodType, key: string): boolean {
  const today = dayKeyFromDate(new Date());
  if (type === "day") return key > today;
  if (type === "month") return key > today.slice(0, 7);
  return key > isoWeekLabelFromDate(new Date());
}
function formatTime(value: number, locale: string): string { return new Date(value).toLocaleString(locale); }

function formatDayKey(value: number): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "unknown";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(value: number, locale: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

const GTD_FILTER_STATUSES = ["inbox", "next", "waiting", "someday", "reference", "done"] as const satisfies readonly GtdStatus[];

/** Matches a report period reference inside a digest body: `Daily · 2026-08-08`, `daily:2026-08-08`, `Weekly · 2026-W32`, `monthly:2026-08`, … */
const REPORT_REF_PATTERN = /(?:(?:Daily ·\s*|daily:)(\d{4}-\d{2}-\d{2}))|(?:(?:Weekly ·\s*|weekly:)(\d{4}-W\d{2}))|(?:(?:Monthly ·\s*|monthly:)(\d{4}-\d{2}))/g;
/** Matches a `Session 索引` bullet: `- [provider] title`. */
const SESSION_INDEX_PATTERN = /^\[([^\]]+)\]\s*(.+)$/s;

function periodFromReportRef(ref: string): { type: "day" | "week" | "month"; key: string } | null {
  if (ref.startsWith("daily:")) return { type: "day", key: ref.slice("daily:".length) };
  if (ref.startsWith("weekly:")) return { type: "week", key: ref.slice("weekly:".length) };
  if (ref.startsWith("monthly:")) return { type: "month", key: ref.slice("monthly:".length) };
  return null;
}

/**
 * Renders a digest body and rewrites its source references into clickable `.digest-ref`
 * anchors: session bullets in the daily `Session 索引` section (resolved against the
 * report's ordered `report_links`) and report-period references (`Daily · 2026-08-08`,
 * `daily:…`, …) found anywhere.
 */
function renderDigestMarkdown(content: string, links: ReportLinkRow[]): string {
  if (typeof document === "undefined") return markdown(content);
  const template = document.createElement("template");
  template.innerHTML = markdown(content);
  const root = template.content;

  if (links.length) {
    const byProvider = new Map<string, ReportLinkRow[]>();
    for (const link of links) {
      if (!link.provider || !link.agentSessionId) continue;
      const group = byProvider.get(link.provider) || [];
      group.push(link);
      byProvider.set(link.provider, group);
    }
    const cursor = new Map<string, number>();
    const items = root.querySelectorAll<HTMLLIElement>("li");
    for (const item of items) {
      const text = item.textContent || "";
      const match = SESSION_INDEX_PATTERN.exec(text);
      if (!match) continue;
      const provider = match[1].trim();
      const group = byProvider.get(provider);
      if (!group) continue;
      const index = cursor.get(provider) || 0;
      const link = group[index];
      if (!link) continue;
      cursor.set(provider, index + 1);
      const anchor = document.createElement("a");
      anchor.className = "digest-ref";
      anchor.href = "#";
      anchor.dataset.sessionRef = `${link.provider}:${link.agentSessionId}`;
      anchor.textContent = text;
      item.replaceChildren(anchor);
    }
  }

  const walker = document.createTreeWalker(root, 4);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    if (parent && !parent.closest("a, code, pre")) textNodes.push(current as Text);
    current = walker.nextNode();
  }
  for (const textNode of textNodes) {
    const value = textNode.data;
    const matches = [...value.matchAll(REPORT_REF_PATTERN)];
    if (!matches.length) continue;
    const replacement = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      const index = match.index || 0;
      replacement.append(value.slice(offset, index));
      const [, day, week, month] = match;
      const target = day ? `daily:${day}` : week ? `weekly:${week}` : `monthly:${month}`;
      const anchor = document.createElement("a");
      anchor.className = "digest-ref";
      anchor.href = "#";
      anchor.dataset.reportRef = target;
      anchor.textContent = match[0];
      replacement.append(anchor);
      offset = index + match[0].length;
    }
    replacement.append(value.slice(offset));
    textNode.replaceWith(replacement);
  }

  return template.innerHTML;
}

/** Handles clicks on `.digest-ref` anchors inside a rendered digest body. */
function onDigestRefClick(event: React.MouseEvent<HTMLDivElement>, entry: ReportEntry, links: ReportLinkRow[]): void {
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a.digest-ref") : null;
  if (!target || !event.currentTarget.contains(target)) return;
  event.preventDefault();
  const reportRef = target.dataset.reportRef;
  if (reportRef) {
    const period = periodFromReportRef(reportRef);
    if (!period) return;
    window.dispatchEvent(new CustomEvent("agent-resume:report-focus", { detail: period }));
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "report" }));
    return;
  }
  const sessionRef = target.dataset.sessionRef;
  if (!sessionRef) return;
  const separator = sessionRef.indexOf(":");
  const provider = sessionRef.slice(0, separator);
  const id = sessionRef.slice(separator + 1);
  const link = links.find((item) => item.provider === provider && item.agentSessionId === id);
  if (!link) return;
  window.dispatchEvent(new CustomEvent("agent-resume:sessions-preview", {
    detail: {
      provider,
      id,
      title: target.textContent || id,
      projectPath: link.projectPath || "",
      updatedAt: entry.periodEndMs || Date.now()
    }
  }));
}

const GTD_ALL_STATUSES = ["inbox", "next", "waiting", "someday", "reference", "done"] as const satisfies readonly GtdStatus[];

function WorkItemTimeline({
  sessions,
  reports = [],
  dotByKey,
  locale,
  t,
  onSelectSession,
  onSelectReport,
  emptyText
}: {
  sessions: AgentSession[];
  reports?: ReportEntry[];
  dotByKey?: Map<string, ActiveSessionDot>;
  locale: string;
  t: Translate;
  onSelectSession?: (session: AgentSession) => void;
  onSelectReport?: (report: ReportEntry) => void;
  emptyText: string;
}) {
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [sessions]);

  const dayGroups = useMemo(() => {
    const groups: Array<{ dayKey: string; dayLabel: string; sessions: AgentSession[] }> = [];
    const map = new Map<string, { dayKey: string; dayLabel: string; sessions: AgentSession[] }>();
    for (const s of sortedSessions) {
      const dayKey = formatDayKey(s.updatedAt || 0);
      let group = map.get(dayKey);
      if (!group) {
        group = {
          dayKey,
          dayLabel: formatDayLabel(s.updatedAt || 0, locale),
          sessions: []
        };
        map.set(dayKey, group);
        groups.push(group);
      }
      group.sessions.push(s);
    }
    return groups;
  }, [sortedSessions, locale]);

  if (sessions.length === 0 && reports.length === 0) {
    return (
      <div className="report-work-item-history">
        <div className="report-work-item-history-empty cal-session-empty">
          <p className="muted">{emptyText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="report-work-item-history">
      {sessions.length > 0 ? (
        <div className="report-timeline-section report-timeline-sessions">
          <div className="report-work-item-history-head">
            <h3>{t("desktop.report.sessionsTitle")} ({sessions.length})</h3>
          </div>
          <div className="report-timeline">
            {dayGroups.map((group) => (
              <div key={group.dayKey} className="report-timeline-group">
                <div className="report-timeline-group-head">
                  <span className="report-timeline-date">{group.dayLabel}</span>
                  <span className="report-timeline-count muted">{group.sessions.length}</span>
                </div>
                <div className="report-timeline-list">
                  {group.sessions.map((s) => {
                    const sessionKey = `${s.provider}:${s.id}`;
                    const dot = dotByKey?.get(sessionKey);
                    const showDot = dot && dot.status !== "open";
                    const isClosedLastExitWaiting = !showDot && Boolean(s.lastExitWaiting);
                    const projectLabel = s.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) || "";
                    return (
                      <button
                        type="button"
                        key={sessionKey}
                        className="report-timeline-item"
                        onClick={() => onSelectSession?.(s)}
                      >
                        <div className="report-timeline-item-main">
                          <span className="s-provider-tag" data-provider={s.provider}>
                            {s.provider}
                          </span>
                          <span className="report-timeline-title">{s.title || s.id}</span>
                          {showDot && (
                            <span
                              className={`session-dot${sessionDotStatusClass(dot.status)}`}
                              aria-hidden="true"
                              title={dot.status}
                            />
                          )}
                          {isClosedLastExitWaiting && (
                            <span
                              className="session-dot is-awaiting is-last-exit-waiting"
                              aria-hidden="true"
                              title={t("desktop.archive.lastExitWaiting")}
                            />
                          )}
                        </div>
                        <div className="report-timeline-item-meta muted">
                          {projectLabel ? <span className="report-timeline-project">{projectLabel}</span> : null}
                          {projectLabel ? " · " : null}
                          <span className="report-timeline-time">{formatTime(s.updatedAt, locale)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {reports.length > 0 ? (
        <div className="report-timeline-section report-timeline-reports">
          <div className="report-work-item-history-head">
            <h3>{t("desktop.archive.reportsTitle", reports.length)}</h3>
          </div>
          <div className="report-timeline-pointers">
            {reports.map((entry) => {
              const titleText = entry.title || entry.id;
              return (
                <button
                  type="button"
                  key={entry.id}
                  className="report-timeline-item report-pointer-item"
                  onClick={() => onSelectReport?.(entry)}
                >
                  <div className="report-timeline-item-main">
                    <span className={`badge ${entry.level}`}>{entry.level}</span>
                    <span className="report-timeline-title">
                      {t("desktop.archive.reportMentioned", titleText)}
                    </span>
                  </div>
                  <div className="report-timeline-item-meta muted">
                    <span className="report-timeline-time">
                      {formatTime(entry.createdAtMs, locale)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UnassignedDetail({
  sessions,
  dotByKey,
  locale,
  t,
  onSelectSession
}: {
  sessions: AgentSession[];
  dotByKey?: Map<string, ActiveSessionDot>;
  locale: string;
  t: Translate;
  onSelectSession?: (session: AgentSession) => void;
}) {
  return (
    <div className="report-work-item-detail">
      <div className="report-work-item-card">
        <div className="report-work-item-card-label">{t("desktop.archive.workItemsTitle")}</div>
        <div className="report-work-item-card-header">
          <div className="report-work-item-title-row">
            <h2 className="report-work-item-heading">
              <span>{t("desktop.report.noWorkItemGroup")}</span>
            </h2>
          </div>
        </div>
        <div className="report-work-item-fields">
          <div className="report-work-item-field muted">
            {t("desktop.archive.unassignedHint")}
          </div>
        </div>
      </div>

      <WorkItemTimeline
        sessions={sessions}
        dotByKey={dotByKey}
        locale={locale}
        t={t}
        onSelectSession={onSelectSession}
        emptyText={t("desktop.archive.unassignedEmpty")}
      />
    </div>
  );
}

function WorkItemDetail({
  item,
  sessions,
  reports = [],
  knownProjects = [],
  dotByKey,
  locale,
  t,
  onStatusChange,
  onSelectSession,
  onSelectReport
}: {
  item: WorkItemRecord;
  sessions: AgentSession[];
  reports?: ReportEntry[];
  knownProjects?: Array<{ projectId: string; portableKey: string; localPath: string | null; pathMissing: boolean }>;
  dotByKey?: Map<string, ActiveSessionDot>;
  locale: string;
  t: Translate;
  onStatusChange?: (newStatus: GtdStatus) => void;
  onSelectSession?: (session: AgentSession) => void;
  onSelectReport?: (report: ReportEntry) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const capsuleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (capsuleRef.current && !capsuleRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [pickerOpen]);

  const handleSelectStatus = async (newStatus: GtdStatus) => {
    setPickerOpen(false);
    try {
      await desktopApi().notesSetGtdStatus({ noteId: item.noteId, status: newStatus });
      onStatusChange?.(newStatus);
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch (error) {
      console.error("Failed to update GTD status:", error);
    }
  };

  const handleOpenNote = () => {
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" }));
    window.dispatchEvent(new CustomEvent("agent-resume:open-note", { detail: item.noteId }));
  };

  const handleOpenImRoom = async () => {
    try {
      const api = desktopApi();
      if (typeof api.imCreateWorkItemRoom !== "function") return;
      const room = await api.imCreateWorkItemRoom({ noteId: item.noteId });
      if (!room) return;
      const payload: WorkbenchSidebarWorkItem = {
        noteId: item.noteId,
        title: item.title || item.noteId,
        status: (item.gtdStatus as GtdStatus) ?? "inbox",
        next: item.work?.next ?? (item.work as any)?.nextAction,
        decision: item.work?.decision,
        sessions: item.work?.sessions ?? [],
        projects: item.work?.projects,
        primaryProject: item.work?.primaryProject,
        updatedAtMs: item.updatedAtMs
      };
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-work-item", { detail: payload }));
      window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-open-room", { detail: { projectId: room.project.projectId } }));
    } catch (error) {
      console.error("Failed to open IM room:", error);
    }
  };

  const projectList = item.work?.projects?.length
    ? item.work.projects
    : item.work?.primaryProject
      ? [item.work.primaryProject]
      : [];

  const nextText = item.work?.next ?? (item.work as any)?.nextAction;

  return (
    <div className="report-work-item-detail">
      <div className="report-work-item-card">
        <div className="report-work-item-card-label">{t("desktop.archive.workItemsTitle")}</div>
        <div className="report-work-item-card-header">
          <div className="report-work-item-title-row">
            <h2 className="report-work-item-heading">
              <span>{item.title || item.noteId}</span>
            </h2>
            <div className="report-work-item-capsule-wrap" ref={capsuleRef}>
              <button
                type="button"
                className={`report-work-item-capsule is-${item.gtdStatus ?? "inbox"}`}
                onClick={() => setPickerOpen((prev) => !prev)}
                aria-expanded={pickerOpen}
                aria-label={t("desktop.workbench.setGtdStatus")}
              >
                <span className={`wb-gtd-status-dot is-${item.gtdStatus ?? "inbox"}`} aria-hidden="true" />
                <span>{t(`desktop.workbench.gtdStatus.${item.gtdStatus ?? "inbox"}`)}</span>
                <ThemeIcon name="chevron-down" size={12} aria-hidden="true" />
              </button>
              {pickerOpen && (
                <div className="report-gtd-picker" role="menu" aria-label={t("desktop.workbench.setGtdStatus")}>
                  {GTD_ALL_STATUSES.map((status) => (
                    <button
                      key={status}
                      type="button"
                      role="menuitemradio"
                      className={`wb-gtd-context-tag is-${status}`}
                      aria-checked={(item.gtdStatus ?? "inbox") === status}
                      onClick={() => void handleSelectStatus(status)}
                    >
                      {t(`desktop.workbench.gtdStatus.${status}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="report-work-item-actions">
            <button
              type="button"
              className="tool-btn report-work-item-btn-note"
              title={t("desktop.workbench.workItemOpenNote")}
              aria-label={t("desktop.workbench.workItemOpenNote")}
              onClick={handleOpenNote}
            >
              <ThemeIcon name="file-text" size={14} aria-hidden="true" />
              <span>{t("desktop.workbench.workItemOpenNote")}</span>
            </button>
            <button
              type="button"
              className="tool-btn report-work-item-btn-im"
              title={t("desktop.kanban.openRoom")}
              aria-label={t("desktop.kanban.openRoom")}
              onClick={() => void handleOpenImRoom()}
            >
              <ThemeIcon name="message-square" size={14} aria-hidden="true" />
              <span>{t("desktop.kanban.openRoom")}</span>
            </button>
          </div>
        </div>

        <div className="report-work-item-field report-work-item-projects-row">
          <span className="field-label">{t("desktop.archive.projects")}: </span>
          <div className="report-work-item-projects">
            {projectList.length === 0 ? (
              <span className="report-project-chip is-missing">
                {t("desktop.workbench.workItemNoProject")}
              </span>
            ) : (
              projectList.map((p) => {
                const baseName = p.split(/[\\/]/).filter(Boolean).at(-1) || p;
                const matched = knownProjects.find((kp) => kp.localPath === p || kp.portableKey === p);
                const isMissing = Boolean(matched?.pathMissing);
                return (
                  <span
                    key={p}
                    className={`report-project-chip${isMissing ? " is-missing" : ""}`}
                    title={isMissing ? t("desktop.workbench.pathMissingHint") : p}
                  >
                    {baseName}
                  </span>
                );
              })
            )}
          </div>
        </div>

        {nextText ? (
          <div className="report-work-item-field">
            <span className="field-label">{t("desktop.archive.nextAction", nextText)}</span>
          </div>
        ) : null}
        {item.work?.decision ? (
          <div className="report-work-item-field">
            <span className="field-label">{t("desktop.archive.decision", item.work.decision)}</span>
          </div>
        ) : null}
      </div>

      <WorkItemTimeline
        sessions={sessions}
        reports={reports}
        dotByKey={dotByKey}
        locale={locale}
        t={t}
        onSelectSession={onSelectSession}
        onSelectReport={onSelectReport}
        emptyText={t("desktop.archive.historyEmpty")}
      />
    </div>
  );
}

function DigestDetail({ entry, focus, hasSessions, loading, stale, running, locale, t, links, onRun }: { entry?: ReportEntry | null; focus: Focus; hasSessions: boolean; loading: boolean; stale: boolean; running: boolean; locale: string; t: Translate; links: ReportLinkRow[]; onRun: () => void }) {
  if (running) {
    return <div className="detail-generating"><p className="empty-hint">{t("desktop.report.generatingStrong")} {" "}<strong>{digestLabel(focus.type, t)}</strong><span className="detail-generating-key">{focus.key}</span></p><p className="muted detail-generating-hint">{t("desktop.report.generatingHint")}</p></div>;
  }
  if (loading && !entry) {
    return <div className="cal-detail-loading" role="status"><span className="cal-detail-spinner" aria-hidden="true" /><span>{t("desktop.common.loading")}…</span></div>;
  }
  if (isFuture(focus.type, focus.key)) return <p className="empty-hint muted">{t("desktop.report.futureDateHint", digestLabel(focus.type, t))}</p>;
  if (!entry) return <div className={`digest-panel digest-panel-empty${hasSessions ? "" : " digest-panel-quiet"}`}><header className="digest-panel-head"><h3><span className={`badge ${levelFor(focus.type)}`}>{levelFor(focus.type)}</span>{digestLabel(focus.type, t)} · {focus.key}</h3></header><p className="empty-hint muted">{hasSessions ? t("desktop.report.emptyHasSessions", scopeLabel(focus.type, t), digestLabel(focus.type, t)) : t("desktop.report.emptyNoSessions", scopeLabel(focus.type, t), digestLabel(focus.type, t))}</p>{hasSessions ? <button type="button" className="tool-btn" onClick={onRun}>{t("desktop.report.generateBtn", digestLabel(focus.type, t))}</button> : null}</div>;
  return <>{stale ? <div className="digest-stale-banner"><p className="muted">{t("desktop.report.staleDefault")}</p></div> : null}<article className="digest-card"><header className="digest-card-head"><div className="digest-card-title-row"><h3><span className={`badge ${entry.level}`}>{entry.level}</span>{entry.title || entry.id}</h3><div className="digest-card-actions"><button type="button" className="tool-btn" onClick={onRun}>{t("desktop.report.regenerateBtn")}</button></div></div><div className="meta-line">{formatTime(entry.createdAtMs, locale)}{entry.embeddingJson ? " · embedding ✓" : ""}</div></header><div className="digest-body markdown-body" onClick={(event) => onDigestRefClick(event, entry, links)} dangerouslySetInnerHTML={{ __html: renderDigestMarkdown(entry.content, links) }} /></article></>;
}

function SessionDetail({ preview, locale, t, assist, onSummarize, onAutoRename, onResume }: { preview: Preview; locale: string; t: Translate; assist: "summary" | "rename" | null; onSummarize: () => void; onAutoRename: () => void; onResume: () => void }) {
  return <div className="session-preview"><div className="session-preview-head"><h3 className="session-preview-title">{preview.preview.title || preview.session.title || preview.session.id}</h3><div className="session-preview-actions"><button type="button" className="tool-btn" onClick={onSummarize} disabled={assist !== null}>{assist === "summary" ? t("desktop.sessions.summarizing") : "Summarize"}</button><button type="button" className="tool-btn" onClick={onAutoRename} disabled={assist !== null}>{assist === "rename" ? t("desktop.sessions.renaming") : "Auto Rename"}</button><button type="button" className="tool-btn" onClick={onResume}>{t("desktop.agent.resumeSession")}</button></div></div><div className="muted session-preview-meta"><span className="s-provider-tag" data-provider={preview.session.provider}>{preview.session.provider}</span>{" · "}{preview.session.id}{" · "}{preview.session.projectPath}</div><div className="session-summary-box"><div className="session-summary-label">Summary</div><div className="session-summary-body">{preview.summary || <span className="muted">No summary yet</span>}</div></div>{preview.preview.warning ? <p className="status error">{preview.preview.warning}</p> : null}{preview.preview.messages.length ? preview.preview.messages.map((message, index) => (<article key={index} className={`preview-msg ${message.role}`}><div className="role">{message.role}{message.timestamp ? ` · ${formatTime(Number(message.timestamp), locale)}` : ""}</div><div>{message.text}</div></article>)) : <p className="muted">{t("desktop.sessions.noMessages")}</p>}{preview.preview.truncated ? <p className="muted">{t("desktop.sessions.truncated")}</p> : null}</div>;
}

export function ReportPanel(): ReactPortal | null {
  const host = document.getElementById("react-report");
  const { locale, t } = useI18n();
  const [active, setActive] = useState(true);

  // Work items (Archive primary axis)
  const [workItems, setWorkItems] = useState<WorkItemRecord[]>([]);
  const [workItemsLoading, setWorkItemsLoading] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [sessionLinks, setSessionLinks] = useState<WorkItemSessionLink[]>([]);
  const [workItemBySession, setWorkItemBySession] = useState<Record<string, { noteId: string; title: string }>>({});
  const [workItemSessions, setWorkItemSessions] = useState<AgentSession[]>([]);

  // Fallback period sessions / calendar focus
  const [focus, setFocus] = useState<Focus>({ type: "day", key: dayKeyFromDate(new Date()) });
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionListOpen, setSessionListOpen] = useState(true);

  // Search state
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveResults, setArchiveResults] = useState<AgentSession[] | null>(null);

  // Filter state
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | GtdStatus>("all");
  const [dots, setDots] = useState<ActiveSessionDot[]>([]);

  // Preview & focused report state
  const [knownProjects, setKnownProjects] = useState<Array<{ projectId: string; portableKey: string; localPath: string | null; pathMissing: boolean }>>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewAssist, setPreviewAssist] = useState<"summary" | "rename" | null>(null);
  const [focusedReport, setFocusedReport] = useState<ReportEntry | null>(null);
  const [reportLinks, setReportLinks] = useState<ReportLinkRow[]>([]);
  const [runningPeriods, setRunningPeriods] = useState<Set<string>>(new Set());
  const [progressByPeriod, setProgressByPeriod] = useState<Map<string, DigestProgressEvent>>(new Map());
  const [stale, setStale] = useState<Set<string>>(new Set());

  const notifyPreviewStatus = (s: { text: string; kind?: "error" | "ok" | "warning" }) => {
    if (s.text) notifyDesktop({ text: s.text, kind: (s.kind ?? "info") as "error" | "ok" | "info" });
  };
  const notifyStatus = (s: { text: string; kind?: "error" | "ok" | "warning" }) => {
    if (s.text) notifyDesktop({ text: s.text, kind: (s.kind ?? "info") as "error" | "ok" | "info" });
  };

  useEffect(() => {
    if (typeof desktopApi().getWorkbenchActiveSessions === "function") {
      void desktopApi()
        .getWorkbenchActiveSessions()
        .then((activeDots) => {
          if (Array.isArray(activeDots)) setDots(activeDots);
        })
        .catch(() => {
          /* best-effort */
        });
    }
    const onActiveSessions = (event: Event) => {
      const detail = (event as CustomEvent<ActiveSessionDot[]>).detail;
      if (Array.isArray(detail)) setDots(detail);
    };
    window.addEventListener("agent-resume:active-sessions", onActiveSessions);
    return () => window.removeEventListener("agent-resume:active-sessions", onActiveSessions);
  }, []);

  useEffect(() => {
    const api = desktopApi();
    if (typeof api.listProjects === "function") {
      void api.listProjects({ includeHidden: true }).then((list) => {
        if (Array.isArray(list)) setKnownProjects(list);
      }).catch(() => undefined);
    }
  }, []);

  const dotByKey = useMemo(() => {
    const map = new Map<string, ActiveSessionDot>();
    for (const dot of dots) {
      if (dot.sessionKey) map.set(dot.sessionKey, dot);
    }
    return map;
  }, [dots]);

  const loadWorkItems = useCallback(async () => {
    if (typeof desktopApi().notesListWorkItems !== "function") return;
    setWorkItemsLoading(true);
    try {
      const [items, links] = await Promise.all([
        desktopApi().notesListWorkItems(),
        typeof desktopApi().notesListWorkItemSessionLinks === "function"
          ? desktopApi().notesListWorkItemSessionLinks()
          : Promise.resolve([])
      ]);
      setWorkItems(items as WorkItemRecord[]);
      setSessionLinks(links);

      const map: Record<string, { noteId: string; title: string }> = {};
      for (const link of links) {
        map[`${link.provider}:${link.sessionId}`] = {
          noteId: link.noteId,
          title: link.title || link.noteId
        };
      }
      setWorkItemBySession(map);

      setSelectedNoteId((prev) => {
        if (prev === "__unassigned__") return prev;
        if (prev && items.some((it) => it.noteId === prev)) return prev;
        return items[0]?.noteId ?? null;
      });
    } catch {
      // Best-effort
    } finally {
      setWorkItemsLoading(false);
    }
  }, []);

  const selectedWorkItem = useMemo(
    () => workItems.find((item) => item.noteId === selectedNoteId) ?? null,
    [workItems, selectedNoteId]
  );

  const workItemSessionKeysMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of workItems) {
      const keys = new Set<string>();
      for (const key of item.work?.sessions ?? []) {
        if (key?.trim()) keys.add(key.trim());
      }
      for (const link of sessionLinks) {
        if (link.noteId === item.noteId && link.provider && link.sessionId) {
          keys.add(`${link.provider}:${link.sessionId}`);
        }
      }
      map.set(item.noteId, Array.from(keys));
    }
    return map;
  }, [workItems, sessionLinks]);

  const workItemProjects = useMemo(() => {
    const paths = new Set<string>();
    for (const item of workItems) {
      if (item.work?.primaryProject) paths.add(item.work.primaryProject);
      for (const path of item.work?.projects ?? []) paths.add(path);
    }
    return [...paths].sort().map((path) => ({
      path,
      label: path.split(/[\\/]/).filter(Boolean).at(-1) || path
    }));
  }, [workItems]);

  const visibleWorkItems = useMemo(() => {
    const filtered = workItems.filter((item) => {
      if (projectFilter) {
        const itemProjects = [
          item.work?.primaryProject,
          ...(item.work?.projects ?? [])
        ].filter(Boolean);
        if (!itemProjects.includes(projectFilter)) return false;
      }
      if (statusFilter !== "all") {
        const itemStatus = item.gtdStatus ?? "inbox";
        if (itemStatus !== statusFilter) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      const aSessions = workItemSessionKeysMap.get(a.noteId) ?? a.work?.sessions;
      const bSessions = workItemSessionKeysMap.get(b.noteId) ?? b.work?.sessions;
      const rankA = rank({ work: { sessions: aSessions }, updatedAtMs: a.updatedAtMs || 0 }, dotByKey);
      const rankB = rank({ work: { sessions: bSessions }, updatedAtMs: b.updatedAtMs || 0 }, dotByKey);
      return rankB - rankA;
    });
  }, [workItems, projectFilter, statusFilter, workItemSessionKeysMap, dotByKey]);

  const workItemSessionKeys = useMemo(() => {
    if (!selectedWorkItem) return [];
    return workItemSessionKeysMap.get(selectedWorkItem.noteId) ?? [];
  }, [selectedWorkItem, workItemSessionKeysMap]);

  useEffect(() => {
    if (selectedNoteId === "__unassigned__") {
      let cancelled = false;
      setSessionsLoading(true);
      void desktopApi()
        .querySessionsPage({ unassignedOnly: true, projectPath: projectFilter || undefined, limit: 200 })
        .then((page) => {
          if (!cancelled) setWorkItemSessions(page.sessions);
        })
        .catch(() => {
          if (!cancelled) setWorkItemSessions([]);
        })
        .finally(() => {
          if (!cancelled) setSessionsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (!workItemSessionKeys.length) {
      setWorkItemSessions([]);
      return;
    }
    const keys = workItemSessionKeys
      .map((key) => {
        const idx = key.indexOf(":");
        return idx > 0 ? { provider: key.slice(0, idx), id: key.slice(idx + 1) } : null;
      })
      .filter(Boolean) as Array<{ provider: string; id: string }>;

    let cancelled = false;
    setSessionsLoading(true);
    void desktopApi()
      .querySessionsPage({ keys, limit: 200 })
      .then((page) => {
        if (!cancelled) setWorkItemSessions(page.sessions);
      })
      .catch(() => {
        if (!cancelled) setWorkItemSessions([]);
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNoteId, projectFilter, workItemSessionKeys]);

  const loadSessions = useCallback(async () => {
    const range = rangeForPeriod(focus.type, focus.key);
    if (!range) return;
    setSessionsLoading(true);
    try {
      const nextSessions = await desktopApi().listSessionsInRange({ ...range, limit: 500 });
      setSessions(nextSessions);
    } catch (error) {
      setSessions([]);
      notifyStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setSessionsLoading(false);
    }
  }, [focus]);

  useEffect(() => {
    void loadWorkItems();
  }, [loadWorkItems]);

  useEffect(() => {
    const reload = () => {
      void loadWorkItems();
    };
    window.addEventListener("agent-resume:notes-mutated", reload);
    return () => window.removeEventListener("agent-resume:notes-mutated", reload);
  }, [loadWorkItems]);

  useEffect(() => {
    const onTab = (event: Event) => {
      const isReport = (event as CustomEvent<string>).detail === "report";
      setActive(isReport);
      if (isReport) {
        void loadWorkItems();
        void loadSessions();
        if (typeof desktopApi().getWorkbenchActiveSessions === "function") {
          void desktopApi().getWorkbenchActiveSessions().then((d) => {
            if (Array.isArray(d)) setDots(d);
          }).catch(() => undefined);
        }
      }
    };
    window.addEventListener("agent-resume:tab-change", onTab);
    return () => window.removeEventListener("agent-resume:tab-change", onTab);
  }, [loadWorkItems, loadSessions]);

  useEffect(() => {
    const onArchiveFocus = (event: Event) => {
      const noteId = (event as CustomEvent<{ noteId: string }>).detail?.noteId;
      if (noteId) {
        setSelectedNoteId(noteId);
        setPreview(null);
        setFocusedReport(null);
      }
    };
    window.addEventListener("agent-resume:archive-focus", onArchiveFocus);
    return () => window.removeEventListener("agent-resume:archive-focus", onArchiveFocus);
  }, []);

  useEffect(() => {
    const onFocus = async (event: Event) => {
      const next = (event as CustomEvent<Focus | undefined>).detail;
      if (!next?.key) return;
      setFocus(next);
      try {
        const range = rangeForPeriod(next.type, next.key);
        if (range) {
          const list = await desktopApi().listReports({ ...range, limit: 10 });
          const entry = list.find((e) => periodKeyFromEntry(e) === next.key) || list[0] || null;
          setFocusedReport(entry);
          setPreview(null);
        }
      } catch {
        /* best-effort */
      }
    };
    window.addEventListener("agent-resume:report-focus", onFocus);
    return () => window.removeEventListener("agent-resume:report-focus", onFocus);
  }, []);

  useEffect(() => {
    if (!focusedReport?.id) {
      setReportLinks([]);
      return;
    }
    let cancelled = false;
    void desktopApi()
      .getReportLinks(focusedReport.id)
      .then((links) => {
        if (!cancelled) setReportLinks(links ?? []);
      })
      .catch(() => {
        if (!cancelled) setReportLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [focusedReport?.id]);

  useEffect(() => desktopApi().onDigestProgress((event) => {
    const key = progressKeyFromEvent(event);
    if (!key) return;
    setProgressByPeriod((current) => new Map(current).set(key, event));
  }), []);

  useEffect(() => {
    const query = archiveQuery.trim();
    if (!query) {
      setArchiveResults(null);
      return;
    }
    let cancelled = false;
    setSessionsLoading(true);
    const timer = setTimeout(() => {
      void desktopApi()
        .querySessionsPage({ search: query, limit: 200 })
        .then((page) => {
          if (!cancelled) setArchiveResults(page.sessions);
        })
        .catch((error) => {
          if (!cancelled) {
            setArchiveResults([]);
            notifyStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
          }
        })
        .finally(() => {
          if (!cancelled) setSessionsLoading(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [archiveQuery]);

  const openPreview = async (session: AgentSession) => {
    try {
      const result = await desktopApi().previewSession({ provider: session.provider, id: session.id });
      setPreview({ session: result.session, preview: result.preview, summary: result.session.sessionSummary || "" });
      notifyPreviewStatus({ text: "" });
    } catch (error) {
      notifyStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  };

  const summarizePreview = async () => {
    if (!preview) return;
    setPreviewAssist("summary");
    try {
      const result = await desktopApi().summarizeSession({ provider: preview.session.provider, id: preview.session.id });
      setPreview((current) => current ? { ...current, session: result.session, summary: result.summary } : current);
      notifyPreviewStatus({ text: t("desktop.sessions.summaryGenerated"), kind: "ok" });
      window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
    } catch (error) {
      notifyPreviewStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setPreviewAssist(null);
    }
  };

  const renamePreview = async () => {
    if (!preview) return;
    setPreviewAssist("rename");
    try {
      const result = await desktopApi().autoRenameSession({ provider: preview.session.provider, id: preview.session.id });
      const updateTitle = (s: AgentSession) => s.provider === preview.session.provider && s.id === preview.session.id ? { ...s, title: result.title } : s;
      setSessions((current) => current.map(updateTitle));
      setWorkItemSessions((current) => current.map(updateTitle));
      setPreview((current) => current ? { ...current, session: { ...current.session, title: result.title }, preview: { ...current.preview, title: result.title } } : current);
      let text = t("desktop.sessions.renamed", result.title);
      if (!result.nativeRenamed && result.nativeError) text += t("desktop.sessions.renamedNativeError", result.nativeError);
      notifyPreviewStatus({ text, kind: result.nativeRenamed || !result.nativeError ? "ok" : "error" });
      window.dispatchEvent(new CustomEvent("agent-resume:sessions-mutated", { detail: { kind: "session-title" } }));
    } catch (error) {
      notifyPreviewStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setPreviewAssist(null);
    }
  };

  const resumePreview = async () => {
    if (!preview) return;
    const { provider, id } = preview.session;
    try {
      const result = await desktopApi().workbenchOpenSession({ provider, id });
      if (result.external) {
        notifyPreviewStatus({ text: t("desktop.agent.resumeStarted", provider, id), kind: "ok" });
        return;
      }
      window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-open-session", { detail: preview.session }));
      notifyPreviewStatus({ text: t("desktop.agent.resumeStarted", provider, id), kind: "ok" });
    } catch (error) {
      notifyPreviewStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  };

  const run = async (type: ReportPeriodType) => {
    const key = focus.key;
    const periodKey = digestProgressKey(type, key);
    if (runningPeriods.has(periodKey)) return;
    const dailyRunning = isLevelRunning(runningPeriods, "daily");
    const weeklyMonthlyRunning = isLevelRunning(runningPeriods, "weekly") || isLevelRunning(runningPeriods, "monthly");
    if (type === "day" && weeklyMonthlyRunning) {
      notifyStatus({ text: t("desktop.report.weeklyMonthlyBusyError"), kind: "error" });
      return;
    }
    if (type !== "day" && (dailyRunning || weeklyMonthlyRunning)) {
      notifyStatus({ text: t(type === "week" ? "desktop.report.taskBusyGenWeekly" : "desktop.report.taskBusyGenMonthly"), kind: "error" });
      return;
    }
    let allowOverBudget = false;
    try {
      if (typeof desktopApi().previewDigestRun === "function") {
        const estimate = await desktopApi().previewDigestRun({ level: levelFor(type), periodKey: key });
        if (estimate.overBudget) {
          const confirmed = window.confirm(t(
            "desktop.report.budgetConfirm",
            estimate.sessionCount,
            estimate.summaryCallCount,
            estimate.digestCallCount,
            estimate.estimatedLlmCalls,
            estimate.callBudget
          ));
          if (!confirmed) return;
          allowOverBudget = true;
        }
      }
    } catch (error) {
      notifyStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
      return;
    }
    setRunningPeriods((current) => new Set(current).add(periodKey));
    setProgressByPeriod((current) => new Map(current).set(periodKey, { phase: "start", level: levelFor(type), periodLabel: key, message: t("desktop.report.generatingLabel", digestLabel(type, t), key) }));
    notifyStatus({ text: "" });
    try {
      const approval = allowOverBudget ? { allowOverBudget: true } : {};
      if (type === "day") await desktopApi().runDailyDigest({ date: key, ...approval });
      else if (type === "week") await desktopApi().runWeeklyDigest({ weekKey: key, ...approval });
      else await desktopApi().runMonthlyDigest({ monthKey: key, ...approval });
      notifyStatus({ text: t("desktop.report.digestOk", digestLabel(type, t), key, t("desktop.report.created"), 0, 0, ""), kind: "ok" });
      const range = rangeForPeriod(type, key);
      if (range) {
        const list = await desktopApi().listReports({ ...range, limit: 10 });
        const entry = list.find((e) => periodKeyFromEntry(e) === key) || list[0] || null;
        setFocusedReport(entry);
      }
    } catch (error) {
      notifyStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setRunningPeriods((current) => { const next = new Set(current); next.delete(periodKey); return next; });
      setProgressByPeriod((current) => { const next = new Map(current); next.delete(periodKey); return next; });
    }
  };

  const sessionsForList = useMemo(() => {
    if (archiveResults) return archiveResults;
    if (selectedWorkItem || selectedNoteId === "__unassigned__") return workItemSessions;
    return sessions;
  }, [archiveResults, selectedWorkItem, selectedNoteId, workItemSessions, sessions]);

  const sessionGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; sessions: typeof sessionsForList }>();
    for (const session of sessionsForList) {
      const info = workItemBySession[`${session.provider}:${session.id}`];
      const groupKey = info ? `work:${info.noteId}` : "__unassigned__";
      let group = groups.get(groupKey);
      if (!group) {
        group = { key: groupKey, label: info?.title ?? t("desktop.report.noWorkItemGroup"), sessions: [] };
        groups.set(groupKey, group);
      }
      group.sessions.push(session);
    }
    return [...groups.values()];
  }, [sessionsForList, t, workItemBySession]);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadWorkItems(),
      loadSessions(),
      typeof desktopApi().getWorkbenchActiveSessions === "function"
        ? desktopApi().getWorkbenchActiveSessions().then((d) => {
            if (Array.isArray(d)) setDots(d);
          }).catch(() => undefined)
        : Promise.resolve()
    ]);
  }, [loadWorkItems, loadSessions]);

  const focusedPeriodKey = digestProgressKey(focus.type, focus.key);
  const focusedRunning = runningPeriods.has(focusedPeriodKey);
  const focusedProgress = progressByPeriod.get(focusedPeriodKey);

  const detailProgress = focusedRunning && focusedProgress ? (
    <div className="detail-progress gen-progress is-loading" role="status" aria-live="polite">
      <div className="gen-progress-line">{focusedProgress.message || t("desktop.report.generatingHint")}</div>
    </div>
  ) : null;

  const onWorkItemStatusChange = useCallback((noteId: string, newStatus: GtdStatus) => {
    setWorkItems((prev) => prev.map((wi) => (wi.noteId === noteId ? { ...wi, gtdStatus: newStatus } : wi)));
  }, []);

  const [selectedWorkItemReports, setSelectedWorkItemReports] = useState<ReportEntry[]>([]);

  const selectedWorkItemSessionKeys = useMemo(() => {
    if (!selectedWorkItem) return [];
    const keys = new Set<string>();
    for (const key of selectedWorkItem.work?.sessions ?? []) {
      if (key?.trim()) keys.add(key.trim());
    }
    for (const link of sessionLinks) {
      if (link.noteId === selectedWorkItem.noteId) {
        keys.add(`${link.provider}:${link.sessionId}`);
      }
    }
    for (const s of workItemSessions) {
      keys.add(`${s.provider}:${s.id}`);
    }
    return Array.from(keys);
  }, [selectedWorkItem, sessionLinks, workItemSessions]);

  useEffect(() => {
    if (!selectedWorkItem || selectedWorkItemSessionKeys.length === 0) {
      setSelectedWorkItemReports([]);
      return;
    }
    if (typeof desktopApi().listReportsForSessions !== "function") {
      setSelectedWorkItemReports([]);
      return;
    }
    let cancelled = false;
    desktopApi()
      .listReportsForSessions(selectedWorkItemSessionKeys)
      .then((entries) => {
        if (!cancelled) setSelectedWorkItemReports(entries ?? []);
      })
      .catch(() => {
        if (!cancelled) setSelectedWorkItemReports([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWorkItem?.noteId, selectedWorkItemSessionKeys.join(",")]);

  const openReport = useCallback((report: ReportEntry) => {
    setFocusedReport(report);
    setPreview(null);
  }, []);

  const detail = preview ? (
    <SessionDetail
      preview={preview}
      locale={locale}
      t={t}
      assist={previewAssist}
      onSummarize={() => void summarizePreview()}
      onAutoRename={() => void renamePreview()}
      onResume={() => void resumePreview()}
    />
  ) : focusedReport ? (
    <DigestDetail
      entry={focusedReport}
      focus={focus}
      hasSessions={sessions.length > 0}
      loading={sessionsLoading}
      stale={stale.has(`${levelFor(focus.type)}:${focus.key}`)}
      running={focusedRunning}
      locale={locale}
      t={t}
      links={reportLinks}
      onRun={() => void run(focus.type)}
    />
  ) : selectedWorkItem ? (
    <WorkItemDetail
      item={selectedWorkItem}
      sessions={workItemSessions}
      reports={selectedWorkItemReports}
      knownProjects={knownProjects}
      dotByKey={dotByKey}
      locale={locale}
      t={t}
      onStatusChange={(newStatus) => onWorkItemStatusChange(selectedWorkItem.noteId, newStatus)}
      onSelectSession={(s) => void openPreview(s)}
      onSelectReport={openReport}
    />
  ) : selectedNoteId === "__unassigned__" ? (
    <UnassignedDetail
      sessions={workItemSessions}
      dotByKey={dotByKey}
      locale={locale}
      t={t}
      onSelectSession={(s) => void openPreview(s)}
    />
  ) : (
    <div className="cal-detail-empty">
      <p className="muted">{t("desktop.archive.noWorkItemSelected")}</p>
    </div>
  );

  const headerSlot = document.getElementById("app-header-slot");
  const toolbar = (
    <div className="toolbar report-toolbar">
      <div className="cal-nav-left" />
      <div className="cal-nav-right">
        {active && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => void refreshAll()}
            title={t("desktop.common.refresh")}
          >
            ↻
          </button>
        )}
      </div>
    </div>
  );

  if (!host) return null;

  return createPortal(
    <section className="panel active react-report-panel" hidden={!active}>
      {active && headerSlot ? createPortal(toolbar, headerSlot) : null}
      <div className="report-layout">
        <div className="report-left-col">
          <div className="cal-session-panel report-work-items-panel">
            <div className="cal-session-panel-head">
              <strong>{t("desktop.archive.workItemsTitle")}</strong>
              <span className="cal-session-head-meta">
                <span className="muted">
                  {workItemsLoading ? t("desktop.common.loading") : t("desktop.archive.workItemsCount", visibleWorkItems.length)}
                </span>
              </span>
            </div>
            <div className="wb-work-item-filters">
              <select
                className="quiet-select wb-work-item-filter"
                aria-label={t("desktop.notes.projectLabel")}
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
              >
                <option value="">{t("desktop.common.all")}</option>
                {workItemProjects.map((project) => (
                  <option key={project.path} value={project.path}>
                    {project.label}
                  </option>
                ))}
              </select>
              <select
                className="quiet-select wb-work-item-filter"
                aria-label={t("desktop.workbench.sessionFilter")}
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "all" | GtdStatus)}
              >
                <option value="all">{t("desktop.common.all")}</option>
                {GTD_FILTER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`desktop.workbench.gtdStatus.${status}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="cal-session-list" aria-busy={workItemsLoading}>
              {workItemsLoading ? (
                <p className="muted cal-session-empty">{t("desktop.common.loading")}</p>
              ) : (
                <>
                  {visibleWorkItems.length ? (
                    visibleWorkItems.map((item) => {
                      const isSelected = item.noteId === selectedNoteId;
                      const dot = rollupDot(
                        { work: { sessions: workItemSessionKeysMap.get(item.noteId) ?? item.work?.sessions } },
                        dotByKey
                      );
                      const showDot = dot && dot.status !== "open";
                      return (
                        <button
                          type="button"
                          key={item.noteId}
                          className={`cal-session-row report-work-item-row${isSelected ? " active" : ""}`}
                          aria-current={isSelected ? "true" : undefined}
                          onClick={() => {
                            setSelectedNoteId(item.noteId);
                            setPreview(null);
                            setFocusedReport(null);
                          }}
                        >
                          <div className="s-title">
                            <span className={`wb-gtd-status-dot is-${item.gtdStatus ?? "inbox"}`} aria-hidden="true" />
                            <span className="report-work-item-title-text">{item.title || item.noteId}</span>
                            {showDot && (
                              <span
                                className={`session-dot${sessionDotStatusClass(dot.status)}`}
                                aria-hidden="true"
                                title={dot.status}
                              />
                            )}
                          </div>
                          <div className="s-meta">
                            {item.work?.primaryProject
                              ? item.work.primaryProject.split(/[\\/]/).filter(Boolean).at(-1)
                              : item.work?.projects?.[0]?.split(/[\\/]/).filter(Boolean).at(-1) || ""}
                            {item.work?.sessions?.length ? ` · ${item.work.sessions.length} sessions` : ""}
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <p className="muted cal-session-empty">{t("desktop.archive.workItemsEmpty")}</p>
                  )}
                  <button
                    type="button"
                    key="__unassigned__"
                    className={`cal-session-row report-unassigned-row${selectedNoteId === "__unassigned__" ? " active" : ""}`}
                    aria-current={selectedNoteId === "__unassigned__" ? "true" : undefined}
                    title={t("desktop.archive.unassignedHint")}
                    onClick={() => {
                      setSelectedNoteId("__unassigned__");
                      setPreview(null);
                      setFocusedReport(null);
                    }}
                  >
                    <div className="s-title">
                      <span className="wb-gtd-status-dot is-unassigned" aria-hidden="true" />
                      <span className="report-work-item-title-text">{t("desktop.report.noWorkItemGroup")}</span>
                    </div>
                    <div className="s-meta">
                      {t("desktop.archive.unassignedHint")}
                    </div>
                  </button>
                </>
              )}
            </div>
          </div>
          <aside className={`report-session-pane${sessionListOpen ? "" : " collapsed"}`}>
            <div className="cal-session-panel">
              <div
                className="cal-session-panel-head"
                role="button"
                tabIndex={0}
                aria-expanded={sessionListOpen}
                onClick={() => setSessionListOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSessionListOpen((open) => !open);
                  }
                }}
              >
                <strong>
                  {t("desktop.report.sessionsTitle")} · {selectedNoteId === "__unassigned__" ? t("desktop.report.noWorkItemGroup") : (selectedWorkItem ? (selectedWorkItem.title || selectedWorkItem.noteId) : t("desktop.archive.sessionsAllTime"))}
                </strong>
                <span className="cal-session-head-meta">
                  <span className="muted">
                    {sessionsLoading ? t("desktop.common.loading") : t("desktop.report.sessionCountMeta", sessionsForList.length)}
                  </span>
                  <span className={`cal-session-toggle${sessionListOpen ? " open" : ""}`} aria-hidden="true">
                    ▸
                  </span>
                </span>
              </div>
              <div className="cal-session-search-row">
                <input
                  type="search"
                  className="cal-session-search"
                  aria-label={t("desktop.archive.search")}
                  placeholder={t("desktop.archive.searchPlaceholder")}
                  value={archiveQuery}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setArchiveQuery(event.target.value)}
                />
              </div>
              <div className="cal-session-list" aria-busy={sessionsLoading}>
                {sessionsLoading ? (
                  <p className="muted cal-session-empty">{t("desktop.common.loading")}</p>
                ) : sessionsForList.length ? (
                  archiveQuery.trim() ? (
                    sessionGroups.flatMap((group) => [
                      <div key={`g:${group.key}`} className="cal-session-group-head">
                        <span className="cal-session-group-label">{group.label}</span>
                        <span className="cal-session-group-count">{group.sessions.length}</span>
                      </div>,
                      ...group.sessions.map((session) => (
                        <button
                          type="button"
                          key={`${session.provider}:${session.id}`}
                          className={`cal-session-row${preview?.session.provider === session.provider && preview.session.id === session.id ? " active" : ""}`}
                          aria-current={preview?.session.provider === session.provider && preview.session.id === session.id ? "true" : undefined}
                          onClick={() => void openPreview(session)}
                        >
                          <div className="s-title">{session.title || session.id}</div>
                          <div className="s-meta">
                            <span className="s-provider-tag" data-provider={session.provider}>
                              {session.provider}
                            </span>
                            {" · "}
                            {session.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) || ""}
                            {" · "}
                            {formatTime(session.updatedAt, locale)}
                          </div>
                        </button>
                      ))
                    ])
                  ) : (
                    sessionsForList.map((session) => (
                      <button
                        type="button"
                        key={`${session.provider}:${session.id}`}
                        className={`cal-session-row${preview?.session.provider === session.provider && preview.session.id === session.id ? " active" : ""}`}
                        aria-current={preview?.session.provider === session.provider && preview.session.id === session.id ? "true" : undefined}
                        onClick={() => void openPreview(session)}
                      >
                        <div className="s-title">{session.title || session.id}</div>
                        <div className="s-meta">
                          <span className="s-provider-tag" data-provider={session.provider}>
                            {session.provider}
                          </span>
                          {" · "}
                          {session.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) || ""}
                          {" · "}
                          {formatTime(session.updatedAt, locale)}
                        </div>
                      </button>
                    ))
                  )
                ) : (
                  <p className="muted cal-session-empty">{t("desktop.report.noSessionsInRange")}</p>
                )}
              </div>
            </div>
          </aside>
        </div>
        <main className="report-detail-pane">
          <div className="report-detail-head">
            {preview ? (
              <>
                <strong>{preview.preview.title || preview.session.title || preview.session.id}</strong>
                <button
                  type="button"
                  className="tool-btn ghost-btn report-detail-back"
                  onClick={() => {
                    setPreview(null);
                    setPreviewAssist(null);
                    notifyPreviewStatus({ text: "" });
                  }}
                >
                  {t("desktop.report.backToReport")}
                </button>
              </>
            ) : focusedReport ? (
              <>
                <strong>{focusedReport.title || focusedReport.id}</strong>
                <button
                  type="button"
                  className="tool-btn ghost-btn report-detail-back"
                  onClick={() => setFocusedReport(null)}
                >
                  {t("desktop.report.backToReport")}
                </button>
              </>
            ) : selectedWorkItem ? (
              <>
                <strong>{selectedWorkItem.title || selectedWorkItem.noteId}</strong>
                <span className={`wb-gtd-status-dot is-${selectedWorkItem.gtdStatus ?? "inbox"}`} aria-hidden="true" />
              </>
            ) : (
              <strong>{t("desktop.archive.workItemsTitle")}</strong>
            )}
          </div>
          {detailProgress}
          <div className="cal-detail">{detail}</div>
        </main>
      </div>
    </section>,
    host
  );
}
