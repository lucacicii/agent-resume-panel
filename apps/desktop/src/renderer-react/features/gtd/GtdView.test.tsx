import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { GtdView } from "./GtdView";

vi.mock("./imageColorCandidates", () => ({
  extractImageColorCandidates: vi.fn(async () => ["#e04040", "#4060e0"])
}));

type ContextMenuArgs = { x: number; y: number; items: Array<{ id?: string; label?: string }> };

/** Stub `contextMenuShow` so a test can "pick" a menu item. */
function contextMenuReturning(id: string | null) {
  return vi.fn(async (_args: ContextMenuArgs) => id);
}

function contextMenuIds(mock: { mock: { calls: Array<[ContextMenuArgs]> } }): Array<string | undefined> {
  return (mock.mock.calls[0]?.[0]?.items ?? []).map((item) => item.id);
}

function renderGtd(overrides?: Partial<typeof window.agentResume>) {  const host = document.createElement("div");
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
        "desktop.gtd.notesPanel": "Notes",
        "desktop.gtd.newLooseNote": "New note",
        "desktop.gtd.noLooseNotes": "No notes",
        "desktop.workbench.deleteTask": "Delete task",
        "desktop.gtd.archiveTask": "Archive",
        "desktop.gtd.archiveAllDone": "Archive all completed tasks",
        "desktop.gtd.archiveAllDoneHint": "Move every completed task to the archive",
        "desktop.gtd.archiveDone": "Archived {0} task(s)",
        "desktop.gtd.archiveFailed": "Archive failed: {0}",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.gtd.windowOpen": "Open in its own window",
        "desktop.gtd.openInWindow": "Open in a new window",
        "desktop.gtd.windowLimit": "At most {0} workbench windows can be open at once",
        "desktop.gtd.windowNoWorkbench": "This task has no workbench to open",
        "desktop.workbench.gtdStatus.inbox": "To do",
        "desktop.workbench.gtdStatus.next": "In progress",
        "desktop.workbench.gtdStatus.waiting": "Waiting",
        "desktop.workbench.gtdStatus.done": "Done",
        "desktop.gtd.templates": "Templates",
        "desktop.gtd.newTemplate": "New template",
        "desktop.gtd.templateTitle": "Template name",
        "desktop.gtd.templateProject": "Project",
        "desktop.gtd.templateColor": "Color",
        "desktop.gtd.templateColorNone": "None",
        "desktop.gtd.templateImage": "Image",
        "desktop.gtd.templatePickImage": "Pick image…",
        "desktop.gtd.templateChangeImage": "Change image…",
        "desktop.gtd.templateRemoveImage": "Remove image",
        "desktop.gtd.templateImageColors": "Colors from image",
        "desktop.gtd.templateImageNoColors": "No vivid colors found in this image.",
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
    notesSetArchived: vi.fn(async () => undefined),
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
    taskWindowList: vi.fn(async () => [] as Array<{ workbenchId: string; noteId: string; title: string }>),
    onTaskWindowsChanged: () => () => undefined,
    standaloneNoteOpen: vi.fn(async () => ({ ok: true as const })),
    taskTemplatesList: async () => [],
    taskTemplatesCreate: vi.fn(async ({ title, projectPaths }: { title: string; projectPaths?: string[] }) => ({ templateId: "tpl-new", title, projectPaths: projectPaths ?? [], createdAtMs: 1, updatedAtMs: 1 })),
    taskTemplatesUpdate: vi.fn(async ({ templateId, title, projectPaths }: { templateId: string; title: string; projectPaths?: string[] }) => ({ templateId, title, projectPaths: projectPaths ?? [], createdAtMs: 1, updatedAtMs: 1 })),
    taskTemplatesDelete: vi.fn(async () => ({ ok: true })),
    taskTemplatesPickImage: vi.fn(async () => ({ ok: false as const, canceled: true })),
    contextMenuShow: vi.fn(async () => null),
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
    // `someday` is no longer a surfaced column: it folds onto "to do".
    const inboxColumn = host.querySelector('[data-gtd-column="inbox"]');
    expect(inboxColumn?.textContent).toContain("Someday idea");
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
    const contextMenuShow = contextMenuReturning("note");
    renderGtd({ contextMenuShow } as unknown as Partial<typeof window.agentResume>);
    fireEvent.contextMenu(await screen.findByRole("button", { name: /Realtime status/ }));
    await waitFor(() => expect(window.agentResume.standaloneNoteOpen).toHaveBeenCalledWith({ noteId: "t-1" }));
    expect(contextMenuIds(contextMenuShow)).toContain("note");
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
    fireEvent.keyDown(nextCard, { key: "ArrowLeft" });
    const inboxCard = await screen.findByRole("button", { name: /Someday idea/ });
    expect(document.activeElement).toBe(inboxCard);
  });

  it("deletes a session-less task from its context menu", async () => {
    const notesDelete = vi.fn(async () => ({ ok: true, deletedNoteIds: ["t-2"] }));
    renderGtd({ notesDelete, contextMenuShow: contextMenuReturning("delete") } as unknown as Partial<typeof window.agentResume>);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const card = await screen.findByRole("button", { name: /Someday idea/ });
    fireEvent.contextMenu(card);

    await waitFor(() => expect(notesDelete).toHaveBeenCalledWith({ noteId: "t-2" }));
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("does not offer delete for a task that has sessions", async () => {
    const contextMenuShow = contextMenuReturning(null);
    renderGtd({ contextMenuShow } as unknown as Partial<typeof window.agentResume>);
    const card = await screen.findByRole("button", { name: /Realtime status/ });
    fireEvent.contextMenu(card);
    await waitFor(() => expect(contextMenuShow).toHaveBeenCalled());
    expect(contextMenuIds(contextMenuShow)).not.toContain("delete");
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
        { templateId: "tpl-1", title: "Write release notes", projectPaths: ["/work/app", "/work/web"], scripts: [], createdAtMs: 1, updatedAtMs: 1 }
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
      status: "next",
      templateId: "tpl-1"
    }));
    // The just-created card opens its inline rename with the template name.
    const renameInput = await screen.findByRole("textbox", { name: "Title" });
    expect((renameInput as HTMLInputElement).value).toBe("Write release notes");
  });

  it("renames a task from its context menu", async () => {
    const notesRenameTask = vi.fn(async () => ({ noteId: "t-1", title: "Renamed", updatedAtMs: 9 }));
    renderGtd({ notesRenameTask, contextMenuShow: contextMenuReturning("rename") } as unknown as Partial<typeof window.agentResume>);

    const card = await screen.findByRole("button", { name: /Realtime status/ });
    fireEvent.contextMenu(card);

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

  it("creates a template with the chosen palette color", async () => {
    const taskTemplatesCreate = vi.fn(async ({ title }: { title: string }) => ({
      templateId: "tpl-color", title, projectPaths: [], colorKey: "purple", createdAtMs: 1, updatedAtMs: 1
    }));
    renderGtd({ taskTemplatesCreate } as unknown as Partial<typeof window.agentResume>);

    fireEvent.click(await screen.findByRole("button", { name: "New template" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Template name" }), { target: { value: "Night build" } });
    fireEvent.click(screen.getByRole("button", { name: "purple" }));
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    await waitFor(() => expect(taskTemplatesCreate).toHaveBeenCalledWith({
      title: "Night build",
      projectPaths: [],
      colorKey: "purple"
    }));
  });

  it("creates a template with an image, defaulting to its recommended color", async () => {
    const taskTemplatesCreate = vi.fn(async ({ title }: { title: string }) => ({
      templateId: "tpl-img", title, projectPaths: [], createdAtMs: 1, updatedAtMs: 1
    }));
    renderGtd({
      taskTemplatesCreate,
      taskTemplatesPickImage: vi.fn(async () => ({ ok: true as const, pngBase64: "aXBo" }))
    } as unknown as Partial<typeof window.agentResume>);

    fireEvent.click(await screen.findByRole("button", { name: "New template" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Template name" }), { target: { value: "Poster task" } });
    fireEvent.click(screen.getByRole("button", { name: "Pick image…" }));

    // The recommended candidate (first) is preselected; another can be picked.
    const recommended = await screen.findByRole("button", { name: "#e04040" });
    expect(recommended.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "#4060e0" }));

    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    await waitFor(() => expect(taskTemplatesCreate).toHaveBeenCalledWith({
      title: "Poster task",
      projectPaths: [],
      customColor: "#4060e0",
      image: { pngBase64: "aXBo", colors: ["#e04040", "#4060e0"] }
    }));
  });

  it("keeps a stored template image untouched when only the title changes", async () => {
    const taskTemplatesUpdate = vi.fn(async ({ templateId, title }: { templateId: string; title: string }) => ({
      templateId, title, projectPaths: [], createdAtMs: 1, updatedAtMs: 1
    }));
    renderGtd({
      taskTemplatesUpdate,
      contextMenuShow: contextMenuReturning("edit"),
      taskTemplatesList: async () => [{
        templateId: "tpl-img",
        title: "Poster task",
        projectPaths: [],
        customColor: "#e04040",
        imageColors: ["#e04040", "#4060e0"],
        imageDataUrl: "data:image/png;base64,aXBo",
        scripts: [],
        createdAtMs: 1,
        updatedAtMs: 1
      }]
    } as unknown as Partial<typeof window.agentResume>);

    const item = await screen.findByText("Poster task").then((el) => el.closest(".gtd-template-item"));
    fireEvent.contextMenu(item!);
    const titleInput = await screen.findByRole("textbox", { name: "Template name" });
    expect((titleInput as HTMLInputElement).value).toBe("Poster task");
    fireEvent.change(titleInput, { target: { value: "Poster task v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(taskTemplatesUpdate).toHaveBeenCalled());
    const args = (taskTemplatesUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(args.title).toBe("Poster task v2");
    expect(args.customColor).toBe("#e04040");
    // No image key: the stored image is kept as-is.
    expect("image" in args).toBe(false);
  });

  it("paints a card's accent bar from the task's template color", async () => {
    renderGtd({
      notesListTasks: async () => [{
        noteId: "t-blue", title: "Blue task", filename: "t-blue.md", relDir: "", relMdPath: "", scope: "library",
        createdAtMs: 1, updatedAtMs: 1, work: { sessions: [], projects: [] },
        accent: { colorKey: "blue", shade: 2 }
      }]
    } as unknown as Partial<typeof window.agentResume>);

    const card = await screen.findByText("Blue task").then((el) => el.closest(".gtd-card"));
    expect(card?.getAttribute("data-task-accent")).toBe("blue");
    expect(card?.getAttribute("data-task-shade")).toBe("2");
  });

  it("paints a custom accent card from the hue of an image-derived color", async () => {
    renderGtd({
      notesListTasks: async () => [{
        noteId: "t-custom", title: "Custom task", filename: "t-custom.md", relDir: "", relMdPath: "", scope: "library",
        createdAtMs: 1, updatedAtMs: 1, work: { sessions: [], projects: [] },
        accent: { customColor: "#e04040", shade: 1 }
      }]
    } as unknown as Partial<typeof window.agentResume>);

    const card = await screen.findByText("Custom task").then((el) => el.closest(".gtd-card"));
    expect(card?.getAttribute("data-task-accent")).toBe("custom");
    expect(card?.getAttribute("data-task-shade")).toBe("1");
    // Hue of #e04040 ≈ 0 (red) injected as an inline custom property.
    expect((card as HTMLElement).style.getPropertyValue("--task-h")).toBe("0");
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
  it("marks the tasks whose workbench is open in a window", async () => {
    renderGtd({
      taskWindowList: vi.fn(async () => [{ workbenchId: "wb-1", noteId: "t-1", title: "Realtime status" }])
    } as unknown as Partial<typeof window.agentResume>);

    const card = await screen.findByRole("button", { name: /Realtime status/ });
    await waitFor(() => expect(card.querySelector(".gtd-card-window")).toBeTruthy());
    // A task without a window carries no badge.
    expect(screen.getByRole("button", { name: /Someday idea/ }).querySelector(".gtd-card-window")).toBeNull();
  });

  it("shows one live status per workbench chip", async () => {
    renderGtd({
      listAllTaskWorkbenches: async () => [
        { workbenchId: "wb-1", taskNoteId: "t-1", name: "Backend", projectPath: "/work/api", position: 0, layoutJson: null, createdAtMs: 1, updatedAtMs: 1 },
        { workbenchId: "wb-2", taskNoteId: "t-1", name: "Frontend", projectPath: "/work/web", position: 1, layoutJson: null, createdAtMs: 1, updatedAtMs: 1 }
      ],
      getWorkbenchActiveSessions: async () => [
        { paneKey: "terminal:1", projectPath: "/work/api", title: "agent", sessionKey: "codex:s1", status: "awaiting_user", workbenchId: "wb-1" },
        { paneKey: "terminal:2", projectPath: "/work/web", title: "agent", sessionKey: "codex:s2", status: "running", workbenchId: "wb-2" }
      ]
    } as unknown as Partial<typeof window.agentResume>);

    const backend = await screen.findByRole("button", { name: /Backend/ });
    await waitFor(() => expect(backend.querySelector(".session-dot.is-awaiting")).toBeTruthy());
    const frontend = screen.getByRole("button", { name: /Frontend/ });
    expect(frontend.querySelector(".session-dot.is-running")).toBeTruthy();
    // The card-level dot is the most urgent workbench.
    expect(document.querySelector('[data-gtd-note-id="t-1"]')?.querySelector(".session-dot.is-awaiting")).toBeTruthy();
  });

  it("opens the task window when the window badge is clicked", async () => {
    renderGtd({
      taskWindowList: vi.fn(async () => [{ workbenchId: "wb-1", noteId: "t-1", title: "Realtime status" }])
    } as unknown as Partial<typeof window.agentResume>);

    const card = await screen.findByRole("button", { name: /Realtime status/ });
    await waitFor(() => expect(card.querySelector(".gtd-card-window")).toBeTruthy());
    fireEvent.click(card.querySelector(".gtd-card-window")!);
    await waitFor(() => expect(window.agentResume.taskWindowOpen).toHaveBeenCalledWith({
      noteId: "t-1",
      workbenchId: "wb-1",
      title: "Realtime status"
    }));
  });

  it("lists the task template's scripts as commands and opens the task running one", async () => {
    const contextMenuShow = vi.fn(async (_args: ContextMenuArgs) => "script:sc-1");
    renderGtd({
      contextMenuShow,
      notesListTasks: async () => [
        {
          noteId: "t-9", scope: "library", projectPath: undefined,
          filename: "deploy.md", relDir: "", relMdPath: "deploy.md",
          title: "Deploy check", createdAtMs: 1, updatedAtMs: 5, gtdStatus: "inbox",
          work: { sessions: [] }, templateId: "tpl-9"
        }
      ],
      taskTemplatesList: async () => [{
        templateId: "tpl-9", title: "Deploy", projectPaths: [],
        scripts: [
          { id: "sc-1", name: "dev", command: "pnpm dev", cwd: "/work/app" },
          { id: "sc-2", name: "build", command: "pnpm build", cwd: "/work/app" }
        ],
        createdAtMs: 1, updatedAtMs: 1
      }]
    } as unknown as Partial<typeof window.agentResume>);

    fireEvent.contextMenu(await screen.findByRole("button", { name: /Deploy check/ }));
    await waitFor(() => expect(contextMenuShow).toHaveBeenCalled());
    const items = contextMenuShow.mock.calls[0]?.[0]?.items ?? [];
    // The command text itself is the label, so one click is one instruction.
    expect(items.find((item) => item.id === "script:sc-1")?.label).toBe("pnpm dev");
    expect(items.find((item) => item.id === "script:sc-2")?.label).toBe("pnpm build");
    await waitFor(() => expect(window.agentResume.taskWindowOpen).toHaveBeenCalledWith({
      noteId: "t-9",
      workbenchId: "wb-1",
      title: "Deploy check",
      runScript: { name: "dev", command: "pnpm dev", cwd: "/work/app" }
    }));
  });

  it("keeps script entries out of the card menu for unlinked tasks", async () => {
    const contextMenuShow = vi.fn(async (_args: ContextMenuArgs) => null);
    const taskTemplatesList = vi.fn(async () => []);
    renderGtd({ contextMenuShow, taskTemplatesList } as unknown as Partial<typeof window.agentResume>);

    fireEvent.contextMenu(await screen.findByRole("button", { name: /Realtime status/ }));
    await waitFor(() => expect(contextMenuShow).toHaveBeenCalled());
    const ids = contextMenuShow.mock.calls[0]?.[0]?.items ?? [];
    expect(ids.some((item) => item.id?.startsWith("script:"))).toBe(false);
  });

  it("keeps archived tasks off the board", async () => {
    renderGtd({
      notesListTasks: async () => [
        {
          noteId: "t-arch", scope: "library", filename: "filed.md", relDir: "", relMdPath: "filed.md",
          title: "Filed away", createdAtMs: 1, updatedAtMs: 9, gtdStatus: "done",
          archivedAtMs: 123,
          work: { sessions: [] }
        },
        {
          noteId: "t-1", scope: "library", filename: "live.md", relDir: "", relMdPath: "live.md",
          title: "Still active", createdAtMs: 1, updatedAtMs: 5, gtdStatus: "next",
          work: { sessions: [] }
        }
      ]
    } as unknown as Partial<typeof window.agentResume>);

    expect(await screen.findByText("Still active")).toBeTruthy();
    expect(screen.queryByText("Filed away")).toBeNull();
  });

  it("archives a task from its context menu", async () => {
    renderGtd({ contextMenuShow: contextMenuReturning("archive") } as unknown as Partial<typeof window.agentResume>);
    fireEvent.contextMenu(await screen.findByRole("button", { name: /Realtime status/ }));
    await waitFor(() => expect(window.agentResume.notesSetArchived).toHaveBeenCalledWith({
      noteIds: ["t-1"],
      archived: true
    }));
  });

  it("archives the whole done column from its header button", async () => {
    renderGtd({
      notesListTasks: async () => [
        {
          noteId: "t-done-1", scope: "library", filename: "a.md", relDir: "", relMdPath: "a.md",
          title: "Done one", createdAtMs: 1, updatedAtMs: 7, gtdStatus: "done", work: { sessions: [] }
        },
        {
          noteId: "t-done-2", scope: "library", filename: "b.md", relDir: "", relMdPath: "b.md",
          title: "Done two", createdAtMs: 1, updatedAtMs: 6, gtdStatus: "done", work: { sessions: [] }
        }
      ]
    } as unknown as Partial<typeof window.agentResume>);

    fireEvent.click(await screen.findByRole("button", { name: "Archive all completed tasks" }));
    await waitFor(() => expect(window.agentResume.notesSetArchived).toHaveBeenCalled());
    const args = (window.agentResume.notesSetArchived as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      noteIds: string[];
      archived: boolean;
    };
    expect(args.archived).toBe(true);
    expect([...args.noteIds].sort()).toEqual(["t-done-1", "t-done-2"]);
  });
});
