import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SessionsView } from "./SessionsView";

function session(provider: string, id: string, title: string, updatedAt: number) {
  return { provider, id, title, projectPath: "/work/app", updatedAt };
}

const FACETS = {
  total: 3,
  byProvider: { codex: 2, claude: 1 },
  byGtdStatus: { done: 1 },
  untagged: 2,
  byTask: { "task-1": 2 },
  unassigned: 1
};

function renderSessions(overrides?: Partial<typeof window.agentResume>) {
  const host = document.createElement("div");
  host.id = "react-sessions";
  document.body.append(host);
  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        "desktop.common.all": "All",
        "desktop.gtd.unmarked": "Unmarked",
        "desktop.workbench.gtdStatus.inbox": "To do",
        "desktop.workbench.gtdStatus.next": "In progress",
        "desktop.workbench.gtdStatus.waiting": "Waiting",
        "desktop.workbench.gtdStatus.done": "Done",
        "desktop.sessions.title": "Sessions",
        "desktop.sessions.search": "Filter title, summary, project, provider, id",
        "desktop.sessions.count": "{0} sessions",
        "desktop.sessions.loading": "Loading…",
        "desktop.sessions.empty": "No sessions yet",
        "desktop.sessions.emptySearch": "No sessions match your search",
        "desktop.sessions.loadMore": "Load more ({0}/{1})",
        "desktop.sessions.allLoaded": "All sessions loaded",
        "desktop.sessions.noTask": "This session is not linked to a task",
        "desktop.sessions.ageFilterLabel": "Filter by age",
        "desktop.sessions.ageAll": "All ages",
        "desktop.sessions.age7": "Older than 7 days",
        "desktop.sessions.age30": "Older than 30 days",
        "desktop.sessions.age90": "Older than 90 days",
        "desktop.sessions.resync": "Resync",
        "desktop.sessions.providerFilter": "Provider filter",
        "desktop.sessions.gtdFilter": "GTD filter",
        "desktop.sessions.colProvider": "Provider",
        "desktop.sessions.colTitle": "Title / Summary",
        "desktop.sessions.colProject": "Project",
        "desktop.sessions.colUpdated": "Updated",
        "desktop.sessions.taskFilter": "Filter by task",
        "desktop.sessions.taskAll": "All tasks",
        "desktop.sessions.taskUnassigned": "Unassigned"
      }
    }),
    onLocaleChanged: () => () => undefined,
    querySessionsPage: vi.fn(async () => ({
      sessions: [session("codex", "s1", "Fix renderer", 10)],
      total: 1
    })),
    sessionFacets: vi.fn(async () => FACETS),
    listSessionGtdStatuses: vi.fn(async () => ({})),
    notesListTasks: vi.fn(async () => [
      {
        noteId: "task-1",
        scope: "library",
        filename: "fix.md",
        relDir: "",
        relMdPath: "fix.md",
        title: "Fix renderer",
        createdAtMs: 1,
        updatedAtMs: 2,
        work: { sessions: [] }
      }
    ]),
    notesTaskNoteIdForSession: vi.fn(async () => "task-1"),
    previewSession: vi.fn(async () => ({
      session: session("codex", "s1", "Fix renderer", 10),
      preview: { title: "Fix renderer", messages: [{ role: "user", text: "hello" }] }
    })),
    renameSession: vi.fn(async () => ({ title: "Fix renderer", nativeRenamed: true })),
    autoRenameSession: vi.fn(async () => ({ title: "Suggested", nativeRenamed: true })),
    syncSessions: vi.fn(async () => undefined),
    ensureTaskWorkbench: vi.fn(async () => ({ workbenchId: "wb-1" })),
    listTaskWorkbenches: vi.fn(async () => [{ workbenchId: "wb-1", taskNoteId: "task-1" }]),
    taskWindowOpen: vi.fn(async () => ({ ok: true as const, created: false })),
    ...overrides
  } as unknown as typeof window.agentResume;

  render(<I18nProvider><SessionsView active /></I18nProvider>);
  return host;
}

function pageCall(): Record<string, unknown> {
  const calls = (window.agentResume.querySessionsPage as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
}

describe("SessionsView", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("react-sessions")?.remove();
  });

  it("renders the first page, the total count and the filter chips", async () => {
    renderSessions();
    expect(await screen.findByText("Fix renderer")).toBeTruthy();
    expect(screen.getByText("1 sessions")).toBeTruthy();
    expect(window.agentResume.sessionFacets).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "codex 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unmarked 2" })).toBeTruthy();
    expect(screen.getByText("Title / Summary")).toBeTruthy();
    expect(pageCall()).toMatchObject({ limit: 100, search: undefined });
  });

  it("appends the next page when load more is clicked", async () => {
    const querySessionsPage = vi.fn(async (args: { cursor?: unknown }) =>
      args?.cursor
        ? { sessions: [session("claude", "s2", "Second page", 5)], total: 2 }
        : {
            sessions: [session("codex", "s1", "First page", 10)],
            total: 2,
            nextCursor: { updatedAt: 10, provider: "codex", id: "s1" }
          }
    );
    renderSessions({ querySessionsPage } as unknown as Partial<typeof window.agentResume>);

    expect(await screen.findByText("First page")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Load more/ }));
    expect(await screen.findByText("Second page")).toBeTruthy();
    expect(pageCall()).toMatchObject({
      limit: 100,
      cursor: { updatedAt: 10, provider: "codex", id: "s1" },
      search: undefined
    });
  });

  it("runs the search term through the paginated query", async () => {
    renderSessions();
    await screen.findByText("Fix renderer");
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter title, summary, project, provider, id" }), {
      target: { value: "renderer" }
    });
    await waitFor(() => expect(pageCall()).toMatchObject({ limit: 100, search: "renderer" }));
  });

  it("restricts the page to the providers whose chip is on", async () => {
    renderSessions();
    fireEvent.click(await screen.findByRole("button", { name: "codex 2" }));
    await waitFor(() => expect(pageCall()).toMatchObject({ providers: ["codex"] }));
    fireEvent.click(screen.getByRole("button", { name: "codex 2" }));
    await waitFor(() => expect(pageCall()).not.toHaveProperty("providers"));
  });

  it("filters to unmarked sessions when that chip is on", async () => {
    renderSessions();
    fireEvent.click(await screen.findByRole("button", { name: "Unmarked 2" }));
    await waitFor(() => expect(pageCall()).toMatchObject({ gtdUntagged: true }));
  });

  it("folds hidden GTD statuses onto the To do chip", async () => {
    renderSessions();
    fireEvent.click(await screen.findByRole("button", { name: "To do 0" }));
    await waitFor(() => expect(pageCall()).toMatchObject({ gtdStatuses: ["inbox", "someday", "reference"] }));
  });

  it("filters to one work item, then to unassigned sessions", async () => {
    renderSessions();
    const taskSelect = await screen.findByRole("combobox", { name: "Filter by task" });

    fireEvent.change(taskSelect, { target: { value: "task-1" } });
    await waitFor(() => expect(pageCall()).toMatchObject({ taskNoteId: "task-1" }));
    expect(screen.getByRole("option", { name: "Fix renderer (2)" })).toBeTruthy();

    fireEvent.change(taskSelect, { target: { value: "unassigned" } });
    await waitFor(() => expect(pageCall()).toMatchObject({ unassignedOnly: true }));

    fireEvent.change(taskSelect, { target: { value: "all" } });
    await waitFor(() => expect(pageCall()).not.toHaveProperty("taskNoteId"));
    expect(pageCall()).not.toHaveProperty("unassignedOnly");
  });

  it("bounds the page by age when the filter changes", async () => {
    renderSessions();
    await screen.findByText("Fix renderer");
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by age" }), { target: { value: "7" } });
    await waitFor(() => expect(pageCall().toMs).toEqual(expect.any(Number)));
    expect(pageCall().toMs as number).toBeLessThan(Date.now());
  });

  it("opens the session detail sheet when a row is clicked", async () => {
    renderSessions();
    fireEvent.click(await screen.findByText("Fix renderer"));
    expect(await screen.findByRole("dialog", { name: "Fix renderer" })).toBeTruthy();
    await waitFor(() => expect(window.agentResume.previewSession).toHaveBeenCalledWith({
      provider: "codex",
      id: "s1"
    }));
  });

  it("shows the empty state when nothing matches", async () => {
    renderSessions({
      querySessionsPage: async () => ({ sessions: [], total: 0 })
    } as unknown as Partial<typeof window.agentResume>);
    expect(await screen.findByText("No sessions yet")).toBeTruthy();
  });
});
