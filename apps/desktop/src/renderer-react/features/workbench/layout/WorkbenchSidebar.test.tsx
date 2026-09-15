import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { ActiveSessionDot } from "../activeSessionDots";
import { WorkbenchSidebar, type WorkbenchSidebarWorkItem } from "./WorkbenchSidebar";

beforeEach(() => {
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages: {} }),
    onLocaleChanged: () => () => undefined
  } as unknown as typeof window.agentResume;
});

function renderSidebar({
  workItems,
  dotByKey
}: {
  workItems: WorkbenchSidebarWorkItem[];
  dotByKey?: Map<string, ActiveSessionDot>;
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
    const workItems: WorkbenchSidebarWorkItem[] = [
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
    const workItems: WorkbenchSidebarWorkItem[] = [
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
    const workItems: WorkbenchSidebarWorkItem[] = [
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
    const workItems: WorkbenchSidebarWorkItem[] = [
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
    const workItems: WorkbenchSidebarWorkItem[] = [
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
