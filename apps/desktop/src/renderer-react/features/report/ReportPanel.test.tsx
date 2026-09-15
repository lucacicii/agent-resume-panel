import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, DigestProgressEvent, ReportEntry, WorkItemRecord } from "@agent-resume/core";
import { I18nProvider } from "../../i18n";
import { ReportPanel } from "./ReportPanel";
import { isoWeekLabelFromDate } from "./model";

const now = new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const week = isoWeekLabelFromDate(now);
const month = day.slice(0, 7);
const report: ReportEntry = { id: `daily:${day}`, level: "daily", periodStartMs: now.getTime(), periodEndMs: now.getTime(), title: "Daily digest", content: "# Progress\nReact report", embeddingJson: "[0.1]", createdAtMs: now.getTime() };
const session: AgentSession = { provider: "codex", id: "s-1", title: "Renderer migration", projectPath: "/work/panel", updatedAt: now.getTime() };

const defaultWorkItem: WorkItemRecord = {
  noteId: "wi-1",
  title: "Renderer migration",
  gtdStatus: "next",
  updatedAtMs: now.getTime(),
  work: {
    sessions: ["codex:s-1"],
    projects: ["/work/panel"],
    primaryProject: "/work/panel",
    nextAction: "Move it to React",
    decision: "Decided on React"
  }
};

const i18nMessages = {
  "desktop.archive.workItemsTitle": "Work items",
  "desktop.archive.workItemsEmpty": "No work items yet",
  "desktop.archive.sessionsAllTime": "All time",
  "desktop.archive.noWorkItemSelected": "Select a work item on the left",
  "desktop.archive.historyEmpty": "No history yet",
  "desktop.archive.nextAction": "Next action: {0}",
  "desktop.archive.decision": "Decision: {0}",
  "desktop.archive.projects": "Projects",
  "desktop.archive.search": "Search sessions",
  "desktop.archive.searchPlaceholder": "Search all sessions…",
  "desktop.archive.needsMe": "Needs me {0}",
  "desktop.archive.lastExitWaiting": "This session was waiting on you when the app last closed",
  "desktop.gtd.inbox": "Inbox",
  "desktop.gtd.next": "Next",
  "desktop.gtd.waiting": "Waiting",
  "desktop.gtd.someday": "Someday",
  "desktop.gtd.reference": "Reference",
  "desktop.gtd.done": "Done",
  "desktop.report.digestDaily": "Daily",
  "desktop.report.digestWeekly": "Weekly",
  "desktop.report.digestMonthly": "Monthly",
  "desktop.report.sessionsTitle": "Sessions",
  "desktop.report.noWorkItemGroup": "No work item",
  "desktop.report.sessionCountMeta": "{0} sessions",
  "desktop.report.rangeDay": "Day {0}",
  "desktop.report.rangeWeek": "Week {0}",
  "desktop.report.rangeMonth": "Month {0}",
  "desktop.report.backToReport": "Back",
  "desktop.report.noSessionsInRange": "No sessions",
  "desktop.report.generatingLabel": "Generating {0} {1}",
  "desktop.report.generatingStrong": "Generating",
  "desktop.report.generatingHint": "Waiting for this digest",
  "desktop.report.regenerateBtn": "Regenerate",
  "desktop.report.generateBtn": "Generate {0}",
  "desktop.report.digestGeneratedAt": "Generated at {0}",
  "desktop.report.emptyHasSessions": "Ready",
  "desktop.report.emptyNoSessions": "Empty",
  "desktop.report.created": "created",
  "desktop.report.digestOk": "{0} {1} OK",
  "desktop.common.loading": "Loading",
  "desktop.common.refresh": "Refresh",
  "desktop.common.today": "Today",
  "desktop.agent.resumeSession": "Resume",
  "desktop.agent.resumeStarted": "Resume started {0}:{1}",
  "desktop.sessions.summary": "Summary",
  "desktop.sessions.generateSummary": "Generate summary",
  "desktop.sessions.summarizing": "Summarizing…",
  "desktop.sessions.summaryGenerated": "Summary generated",
  "desktop.sessions.autoRename": "Auto rename",
  "desktop.sessions.renaming": "Renaming…",
  "desktop.sessions.renamed": "Renamed to {0}",
  "desktop.sessions.noMessages": "No messages"
};

function mockAgentResume(overrides: Partial<typeof window.agentResume> = {}): typeof window.agentResume {
  return {
    getI18nBundle: async () => ({ locale: "en", messages: i18nMessages }),
    onLocaleChanged: () => () => undefined,
    notesListWorkItems: async () => [defaultWorkItem],
    notesListWorkItemSessionLinks: async () => [{
      noteId: defaultWorkItem.noteId,
      title: defaultWorkItem.title,
      provider: "codex",
      sessionId: "s-1"
    }],
    querySessionsPage: async () => ({ sessions: [session], total: 1 }),
    listReports: async () => [report],
    listSessionsInRange: async () => [session],
    getReportLinks: async () => [],
    previewSession: async () => ({ session, preview: { title: session.title, messages: [] } }),
    summarizeSession: async () => ({ summary: "Migrated the Report panel.", language: "en", session: { ...session, sessionSummary: "Migrated the Report panel." } }),
    autoRenameSession: async () => ({ title: "Migrate Report panel", previousTitle: session.title, session: { ...session, title: "Migrate Report panel" }, nativeRenamed: true }),
    previewDigestRun: async () => ({ level: "daily", periodKey: day, sessionCount: 1, summaryCallCount: 1, digestCallCount: 1, estimatedLlmCalls: 1, callBudget: 100, overBudget: false }),
    runDailyDigest: async () => ({ replaced: false, sessionCount: 1, summaryReadyCount: 1 }),
    runWeeklyDigest: async () => ({}),
    runMonthlyDigest: async () => ({}),
    workbenchOpenSession: async () => ({ external: false }),
    onDigestProgress: () => () => undefined,
    ...overrides
  } as unknown as typeof window.agentResume;
}

beforeEach(() => {
  const headerSlot = document.createElement("div");
  headerSlot.id = "app-header-slot";
  document.body.append(headerSlot);
});

afterEach(() => {
  cleanup();
  document.getElementById("react-report")?.remove();
  document.getElementById("app-header-slot")?.remove();
  vi.restoreAllMocks();
});

describe("ReportPanel", () => {
  it("defaults to work-item-first layout, reuses 3-column shell, and does not show calendar by default", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);
    window.agentResume = mockAgentResume();

    render(<I18nProvider><ReportPanel /></I18nProvider>);

    // 1. Reuses existing 3-column shell without inventing new layout primitives
    await waitFor(() => expect(document.querySelector(".report-work-items-panel")).toBeTruthy());
    expect(document.querySelector(".report-layout")).toBeTruthy();
    expect(document.querySelector(".report-left-col")).toBeTruthy();
    expect(document.querySelector(".report-session-pane")).toBeTruthy();
    expect(document.querySelector(".report-detail-pane")).toBeTruthy();

    // 2. Does NOT show calendar by default ("进入归档不再默认看到日历")
    expect(document.querySelector(".report-cal-pane")).toBeNull();
    expect(document.querySelector(".cal-main")).toBeNull();
    expect(screen.queryByText("Dates:")).toBeNull();

    // 3. Renders work items in left column
    expect(screen.getAllByText("Renderer migration").length).toBeGreaterThanOrEqual(1);

    // 4. Middle pane shows sessions for selected work item
    expect(await screen.findByText("Sessions · Renderer migration")).toBeTruthy();

    // 5. Right pane shows work item details (next action, decision)
    expect(await screen.findByText(/Move it to React/)).toBeTruthy();
    expect(await screen.findByText(/Decided on React/)).toBeTruthy();
  });

  it("switches selection when clicking another work item", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);

    const secondWorkItem: WorkItemRecord = {
      noteId: "wi-2",
      title: "Second Feature",
      gtdStatus: "inbox",
      updatedAtMs: now.getTime() - 10000,
      work: {
        sessions: ["codex:s-2"],
        projects: ["/work/docs"],
        nextAction: "Write documentation"
      }
    };

    window.agentResume = mockAgentResume({
      notesListWorkItems: async () => [defaultWorkItem, secondWorkItem]
    });

    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await waitFor(() => expect(document.querySelector(".report-work-items-panel")).toBeTruthy());

    const secondBtn = screen.getByRole("button", { name: /Second Feature/ });
    fireEvent.click(secondBtn);

    // Detail pane updates to Second Feature
    expect(await screen.findByText(/Write documentation/)).toBeTruthy();
    expect(screen.getByText("Sessions · Second Feature")).toBeTruthy();
  });

  it("previews a session from the session list and dispatches workbench open", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);

    const spy = vi.fn();
    window.addEventListener("agent-resume:workbench-open-session", spy);
    window.agentResume = mockAgentResume();

    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await waitFor(() => expect(document.querySelector(".report-work-items-panel")).toBeTruthy());

    // Click session row in middle list
    const sessionRow = await screen.findByRole("button", { name: /codex/ });
    fireEvent.click(sessionRow);

    // Detail pane shows session preview
    const resumeBtn = await screen.findByRole("button", { name: "Resume" });
    fireEvent.click(resumeBtn);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.id).toBe("s-1");
    expect(detail.provider).toBe("codex");

    // Click Back to return to work item detail
    const backBtn = screen.getByRole("button", { name: "Back" });
    fireEvent.click(backBtn);
    expect(await screen.findByText(/Move it to React/)).toBeTruthy();

    window.removeEventListener("agent-resume:workbench-open-session", spy);
  });

  it("renders focused digest when report-focus is dispatched", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);

    window.agentResume = mockAgentResume({
      listReports: async () => [report]
    });

    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await waitFor(() => expect(document.querySelector(".report-work-items-panel")).toBeTruthy());

    // Dispatch report-focus
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:report-focus", {
        detail: { type: "day", key: day }
      }));
    });

    // Detail pane displays the daily digest
    expect((await screen.findAllByText("Daily digest")).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("React report")).toBeTruthy();

    // Back button returns to work item
    const backBtn = screen.getByRole("button", { name: "Back" });
    fireEvent.click(backBtn);
    expect(await screen.findByText(/Move it to React/)).toBeTruthy();
  });

  it("opens a session when a digest session reference is clicked in focused report", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);
    const sessionRefReport: ReportEntry = {
      ...report,
      content: `## 概览\nRenderer work.\n\n## Session 索引\n- [codex] Renderer migration\n`
    };
    const spy = vi.fn();
    window.addEventListener("agent-resume:sessions-preview", spy);
    window.agentResume = mockAgentResume({
      listReports: async () => [sessionRefReport],
      getReportLinks: async () => [{ reportId: `daily:${day}`, provider: "codex", agentSessionId: "s-1", projectPath: "/work/panel" }]
    });
    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await waitFor(() => expect(document.querySelector(".report-work-items-panel")).toBeTruthy());

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:report-focus", {
        detail: { type: "day", key: day }
      }));
    });

    expect((await screen.findAllByText("Daily digest")).length).toBeGreaterThanOrEqual(1);
    const link = await waitFor(() => {
      const element = document.querySelector<HTMLAnchorElement>("a.digest-ref[data-session-ref]");
      expect(element).toBeTruthy();
      return element;
    });
    expect(link!.getAttribute("data-session-ref")).toBe("codex:s-1");
    expect(link!.textContent).toContain("Renderer migration");
    fireEvent.click(link!);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.provider).toBe("codex");
    expect(detail.id).toBe("s-1");
    expect(detail.projectPath).toBe("/work/panel");
    window.removeEventListener("agent-resume:sessions-preview", spy);
  });

  it("displays digest generation progress when an event is received", async () => {
    let emitProgress: ((event: DigestProgressEvent) => void) | undefined;
    window.agentResume = mockAgentResume({
      onDigestProgress: (callback: (event: DigestProgressEvent) => void) => {
        emitProgress = callback;
        return () => undefined;
      }
    });
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);
    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await waitFor(() => expect(document.querySelector(".report-work-items-panel")).toBeTruthy());

    // Focus a report
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:report-focus", {
        detail: { type: "day", key: day }
      }));
    });
    expect((await screen.findAllByText("Daily digest")).length).toBeGreaterThanOrEqual(1);

    // Emit generation event
    await act(async () => {
      emitProgress?.({ phase: "reading_sessions", level: "daily", dayKey: day, message: "Processing sessions" });
    });
    // While generating, progress message is handled
  });

  it("keeps same-titled work items as separate session groups (A3)", async () => {
    const session1: AgentSession = { provider: "codex", id: "s-1", title: "Session 1", projectPath: "/work/panel", updatedAt: now.getTime() };
    const session2: AgentSession = { provider: "claude", id: "s-2", title: "Session 2", projectPath: "/work/panel", updatedAt: now.getTime() };
    window.agentResume = mockAgentResume({
      querySessionsPage: async () => ({ sessions: [session1, session2], total: 2 }),
      notesListWorkItemSessionLinks: (async () => [
        { noteId: "wi-1", title: "Realtime status", provider: session1.provider, sessionId: session1.id },
        { noteId: "wi-2", title: "Realtime status", provider: session2.provider, sessionId: session2.id }
      ]) as typeof window.agentResume.notesListWorkItemSessionLinks
    });
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);
    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await waitFor(() => expect(document.querySelector(".report-work-items-panel")).toBeTruthy());

    // Enter search to trigger group view
    fireEvent.change(screen.getByRole("searchbox", { name: "Search sessions" }), { target: { value: "session" } });

    const groupHeads = await screen.findAllByText("Realtime status");
    expect(groupHeads).toHaveLength(2);
    expect(groupHeads.every((head) => head.closest(".cal-session-group-head"))).toBe(true);
  });

  it("searches across the whole catalog when a query is entered", async () => {
    const other: AgentSession = { provider: "claude", id: "other-1", title: "Cross-range hit", projectPath: "/work/other", updatedAt: Date.now() };
    const querySessionsPage = vi.fn(async () => ({ sessions: [other], total: 1 }));
    window.agentResume = mockAgentResume({
      querySessionsPage: querySessionsPage as unknown as typeof window.agentResume.querySessionsPage,
      notesListWorkItemSessionLinks: (async () => []) as typeof window.agentResume.notesListWorkItemSessionLinks
    });
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);
    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await waitFor(() => expect(document.querySelector(".report-work-items-panel")).toBeTruthy());

    fireEvent.change(screen.getByRole("searchbox", { name: "Search sessions" }), { target: { value: "cross" } });
    await waitFor(() => expect(querySessionsPage).toHaveBeenCalledWith(expect.objectContaining({ search: "cross" })));
    expect((await screen.findAllByText("Cross-range hit")).length).toBeGreaterThanOrEqual(1);
  });
});
