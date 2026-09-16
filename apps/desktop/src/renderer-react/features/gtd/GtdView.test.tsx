import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { GtdView } from "./GtdView";

function renderGtd(overrides?: Partial<typeof window.agentResume>) {
  const host = document.createElement("div");
  host.id = "react-gtd";
  document.body.append(host);
  const header = document.createElement("div");
  header.id = "app-header-slot";
  document.body.append(header);
  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        "desktop.gtd.title": "GTD",
        "desktop.gtd.filter": "Filter tasks",
        "desktop.gtd.newTask": "New task",
        "desktop.gtd.emptyColumn": "Nothing here",
        "desktop.gtd.createTask": "Create",
        "desktop.gtd.taskTitle": "Title",
        "desktop.gtd.taskProject": "Project",
        "desktop.gtd.chooseProject": "Choose folder…",
        "desktop.gtd.taskTitleRequired": "Title is required",
        "desktop.common.cancel": "Cancel",
        "desktop.common.close": "Close",
        "desktop.gtd.backToGtd": "Back to GTD",
        "desktop.gtd.notesPanel": "Notes",
        "desktop.gtd.newLooseNote": "New note",
        "desktop.gtd.noLooseNotes": "No notes",
        "desktop.workbench.deleteWorkItem": "Delete task",
        "desktop.workbench.workItemOpenNote": "Open note",
        "desktop.workbench.gtdStatus.inbox": "Inbox",
        "desktop.workbench.gtdStatus.next": "Next",
        "desktop.workbench.gtdStatus.waiting": "Waiting",
        "desktop.workbench.gtdStatus.someday": "Someday",
        "desktop.workbench.gtdStatus.reference": "Reference",
        "desktop.workbench.gtdStatus.done": "Done"
      }
    }),
    onLocaleChanged: () => () => undefined,
    notesListWorkItems: async () => [
      {
        noteId: "t-1", scope: "project", projectPath: "/work/app",
        filename: "realtime.md", relDir: "", relMdPath: "realtime.md",
        title: "Realtime status", createdAtMs: 1, updatedAtMs: 5, gtdStatus: "next",
        work: { next: "Wire the rollup", sessions: ["codex:s1"], projects: ["/work/app"], primaryProject: "/work/app" }
      },
      {
        noteId: "t-2", scope: "library",
        filename: "someday.md", relDir: "", relMdPath: "someday.md",
        title: "Someday idea", createdAtMs: 1, updatedAtMs: 2, gtdStatus: "someday",
        work: { sessions: [] }
      }
    ],
    notesSetGtdStatus: vi.fn(async () => ({ ok: true })),
    notesCreateWorkItem: vi.fn(async () => ({
      noteId: "t-3", scope: "library", filename: "new.md", relDir: "", relMdPath: "new.md",
      title: "New task", createdAtMs: 3, updatedAtMs: 3, gtdStatus: "inbox", work: { sessions: [] }
    })),
    ...overrides
  } as unknown as typeof window.agentResume;

  render(<I18nProvider><GtdView active /></I18nProvider>);
  return host;
}

describe("GtdView", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("react-gtd")?.remove();
    document.getElementById("app-header-slot")?.remove();
  });

  it("renders tasks in their GTD columns", async () => {
    const host = renderGtd();
    expect(await screen.findByText("Realtime status")).toBeTruthy();
    expect(screen.getByText("Someday idea")).toBeTruthy();
    const nextColumn = host.querySelector('[data-gtd-column="next"]');
    expect(nextColumn?.textContent).toContain("Realtime status");
    const somedayColumn = host.querySelector('[data-gtd-column="someday"]');
    expect(somedayColumn?.textContent).toContain("Someday idea");
  });

  it("opens a task in the workbench when its card is clicked", async () => {
    renderGtd();
    const listener = vi.fn();
    window.addEventListener("agent-resume:view-open-task", listener);
    fireEvent.click(await screen.findByRole("button", { name: /Realtime status/ }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ noteId: "t-1", title: "Realtime status", openNote: true })
    }));
    window.removeEventListener("agent-resume:view-open-task", listener);
  });

  it("offers Open note in the card context menu", async () => {
    renderGtd();
    const listener = vi.fn();
    window.addEventListener("agent-resume:view-open-task", listener);
    fireEvent.contextMenu(await screen.findByRole("button", { name: /Realtime status/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open note" }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ noteId: "t-1", openNote: true })
    }));
    window.removeEventListener("agent-resume:view-open-task", listener);
  });

  it("moves a task between columns on drop by setting its GTD status", async () => {
    const host = renderGtd();
    const card = await screen.findByRole("button", { name: /Realtime status/ });
    const waitingColumn = host.querySelector('[data-gtd-column="waiting"]')!;
    const dataTransfer = { setData: vi.fn(), getData: () => "t-1", dropEffect: "", effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(waitingColumn, { dataTransfer });
    fireEvent.drop(waitingColumn, { dataTransfer });
    await waitFor(() => expect(window.agentResume.notesSetGtdStatus).toHaveBeenCalledWith({ noteId: "t-1", status: "waiting" }));
  });

  it("creates a task from the toolbar dialog", async () => {
    renderGtd();
    fireEvent.click(await screen.findByRole("button", { name: "New task" }));
    const titleInput = await screen.findByRole("textbox", { name: "Title" });
    fireEvent.change(titleInput, { target: { value: "Ship the redesign" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(window.agentResume.notesCreateWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      title: "Ship the redesign"
    })));
  });

  it("picks a folder via the dialog and binds it to the new task without registering a project", async () => {
    const pickDirectory = vi.fn(async () => ({ ok: true as const, path: "/work/app" }));
    const host = renderGtd({ pickDirectory } as unknown as Partial<typeof window.agentResume>);
    fireEvent.click(await screen.findByRole("button", { name: "New task" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Title" }), { target: { value: "With project" } });
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    await waitFor(() => expect(pickDirectory).toHaveBeenCalledWith({ title: "Project" }));
    await waitFor(() => expect(host.querySelector(".gtd-new-task-project-path")?.textContent).toContain("app"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(window.agentResume.notesCreateWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      title: "With project",
      projects: ["/work/app"],
      primaryProject: "/work/app"
    })));
  });

  it("filters cards by query", async () => {
    const host = renderGtd();
    const search = await screen.findByRole("searchbox", { name: "Filter tasks" });
    await act(async () => fireEvent.change(search, { target: { value: "someday" } }));
    await waitFor(() => expect(host.textContent).not.toContain("Realtime status"));
    expect(host.textContent).toContain("Someday idea");
  });

  it("shows a task's workbenches and deep-links a chip to its workbench", async () => {
    renderGtd({
      listAllTaskWorkbenches: async () => [
        { workbenchId: "wb-1", taskNoteId: "t-1", name: "Backend", projectPath: "/work/api", position: 0, layoutJson: null, createdAtMs: 1, updatedAtMs: 1 },
        { workbenchId: "wb-2", taskNoteId: "t-1", name: "Frontend", projectPath: "/work/web", position: 1, layoutJson: null, createdAtMs: 1, updatedAtMs: 1 }
      ]
    } as unknown as Partial<typeof window.agentResume>);
    const chip = await screen.findByRole("button", { name: "Frontend" });
    const listener = vi.fn();
    window.addEventListener("agent-resume:view-open-task", listener);
    fireEvent.click(chip);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ noteId: "t-1", workbenchId: "wb-2" })
    }));
    window.removeEventListener("agent-resume:view-open-task", listener);
  });

  it("navigates cards with arrow keys", async () => {
    renderGtd();
    const nextCard = await screen.findByRole("button", { name: /Realtime status/ });
    nextCard.focus();
    expect(document.activeElement).toBe(nextCard);
    fireEvent.keyDown(nextCard, { key: "ArrowRight" });
    const somedayCard = await screen.findByRole("button", { name: /Someday idea/ });
    expect(document.activeElement).toBe(somedayCard);
  });

  it("deletes a session-less task from its context menu", async () => {
    const notesDelete = vi.fn(async () => ({ ok: true, deletedNoteIds: ["t-2"] }));
    renderGtd({ notesDelete } as unknown as Partial<typeof window.agentResume>);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const card = await screen.findByRole("button", { name: /Someday idea/ });
    fireEvent.contextMenu(card);
    const del = await screen.findByRole("menuitem", { name: "Delete task" });
    fireEvent.click(del);

    await waitFor(() => expect(notesDelete).toHaveBeenCalledWith({ noteId: "t-2" }));
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("does not offer delete for a task that has sessions", async () => {
    renderGtd();
    const card = await screen.findByRole("button", { name: /Realtime status/ });
    fireEvent.contextMenu(card);
    expect(screen.queryByRole("menuitem", { name: "Delete task" })).toBeNull();
  });
});
