import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { BoardQuickAccess } from "./BoardQuickAccess";

function renderBoard(overrides?: Partial<typeof window.agentResume>) {
  const host = document.createElement("div");
  host.id = "react-gtd";
  document.body.append(host);
  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        "desktop.gtd.title": "GTD",
        "desktop.gtd.newTask": "New task",
        "desktop.top.settings": "Settings",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.quickAccessCategoryTasks": "Tasks",
        "desktop.workbench.quickAccessCategoryApplication": "Application",
        "desktop.workbench.quickAccessCommandPlaceholder": "Type a command",
        "desktop.workbench.quickAccessFilePlaceholder": "Type a file",
        "desktop.workbench.quickAccessLoading": "Loading",
        "desktop.workbench.quickAccessNoFiles": "No files",
        "desktop.workbench.quickAccessNoCommands": "No commands",
        "desktop.workbench.quickAccessNoProject": "No project",
        "desktop.workbench.quickAccessTruncated": "More results available",
        "desktop.workbench.quickAccessClose": "Close",
        "desktop.workbench.quickAccessDialog": "Quick Access"
      }
    }),
    onLocaleChanged: () => () => undefined,
    notesListTasks: async () => [
      {
        noteId: "t-1", scope: "library", filename: "realtime.md", relDir: "", relMdPath: "realtime.md",
        title: "Realtime status", createdAtMs: 1, updatedAtMs: 5, gtdStatus: "next",
        work: { sessions: [], projects: ["/work/app"] }
      }
    ],
    ensureTaskWorkbench: vi.fn(async () => ({ workbenchId: "wb-1" })),
    listTaskWorkbenches: vi.fn(async () => [
      { workbenchId: "wb-1", taskNoteId: "t-1", name: "", projectPath: "/work/app", position: 0, layoutJson: null, createdAtMs: 1, updatedAtMs: 1 }
    ]),
    taskWindowOpen: vi.fn(async () => ({ ok: true as const, created: true })),
    ...overrides
  } as unknown as typeof window.agentResume;

  render(<I18nProvider><BoardQuickAccess /></I18nProvider>);
  return host;
}

describe("BoardQuickAccess", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("react-gtd")?.remove();
  });

  it("opens on ⌘P and stays closed for a plain key", async () => {
    renderBoard();
    fireEvent.keyDown(window, { key: "p" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(window, { key: "p", metaKey: true });
    expect(await screen.findByRole("dialog", { name: "Quick Access" })).toBeTruthy();
  });

  it("opens the window of the task it runs", async () => {
    renderBoard();
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    const taskRow = await screen.findByText("Realtime status");
    fireEvent.click(taskRow);

    await waitFor(() => expect(window.agentResume.taskWindowOpen).toHaveBeenCalledWith({
      noteId: "t-1",
      workbenchId: "wb-1",
      title: "Realtime status"
    }));
  });

  it("starts a new task through the board event", async () => {
    renderBoard();
    const onNewTask = vi.fn();
    window.addEventListener("agent-resume:gtd-new-task", onNewTask);
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    fireEvent.click(await screen.findByText("New task"));
    await waitFor(() => expect(onNewTask).toHaveBeenCalled());
    window.removeEventListener("agent-resume:gtd-new-task", onNewTask);
  });
});
