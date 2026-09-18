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
        "desktop.workbench.deleteTask": "Delete task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.gtdStatus.inbox": "Inbox",
        "desktop.workbench.gtdStatus.next": "Next",
        "desktop.workbench.gtdStatus.waiting": "Waiting",
        "desktop.workbench.gtdStatus.someday": "Someday",
        "desktop.workbench.gtdStatus.reference": "Reference",
        "desktop.workbench.gtdStatus.done": "Done",
        "desktop.gtd.templates": "Templates",
        "desktop.gtd.newTemplate": "New template",
        "desktop.gtd.templateTitle": "Template name",
        "desktop.gtd.templateProject": "Project",
        "desktop.gtd.emptyTemplates": "No templates",
        "desktop.gtd.createTemplate": "Create template",
        "desktop.gtd.editTemplate": "Edit template",
        "desktop.gtd.deleteTemplate": "Delete template",
        "desktop.gtd.deleteTemplateConfirm": "Delete template \"{0}\"?",
        "desktop.common.rename": "Rename",
        "desktop.common.save": "Save"
      }
    }),
    onLocaleChanged: () => () => undefined,
    notesListTasks: async () => [
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
    notesCreateTask: vi.fn(async () => ({
      noteId: "t-3", scope: "library", filename: "new.md", relDir: "", relMdPath: "new.md",
      title: "New task", createdAtMs: 3, updatedAtMs: 3, gtdStatus: "inbox", work: { sessions: [] }
    })),
    notesRenameTask: vi.fn(async ({ noteId, title }: { noteId: string; title: string }) => ({ noteId, title, updatedAtMs: 9 })),
    listAllTaskWorkbenches: async () => [],
    ensureTaskWorkbench: vi.fn(async () => ({ workbenchId: "wb-1" })),
    listTaskWorkbenches: vi.fn(async () => [
      { workbenchId: "wb-1", taskNoteId: "t-1", name: "", projectPath: "/work/app", position: 0, layoutJson: null, createdAtMs: 1, updatedAtMs: 1 }
    ]),
    taskWindowOpen: vi.fn(async () => ({ ok: true as const, created: true })),
    standaloneNoteOpen: vi.fn(async () => ({ ok: true as const })),
    taskTemplatesList: async () => [],
    taskTemplatesCreate: vi.fn(async ({ title, projectPaths }: { title: string; projectPaths?: string[] }) => ({ templateId: "tpl-new", title, projectPaths: projectPaths ?? [], createdAtMs: 1, updatedAtMs: 1 })),
    taskTemplatesUpdate: vi.fn(async ({ templateId, title, projectPaths }: { templateId: string; title: string; projectPaths?: string[] }) => ({ templateId, title, projectPaths: projectPaths ?? [], createdAtMs: 1, updatedAtMs: 1 })),
    taskTemplatesDelete: vi.fn(async () => ({ ok: true })),
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

  it("opens a task in its own workbench window when its card is clicked", async () => {
    renderGtd();
    fireEvent.click(await screen.findByRole("button", { name: /Realtime status/ }));
    await waitFor(() => expect(window.agentResume.taskWindowOpen).toHaveBeenCalledWith({
      noteId: "t-1",
      workbenchId: "wb-1",
      title: "Realtime status"
    }));
  });

  it("opens the task note in a floating note window", async () => {
    renderGtd();
    fireEvent.contextMenu(await screen.findByRole("button", { name: /Realtime status/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open note" }));
    await waitFor(() => expect(window.agentResume.standaloneNoteOpen).toHaveBeenCalledWith({ noteId: "t-1" }));
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
    await waitFor(() => expect(window.agentResume.notesCreateTask).toHaveBeenCalledWith(expect.objectContaining({
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
    await waitFor(() => expect(window.agentResume.notesCreateTask).toHaveBeenCalledWith(expect.objectContaining({
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
    fireEvent.click(chip);
    await waitFor(() => expect(window.agentResume.taskWindowOpen).toHaveBeenCalledWith({
      noteId: "t-1",
      workbenchId: "wb-2",
      title: "Realtime status"
    }));
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

  it("creates a pre-filled task by dropping a template onto a column", async () => {
    let created = false;
    const notesCreateTask = vi.fn(async () => {
      created = true;
      return {
        noteId: "t-9", scope: "library", filename: "tpl.md", relDir: "", relMdPath: "tpl.md",
        title: "Write release notes", createdAtMs: 9, updatedAtMs: 9, gtdStatus: "next",
        work: { projects: ["/work/app"], primaryProject: "/work/app", sessions: [] }
      };
    });
    const notesListTasks = async (): Promise<Array<Record<string, unknown>>> => {
      const base: Array<Record<string, unknown>> = [
        {
          noteId: "t-1", scope: "project", projectPath: "/work/app",
          filename: "realtime.md", relDir: "", relMdPath: "realtime.md",
          title: "Realtime status", createdAtMs: 1, updatedAtMs: 5, gtdStatus: "next",
          work: { next: "Wire the rollup", sessions: ["codex:s1"], projects: ["/work/app"], primaryProject: "/work/app" }
        }
      ];
      if (created) {
        base.unshift({
          noteId: "t-9", scope: "library", filename: "tpl.md", relDir: "", relMdPath: "tpl.md",
          title: "Write release notes", createdAtMs: 9, updatedAtMs: 9, gtdStatus: "next",
          work: { projects: ["/work/app"], primaryProject: "/work/app", sessions: [] }
        });
      }
      return base;
    };
    const host = renderGtd({
      notesCreateTask,
      notesListTasks,
      taskTemplatesList: async () => [
        { templateId: "tpl-1", title: "Write release notes", projectPaths: ["/work/app", "/work/web"], createdAtMs: 1, updatedAtMs: 1 }
      ]
    } as unknown as Partial<typeof window.agentResume>);

    const templateTitle = await screen.findByText("Write release notes");
    const nextColumn = host.querySelector('[data-gtd-column="next"]')!;
    const dataTransfer = { setData: vi.fn(), getData: () => "", dropEffect: "", effectAllowed: "" };
    fireEvent.dragStart(templateTitle.closest(".gtd-template-item")!, { dataTransfer });
    fireEvent.dragOver(nextColumn, { dataTransfer });
    fireEvent.drop(nextColumn, { dataTransfer });

    await waitFor(() => expect(notesCreateTask).toHaveBeenCalledWith({
      title: "Write release notes",
      projects: ["/work/app", "/work/web"],
      primaryProject: "/work/app",
      status: "next"
    }));
    // The just-created card opens its inline rename with the template name.
    const renameInput = await screen.findByRole("textbox", { name: "Title" });
    expect((renameInput as HTMLInputElement).value).toBe("Write release notes");
  });

  it("renames a task from its context menu", async () => {
    const notesRenameTask = vi.fn(async () => ({ noteId: "t-1", title: "Renamed", updatedAtMs: 9 }));
    renderGtd({ notesRenameTask } as unknown as Partial<typeof window.agentResume>);

    const card = await screen.findByRole("button", { name: /Realtime status/ });
    fireEvent.contextMenu(card);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    const input = await screen.findByRole("textbox", { name: "Title" });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(notesRenameTask).toHaveBeenCalledWith({ noteId: "t-1", title: "Renamed" }));
  });

  it("adds a template from the library panel", async () => {
    const taskTemplatesCreate = vi.fn(async ({ title, projectPaths }: { title: string; projectPaths?: string[] }) => ({
      templateId: "tpl-2", title, projectPaths: projectPaths ?? [], createdAtMs: 1, updatedAtMs: 1
    }));
    renderGtd({ taskTemplatesCreate } as unknown as Partial<typeof window.agentResume>);

    fireEvent.click(await screen.findByRole("button", { name: "New template" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Template name" }), { target: { value: "Daily standup" } });
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    await waitFor(() => expect(taskTemplatesCreate).toHaveBeenCalledWith({ title: "Daily standup", projectPaths: [] }));
  });

  it("collects several projects for one template", async () => {
    const taskTemplatesCreate = vi.fn(async ({ title, projectPaths }: { title: string; projectPaths?: string[] }) => ({
      templateId: "tpl-3", title, projectPaths: projectPaths ?? [], createdAtMs: 1, updatedAtMs: 1
    }));
    const pickDirectory = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, path: "/work/app" })
      .mockResolvedValueOnce({ ok: true as const, path: "/work/web" });
    renderGtd({ taskTemplatesCreate, pickDirectory } as unknown as Partial<typeof window.agentResume>);

    fireEvent.click(await screen.findByRole("button", { name: "New template" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Template name" }), { target: { value: "Ship feature" } });

    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    await waitFor(() => expect(screen.getByText("app")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    await waitFor(() => expect(screen.getByText("web")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    await waitFor(() => expect(taskTemplatesCreate).toHaveBeenCalledWith({
      title: "Ship feature",
      projectPaths: ["/work/app", "/work/web"]
    }));
  });
});
