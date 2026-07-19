import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, DigestProgressEvent, ReportEntry } from "@agent-resume/core";
import { I18nProvider } from "../../i18n";
import { ReportPanel } from "./ReportPanel";
import { isoWeekLabelFromDate } from "./model";

const now = new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const week = isoWeekLabelFromDate(now);
const month = day.slice(0, 7);
const report: ReportEntry = { id: `daily:${day}`, level: "daily", periodStartMs: now.getTime(), periodEndMs: now.getTime(), title: "Daily digest", content: "# Progress\nReact report", embeddingJson: "[0.1]", createdAtMs: now.getTime() };
const weeklyReport: ReportEntry = { ...report, id: `weekly:${week}`, level: "weekly" };
const monthlyReport: ReportEntry = { ...report, id: `monthly:${month}`, level: "monthly" };
const session: AgentSession = { provider: "codex", id: "s-1", title: "Renderer migration", projectPath: "/work/panel", updatedAt: now.getTime() };

afterEach(() => { cleanup(); document.getElementById("react-report")?.remove(); });

describe("ReportPanel", () => {
  it("loads the current report, shows session details, and regenerates the focused digest", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);
    const runDailyDigest = vi.fn(async () => ({ replaced: false, sessionCount: 1, summaryReadyCount: 1 }));
    const summarizeSession = vi.fn(async () => ({ summary: "Migrated the Report panel.", language: "en", session: { ...session, sessionSummary: "Migrated the Report panel." } }));
    const autoRenameSession = vi.fn(async () => ({ title: "Migrate Report panel", previousTitle: session.title, session: { ...session, title: "Migrate Report panel" }, nativeRenamed: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { "desktop.report.digestDaily": "Daily", "desktop.report.digestWeekly": "Weekly", "desktop.report.digestMonthly": "Monthly", "desktop.report.digestDetailTitle": "{0} · {1}", "desktop.report.sessionsTitle": "Sessions", "desktop.report.sessionCountMeta": "{0} sessions", "desktop.report.rangeDay": "Day {0}", "desktop.report.rangeWeek": "Week {0}", "desktop.report.rangeMonth": "Month {0}", "desktop.report.scopeDay": "this day", "desktop.report.scopeWeek": "this week", "desktop.report.scopeMonth": "this month", "desktop.report.legendDates": "Dates:", "desktop.report.legendDailyOk": "D generated", "desktop.report.legendDailyStale": "Update pending", "desktop.report.legendDailyMissing": "Not generated", "desktop.report.legendNoSession": "No activity", "desktop.report.legendWeekly": "Weekly", "desktop.report.legendMonthly": "Monthly", "desktop.report.regenerateBtn": "Regenerate", "desktop.report.gtdBtn": "GTD", "desktop.report.created": "created", "desktop.report.digestOk": "{0} {1} OK", "desktop.report.backToReport": "Back", "desktop.common.loading": "Loading", "desktop.common.refresh": "Refresh", "desktop.common.today": "Today", "desktop.common.yearSuffix": "{0}", "desktop.report.prevMonth": "Previous", "desktop.report.nextMonth": "Next", "desktop.report.weekdayMon": "Mon", "desktop.report.weekdayTue": "Tue", "desktop.report.weekdayWed": "Wed", "desktop.report.weekdayThu": "Thu", "desktop.report.weekdayFri": "Fri", "desktop.report.weekdaySat": "Sat", "desktop.report.weekdaySun": "Sun", "desktop.report.weekCol": "Wk", "desktop.report.monthBtn": "Month", "desktop.report.noSessionsInRange": "No sessions", "desktop.report.futureDateHint": "Future", "desktop.report.emptyHasSessions": "Ready", "desktop.report.emptyNoSessions": "Empty", "desktop.report.generateBtn": "Generate {0}", "desktop.report.generatingLabel": "Generating {0} {1}", "desktop.report.generatingStrong": "Generating", "desktop.report.generatingHint": "Waiting for this digest", "desktop.calendar.month1": "Jan", "desktop.calendar.month2": "Feb", "desktop.calendar.month3": "Mar", "desktop.calendar.month4": "Apr", "desktop.calendar.month5": "May", "desktop.calendar.month6": "Jun", "desktop.calendar.month7": "Jul", "desktop.calendar.month8": "Aug", "desktop.calendar.month9": "Sep", "desktop.calendar.month10": "Oct", "desktop.calendar.month11": "Nov", "desktop.calendar.month12": "Dec" } }),
      onLocaleChanged: () => () => undefined,
      listReports: async () => [report, weeklyReport, monthlyReport],
      listSessionsInRange: async () => [session],
      needsDailyDigestRefresh: async () => ({ needed: false, reason: "up_to_date" }),
      needsWeeklyDigestRefresh: async () => ({ needed: true, reason: "updated_sessions" }),
      needsMonthlyDigestRefresh: async () => ({ needed: true, reason: "updated_sessions" }),
      previewSession: async () => ({ session, preview: { title: session.title, messages: [{ role: "user", text: "Move it to React" }] } }),
      summarizeSession,
      autoRenameSession,
      runDailyDigest,
      runWeeklyDigest: async () => ({}),
      runMonthlyDigest: async () => ({}),
      onDigestProgress: () => () => undefined
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><ReportPanel /></I18nProvider>);

    await screen.findByText("Daily digest");
    await screen.findByText(`Sessions · Day ${day}`);
    await screen.findByText("1 sessions");
    expect(screen.getByText("Dates:")).toBeTruthy();
    expect(screen.getByText(/embedding/)).toBeTruthy();
    const providerTag = screen.getByText("codex");
    expect(providerTag.classList.contains("s-provider-tag")).toBe(true);
    expect(providerTag.getAttribute("data-provider")).toBe("codex");
    await waitFor(() => expect(document.querySelector(".cal-week-btn .mark.daily-stale")?.textContent).toBe("↻"));
    expect(document.querySelector(".cal-month-btn .cal-period-stale")?.textContent).toBe("↻");
    fireEvent.click(screen.getByRole("button", { name: /Renderer migration/ }));
    await screen.findByText("Move it to React");
    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));
    await waitFor(() => expect(summarizeSession).toHaveBeenCalledWith({ provider: "codex", id: "s-1" }));
    await screen.findByText("Migrated the Report panel.");
    fireEvent.click(screen.getByRole("button", { name: "Auto Rename" }));
    await waitFor(() => expect(autoRenameSession).toHaveBeenCalledWith({ provider: "codex", id: "s-1" }));
    await waitFor(() => expect(document.querySelector(".session-preview-title")?.textContent).toBe("Migrate Report panel"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(runDailyDigest).toHaveBeenCalledWith({ date: day }));

    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
    expect(document.querySelector(".react-report-panel")?.hasAttribute("hidden")).toBe(true);
  });

  it("blocks weekly generation while a daily digest is running", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);
    let emitProgress: ((event: DigestProgressEvent) => void) | undefined;
    let resolveDaily: () => void;
    const dailyDone = new Promise<void>((resolve) => { resolveDaily = resolve; });
    const runWeeklyDigest = vi.fn(async () => ({}));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { "desktop.report.digestDaily": "Daily", "desktop.report.digestWeekly": "Weekly", "desktop.report.digestMonthly": "Monthly", "desktop.report.digestDetailTitle": "{0} · {1}", "desktop.report.sessionsTitle": "Sessions", "desktop.report.sessionCountMeta": "{0} sessions", "desktop.report.rangeDay": "Day {0}", "desktop.report.rangeWeek": "Week {0}", "desktop.report.rangeMonth": "Month {0}", "desktop.report.scopeDay": "this day", "desktop.report.scopeWeek": "this week", "desktop.report.scopeMonth": "this month", "desktop.report.legendDates": "Dates:", "desktop.report.legendDailyOk": "D generated", "desktop.report.legendDailyStale": "Update pending", "desktop.report.legendDailyMissing": "Not generated", "desktop.report.legendNoSession": "No activity", "desktop.report.legendWeekly": "Weekly", "desktop.report.legendMonthly": "Monthly", "desktop.report.regenerateBtn": "Regenerate", "desktop.report.gtdBtn": "GTD", "desktop.report.created": "created", "desktop.report.digestOk": "{0} {1} OK", "desktop.report.backToReport": "Back", "desktop.common.loading": "Loading", "desktop.common.refresh": "Refresh", "desktop.common.today": "Today", "desktop.common.yearSuffix": "{0}", "desktop.report.prevMonth": "Previous", "desktop.report.nextMonth": "Next", "desktop.report.weekdayMon": "Mon", "desktop.report.weekdayTue": "Tue", "desktop.report.weekdayWed": "Wed", "desktop.report.weekdayThu": "Thu", "desktop.report.weekdayFri": "Fri", "desktop.report.weekdaySat": "Sat", "desktop.report.weekdaySun": "Sun", "desktop.report.weekCol": "Wk", "desktop.report.monthBtn": "Month", "desktop.report.noSessionsInRange": "No sessions", "desktop.report.futureDateHint": "Future", "desktop.report.emptyHasSessions": "Ready", "desktop.report.emptyNoSessions": "Empty", "desktop.report.generateBtn": "Generate {0}", "desktop.report.generatingLabel": "Generating {0} {1}", "desktop.report.generatingStrong": "Generating", "desktop.report.generatingHint": "Waiting for this digest", "desktop.calendar.month1": "Jan", "desktop.calendar.month2": "Feb", "desktop.calendar.month3": "Mar", "desktop.calendar.month4": "Apr", "desktop.calendar.month5": "May", "desktop.calendar.month6": "Jun", "desktop.calendar.month7": "Jul", "desktop.calendar.month8": "Aug", "desktop.calendar.month9": "Sep", "desktop.calendar.month10": "Oct", "desktop.calendar.month11": "Nov", "desktop.calendar.month12": "Dec" } }),
      onLocaleChanged: () => () => undefined,
      listReports: async () => [report, weeklyReport, monthlyReport],
      listSessionsInRange: async () => [session],
      needsDailyDigestRefresh: async () => ({ needed: false, reason: "up_to_date" }),
      needsWeeklyDigestRefresh: async () => ({ needed: false, reason: "up_to_date" }),
      needsMonthlyDigestRefresh: async () => ({ needed: false, reason: "up_to_date" }),
      previewSession: async () => ({ session, preview: { title: session.title, messages: [] } }),
      runDailyDigest: async () => { await dailyDone; return { replaced: false, sessionCount: 1, summaryReadyCount: 1 }; },
      runWeeklyDigest,
      runMonthlyDigest: async () => ({}),
      onDigestProgress: (callback: (event: DigestProgressEvent) => void) => { emitProgress = callback; return () => undefined; }
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><ReportPanel /></I18nProvider>);

    await screen.findByText("Daily digest");
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await screen.findByText("Generating");
    await waitFor(() => expect(document.querySelector(".cal-cell.generating .cal-cell-loading")).toBeTruthy());
    expect(document.querySelector(".detail-progress.gen-progress")).toBeTruthy();
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:report-focus", { detail: { type: "week", key: week } })));
    await screen.findByText(`Sessions · Week ${week}`);
    expect(document.querySelector(".cal-detail")?.textContent).not.toContain(`Daily ${day}`);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await screen.findByText("desktop.report.taskBusyGenWeekly");
    expect(runWeeklyDigest).not.toHaveBeenCalled();
    expect(document.querySelector(".cal-week-btn.generating")).toBeNull();

    await act(async () => emitProgress?.({ phase: "digest", level: "daily", periodLabel: day, message: "Daily progress" }));
    expect(document.querySelector(".cal-detail")?.textContent).not.toContain("Daily progress");

    await act(async () => { resolveDaily!(); });
  });
});
