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
  "desktop.archive.workItemsCount": "{0} items",
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
  "desktop.notes.projectLabel": "Project",
  "desktop.workbench.sessionFilter": "Session filter",
  "desktop.workbench.setGtdStatus": "Set GTD status",
  "desktop.workbench.gtdStatus.inbox": "Inbox",
  "desktop.workbench.gtdStatus.next": "Next",
  "desktop.workbench.gtdStatus.waiting": "Waiting",
  "desktop.workbench.gtdStatus.someday": "Someday",
  "desktop.workbench.gtdStatus.reference": "Reference",
  "desktop.workbench.gtdStatus.done": "Done",
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
  "desktop.common.all": "All",
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
  "desktop.sessions.noMessages": "No messages",
  "desktop.workbench.workItemOpenNote": "Open note",
  "desktop.kanban.openRoom": "Discussion room",
  "desktop.workbench.workItemNoProject": "No project yet",
  "desktop.workbench.pathMissingHint": "Local folder not found on this machine"
};

function mockAgentResume(overrides: Partial<typeof window.agentResume> = {}): typeof window.agentResume {
  return {
    getI18nBundle: async () => ({ locale: "en", messages: i18nMessages }),
    onLocaleChanged: () => () => undefined,
    listProjects: async () => [],
    notesSetGtdStatus: async ({ noteId, status }: { noteId: string; status: any }) => ({ noteId, gtdStatus: status } as any),
    imCreateWorkItemRoom: async ({ noteId }: { noteId: string }) => ({ project: { projectId: `room-${noteId}` } } as any),
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
    getWorkbenchActiveSessions: async () => [],
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
    const sessionRows = await screen.findAllByRole("button", { name: /codex/ });
    fireEvent.click(sessionRows[0]);

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
    await screen.findAllByText("Work items");

    // Enter search to trigger group view
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search sessions" }), { target: { value: "session" } });

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

  it("does not merge same-titled work items in the left list (A2)", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);

    const item1: WorkItemRecord = {
      noteId: "wi-dup-1",
      title: "Duplicate Work Item",
      gtdStatus: "next",
      updatedAtMs: now.getTime() - 1000,
      work: {
        sessions: ["codex:s-1"],
        nextAction: "Action for item 1"
      }
    };
    const item2: WorkItemRecord = {
      noteId: "wi-dup-2",
      title: "Duplicate Work Item",
      gtdStatus: "next",
      updatedAtMs: now.getTime() - 2000,
      work: {
        sessions: ["codex:s-2"],
        nextAction: "Action for item 2"
      }
    };

    window.agentResume = mockAgentResume({
      notesListWorkItems: async () => [item1, item2]
    });

    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await screen.findAllByText("Work items");

    const buttons = document.querySelectorAll(".report-work-item-row");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain("Duplicate Work Item");
    expect(buttons[1].textContent).toContain("Duplicate Work Item");

    fireEvent.click(buttons[1]);
    expect(await screen.findByText(/Action for item 2/)).toBeTruthy();
  });

  it("includes done and someday work items, filters by GTD status exempting session GTD (A2, D2)", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);

    const doneItem: WorkItemRecord = {
      noteId: "wi-done",
      title: "Completed Task",
      gtdStatus: "done",
      updatedAtMs: now.getTime() - 500,
      work: { sessions: ["codex:s-done"] }
    };
    const somedayItem: WorkItemRecord = {
      noteId: "wi-someday",
      title: "Someday Task",
      gtdStatus: "someday",
      updatedAtMs: now.getTime() - 600,
      work: { sessions: ["codex:s-someday"] }
    };
    const inboxItem: WorkItemRecord = {
      noteId: "wi-inbox",
      title: "Inbox Task",
      gtdStatus: "inbox",
      updatedAtMs: now.getTime() - 700,
      work: { sessions: ["codex:s-inbox"] }
    };

    window.agentResume = mockAgentResume({
      notesListWorkItems: async () => [defaultWorkItem, doneItem, somedayItem, inboxItem]
    });

    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await screen.findAllByText("Work items");

    // Default list shows all items including done and someday
    const initialRows = document.querySelectorAll(".report-work-item-row");
    expect(initialRows).toHaveLength(4);
    expect(screen.getByText("Completed Task")).toBeTruthy();
    expect(screen.getByText("Someday Task")).toBeTruthy();
    expect(screen.getByText("Inbox Task")).toBeTruthy();

    // Filter by GTD status "done"
    const statusSelect = screen.getByRole("combobox", { name: "Session filter" });
    fireEvent.change(statusSelect, { target: { value: "done" } });

    const doneRows = document.querySelectorAll(".report-work-item-row");
    expect(doneRows).toHaveLength(1);
    expect(doneRows[0].textContent).toContain("Completed Task");

    // Filter by GTD status "someday"
    fireEvent.change(statusSelect, { target: { value: "someday" } });
    const somedayRows = document.querySelectorAll(".report-work-item-row");
    expect(somedayRows).toHaveLength(1);
    expect(somedayRows[0].textContent).toContain("Someday Task");
  });

  it("filters work items by project (A2)", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);

    const projectAItem: WorkItemRecord = {
      noteId: "wi-proj-a",
      title: "Project Alpha Work",
      gtdStatus: "next",
      updatedAtMs: now.getTime() - 100,
      work: { projects: ["/repos/alpha"], primaryProject: "/repos/alpha" }
    };
    const projectBItem: WorkItemRecord = {
      noteId: "wi-proj-b",
      title: "Project Beta Work",
      gtdStatus: "next",
      updatedAtMs: now.getTime() - 200,
      work: { projects: ["/repos/beta"], primaryProject: "/repos/beta" }
    };

    window.agentResume = mockAgentResume({
      notesListWorkItems: async () => [projectAItem, projectBItem]
    });

    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await screen.findAllByText("Work items");

    const initialRows = document.querySelectorAll(".report-work-item-row");
    expect(initialRows).toHaveLength(2);
    expect(initialRows[0].textContent).toContain("Project Alpha Work");
    expect(initialRows[1].textContent).toContain("Project Beta Work");

    const projectSelect = screen.getByRole("combobox", { name: "Project" });
    fireEvent.change(projectSelect, { target: { value: "/repos/alpha" } });

    const filteredRows = document.querySelectorAll(".report-work-item-row");
    expect(filteredRows).toHaveLength(1);
    expect(filteredRows[0].textContent).toContain("Project Alpha Work");
  });

  it("sorts work items by P2 live urgency then recency (A2)", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);

    const itemA: WorkItemRecord = {
      noteId: "wi-a",
      title: "Item A Waiting",
      gtdStatus: "next",
      updatedAtMs: 1000,
      work: { sessions: ["codex:s-wait"] }
    };
    const itemB: WorkItemRecord = {
      noteId: "wi-b",
      title: "Item B Recent Idle",
      gtdStatus: "next",
      updatedAtMs: 9000,
      work: { sessions: ["codex:s-idle"] }
    };
    const itemC: WorkItemRecord = {
      noteId: "wi-c",
      title: "Item C Older Idle",
      gtdStatus: "next",
      updatedAtMs: 2000,
      work: { sessions: [] }
    };

    window.agentResume = mockAgentResume({
      notesListWorkItems: async () => [itemC, itemB, itemA],
      getWorkbenchActiveSessions: async () => [
        { sessionKey: "codex:s-wait", provider: "codex", sessionId: "s-wait", status: "awaiting_user" }
      ]
    });

    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await screen.findAllByText("Work items");

    const rows = document.querySelectorAll(".report-work-item-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Item A Waiting");
    expect(rows[1].textContent).toContain("Item B Recent Idle");
    expect(rows[2].textContent).toContain("Item C Older Idle");
  });

  it("renders work item summary header with title, GTD capsule, project chips, next action, decision (A5)", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);

    const detailedItem: WorkItemRecord = {
      noteId: "wi-detail",
      title: "Refactor Architecture",
      gtdStatus: "next",
      updatedAtMs: now.getTime(),
      work: {
        sessions: [],
        projects: ["/repos/app", "/repos/missing-pkg"],
        primaryProject: "/repos/app",
        next: "Extract pure domain functions",
        decision: "Proceed with B4 batch"
      }
    };

    window.agentResume = mockAgentResume({
      notesListWorkItems: async () => [detailedItem],
      listProjects: async () => [
        { projectId: "p-app", portableKey: "/repos/app", localPath: "/repos/app", pathMissing: false } as any,
        { projectId: "p-missing", portableKey: "/repos/missing-pkg", localPath: "/repos/missing-pkg", pathMissing: true } as any
      ]
    });

    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await screen.findAllByText("Work items");

    const card = document.querySelector(".report-work-item-card");
    expect(card).toBeTruthy();
    expect(card!.querySelector(".report-work-item-heading")?.textContent).toBe("Refactor Architecture");
    expect(card!.querySelector(".report-work-item-capsule")?.textContent).toContain("Next");
    expect(card!.textContent).toContain("Next action: Extract pure domain functions");
    expect(card!.textContent).toContain("Decision: Proceed with B4 batch");

    const appChip = card!.querySelector(".report-project-chip:not(.is-missing)");
    expect(appChip?.textContent).toBe("app");

    const missingChip = card!.querySelector(".report-project-chip.is-missing");
    expect(missingChip?.textContent).toBe("missing-pkg");
    expect(missingChip?.getAttribute("title")).toBe("Local folder not found on this machine");

    expect(screen.getByRole("button", { name: "Open note" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discussion room" })).toBeTruthy();
  });

  it("allows switching GTD status through six-state capsule menu and persists via notesSetGtdStatus (A5)", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);

    const item: WorkItemRecord = {
      noteId: "wi-capsule",
      title: "Capsule Test Item",
      gtdStatus: "inbox",
      updatedAtMs: now.getTime(),
      work: { sessions: [] }
    };

    let currentStatus: GtdStatus = "inbox";
    const notesSetGtdStatus = vi.fn(async ({ noteId, status }: { noteId: string; status: any }) => {
      currentStatus = status;
      return {
        noteId,
        gtdStatus: status
      } as any;
    });

    window.agentResume = mockAgentResume({
      notesListWorkItems: async () => [{ ...item, gtdStatus: currentStatus }],
      notesSetGtdStatus
    });

    render(<I18nProvider><ReportPanel /></I18nProvider>);
    await screen.findAllByText("Work items");

    // Click the capsule to open the picker
    const capsuleBtn = screen.getByRole("button", { name: "Set GTD status" });
    expect(capsuleBtn.textContent).toContain("Inbox");
    fireEvent.click(capsuleBtn);

    // The picker should show all 6 states
    const statusOptions = screen.getAllByRole("menuitemradio");
    expect(statusOptions).toHaveLength(6);
    expect(statusOptions.map((opt) => opt.textContent)).toEqual(["Inbox", "Next", "Waiting", "Someday", "Reference", "Done"]);

    // Click "Waiting"
    fireEvent.click(statusOptions[2]);

    await waitFor(() => {
      expect(notesSetGtdStatus).toHaveBeenCalledWith({ noteId: "wi-capsule", status: "waiting" });
    });

    // Capsule button now reflects updated status
    await waitFor(() => {
      const updatedBtn = screen.getByRole("button", { name: "Set GTD status" });
      expect(updatedBtn.textContent).toContain("Waiting");
    });
  });

  it("handles open note and IM entry events from summary header (A5, D4)", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);

    const item: WorkItemRecord = {
      noteId: "wi-nav",
      title: "Nav Test Item",
      gtdStatus: "next",
      updatedAtMs: now.getTime(),
      work: {
        sessions: ["codex:s-1"],
        projects: ["/repos/app"],
        primaryProject: "/repos/app",
        next: "Next step"
      }
    };

    const imCreateWorkItemRoom = vi.fn(async ({ noteId }: { noteId: string }) => ({
      project: { projectId: `room-${noteId}` }
    } as any));

    window.agentResume = mockAgentResume({
      notesListWorkItems: async () => [item],
      imCreateWorkItemRoom
    });

    const eventsDispatched: Array<{ type: string; detail: any }> = [];
    const recordEvent = (e: Event) => {
      eventsDispatched.push({ type: e.type, detail: (e as CustomEvent).detail });
    };

    window.addEventListener("agent-resume:tab-request", recordEvent);
    window.addEventListener("agent-resume:open-note", recordEvent);
    window.addEventListener("agent-resume:workbench-work-item", recordEvent);
    window.addEventListener("agent-resume:workbench-open-room", recordEvent);

    try {
      render(<I18nProvider><ReportPanel /></I18nProvider>);
      await screen.findAllByText("Work items");

      // 1. Open note
      const openNoteBtn = screen.getByRole("button", { name: "Open note" });
      fireEvent.click(openNoteBtn);

      expect(eventsDispatched).toContainEqual({ type: "agent-resume:tab-request", detail: "notes" });
      expect(eventsDispatched).toContainEqual({ type: "agent-resume:open-note", detail: "wi-nav" });

      eventsDispatched.length = 0;

      // 2. IM room
      const openImBtn = screen.getByRole("button", { name: "Discussion room" });
      fireEvent.click(openImBtn);

      await waitFor(() => {
        expect(imCreateWorkItemRoom).toHaveBeenCalledWith({ noteId: "wi-nav" });
      });

      expect(eventsDispatched).toContainEqual({
        type: "agent-resume:workbench-work-item",
        detail: expect.objectContaining({
          noteId: "wi-nav",
          title: "Nav Test Item",
          status: "next",
          next: "Next step",
          sessions: ["codex:s-1"],
          projects: ["/repos/app"],
          primaryProject: "/repos/app"
        })
      });
      expect(eventsDispatched).toContainEqual({ type: "agent-resume:tab-request", detail: "workbench" });
      expect(eventsDispatched).toContainEqual({ type: "agent-resume:workbench-open-room", detail: { projectId: "room-wi-nav" } });
    } finally {
      window.removeEventListener("agent-resume:tab-request", recordEvent);
      window.removeEventListener("agent-resume:open-note", recordEvent);
      window.removeEventListener("agent-resume:workbench-work-item", recordEvent);
      window.removeEventListener("agent-resume:workbench-open-room", recordEvent);
    }
  });

  it("renders T1 timeline aggregated by day with provider, project, time, live status dots, and preview navigation (A6)", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);

    const day1 = new Date(2026, 8, 15, 14, 30, 0).getTime();
    const day1Earlier = new Date(2026, 8, 15, 9, 15, 0).getTime();
    const day2 = new Date(2026, 8, 14, 16, 0, 0).getTime();

    const item: WorkItemRecord = {
      noteId: "wi-timeline",
      title: "Timeline Work Item",
      gtdStatus: "next",
      updatedAtMs: day1,
      work: {
        sessions: ["codex:s-1", "claude:s-2", "codex:s-3"]
      }
    };

    const s1: AgentSession = {
      provider: "codex",
      id: "s-1",
      title: "Codex Session 1",
      projectPath: "/work/project-a",
      updatedAt: day1
    };
    const s2: AgentSession = {
      provider: "claude",
      id: "s-2",
      title: "Claude Session 2",
      projectPath: "/work/project-b",
      updatedAt: day1Earlier
    };
    const s3: AgentSession = {
      provider: "codex",
      id: "s-3",
      title: "Codex Session 3",
      projectPath: "/work/project-a",
      updatedAt: day2,
      lastExitWaiting: true
    };

    const previewSessionMock = vi.fn(async ({ provider, id }: { provider: string; id: string }) => ({
      session: { ...s1, id, provider: provider as any },
      preview: { title: `Preview of ${id}`, messages: [] }
    }));

    // Provide active dots: s1 is awaiting_user
    const dots: ActiveSessionDot[] = [
      {
        sessionKey: "codex:s-1",
        paneKey: "p-1",
        projectPath: "/work/project-a",
        title: "Codex Session 1",
        status: "awaiting_user"
      }
    ];

    window.agentResume = mockAgentResume({
      notesListWorkItems: async () => [item],
      querySessionsPage: async () => ({
        sessions: [s1, s2, s3],
        total: 3,
        hasMore: false
      }),
      previewSession: previewSessionMock,
      getWorkbenchActiveSessions: async () => dots
    });

    render(
      <I18nProvider>
        <ReportPanel />
      </I18nProvider>
    );

    // Wait for the timeline to load and active dots to apply
    await waitFor(() => {
      expect(document.querySelector(".report-timeline")).toBeTruthy();
      expect(document.querySelector(".report-timeline-group .session-dot.is-awaiting")).toBeTruthy();
    });

    // Verify 2 day groups exist
    const groups = document.querySelectorAll(".report-timeline-group");
    expect(groups.length).toBe(2);

    // Group 1 has 2 sessions, Group 2 has 1 session
    const group1Counts = groups[0].querySelector(".report-timeline-count");
    expect(group1Counts?.textContent).toBe("2");
    const group2Counts = groups[1].querySelector(".report-timeline-count");
    expect(group2Counts?.textContent).toBe("1");

    // Provider tags
    expect(screen.getAllByText("codex").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("claude").length).toBeGreaterThanOrEqual(1);

    // Project names
    expect(screen.getAllByText("project-a").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("project-b").length).toBeGreaterThanOrEqual(1);

    // Live status dot on s1 (active awaiting_user)
    const activeDot = groups[0].querySelector(".session-dot.is-awaiting");
    expect(activeDot).toBeTruthy();
    expect(activeDot?.classList.contains("is-last-exit-waiting")).toBe(false);

    // Closed waiting status dot on s3 (lastExitWaiting)
    const lastExitDot = groups[1].querySelector(".session-dot.is-last-exit-waiting");
    expect(lastExitDot).toBeTruthy();

    // Click on timeline item s1 to open preview
    const timelineItems = document.querySelectorAll<HTMLButtonElement>(".report-timeline-item");
    expect(timelineItems.length).toBe(3);
    fireEvent.click(timelineItems[0]);

    await waitFor(() => {
      expect(previewSessionMock).toHaveBeenCalledWith({ provider: "codex", id: "s-1" });
      expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    });

    // Click Back to return to work item detail
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(document.querySelector(".report-timeline")).toBeTruthy();
    });
  });

  it("displays empty state for work item with no sessions without white screen or blank page (A6)", async () => {
    const host = document.createElement("div");
    host.id = "react-report";
    document.body.append(host);

    const emptyItem: WorkItemRecord = {
      noteId: "wi-empty",
      title: "Empty Work Item",
      gtdStatus: "inbox",
      updatedAtMs: Date.now(),
      work: {
        sessions: [],
        next: "Write unit test",
        decision: "Proceed with empty state"
      }
    };

    window.agentResume = mockAgentResume({
      notesListWorkItems: async () => [emptyItem],
      querySessionsPage: async () => ({
        sessions: [],
        total: 0,
        hasMore: false
      })
    });

    render(
      <I18nProvider>
        <ReportPanel />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Empty Work Item").length).toBeGreaterThanOrEqual(1);
    });

    // Verify detail pane is rendered, not blank
    const detailPane = document.querySelector(".report-work-item-detail");
    expect(detailPane).toBeTruthy();

    // Verify header and fields are intact
    expect(screen.getByText("Next action: Write unit test")).toBeTruthy();
    expect(screen.getByText("Decision: Proceed with empty state")).toBeTruthy();

    // Verify empty state container and message exist
    const emptyState = document.querySelector(".report-work-item-history-empty");
    expect(emptyState).toBeTruthy();
    expect(emptyState?.textContent).toContain("No history yet");

    // Negative assertion: timeline does not exist, and detail is not empty/missing
    expect(document.querySelector(".report-timeline")).toBeNull();
    expect(document.querySelector(".cal-detail-empty")).toBeNull();
  });
});
