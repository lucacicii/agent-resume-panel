import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ArchiveView } from "./ArchiveView";

function archivedRecord(noteId: string, title: string, archivedAtMs: number) {
  return {
    noteId,
    scope: "library",
    filename: `${noteId}.md`,
    relDir: "",
    relMdPath: `${noteId}.md`,
    title,
    createdAtMs: 1,
    updatedAtMs: 2,
    gtdStatus: "done" as const,
    archivedAtMs,
    work: { sessions: [] as string[] }
  };
}

function renderArchive(overrides?: Partial<typeof window.agentResume>) {
  const host = document.createElement("div");
  host.id = "react-archive";
  document.body.append(host);
  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        "desktop.archive.title": "Archive",
        "desktop.archive.search": "Search archive…",
        "desktop.archive.count": "{0} archived",
        "desktop.archive.loading": "Loading…",
        "desktop.archive.empty": "No archived tasks",
        "desktop.archive.emptySearch": "No archived tasks match your search",
        "desktop.archive.unarchive": "Restore to board",
        "desktop.archive.archivedAt": "Archived {0}",
        "desktop.workbench.gtdStatus.inbox": "To do",
        "desktop.workbench.gtdStatus.next": "In progress",
        "desktop.workbench.gtdStatus.waiting": "Waiting",
        "desktop.workbench.gtdStatus.done": "Done"
      }
    }),
    onLocaleChanged: () => () => undefined,
    notesListTasks: async () => [
      archivedRecord("t-arch-1", "Filed first", 100),
      archivedRecord("t-arch-2", "Filed second", 200)
    ],
    notesSetArchived: vi.fn(async () => undefined),
    standaloneNoteOpen: vi.fn(async () => ({ ok: true as const })),
    ...overrides
  } as unknown as typeof window.agentResume;

  render(<I18nProvider><ArchiveView active /></I18nProvider>);
  return host;
}

describe("ArchiveView", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("react-archive")?.remove();
  });

  it("lists only archived tasks", async () => {
    renderArchive({
      notesListTasks: async () => [
        archivedRecord("t-arch-1", "Filed first", 100),
        {
          noteId: "t-live", scope: "library", filename: "live.md", relDir: "", relMdPath: "live.md",
          title: "Still on the board", createdAtMs: 1, updatedAtMs: 9, gtdStatus: "next",
          work: { sessions: [] }
        }
      ]
    } as unknown as Partial<typeof window.agentResume>);

    expect(await screen.findByText("Filed first")).toBeTruthy();
    expect(screen.queryByText("Still on the board")).toBeNull();
  });

  it("restores a task to the board", async () => {
    renderArchive();
    const restoreButtons = await screen.findAllByRole("button", { name: "Restore to board" });
    fireEvent.click(restoreButtons[0]);
    await waitFor(() => expect(window.agentResume.notesSetArchived).toHaveBeenCalledWith({
      noteIds: ["t-arch-2"],
      archived: false
    }));
  });

  it("filters archived tasks by query", async () => {
    renderArchive();
    expect(await screen.findByText("Filed first")).toBeTruthy();
    const search = screen.getByRole("searchbox", { name: "Search archive…" });
    fireEvent.change(search, { target: { value: "second" } });
    await waitFor(() => expect(screen.queryByText("Filed first")).toBeNull());
    expect(screen.getByText("Filed second")).toBeTruthy();
  });

  it("shows the empty state when nothing is archived", async () => {
    renderArchive({
      notesListTasks: async () => [
        {
          noteId: "t-live", scope: "library", filename: "live.md", relDir: "", relMdPath: "live.md",
          title: "Still on the board", createdAtMs: 1, updatedAtMs: 9, gtdStatus: "next",
          work: { sessions: [] }
        }
      ]
    } as unknown as Partial<typeof window.agentResume>);

    expect(await screen.findByText("No archived tasks")).toBeTruthy();
  });
});
