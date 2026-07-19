import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, ReportEntry } from "@agent-resume/core";
import { I18nProvider } from "../../i18n";
import { ReportPanel } from "./ReportPanel";

const now = new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const report: ReportEntry = { id: `daily:${day}`, level: "daily", periodStartMs: now.getTime(), periodEndMs: now.getTime(), title: "Daily digest", content: "# Progress\nReact report", embeddingJson: null, createdAtMs: now.getTime() };
const session: AgentSession = { provider: "codex", id: "s-1", title: "Renderer migration", projectPath: "/work/panel", updatedAt: now.getTime() };

afterEach(() => { cleanup(); document.getElementById("react-report")?.remove(); });

describe("ReportPanel", () => {
  it("loads the current report, shows session details, and regenerates the focused digest", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);
    const runDailyDigest = vi.fn(async () => ({ replaced: false, sessionCount: 1, summaryReadyCount: 1 }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { "desktop.report.digestDaily": "Daily", "desktop.report.digestWeekly": "Weekly", "desktop.report.digestMonthly": "Monthly", "desktop.report.digestDetailTitle": "{0} · {1}", "desktop.report.sessionsTitle": "Sessions", "desktop.report.sessionCountMeta": "{0} sessions", "desktop.report.regenerateBtn": "Regenerate", "desktop.report.gtdBtn": "GTD", "desktop.report.created": "created", "desktop.report.digestOk": "{0} {1} OK", "desktop.report.backToReport": "Back", "desktop.common.loading": "Loading", "desktop.common.refresh": "Refresh", "desktop.common.today": "Today", "desktop.common.yearSuffix": "{0}", "desktop.report.prevMonth": "Previous", "desktop.report.nextMonth": "Next", "desktop.report.weekdayMon": "Mon", "desktop.report.weekdayTue": "Tue", "desktop.report.weekdayWed": "Wed", "desktop.report.weekdayThu": "Thu", "desktop.report.weekdayFri": "Fri", "desktop.report.weekdaySat": "Sat", "desktop.report.weekdaySun": "Sun", "desktop.report.weekCol": "Wk", "desktop.report.monthBtn": "Month", "desktop.report.noSessionsInRange": "No sessions", "desktop.report.futureDateHint": "Future", "desktop.report.emptyHasSessions": "Ready", "desktop.report.emptyNoSessions": "Empty", "desktop.report.generateBtn": "Generate {0}", "desktop.report.generatingLabel": "Generating {0} {1}", "desktop.calendar.month1": "Jan", "desktop.calendar.month2": "Feb", "desktop.calendar.month3": "Mar", "desktop.calendar.month4": "Apr", "desktop.calendar.month5": "May", "desktop.calendar.month6": "Jun", "desktop.calendar.month7": "Jul", "desktop.calendar.month8": "Aug", "desktop.calendar.month9": "Sep", "desktop.calendar.month10": "Oct", "desktop.calendar.month11": "Nov", "desktop.calendar.month12": "Dec" } }),
      onLocaleChanged: () => () => undefined,
      listReports: async () => [report],
      listSessionsInRange: async () => [session],
      previewSession: async () => ({ session, preview: { title: session.title, messages: [{ role: "user", text: "Move it to React" }] } }),
      runDailyDigest,
      runWeeklyDigest: async () => ({}),
      runMonthlyDigest: async () => ({}),
      onDigestProgress: () => () => undefined
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><ReportPanel /></I18nProvider>);

    await screen.findByText("Daily digest");
    fireEvent.click(screen.getByRole("button", { name: /Renderer migration/ }));
    await screen.findByText("Move it to React");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(runDailyDigest).toHaveBeenCalledWith({ date: day }));

    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" })));
    expect(document.querySelector(".react-report-panel")?.hasAttribute("hidden")).toBe(true);
  });
});
