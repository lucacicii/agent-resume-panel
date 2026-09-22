import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ScheduleView } from "./ScheduleView";
import type { ThunderSchedule } from "@agent-resume/core";

const messages = {
  "desktop.schedule.addSchedule": "Add Schedule",
  "desktop.schedule.createTitle": "New Schedule",
  "desktop.schedule.runNow": "Run Now",
  "desktop.schedule.searchPlaceholder": "Search schedules…",
  "desktop.schedule.filterAll": "All",
  "desktop.schedule.filterActive": "Active",
  "desktop.schedule.filterPaused": "Paused"
};

const mockSchedules: ThunderSchedule[] = [
  {
    id: "sched-1",
    name: "Daily Code Health Check",
    prompt: "Run git status and tests",
    workspaceDir: "/work/project",
    model: "openai/gpt-4o",
    triggerType: "interval",
    triggerValue: "1h",
    enabled: true,
    lastRunAtMs: 1000,
    lastStatus: "success",
    lastOutput: "All tests passed cleanly.",
    nextRunAtMs: 2000,
    createdAtMs: 1000,
    updatedAtMs: 1000
  },
  {
    id: "sched-2",
    name: "Doc Sync Automation",
    prompt: "Sync markdown docs to wiki",
    triggerType: "daily",
    triggerValue: "09:00",
    enabled: false,
    lastStatus: "idle",
    createdAtMs: 500,
    updatedAtMs: 500
  }
];

describe("ScheduleView", () => {
  beforeEach(() => {
    const host = document.createElement("div");
    host.id = "react-schedule";
    document.body.append(host);

    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages }),
      onLocaleChanged: () => () => undefined,
      schedulesList: vi.fn(async () => mockSchedules),
      schedulesRunNow: vi.fn(async () => ({ runId: "run-1" })),
      schedulesToggle: vi.fn(async ({ id, enabled }) => ({ ...mockSchedules[0], enabled })),
      schedulesDelete: vi.fn(async () => true),
      thunderListModels: vi.fn(async () => [
        { id: "gpt-4o", name: "GPT-4o", provider: "openai", selection_id: "openai/gpt-4o", available: true }
      ]),
      schedulesListRuns: vi.fn(async () => []),
      onScheduleStatusChanged: () => () => undefined,
      onScheduleRunEvent: () => () => undefined
    } as unknown as typeof window.agentResume;
  });

  afterEach(() => {
    cleanup();
    document.getElementById("react-schedule")?.remove();
  });

  it("renders the schedule list and details", async () => {
    render(
      <I18nProvider>
        <ScheduleView active={true} />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Daily Code Health Check").length).toBeGreaterThan(0);
      expect(screen.getByText("Doc Sync Automation")).toBeTruthy();
    });

    expect(screen.getByText("Run git status and tests")).toBeTruthy();
    expect(screen.getByText("All tests passed cleanly.")).toBeTruthy();
  });

  it("triggers run now when clicked", async () => {
    render(
      <I18nProvider>
        <ScheduleView active={true} />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Daily Code Health Check").length).toBeGreaterThan(0);
    });

    const runNowButtons = screen.getAllByRole("button", { name: /Run Now/i });
    expect(runNowButtons.length).toBeGreaterThan(0);
    fireEvent.click(runNowButtons[0]);

    await waitFor(() => {
      expect(window.agentResume.schedulesRunNow).toHaveBeenCalledWith({ id: "sched-1" });
    });
  });

  it("opens editor modal when add button is clicked", async () => {
    render(
      <I18nProvider>
        <ScheduleView active={true} />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Daily Code Health Check").length).toBeGreaterThan(0);
    });

    const addBtn = screen.getByTitle("Add Schedule");
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByText("New Schedule")).toBeTruthy();
    });
  });
});
