import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, GtdStatus } from "@agent-resume/core";
import { I18nProvider } from "../../i18n";
import { KanbanPanel } from "./KanbanPanel";

type TestNote = {
  noteId: string;
  scope: "library" | "project" | "session";
  projectPath?: string;
  filename: string;
  relDir: string;
  relMdPath: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
  gtdStatus: GtdStatus;
};

const session: AgentSession = {
  provider: "codex",
  id: "session-1",
  title: "Ship Kanban",
  projectPath: "/work/agent-resume-panel",
  updatedAt: Date.now()
};

const note: TestNote = {
  noteId: "note-1",
  scope: "library" as const,
  filename: "plan.md",
  relDir: "",
  relMdPath: "plan.md",
  title: "Quarterly plan",
  createdAtMs: Date.now(),
  updatedAtMs: Date.now(),
  gtdStatus: "waiting" as const
};

const GTD_LABELS = {
  "desktop.workbench.gtdStatus.inbox": "Inbox",
  "desktop.workbench.gtdStatus.next": "Next",
  "desktop.workbench.gtdStatus.waiting": "Waiting",
  "desktop.workbench.gtdStatus.someday": "Someday",
  "desktop.workbench.gtdStatus.reference": "Reference",
  "desktop.workbench.gtdStatus.done": "Done"
};

function renderKanban(options: {
  doneNote?: boolean;
 sessions?: AgentSession[];
  notes?: TestNote[];
 statuses?: Record<string, "inbox" | "next" | "waiting" | "someday" | "reference" | "done">;
} = {}) {
  const setSessionGtdStatus = vi.fn(async () => ({ ok: true }));
  const notesSetGtdStatus = vi.fn(async () => ({ record: note }));
  const notes = options.notes ?? (options.doneNote
    ? [note, { ...note, noteId: "note-done", title: "Finished task", gtdStatus: "done" as const }]
    : [note]);
  const sessions = options.sessions ?? [session];
  const statuses = options.statuses ?? { "codex:session-1": "next" };
  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        ...GTD_LABELS,
        "desktop.kanban.title": "Kanban",
        "desktop.kanban.itemCount": "{0} items",
        "desktop.kanban.moved": "Moved",
        "desktop.kanban.archived": "Archived",
        "desktop.kanban.archive": "Archive",
        "desktop.kanban.archiveAll": "Archive all completed",
        "desktop.kanban.archiveAllConfirm": "Archive {0} items?",
        "desktop.kanban.emptyColumn": "Drop a card here",
        "desktop.kanban.empty": "No items",
        "desktop.kanban.source.all": "All",
        "desktop.kanban.source.sessions": "Sessions",
        "desktop.kanban.source.notes": "Notes",
        "desktop.kanban.sourceFilter": "Source",
        "desktop.kanban.scope.library": "Library",
        "desktop.kanban.scope.project": "Project",
        "desktop.kanban.scope.session": "Session",
        "desktop.kanban.projects": "Projects",
        "desktop.kanban.allProjects": "All projects",
        "desktop.kanban.noProjects": "No projects yet",
        "desktop.notes.filterProjects": "Filter projects…",
        "desktop.common.showSidebar": "Show sidebar",
        "desktop.common.hideSidebar": "Hide sidebar",
        "desktop.common.search": "Search",
        "desktop.common.refresh": "Refresh",
        "desktop.common.justNow": "Just now",
        "desktop.common.minutesAgo": "{0} min ago",
        "desktop.common.hoursAgo": "{0} h ago",
        "desktop.common.daysAgo": "{0} d ago"
      }
    }),
    onLocaleChanged: () => () => undefined,
    listSessions: async () => sessions,
    listSessionGtdStatuses: async () => statuses,
    notesList: async () => notes,
    listProjects: async () => [
      { projectId: "proj-a", portableKey: "/work/agent-resume-panel", alias: "Agent Resume", hidden: false, pinned: true, lastSeenAtMs: null, updatedAtMs: 0, localPath: "/work/agent-resume-panel", pathMissing: false, sessionCount: 1 },
      { projectId: "proj-b", portableKey: "/work/other", alias: "Other", hidden: false, pinned: false, lastSeenAtMs: null, updatedAtMs: 0, localPath: "/work/other", pathMissing: false, sessionCount: 0 }
    ],
    listProjectAliases: async () => ({ "/work/agent-resume-panel": "Agent Resume" }),
    setSessionGtdStatus,
    notesSetGtdStatus,
    onSessionsSynced: () => () => undefined
  } as unknown as typeof window.agentResume;

  render(
    <I18nProvider>
      <KanbanPanel />
    </I18nProvider>
  );
  return { setSessionGtdStatus, notesSetGtdStatus };
}

function activate() {
  act(() => {
    window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "kanban" }));
  });
}

const dataTransfer = { setData: () => undefined, effectAllowed: "" };

describe("KanbanPanel", () => {
  beforeEach(() => {
    const host = document.createElement("div");
    host.id = "react-kanban";
    document.body.appendChild(host);
  });
  afterEach(() => cleanup());

  it("groups sessions and notes into their GTD status columns", async () => {
    renderKanban();
    activate();
    const sessionCard = await screen.findByRole("button", { name: /Ship Kanban/ });
    const noteCard = await screen.findByRole("button", { name: /Quarterly plan/ });

    expect(sessionCard.closest(".kanban-column")?.classList.contains("is-next")).toBe(true);
    expect(noteCard.closest(".kanban-column")?.classList.contains("is-waiting")).toBe(true);
  });

  it("persists a session card move to the dropped status", async () => {
    const { setSessionGtdStatus } = renderKanban();
    activate();
    const sessionCard = await screen.findByRole("button", { name: /Ship Kanban/ });
    const doneColumn = document.querySelector(".kanban-column.is-done") as HTMLElement;

    fireEvent.dragStart(sessionCard, { dataTransfer });
    fireEvent.drop(doneColumn, { dataTransfer });

    await waitFor(() =>
      expect(setSessionGtdStatus).toHaveBeenCalledWith({
        provider: "codex",
        id: "session-1",
        status: "done"
      })
    );
  });

  it("persists a note card move to the dropped status", async () => {
    const { notesSetGtdStatus } = renderKanban();
    activate();
    const noteCard = await screen.findByRole("button", { name: /Quarterly plan/ });
    const nextColumn = document.querySelector(".kanban-column.is-next") as HTMLElement;

    fireEvent.dragStart(noteCard, { dataTransfer });
    fireEvent.drop(nextColumn, { dataTransfer });

    await waitFor(() =>
      expect(notesSetGtdStatus).toHaveBeenCalledWith({ noteId: "note-1", status: "next" })
    );
  });

  it("archives a card by clearing its GTD status", async () => {
    const { setSessionGtdStatus } = renderKanban();
    activate();
    const sessionCard = await screen.findByRole("button", { name: /Ship Kanban/ });
    const archiveBtn = within(sessionCard).getByRole("button", { name: "Archive" });
    fireEvent.click(archiveBtn);
    await waitFor(() =>
      expect(setSessionGtdStatus).toHaveBeenCalledWith({ provider: "codex", id: "session-1", status: null })
    );
  });

  it("archives all done cards at once", async () => {
    const stub = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { notesSetGtdStatus } = renderKanban({ doneNote: true });
    activate();
    const archiveAllBtn = await screen.findByRole("button", { name: "Archive all completed" });
    fireEvent.click(archiveAllBtn);
    await waitFor(() =>
      expect(notesSetGtdStatus).toHaveBeenCalledWith({ noteId: "note-done", status: null })
    );
    stub.mockRestore();
  });

  const sessionB: AgentSession = {
    provider: "claude",
    id: "session-2",
    title: "Other project task",
    projectPath: "/work/other",
    updatedAt: Date.now()
  };
  const projectNote: TestNote = {
    noteId: "note-proj",
    scope: "project" as const,
    projectPath: "/work/agent-resume-panel",
    filename: "design.md",
    relDir: "",
    relMdPath: "design.md",
    title: "Design doc",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    gtdStatus: "inbox" as const
  };

  it("filters cards by the selected project", async () => {
    renderKanban({
      sessions: [session, sessionB],
      notes: [note, projectNote],
      statuses: { "codex:session-1": "next", "claude:session-2": "next" }
    });
    activate();

    // Both sessions + both notes visible initially (library note has no project).
    await screen.findByRole("button", { name: /Ship Kanban/ });
    expect(screen.getByRole("button", { name: /Other project task/ })).toBeTruthy();

    // Select project A.
    fireEvent.click(screen.getByRole("button", { name: "Agent Resume" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ship Kanban/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Other project task/ })).toBeNull();
    });
    // Project note in project A is visible; library note is hidden.
    expect(screen.getByRole("button", { name: /Design doc/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Quarterly plan/ })).toBeNull();

    // Back to all projects.
    fireEvent.click(screen.getByRole("button", { name: "All projects" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Other project task/ })).toBeTruthy());
    expect(screen.getByRole("button", { name: /Quarterly plan/ })).toBeTruthy();
  });

  it("hides library-scoped notes when a project is selected", async () => {
    renderKanban({
      sessions: [session],
      notes: [note, projectNote],
      statuses: { "codex:session-1": "next" }
    });
    activate();
    await screen.findByRole("button", { name: /Quarterly plan/ });

    fireEvent.click(screen.getByRole("button", { name: "Agent Resume" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Quarterly plan/ })).toBeNull());
    expect(screen.queryByRole("button", { name: /Design doc/ })).toBeTruthy();
  });
});
