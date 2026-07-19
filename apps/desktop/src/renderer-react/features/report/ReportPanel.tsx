import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState, type ReactPortal } from "react";
import type { AgentSession, ReportEntry } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { renderMarkdown as markdown } from "../../components/Markdown";
import { useI18n } from "../../i18n";
import { calendarCells, dayKeyFromDate, dayKeyFromMs, digestIndex, isoWeekLabelFromDate, paddedMonthRange, parseWeekRange, rangeForPeriod, type ReportPeriodType, viewMonthKey } from "./model";

type Focus = { type: ReportPeriodType; key: string };
type Preview = { session: AgentSession; messages: Array<{ role: string; text: string; timestamp?: string }> };

const MONTH_KEYS = ["desktop.calendar.month1", "desktop.calendar.month2", "desktop.calendar.month3", "desktop.calendar.month4", "desktop.calendar.month5", "desktop.calendar.month6", "desktop.calendar.month7", "desktop.calendar.month8", "desktop.calendar.month9", "desktop.calendar.month10", "desktop.calendar.month11", "desktop.calendar.month12"];

function levelFor(type: ReportPeriodType): "daily" | "weekly" | "monthly" { return type === "day" ? "daily" : type === "week" ? "weekly" : "monthly"; }
function digestLabel(type: ReportPeriodType, t: (key: string) => string): string { return t(type === "day" ? "desktop.report.digestDaily" : type === "week" ? "desktop.report.digestWeekly" : "desktop.report.digestMonthly"); }
function isFuture(type: ReportPeriodType, key: string): boolean {
  const today = dayKeyFromDate(new Date());
  if (type === "day") return key > today;
  if (type === "month") return key > today.slice(0, 7);
  return key > isoWeekLabelFromDate(new Date());
}
function formatTime(value: number, locale: string): string { return new Date(value).toLocaleString(locale); }

export function ReportPanel(): ReactPortal | null {
  const host = document.getElementById("react-report");
  const { locale, t } = useI18n();
  const today = useMemo(() => new Date(), []);
  const [active, setActive] = useState(true);
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [focus, setFocus] = useState<Focus>({ type: "day", key: dayKeyFromDate(today) });
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [monthSessions, setMonthSessions] = useState<AgentSession[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [stale, setStale] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });

  const monthKey = viewMonthKey(view.year, view.month);
  const index = useMemo(() => digestIndex(entries), [entries]);
  const sessionDays = useMemo(() => new Set(monthSessions.map((item) => dayKeyFromMs(item.updatedAt))), [monthSessions]);

  const loadMonth = useCallback(async () => {
    setLoading(true);
    try {
      const padded = paddedMonthRange(view.year, view.month);
      const exact = rangeForPeriod("month", viewMonthKey(view.year, view.month));
      const [nextEntries, nextSessions] = await Promise.all([
        desktopApi().listReports({ ...padded, limit: 300 }),
        exact ? desktopApi().listSessionsInRange({ ...exact, limit: 2000 }) : Promise.resolve([])
      ]);
      setEntries(nextEntries);
      setMonthSessions(nextSessions);
      if (typeof desktopApi().needsDailyDigestRefresh === "function") {
        const checks = await Promise.all(nextEntries.filter((entry) => entry.level === "daily" || entry.level === "weekly" || entry.level === "monthly").map(async (entry) => {
          const key = entry.level === "daily" ? entry.id.replace(/^daily:/, "") : entry.level === "weekly" ? entry.id.replace(/^weekly:/, "") : entry.id.replace(/^monthly:/, "");
          const check = entry.level === "daily" ? await desktopApi().needsDailyDigestRefresh(key) : entry.level === "weekly" ? await desktopApi().needsWeeklyDigestRefresh(key) : await desktopApi().needsMonthlyDigestRefresh(key);
          return check.needed && (check.reason === "new_sessions" || check.reason === "updated_sessions") ? `${entry.level}:${key}` : "";
        }));
        setStale(new Set(checks.filter(Boolean)));
      }
      setStatus({ text: "" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally { setLoading(false); }
  }, [view.month, view.year]);

  const loadSessions = useCallback(async () => {
    const range = rangeForPeriod(focus.type, focus.key);
    if (!range) return;
    try {
      setSessions(await desktopApi().listSessionsInRange({ ...range, limit: 500 }));
    } catch (error) {
      setSessions([]);
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [focus]);

  useEffect(() => { void loadMonth(); }, [loadMonth]);
  useEffect(() => { setPreview(null); void loadSessions(); }, [loadSessions]);
  useEffect(() => {
    const onTab = (event: Event) => setActive((event as CustomEvent<string>).detail === "report");
    window.addEventListener("agent-resume:tab-change", onTab);
    return () => window.removeEventListener("agent-resume:tab-change", onTab);
  }, []);
  useEffect(() => {
    const onFocus = (event: Event) => {
      const next = (event as CustomEvent<Focus | undefined>).detail;
      if (!next?.key) return;
      if (next.type === "day" || next.type === "month") {
        const [year, month] = next.key.split("-").map(Number);
        if (Number.isFinite(year) && Number.isFinite(month)) setView({ year, month: month - 1 });
      } else {
        const range = parseWeekRange(next.key);
        if (range) { const date = new Date(range.fromMs); setView({ year: date.getFullYear(), month: date.getMonth() }); }
      }
      selectFocus(next);
    };
    window.addEventListener("agent-resume:report-focus", onFocus);
    return () => window.removeEventListener("agent-resume:report-focus", onFocus);
  }, []);
  useEffect(() => desktopApi().onDigestProgress((event) => {
    const level = levelFor(focus.type);
    if (event.level === level && event.periodLabel === focus.key) setProgress(event.message || "");
  }), [focus]);

  const selectFocus = (next: Focus) => { setFocus(next); setProgress(""); };
  const navigate = (delta: number) => {
    const next = new Date(view.year, view.month + delta, 1);
    const month = { year: next.getFullYear(), month: next.getMonth() };
    setView(month);
    selectFocus({ type: "month", key: viewMonthKey(month.year, month.month) });
  };
  const openPreview = async (session: AgentSession) => {
    try {
      const result = await desktopApi().previewSession({ provider: session.provider, id: session.id });
      setPreview({ session: result.session, messages: result.preview.messages });
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };
  const run = async (type: ReportPeriodType) => {
    const key = focus.key;
    setRunning(true); setProgress(t("desktop.report.generatingLabel", digestLabel(type, t), key)); setStatus({ text: "" });
    try {
      if (type === "day") await desktopApi().runDailyDigest({ date: key });
      else if (type === "week") await desktopApi().runWeeklyDigest(key);
      else await desktopApi().runMonthlyDigest(key);
      setStatus({ text: t("desktop.report.digestOk", digestLabel(type, t), key, t("desktop.report.created"), 0, 0, ""), kind: "ok" });
      await loadMonth();
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
    finally { setRunning(false); setProgress(""); }
  };

  if (!host) return null;
  const selectedEntry = index.get(`${levelFor(focus.type)}:${focus.key}`);
  const cells = calendarCells(view.year, view.month);
  const weeks = Array.from({ length: 6 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
  const detail = preview ? <SessionDetail preview={preview} locale={locale} /> : <DigestDetail entry={selectedEntry} focus={focus} hasSessions={sessions.length > 0} stale={stale.has(`${levelFor(focus.type)}:${focus.key}`)} running={running} progress={progress} t={t} onRun={() => void run(focus.type)} onGtd={() => window.dispatchEvent(new CustomEvent("agent-resume:gtd-open", { detail: { level: levelFor(focus.type), reportId: selectedEntry?.id } }))} />;
  return createPortal(<section className="panel active react-report-panel" hidden={!active}><div className="toolbar report-toolbar"><div className="cal-nav-left"><button type="button" className="tool-btn" onClick={() => navigate(-1)} title={t("desktop.report.prevMonth")}>‹</button><select className="quiet-select tool-select cal-year-select" value={view.year} onChange={(event) => { const year = Number(event.target.value); setView({ ...view, year }); selectFocus({ type: "month", key: viewMonthKey(year, view.month) }); }}>{Array.from({ length: 18 }, (_, index) => today.getFullYear() + 2 - index).map((year) => <option key={year} value={year}>{t("desktop.common.yearSuffix", year)}</option>)}</select><select className="quiet-select tool-select cal-month-select" value={view.month} onChange={(event) => { const month = Number(event.target.value); setView({ ...view, month }); selectFocus({ type: "month", key: viewMonthKey(view.year, month) }); }}>{MONTH_KEYS.map((key, month) => <option key={key} value={month}>{t(key)}</option>)}</select><button type="button" className="tool-btn" onClick={() => navigate(1)} title={t("desktop.report.nextMonth")}>›</button><button type="button" className="tool-btn" onClick={() => { const now = new Date(); setView({ year: now.getFullYear(), month: now.getMonth() }); selectFocus({ type: "day", key: dayKeyFromDate(now) }); }}>{t("desktop.common.today")}</button></div><div className="cal-nav-right"><button type="button" className="tool-btn ghost-btn" onClick={() => void loadMonth()}>{t("desktop.common.refresh")}</button></div></div><div className="report-layout"><aside className="report-cal-pane"><div className="cal-main"><div className="cal-weekdays"><span>{t("desktop.report.weekdayMon")}</span><span>{t("desktop.report.weekdayTue")}</span><span>{t("desktop.report.weekdayWed")}</span><span>{t("desktop.report.weekdayThu")}</span><span>{t("desktop.report.weekdayFri")}</span><span>{t("desktop.report.weekdaySat")}</span><span>{t("desktop.report.weekdaySun")}</span><span className="cal-week-col-head">{t("desktop.report.weekCol")}</span></div><div className="cal-grid">{weeks.map((week) => <CalendarWeek key={week[0]?.key} cells={week} focus={focus} index={index} sessionDays={sessionDays} stale={stale} t={t} onDay={(key) => selectFocus({ type: "day", key })} onWeek={(key) => selectFocus({ type: "week", key })} />)}</div><div className="cal-month-actions"><button type="button" className={`tool-btn cal-month-btn${focus.type === "month" ? " selected" : ""}${stale.has(`monthly:${monthKey}`) ? " has-digest-stale" : ""}`} disabled={isFuture("month", monthKey)} onClick={() => selectFocus({ type: "month", key: monthKey })}>{t("desktop.report.monthBtn")} · {monthKey}</button></div></div></aside><aside className="report-session-pane"><div className="cal-session-panel"><div className="cal-session-panel-head"><strong>{t("desktop.report.sessionsTitle")}</strong><span className="muted">{loading ? t("desktop.common.loading") : t("desktop.report.sessionCountMeta", sessions.length)}</span></div><div className="cal-session-list">{sessions.length ? sessions.map((session) => <button type="button" key={`${session.provider}:${session.id}`} className="cal-session-row" onClick={() => void openPreview(session)}><div className="s-title">{session.title || session.id}</div><div className="s-meta">{session.provider} · {session.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) || ""} · {formatTime(session.updatedAt, locale)}</div></button>) : <p className="muted cal-session-empty">{t("desktop.report.noSessionsInRange")}</p>}</div></div></aside><main className="report-detail-pane"><div className="report-detail-head"><strong>{preview ? preview.session.title || preview.session.id : t("desktop.report.digestDetailTitle", digestLabel(focus.type, t), focus.key)}</strong>{preview ? <button type="button" className="tool-btn ghost-btn report-detail-back" onClick={() => setPreview(null)}>{t("desktop.report.backToReport")}</button> : null}</div><div className="cal-detail">{detail}</div></main></div><Status kind={status.kind}>{status.text}</Status></section>, host);
}

function CalendarWeek({ cells, focus, index, sessionDays, stale, t, onDay, onWeek }: { cells: ReturnType<typeof calendarCells>; focus: Focus; index: Map<string, ReportEntry>; sessionDays: Set<string>; stale: Set<string>; t: (key: string, ...args: Array<string | number>) => string; onDay: (key: string) => void; onWeek: (key: string) => void }) {
  const week = cells[0]?.week || "";
  const hasWeek = index.has(`weekly:${week}`);
  return <>{cells.map((cell) => { const digest = index.get(`daily:${cell.key}`); const mark = digest ? stale.has(`daily:${cell.key}`) ? "daily-stale" : "daily" : !cell.outside && sessionDays.has(cell.key) ? "daily-missing" : "no-session"; return <button type="button" key={cell.key} className={`cal-cell${cell.outside ? " outside" : ""}${focus.type === "day" && focus.key === cell.key ? " selected" : ""}`} onClick={() => onDay(cell.key)}><span className="day-num">{cell.day}</span><span className="marks"><span className={`mark ${mark}`} aria-hidden="true">{digest ? mark === "daily-stale" ? "↻" : "D" : mark === "daily-missing" ? "+" : "-"}</span></span></button>; })}<button type="button" className={`cal-week-btn${hasWeek ? " has-digest" : ""}${stale.has(`weekly:${week}`) ? " has-digest-stale" : ""}${focus.type === "week" && focus.key === week ? " selected" : ""}`} onClick={() => onWeek(week)}><span className="cal-week-label">{week.slice(-3)}</span></button></>;
}

function DigestDetail({ entry, focus, hasSessions, stale, running, progress, t, onRun, onGtd }: { entry?: ReportEntry; focus: Focus; hasSessions: boolean; stale: boolean; running: boolean; progress: string; t: (key: string, ...args: Array<string | number>) => string; onRun: () => void; onGtd: () => void }) {
  if (running) return <div className="detail-generating"><p className="empty-hint">{progress || t("desktop.report.generatingLabel", digestLabel(focus.type, t), focus.key)}</p></div>;
  if (isFuture(focus.type, focus.key)) return <p className="empty-hint muted">{t("desktop.report.futureDateHint", digestLabel(focus.type, t))}</p>;
  if (!entry) return <div className="digest-panel digest-panel-empty"><p className="empty-hint muted">{hasSessions ? t("desktop.report.emptyHasSessions", focus.type, digestLabel(focus.type, t)) : t("desktop.report.emptyNoSessions", focus.type, digestLabel(focus.type, t))}</p>{hasSessions ? <button type="button" className="tool-btn" onClick={onRun}>{t("desktop.report.generateBtn", digestLabel(focus.type, t))}</button> : null}</div>;
  return <>{stale ? <div className="digest-stale-banner"><p className="muted">{t("desktop.report.staleDefault")}</p></div> : null}<article className="digest-card"><header className="digest-card-head"><div className="digest-card-title-row"><h3><span className={`badge ${entry.level}`}>{entry.level}</span>{entry.title || entry.id}</h3><div className="digest-card-actions"><button type="button" className="tool-btn" onClick={onRun}>{t("desktop.report.regenerateBtn")}</button><button type="button" className="tool-btn" onClick={onGtd}>{t("desktop.report.gtdBtn")}</button></div></div></header><div className="digest-body markdown-body" dangerouslySetInnerHTML={{ __html: markdown(entry.content) }} /></article></>;
}

function SessionDetail({ preview, locale }: { preview: Preview; locale: string }) { return <div className="session-preview">{preview.messages.map((message, index) => <article key={index} className="session-preview-message"><strong>{message.role}</strong>{message.timestamp ? <span>{formatTime(Number(message.timestamp), locale)}</span> : null}<pre>{message.text}</pre></article>)}</div>; }
