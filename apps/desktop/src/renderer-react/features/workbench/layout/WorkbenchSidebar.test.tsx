import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { ActiveSessionDot } from "../activeSessionDots";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import type { WorkbenchWorkItem } from "../workItem";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        "desktop.workbench.needsMe": "Needs me {0}",
        "desktop.workbench.newWorkItem": "New work item"
      }
    }),
    onLocaleChanged: () => () => undefined
  } as unknown as typeof window.agentResume;
});

function renderSidebar({
  workItems,
  dotByKey,
  needsYouCount,
  workItemNeedsYouFilter,
  onWorkItemNeedsYouFilterChange,
  onAddWorkItem
}: {
  workItems: WorkbenchWorkItem[];
  dotByKey?: Map<string, ActiveSessionDot>;
  needsYouCount?: number;
  workItemNeedsYouFilter?: boolean;
  onWorkItemNeedsYouFilterChange?: (active: boolean) => void;
  onAddWorkItem?: () => void;
}) {
  return render(
    <I18nProvider>
      <WorkbenchSidebar
        collapsed={false}
        workItemsActive={true}
        resourceView="projects"
        workItems={workItems}
        selectedWorkItemId={null}
        workItemProjects={[]}
        workItemProjectFilter=""
        workItemStatusFilter="all"
        dotByKey={dotByKey}
        needsYouCount={needsYouCount}
        workItemNeedsYouFilter={workItemNeedsYouFilter}
        onWorkItemNeedsYouFilterChange={onWorkItemNeedsYouFilterChange}
        projectFilter="all"
        projectQuery=""
        selectedProject={null}
        selectedFolderId={null}
        selectedGtdStatus="inbox"
        completedGtdExpanded={false}
        expandedProjectIds={new Set()}
        expandedFolderIds={new Set()}
        dragTargetKey={null}
        unclassifiedFolderId="__unclassified__"
        projects={[]}
        gtdStatusCounts={new Map()}
        folderAssignmentKey={(p, s) => `${p}:${s}`}
        onProjectQueryChange={vi.fn()}
        onProjectFilterChange={vi.fn()}
        onSelectAllSessions={vi.fn()}
        onAddProject={vi.fn()}
        onAddWorkItem={onAddWorkItem}
        onSelectProject={vi.fn()}
        onToggleProjectExpanded={vi.fn()}
        onProjectMenu={vi.fn()}
        onSelectFolder={vi.fn()}
        onFolderMenu={vi.fn()}
        onFolderDragOver={vi.fn()}
        onFolderDragLeave={vi.fn()}
        onFolderDrop={vi.fn()}
        onToggleFolderExpanded={vi.fn()}
        onSelectWorkItem={vi.fn()}
        onSelectWorkItemsView={vi.fn()}
        onSelectResourceView={vi.fn()}
        onSelectResourceViewMode={vi.fn()}
        onWorkItemProjectFilterChange={vi.fn()}
        onWorkItemStatusFilterChange={vi.fn()}
        onSelectGtdStatus={vi.fn()}
        onToggleCompletedGtd={vi.fn()}
      />
    </I18nProvider>
  );
}

describe("WorkbenchSidebar work items live dot (P3)", () => {
  it("renders awaiting_user live dot on work item row", () => {
    const workItems: WorkbenchWorkItem[] = [
      { noteId: "wi-awaiting", title: "Awaiting task", status: "next", sessions: ["codex:s-await"] }
    ];
    const dotByKey = new Map<string, ActiveSessionDot>([
      ["codex:s-await", { paneKey: "p-1", projectPath: "/app", title: "Awaiting", sessionKey: "codex:s-await", status: "awaiting_user" }]
    ]);

    renderSidebar({ workItems, dotByKey });
    const row = screen.getByRole("button", { name: /Awaiting task/i });
    expect(row.querySelector(".wb-gtd-status-dot")).not.toBeNull();
    const liveDot = row.querySelector(".session-dot");
    expect(liveDot).not.toBeNull();
    expect(liveDot?.classList.contains("is-awaiting")).toBe(true);
  });

  it("renders error live dot on work item row", () => {
    const workItems: WorkbenchWorkItem[] = [
      { noteId: "wi-error", title: "Error task", status: "next", sessions: ["codex:s-err"] }
    ];
    const dotByKey = new Map<string, ActiveSessionDot>([
      ["codex:s-err", { paneKey: "p-2", projectPath: "/app", title: "Error", sessionKey: "codex:s-err", status: "error" }]
    ]);

    renderSidebar({ workItems, dotByKey });
    const row = screen.getByRole("button", { name: /Error task/i });
    expect(row.querySelector(".wb-gtd-status-dot")).not.toBeNull();
    const liveDot = row.querySelector(".session-dot");
    expect(liveDot).not.toBeNull();
    expect(liveDot?.classList.contains("is-error")).toBe(true);
  });

  it("renders running/connecting live dot on work item row", () => {
    const workItems: WorkbenchWorkItem[] = [
      { noteId: "wi-run", title: "Running task", status: "next", sessions: ["codex:s-run"] },
      { noteId: "wi-conn", title: "Connecting task", status: "next", sessions: ["codex:s-conn"] }
    ];
    const dotByKey = new Map<string, ActiveSessionDot>([
      ["codex:s-run", { paneKey: "p-3", projectPath: "/app", title: "Run", sessionKey: "codex:s-run", status: "running" }],
      ["codex:s-conn", { paneKey: "p-4", projectPath: "/app", title: "Conn", sessionKey: "codex:s-conn", status: "connecting" }]
    ]);

    renderSidebar({ workItems, dotByKey });
    const runRow = screen.getByRole("button", { name: /Running task/i });
    const connRow = screen.getByRole("button", { name: /Connecting task/i });

    expect(runRow.querySelector(".session-dot")?.classList.contains("is-running")).toBe(true);
    expect(connRow.querySelector(".session-dot")?.classList.contains("is-connecting")).toBe(true);
  });

  it("does not render a second dot on inactive work item row", () => {
    const workItems: WorkbenchWorkItem[] = [
      { noteId: "wi-idle", title: "Idle task", status: "next", sessions: ["codex:s-idle"] },
      { noteId: "wi-no-sessions", title: "Empty task", status: "next", sessions: [] }
    ];
    // dotByKey has no entry for s-idle
    renderSidebar({ workItems, dotByKey: new Map() });

    const idleRow = screen.getByRole("button", { name: /Idle task/i });
    const emptyRow = screen.getByRole("button", { name: /Empty task/i });

    // GTD dot is present
    expect(idleRow.querySelector(".wb-gtd-status-dot")).not.toBeNull();
    expect(emptyRow.querySelector(".wb-gtd-status-dot")).not.toBeNull();

    // No second dot (session-dot)
    expect(idleRow.querySelector(".session-dot")).toBeNull();
    expect(emptyRow.querySelector(".session-dot")).toBeNull();
  });

  it("does not render a second dot when session status is open", () => {
    const workItems: WorkbenchWorkItem[] = [
      { noteId: "wi-open", title: "Open task", status: "next", sessions: ["codex:s-open"] }
    ];
    const dotByKey = new Map<string, ActiveSessionDot>([
      ["codex:s-open", { paneKey: "p-5", projectPath: "/app", title: "Open", sessionKey: "codex:s-open", status: "open" }]
    ]);

    renderSidebar({ workItems, dotByKey });
    const row = screen.getByRole("button", { name: /Open task/i });

    expect(row.querySelector(".wb-gtd-status-dot")).not.toBeNull();
    expect(row.querySelector(".session-dot")).toBeNull();
  });
});

describe("WorkbenchSidebar needs-you filter chip (P4)", () => {
  it("does not render the chip in DOM when n=0", () => {
    const workItems: WorkbenchWorkItem[] = [
      { noteId: "wi-1", title: "Task 1", status: "next", sessions: ["codex:s-1"] }
    ];
    // No awaiting_user sessions -> n=0
    renderSidebar({
      workItems,
      dotByKey: new Map([
        ["codex:s-1", { paneKey: "p-1", projectPath: "/app", title: "Task 1", sessionKey: "codex:s-1", status: "running" }]
      ])
    });

    expect(screen.queryByRole("button", { name: /Needs me/i })).toBeNull();
    expect(document.querySelector(".wb-work-item-needs-chip")).toBeNull();
  });

  it("renders the chip in DOM when n>0 and responds to clicks", async () => {
    const workItems: WorkbenchWorkItem[] = [
      { noteId: "wi-1", title: "Task 1", status: "next", sessions: ["codex:s-1"] },
      { noteId: "wi-2", title: "Task 2", status: "next", sessions: ["codex:s-2"] }
    ];
    const dotByKey = new Map<string, ActiveSessionDot>([
      ["codex:s-1", { paneKey: "p-1", projectPath: "/app", title: "Task 1", sessionKey: "codex:s-1", status: "awaiting_user" }],
      ["codex:s-2", { paneKey: "p-2", projectPath: "/app", title: "Task 2", sessionKey: "codex:s-2", status: "awaiting_user" }]
    ]);
    const onToggle = vi.fn();

    renderSidebar({
      workItems,
      dotByKey,
      workItemNeedsYouFilter: false,
      onWorkItemNeedsYouFilterChange: onToggle
    });

    const chip = await screen.findByRole("button", { name: /Needs me 2/i });
    expect(chip).not.toBeNull();
    expect(chip.classList.contains("is-active")).toBe(false);
    expect(chip.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("renders active chip state when filter is active", async () => {
    const workItems: WorkbenchWorkItem[] = [
      { noteId: "wi-1", title: "Task 1", status: "next", sessions: ["codex:s-1"] }
    ];
    const dotByKey = new Map<string, ActiveSessionDot>([
      ["codex:s-1", { paneKey: "p-1", projectPath: "/app", title: "Task 1", sessionKey: "codex:s-1", status: "awaiting_user" }]
    ]);

    renderSidebar({
      workItems,
      dotByKey,
      workItemNeedsYouFilter: true
    });

    const chip = await screen.findByRole("button", { name: /Needs me 1/i });
    expect(chip.classList.contains("is-active")).toBe(true);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("WorkbenchSidebar create work item (P5)", () => {
  it("renders new work item button and fires onAddWorkItem when clicked", async () => {
    const onAddWorkItem = vi.fn();
    renderSidebar({
      workItems: [],
      onAddWorkItem
    });

    const addBtn = await screen.findByRole("button", { name: /New work item/i });
    expect(addBtn).not.toBeNull();
    expect(addBtn.classList.contains("wb-add-work-item-btn")).toBe(true);

    fireEvent.click(addBtn);
    expect(onAddWorkItem).toHaveBeenCalledTimes(1);
  });
});
