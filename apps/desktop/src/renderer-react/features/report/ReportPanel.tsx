import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactPortal } from "react";
import type { AgentSession, DigestProgressEvent, ReportEntry } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { renderMarkdown as markdown } from "../../components/Markdown";
import { useI18n } from "../../i18n";
import { calendarCells, dayKeyFromDate, dayKeyFromMs, digestIndex, isoWeekLabelFromDate, paddedMonthRange, parseWeekRange, periodKeyFromEntry, rangeForPeriod, type ReportPeriodType, viewMonthKey } from "./model";

type Focus = { type: ReportPeriodType; key: string };
type SessionPreview = { title: string; messages: Array<{ role: string; text: string; timestamp?: string }>; truncated?: boolean; warning?: string };
type Preview = { session: AgentSession; preview: SessionPreview; summary: string };

const MONTH_KEYS = ["desktop.calendar.month1", "desktop.calendar.month2", "desktop.calendar.month3", "desktop.calendar.month4", "desktop.calendar.month5", "desktop.calendar.month6", "desktop.calendar.month7", "desktop.calendar.month8", "desktop.calendar.month9", "desktop.calendar.month10", "desktop.calendar.month11", "desktop.calendar.month12"];

function levelFor(type: ReportPeriodType): "daily" | "weekly" | "monthly" { return type === "day" ? "daily" : type === "week" ? "weekly" : "monthly"; }
type Translate = (key: string, ...args: Array<string | number>) => string;

function digestLabel(type: ReportPeriodType, t: Translate): string { return t(type === "day" ? "desktop.report.digestDaily" : type === "week" ? "desktop.report.digestWeekly" : "desktop.report.digestMonthly"); }
function rangeLabel(type: ReportPeriodType, key: string, t: Translate): string { return t(type === "day" ? "desktop.report.rangeDay" : type === "week" ? "desktop.report.rangeWeek" : "desktop.report.rangeMonth", key); }
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
  const [previewAssist, setPreviewAssist] = useState<"summary" | "rename" | null>(null);
  const [previewStatus, setPreviewStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [stale, setStale] = useState<Set<string>>(new Set());
  const [monthLoading, setMonthLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [runningPeriods, setRunningPeriods] = useState<Set<string>>(new Set());
  const [progressByPeriod, setProgressByPeriod] = useState<Map<string, DigestProgressEvent>>(new Map());
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const sessionRequestId = useRef(0);
  const monthRequestId = useRef(0);

  const monthKey = viewMonthKey(view.year, view.month);
  const index = useMemo(() => digestIndex(entries), [entries]);
  const sessionDays = useMemo(() => new Set(monthSessions.map((item) => dayKeyFromMs(item.updatedAt))), [monthSessions]);

  const loadMonth = useCallback(async () => {
    const requestId = ++monthRequestId.current;
    setMonthLoading(true);
    try {
      const padded = paddedMonthRange(view.year, view.month);
      const exact = rangeForPeriod("month", viewMonthKey(view.year, view.month));
      const [nextEntries, nextSessions] = await Promise.all([
        desktopApi().listReports({ ...padded, limit: 300 }),
        exact ? desktopApi().listSessionsInRange({ ...exact, limit: 2000 }) : Promise.resolve([])
      ]);
      if (requestId !== monthRequestId.current) return;
      setEntries(nextEntries);
      setMonthSessions(nextSessions);
      if (typeof desktopApi().needsDailyDigestRefresh === "function") {
        const canonicalEntries = [...digestIndex(nextEntries).values()];
        const checks = await Promise.all(canonicalEntries.map(async (entry) => {
          const key = periodKeyFromEntry(entry);
          if (!key) return null;
          const check = entry.level === "daily"
            ? await desktopApi().needsDailyDigestRefresh(key)
            : entry.level === "weekly"
              ? await desktopApi().needsWeeklyDigestRefresh(key)
              : await desktopApi().needsMonthlyDigestRefresh(key);
          return { key: `${entry.level}:${key}`, check };
        }));
        if (requestId !== monthRequestId.current) return;
        setStale(new Set(checks.filter((item) => item?.check.needed).map((item) => item!.key)));
      } else {
        setStale(new Set());
      }
      setStatus({ text: "" });
    } catch (error) {
      if (requestId === monthRequestId.current) setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      if (requestId === monthRequestId.current) setMonthLoading(false);
    }
  }, [view.month, view.year]);

  const loadSessions = useCallback(async () => {
    const range = rangeForPeriod(focus.type, focus.key);
    if (!range) return;
    const requestId = ++sessionRequestId.current;
    setSessionsLoading(true);
    try {
      const nextSessions = await desktopApi().listSessionsInRange({ ...range, limit: 500 });
      if (requestId === sessionRequestId.current) setSessions(nextSessions);
    } catch (error) {
      if (requestId === sessionRequestId.current) {
        setSessions([]);
        setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
      }
    } finally {
      if (requestId === sessionRequestId.current) setSessionsLoading(false);
    }
  }, [focus]);

  useEffect(() => { void loadMonth(); }, [loadMonth]);
  useEffect(() => { setPreview(null); setPreviewAssist(null); setPreviewStatus({ text: "" }); void loadSessions(); }, [loadSessions]);
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
    const key = progressKeyFromEvent(event);
    if (!key) return;
    setProgressByPeriod((current) => new Map(current).set(key, event));
  }), []);

  const selectFocus = (next: Focus) => { setFocus(next); };
  const navigate = (delta: number) => {
    const next = new Date(view.year, view.month + delta, 1);
    const month = { year: next.getFullYear(), month: next.getMonth() };
    setView(month);
    selectFocus({ type: "month", key: viewMonthKey(month.year, month.month) });
  };
  const openPreview = async (session: AgentSession) => {
    try {
      const result = await desktopApi().previewSession({ provider: session.provider, id: session.id });
      setPreview({ session: result.session, preview: result.preview, summary: result.session.sessionSummary || "" });
      setPreviewStatus({ text: "" });
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  };
  const summarizePreview = async () => {
    if (!preview) return;
    setPreviewAssist("summary");
    try {
      const result = await desktopApi().summarizeSession({ provider: preview.session.provider, id: preview.session.id });
      setPreview((current) => current ? { ...current, session: result.session, summary: result.summary } : current);
      setPreviewStatus({ text: t("desktop.sessions.summaryGenerated"), kind: "ok" });
      window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
    } catch (error) { setPreviewStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
    finally { setPreviewAssist(null); }
  };
  const renamePreview = async () => {
    if (!preview) return;
    setPreviewAssist("rename");
    try {
      const result = await desktopApi().autoRenameSession({ provider: preview.session.provider, id: preview.session.id });
      const updateTitle = (session: AgentSession) => session.provider === preview.session.provider && session.id === preview.session.id ? { ...session, title: result.title } : session;
      setSessions((current) => current.map(updateTitle));
      setMonthSessions((current) => current.map(updateTitle));
      setPreview((current) => current ? { ...current, session: { ...current.session, title: result.title }, preview: { ...current.preview, title: result.title } } : current);
      let text = t("desktop.sessions.renamed", result.title);
      if (!result.nativeRenamed && result.nativeError) text += t("desktop.sessions.renamedNativeError", result.nativeError);
      setPreviewStatus({ text, kind: result.nativeRenamed || !result.nativeError ? "ok" : "error" });
      window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
    } catch (error) { setPreviewStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
    finally { setPreviewAssist(null); }
  };
  const run = async (type: ReportPeriodType) => {
    const key = focus.key;
    const periodKey = digestProgressKey(type, key);
    if (runningPeriods.has(periodKey)) return;
    const dailyRunning = isLevelRunning(runningPeriods, "daily");
    const weeklyMonthlyRunning = isLevelRunning(runningPeriods, "weekly") || isLevelRunning(runningPeriods, "monthly");
    if (type === "day" && weeklyMonthlyRunning) {
      setStatus({ text: t("desktop.report.weeklyMonthlyBusyError"), kind: "error" });
      return;
    }
    if (type !== "day" && (dailyRunning || weeklyMonthlyRunning)) {
      setStatus({ text: t(type === "week" ? "desktop.report.taskBusyGenWeekly" : "desktop.report.taskBusyGenMonthly"), kind: "error" });
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
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
      return;
    }
    setRunningPeriods((current) => new Set(current).add(periodKey));
    setProgressByPeriod((current) => new Map(current).set(periodKey, { phase: "start", level: levelFor(type), periodLabel: key, message: t("desktop.report.generatingLabel", digestLabel(type, t), key) }));
    setStatus({ text: "" });
    try {
      const approval = allowOverBudget ? { allowOverBudget: true } : {};
      if (type === "day") await desktopApi().runDailyDigest({ date: key, ...approval });
      else if (type === "week") await desktopApi().runWeeklyDigest({ weekKey: key, ...approval });
      else await desktopApi().runMonthlyDigest({ monthKey: key, ...approval });
      setStatus({ text: t("desktop.report.digestOk", digestLabel(type, t), key, t("desktop.report.created"), 0, 0, ""), kind: "ok" });
      await loadMonth();
    } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
    finally {
      setRunningPeriods((current) => { const next = new Set(current); next.delete(periodKey); return next; });
      setProgressByPeriod((current) => { const next = new Map(current); next.delete(periodKey); return next; });
    }
  };

  if (!host) return null;
  const selectedEntry = index.get(`${levelFor(focus.type)}:${focus.key}`);
  const cells = calendarCells(view.year, view.month);
  const weeks = Array.from({ length: 6 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
  const focusedPeriodKey = digestProgressKey(focus.type, focus.key);
  const focusedRunning = runningPeriods.has(focusedPeriodKey);
  const focusedProgress = progressByPeriod.get(focusedPeriodKey);
  const detail = preview ? <SessionDetail preview={preview} locale={locale} t={t} assist={previewAssist} status={previewStatus} onSummarize={() => void summarizePreview()} onAutoRename={() => void renamePreview()} /> : <DigestDetail entry={selectedEntry} focus={focus} hasSessions={sessions.length > 0} stale={stale.has(`${levelFor(focus.type)}:${focus.key}`)} running={focusedRunning} locale={locale} t={t} onRun={() => void run(focus.type)} onGtd={() => window.dispatchEvent(new CustomEvent("agent-resume:gtd-open", { detail: { level: levelFor(focus.type), reportId: selectedEntry?.id } }))} />;
  const detailProgress = !preview && focusedRunning ? <DigestProgressCard focus={focus} progress={focusedProgress} t={t} /> : null;
  const hasMonthDigest = index.has(`monthly:${monthKey}`);
  return createPortal(
    <section className="panel active react-report-panel" hidden={!active}>
      <div className="toolbar report-toolbar">
        <div className="cal-nav-left">
          <button type="button" className="tool-btn" onClick={() => navigate(-1)} title={t("desktop.report.prevMonth")}>‹</button>
          <select className="quiet-select tool-select cal-year-select" value={view.year} onChange={(event) => { const year = Number(event.target.value); setView({ ...view, year }); selectFocus({ type: "month", key: viewMonthKey(year, view.month) }); }}>{Array.from({ length: 18 }, (_, index) => today.getFullYear() + 2 - index).map((year) => <option key={year} value={year}>{t("desktop.common.yearSuffix", year)}</option>)}</select>
          <select className="quiet-select tool-select cal-month-select" value={view.month} onChange={(event) => { const month = Number(event.target.value); setView({ ...view, month }); selectFocus({ type: "month", key: viewMonthKey(view.year, month) }); }}>{MONTH_KEYS.map((key, month) => <option key={key} value={month}>{t(key)}</option>)}</select>
          <button type="button" className="tool-btn" onClick={() => navigate(1)} title={t("desktop.report.nextMonth")}>›</button>
          <button type="button" className="tool-btn" onClick={() => { const now = new Date(); setView({ year: now.getFullYear(), month: now.getMonth() }); selectFocus({ type: "day", key: dayKeyFromDate(now) }); }}>{t("desktop.common.today")}</button>
        </div>
        <div className="cal-nav-right"><button type="button" className="tool-btn ghost-btn" disabled={monthLoading} onClick={() => void loadMonth()}>{monthLoading ? t("desktop.common.loading") : t("desktop.common.refresh")}</button></div>
      </div>
      <div className="report-layout">
        <aside className="report-cal-pane"><div className="cal-main">
          <div className="cal-weekdays"><span>{t("desktop.report.weekdayMon")}</span><span>{t("desktop.report.weekdayTue")}</span><span>{t("desktop.report.weekdayWed")}</span><span>{t("desktop.report.weekdayThu")}</span><span>{t("desktop.report.weekdayFri")}</span><span>{t("desktop.report.weekdaySat")}</span><span>{t("desktop.report.weekdaySun")}</span><span className="cal-week-col-head">{t("desktop.report.weekCol")}</span></div>
          <div className="cal-grid">{weeks.map((week) => <CalendarWeek key={week[0]?.key} cells={week} focus={focus} index={index} sessionDays={sessionDays} stale={stale} runningPeriods={runningPeriods} t={t} onDay={(key) => selectFocus({ type: "day", key })} onWeek={(key) => selectFocus({ type: "week", key })} />)}</div>
          <div className="cal-month-actions"><button type="button" className={`tool-btn cal-month-btn${hasMonthDigest ? " has-digest" : ""}${focus.type === "month" ? " selected" : ""}${stale.has(`monthly:${monthKey}`) ? " has-digest-stale" : ""}${runningPeriods.has(digestProgressKey("month", monthKey)) ? " generating" : ""}`} disabled={isFuture("month", monthKey)} onClick={() => selectFocus({ type: "month", key: monthKey })}>{t("desktop.report.monthBtn")} · {monthKey}{stale.has(`monthly:${monthKey}`) ? <span className="cal-period-stale" aria-hidden="true">↻</span> : null}</button></div>
          <CalendarLegend t={t} />
        </div></aside>
        <aside className="report-session-pane"><div className="cal-session-panel"><div className="cal-session-panel-head"><strong>{t("desktop.report.sessionsTitle")} · {rangeLabel(focus.type, focus.key, t)}</strong><span className="muted">{sessionsLoading ? t("desktop.common.loading") : t("desktop.report.sessionCountMeta", sessions.length)}</span></div><div className="cal-session-list" aria-busy={sessionsLoading}>{sessionsLoading ? <p className="muted cal-session-empty">{t("desktop.common.loading")}</p> : sessions.length ? sessions.map((session) => <button type="button" key={`${session.provider}:${session.id}`} className="cal-session-row" onClick={() => void openPreview(session)}><div className="s-title">{session.title || session.id}</div><div className="s-meta"><span className="s-provider-tag" data-provider={session.provider}>{session.provider}</span>{" · "}{session.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) || ""}{" · "}{formatTime(session.updatedAt, locale)}</div></button>) : <p className="muted cal-session-empty">{t("desktop.report.noSessionsInRange")}</p>}</div></div></aside>
        <main className="report-detail-pane"><div className="report-detail-head"><strong>{preview ? preview.preview.title || preview.session.title || preview.session.id : t("desktop.report.digestDetailTitle", digestLabel(focus.type, t), focus.key)}</strong>{preview ? <button type="button" className="tool-btn ghost-btn report-detail-back" onClick={() => { setPreview(null); setPreviewAssist(null); setPreviewStatus({ text: "" }); }}>{t("desktop.report.backToReport")}</button> : null}</div>{detailProgress}<div className="cal-detail">{detail}</div></main>
      </div>
      <Status kind={status.kind}>{status.text}</Status>
    </section>,
    host
  );
}

function CalendarLegend({ t }: { t: Translate }) {
  return <p className="muted cal-legend"><span className="cal-legend-group"><span>{t("desktop.report.legendDates")}</span><span className="dot daily" /><span>{t("desktop.report.legendDailyOk")}</span><span className="dot daily-stale" /><span>{t("desktop.report.legendDailyStale")}</span><span className="dot daily-missing" /><span>{t("desktop.report.legendDailyMissing")}</span><span className="dot no-session" /><span>{t("desktop.report.legendNoSession")}</span></span><span className="cal-legend-group"><span className="dot weekly" /><span>{t("desktop.report.legendWeekly")}</span><span className="dot monthly" /><span>{t("desktop.report.legendMonthly")}</span></span></p>;
}

function CalendarWeek({ cells, focus, index, sessionDays, stale, runningPeriods, t, onDay, onWeek }: { cells: ReturnType<typeof calendarCells>; focus: Focus; index: Map<string, ReportEntry>; sessionDays: Set<string>; stale: Set<string>; runningPeriods: ReadonlySet<string>; t: Translate; onDay: (key: string) => void; onWeek: (key: string) => void }) {
  const week = cells[0]?.week || "";
  const hasWeek = index.has(`weekly:${week}`);
  const staleWeek = stale.has(`weekly:${week}`);
  const weekGenerating = runningPeriods.has(digestProgressKey("week", week));
  return <>{cells.map((cell) => { const digest = index.get(`daily:${cell.key}`); const generating = runningPeriods.has(digestProgressKey("day", cell.key)); const mark = digest ? stale.has(`daily:${cell.key}`) ? "daily-stale" : "daily" : !cell.outside && sessionDays.has(cell.key) ? "daily-missing" : "no-session"; return <button type="button" key={cell.key} className={`cal-cell${cell.outside ? " outside" : ""}${focus.type === "day" && focus.key === cell.key ? " selected" : ""}${generating ? " generating" : ""}`} aria-busy={generating || undefined} onClick={() => onDay(cell.key)}><span className="day-num">{cell.day}</span><span className="marks">{generating ? null : <span className={`mark ${mark}`} aria-hidden="true">{digest ? mark === "daily-stale" ? "↻" : "D" : mark === "daily-missing" ? "+" : "-"}</span>}</span>{generating ? <span className="cal-cell-loading" aria-hidden="true" /> : null}</button>; })}<button type="button" className={`cal-week-btn${hasWeek ? " has-digest" : ""}${staleWeek ? " has-digest-stale" : ""}${focus.type === "week" && focus.key === week ? " selected" : ""}${weekGenerating ? " generating" : ""}`} aria-busy={weekGenerating || undefined} onClick={() => onWeek(week)}><span className="cal-week-label">{week.slice(-3)}</span>{staleWeek ? <span className="marks"><span className="mark daily-stale" aria-hidden="true">↻</span></span> : null}</button></>;
}

function DigestProgressCard({ focus, progress, t }: { focus: Focus; progress?: DigestProgressEvent; t: Translate }) {
  const progressText = progress?.message || t("desktop.report.generatingLabel", digestLabel(focus.type, t), focus.key);
  const sessionText = progress?.session ? `${progress.index || 0}/${progress.total || 0} · ${progress.session.provider} · ${progress.session.title || progress.session.id}` : "";
  const progressWidth = progress?.index && progress.total ? `${Math.min(100, Math.round((progress.index / progress.total) * 100))}%` : "35%";
  return <div className="detail-progress gen-progress is-loading" role="status" aria-live="polite"><div className="gen-progress-line">{progressText}</div>{sessionText ? <div className="gen-progress-session-row"><span className="gen-progress-pulse" aria-hidden="true" /><span className="gen-progress-session">{sessionText}</span></div> : null}<div className="gen-progress-bar-wrap"><div className="gen-progress-bar" style={{ width: progressWidth }} /></div></div>;
}

function DigestDetail({ entry, focus, hasSessions, stale, running, locale, t, onRun, onGtd }: { entry?: ReportEntry; focus: Focus; hasSessions: boolean; stale: boolean; running: boolean; locale: string; t: Translate; onRun: () => void; onGtd: () => void }) {
  if (running) {
    return <div className="detail-generating"><p className="empty-hint">{t("desktop.report.generatingStrong")} {" "}<strong>{digestLabel(focus.type, t)}</strong><span className="detail-generating-key">{focus.key}</span></p><p className="muted detail-generating-hint">{t("desktop.report.generatingHint")}</p></div>;
  }
  if (isFuture(focus.type, focus.key)) return <p className="empty-hint muted">{t("desktop.report.futureDateHint", digestLabel(focus.type, t))}</p>;
  if (!entry) return <div className={`digest-panel digest-panel-empty${hasSessions ? "" : " digest-panel-quiet"}`}><header className="digest-panel-head"><h3><span className={`badge ${levelFor(focus.type)}`}>{levelFor(focus.type)}</span>{digestLabel(focus.type, t)} · {focus.key}</h3></header><p className="empty-hint muted">{hasSessions ? t("desktop.report.emptyHasSessions", scopeLabel(focus.type, t), digestLabel(focus.type, t)) : t("desktop.report.emptyNoSessions", scopeLabel(focus.type, t), digestLabel(focus.type, t))}</p>{hasSessions ? <button type="button" className="tool-btn" onClick={onRun}>{t("desktop.report.generateBtn", digestLabel(focus.type, t))}</button> : null}</div>;
  return <>{stale ? <div className="digest-stale-banner"><p className="muted">{t("desktop.report.staleDefault")}</p></div> : null}<article className="digest-card"><header className="digest-card-head"><div className="digest-card-title-row"><h3><span className={`badge ${entry.level}`}>{entry.level}</span>{entry.title || entry.id}</h3><div className="digest-card-actions"><button type="button" className="tool-btn" onClick={onRun}>{t("desktop.report.regenerateBtn")}</button><button type="button" className="tool-btn" onClick={onGtd}>{t("desktop.report.gtdBtn")}</button></div></div><div className="meta-line">{formatTime(entry.createdAtMs, locale)}{entry.embeddingJson ? " · embedding ✓" : ""}</div></header><div className="digest-body markdown-body" dangerouslySetInnerHTML={{ __html: markdown(entry.content) }} /></article></>;
}

function SessionDetail({ preview, locale, t, assist, status, onSummarize, onAutoRename }: { preview: Preview; locale: string; t: Translate; assist: "summary" | "rename" | null; status: { text: string; kind?: StatusKind }; onSummarize: () => void; onAutoRename: () => void }) {
  return <div className="session-preview"><div className="session-preview-head"><h3 className="session-preview-title">{preview.preview.title || preview.session.title || preview.session.id}</h3><div className="session-preview-actions"><button type="button" className="tool-btn" onClick={onSummarize} disabled={assist !== null}>{assist === "summary" ? t("desktop.sessions.summarizing") : "Summarize"}</button><button type="button" className="tool-btn" onClick={onAutoRename} disabled={assist !== null}>{assist === "rename" ? t("desktop.sessions.renaming") : "Auto Rename"}</button></div></div><div className="muted session-preview-meta"><span className="s-provider-tag" data-provider={preview.session.provider}>{preview.session.provider}</span>{" · "}{preview.session.id}{" · "}{preview.session.projectPath}</div><Status kind={status.kind}>{status.text}</Status>{preview.summary ? <div className="session-summary-box"><div className="session-summary-label">Summary</div><div className="session-summary-body">{preview.summary}</div></div> : null}{preview.preview.warning ? <p className="status error">{preview.preview.warning}</p> : null}{preview.preview.messages.length ? preview.preview.messages.map((message, index) => <article key={index} className={`preview-msg ${message.role}`}><div className="role">{message.role}{message.timestamp ? ` · ${formatTime(Number(message.timestamp), locale)}` : ""}</div><div>{message.text}</div></article>) : <p className="muted">{t("desktop.sessions.noMessages")}</p>}{preview.preview.truncated ? <p className="muted">{t("desktop.sessions.truncated")}</p> : null}</div>;
}
