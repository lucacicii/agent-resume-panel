import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { PeriodInsights } from "@agent-resume/core";
import { PeriodInsightsDashboard } from "./PeriodInsightsDashboard";

const mockInsights: PeriodInsights = {
  fromMs: 1000,
  toMs: 2000,
  sessionStats: {
    total: 10,
    completed: 6,
    active: 3,
    blocked: 1,
    other: 0,
    byProvider: { pi: 7, claude: 3 },
    byProject: [
      { projectPath: "/work/app1", projectName: "app1", count: 6 },
      { projectPath: "/work/app2", projectName: "app2", count: 4 }
    ],
    deepTurnCount: 4,
    quickTurnCount: 2
  },
  blockedSessions: [
    {
      provider: "pi",
      id: "ses-blocked-1",
      title: "Fix payment issue",
      projectPath: "/work/app1",
      updatedAt: 1500,
      blockerReason: "Gateway returned 403 Forbidden",
      nextAction: "Request API credentials"
    }
  ],
  activeSessions: [
    {
      provider: "claude",
      id: "ses-active-1",
      title: "Refactor router",
      projectPath: "/work/app2",
      updatedAt: 1600,
      nextAction: "Write unit tests"
    }
  ],
  tagStats: {
    totalTags: 3,
    totalHits: 8,
    byCategory: {
      task_type: [
        {
          tag: "Bug Fix",
          normalizedTag: "bug-fix",
          displayName: "Bug Fix",
          category: "task_type",
          sessionCount: 4,
          weight: 4.5,
          sessionIds: ["pi:s1", "pi:s2"]
        }
      ],
      tech_stack: [
        {
          tag: "React",
          normalizedTag: "react",
          displayName: "React",
          category: "tech_stack",
          sessionCount: 3,
          weight: 3.0,
          sessionIds: ["pi:s1"]
        }
      ]
    },
    topTags: [
      {
        tag: "Bug Fix",
        normalizedTag: "bug-fix",
        displayName: "Bug Fix",
        category: "task_type",
        sessionCount: 4,
        weight: 4.5,
        sessionIds: ["pi:s1", "pi:s2"]
      }
    ]
  },
  llmUsage: {
    totalCalls: 24,
    totalTokens: 125000,
    promptTokens: 100000,
    completionTokens: 25000,
    topModels: [{ model: "gpt-5.5", count: 20 }],
    trend: [
      { label: "08:00", calls: 10, tokens: 50000 },
      { label: "12:00", calls: 14, tokens: 75000 }
    ]
  },
  dailyTrend: [
    {
      dayKey: "2026-09-01",
      label: "Mon",
      dayOfMonth: 1,
      dayOfWeek: 1,
      sessionCount: 4,
      completedCount: 3,
      activeCount: 1,
      blockedCount: 0
    },
    {
      dayKey: "2026-09-02",
      label: "Tue",
      dayOfMonth: 2,
      dayOfWeek: 2,
      sessionCount: 6,
      completedCount: 3,
      activeCount: 2,
      blockedCount: 1
    }
  ],
  composerInsights: {
    totalSends: 25,
    avgLength: 64,
    intentDistribution: {
      feature: 15,
      query: 4,
      flowControl: 3,
      errorDiagnosis: 1,
      multimodal: 1,
      constraint: 1
    },
    smoothness: {
      smoothSends: 23,
      frictionSends: 2,
      frictionRate: 8,
      singleTurnSessions: 3,
      multiTurnSessions: 5,
      avgSendsPerSession: 3.1
    },
    frictionSessions: [
      {
        provider: "pi",
        id: "ses-fric-1",
        title: "Fix invoice error",
        projectPath: "/work/app1",
        frictionReasons: ["未达预期", "意外变更"],
        sendCount: 6
      }
    ],
    lengthTiers: {
      micro: 8,
      short: 10,
      medium: 5,
      long: 2
    },
    topPhrases: [
      { phrase: "commit(中文) and push", count: 5 },
      { phrase: "继续", count: 3 }
    ],
    hourlyIntensity: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2, "0")}:00`,
      count: h === 10 ? 8 : h === 15 ? 12 : 1
    }))
  }
};

const fakeTranslate = (key: string, ...args: Array<string | number>) => {
  if (key === "desktop.report.insightsSessions") return "Sessions";
  if (key === "desktop.report.insightsCompleted") return "Completed";
  if (key === "desktop.report.insightsActive") return "Active";
  if (key === "desktop.report.insightsBlocked") return "Blocked";
  if (key === "desktop.report.insightsProjects") return "Projects";
  if (key === "desktop.report.insightsProjectsTouched") return `${args[0]} projects touched`;
  if (key === "desktop.report.insightsProviders") return "Agents";
  if (key === "desktop.report.insightsTokens") return "LLM Usage";
  if (key === "desktop.report.insightsCalls") return `${args[0]} calls · ${args[1]}`;
  if (key === "desktop.report.insightsBlockedList") return "Blocked Watchlist";
  if (key === "desktop.report.insightsTags") return "Tags & Knowledge";
  if (key === "desktop.report.insightsCategoryTaskType") return "Task Types";
  if (key === "desktop.report.insightsCategoryTechStack") return "Tech Stack";
  if (key === "desktop.report.insightsTrendTitle") return "Activity Trend";
  if (key === "desktop.report.insightsTrendHint") return "Click a day to view its daily digest";
  if (key === "desktop.report.insightsInputTokens") return "Prompt";
  if (key === "desktop.report.insightsOutputTokens") return "Completion";
  if (key === "desktop.report.composerInsightsTitle") return "User Instructions Profile";
  if (key === "desktop.report.composerSendsHeadline") return `${args[0]} sends · avg ${args[1]} chars`;
  if (key === "desktop.report.composerIntentTitle") return "Intent Distribution";
  if (key === "desktop.report.composerIntentFeature") return "Feature Dev";
  if (key === "desktop.report.composerHelpTitle") return "Glossary & Metrics";
  if (key === "desktop.report.composerHelpIntent") return "Intent explanation";
  if (key === "desktop.report.composerHelpSmooth") return "Smoothness explanation";
  if (key === "desktop.report.composerHelpHourly") return "Hourly explanation";
  if (key === "desktop.report.composerHelpMacros") return "Macros explanation";
  if (key === "desktop.report.composerSmoothnessTitle") return "Smoothness & Turns";
  if (key === "desktop.report.composerSmoothRate") return `Smooth: ${args[0]}% (${args[1]})`;
  if (key === "desktop.report.composerFrictionRate") return `Friction: ${args[0]}% (${args[1]})`;
  if (key === "desktop.report.composerSingleTurn") return `One-shot: ${args[0]}%`;
  if (key === "desktop.report.composerAvgTurns") return `Avg ${args[0]} sends/session`;
  if (key === "desktop.report.composerHourlyTitle") return "Hourly Intensity (24h)";
  if (key === "desktop.report.composerTopPhrasesTitle") return "Frequent Macros TOP";
  if (key === "desktop.report.composerFrictionSessionsTitle") return "Sessions with Friction & Revisions";
  return key;
};

describe("PeriodInsightsDashboard", () => {
  it("renders metrics, blocked watchlist, and tag chips correctly", () => {
    const onSelectTag = vi.fn();
    const onSelectStatus = vi.fn();
    const onSelectProject = vi.fn();
    const onOpenSession = vi.fn();
    const onSelectDay = vi.fn();

    render(
      <PeriodInsightsDashboard
        insights={mockInsights}
        loading={false}
        selectedTag={null}
        statusFilter="all"
        selectedProject={null}
        onSelectTag={onSelectTag}
        onSelectStatus={onSelectStatus}
        onSelectProject={onSelectProject}
        onOpenSession={onOpenSession}
        onSelectDay={onSelectDay}
        t={fakeTranslate}
      />
    );

    // Verify session count and status
    expect(screen.getAllByText("10").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/6 Completed/)).toBeTruthy();
    expect(screen.getByText(/3 Active/)).toBeTruthy();
    expect(screen.getByText(/1 Blocked/)).toBeTruthy();

    // Verify projects
    expect(screen.getAllByText("app1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("app2")).toBeTruthy();
    expect(screen.getByText("2 projects touched")).toBeTruthy();

    // Verify providers
    expect(screen.getAllByText("pi").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("claude").length).toBeGreaterThanOrEqual(1);

    // Verify tokens
    expect(screen.getByText(/125\.0k · 24 Calls/)).toBeTruthy();

    // Verify blocked watchlist
    expect(screen.getByText("Fix payment issue")).toBeTruthy();
    expect(screen.getByText(/Gateway returned 403 Forbidden/)).toBeTruthy();
    expect(screen.getByText(/Request API credentials/)).toBeTruthy();

    // Click on View blocked session
    const blockerViewBtn = screen.getAllByText("View")[1];
    fireEvent.click(blockerViewBtn);
    expect(onOpenSession).toHaveBeenCalledWith("pi", "ses-blocked-1");

    // Click on completed filter pill
    const completedBtn = screen.getByTitle("Completed");
    fireEvent.click(completedBtn);
    expect(onSelectStatus).toHaveBeenCalledWith("completed");

    // Click on project bar
    const app1Item = screen.getAllByText("app1")[0].closest(".insights-project-bar-item");
    expect(app1Item).toBeTruthy();
    fireEvent.click(app1Item!);
    expect(onSelectProject).toHaveBeenCalledWith("/work/app1");

    // Click on tag chip
    const tagChip = screen.getByText("Bug Fix");
    fireEvent.click(tagChip);
    expect(onSelectTag).toHaveBeenCalledWith("bug-fix");

    // Verify activity trend and click on a day bar
    expect(screen.getByText(/Activity Trend/)).toBeTruthy();
    expect(screen.getByText("Mon")).toBeTruthy();
    const tueCol = screen.getByText("Tue");
    fireEvent.click(tueCol);
    expect(onSelectDay).toHaveBeenCalledWith("2026-09-02");

    // Verify composer sends insights (5 dimensions)
    expect(screen.getByText(/User Instructions Profile/)).toBeTruthy();
    expect(screen.getByText("?")).toBeTruthy();
    expect(screen.getByText("Glossary & Metrics")).toBeTruthy();
    expect(screen.getByText(/25 sends · avg 64 chars/)).toBeTruthy();
    expect(screen.getAllByText("Intent Distribution").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Smoothness & Turns").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Smooth: 92% \(23\)/)).toBeTruthy();
    expect(screen.getByText(/Friction: 8% \(2\)/)).toBeTruthy();
    expect(screen.getAllByText("Hourly Intensity (24h)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Frequent Macros TOP").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("commit(中文) and push")).toBeTruthy();

    // Verify friction session item & click
    expect(screen.getByText("Fix invoice error")).toBeTruthy();
    expect(screen.getByText("未达预期")).toBeTruthy();
    expect(screen.getByText("意外变更")).toBeTruthy();
    const frictionViewBtn = screen.getAllByText("View")[0];
    fireEvent.click(frictionViewBtn);
    expect(onOpenSession).toHaveBeenCalledWith("pi", "ses-fric-1");
  });

  it("returns null if insights has 0 sessions", () => {
    const emptyInsights: PeriodInsights = {
      ...mockInsights,
      sessionStats: {
        ...mockInsights.sessionStats,
        total: 0
      }
    };

    const { container } = render(
      <PeriodInsightsDashboard
        insights={emptyInsights}
        loading={false}
        selectedTag={null}
        statusFilter="all"
        selectedProject={null}
        onSelectTag={vi.fn()}
        onSelectStatus={vi.fn()}
        onSelectProject={vi.fn()}
        onOpenSession={vi.fn()}
        t={fakeTranslate}
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
