import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { NotesView } from "./NotesView";

vi.mock("../workbench/notes/NotePaneView", () => ({
  NotePaneView: ({ noteId, active, onOpenNote }: {
    noteId: string;
    active: boolean;
    onOpenNote: (noteId: string) => void;
  }) => (
    <div data-testid="note-pane" data-note-id={noteId} data-active={String(active)}>
      <button type="button" onClick={() => onOpenNote("child-1")}>open-child</button>
    </div>
  )
}));

const messages = {
  "desktop.common.loading": "Loading…",
  "desktop.notes.selectOrCreate": "Select or create a note",
  "desktop.notes.viewSearch": "Search notes…",
  "desktop.notes.segmentTasks": "Tasks",
  "desktop.notes.segmentLibrary": "Notes",
  "desktop.notes.segmentLabel": "Tasks and notes library",
  "desktop.notes.segmentTasksEmpty": "No tasks yet",
  "desktop.notes.segmentLibraryEmpty": "No notes here yet",
  "desktop.notes.viewImport": "Import notes…",
  "desktop.notes.sectionResults": "Results",
  "desktop.notes.sectionTasks": "Tasks",
  "desktop.notes.sectionProjects": "Project notes",
  "desktop.notes.sectionLibrary": "Library",
  "desktop.notes.viewEmptyTitle": "No notes yet",
  "desktop.notes.viewEmptyHint": "Create your first note to get started.",
  "desktop.notes.viewEmptySearch": "No notes match your search.",
  "desktop.workbench.newNote": "New note"
};

type TestRoot = {
  noteId: string;
  scope: string;
  filename: string;
  relDir: string;
  relMdPath: string;
  title?: string;
  createdAtMs: number;
  updatedAtMs: number;
  projectPath?: string;
  work?: { sessions: string[] };
};

const roots: TestRoot[] = [
  {
    noteId: "t-1", scope: "project", projectPath: "/work/app", filename: "task.md", relDir: "",
    relMdPath: "task.md", title: "Ship the release", createdAtMs: 1, updatedAtMs: 5,
    work: { sessions: [] }
  },
  {
    noteId: "p-1", scope: "project", projectPath: "/work/app", filename: "project.md", relDir: "",
    relMdPath: "project.md", title: "App journal", createdAtMs: 1, updatedAtMs: 4
  },
  {
    noteId: "l-1", scope: "library", filename: "scratch.md", relDir: "library",
    relMdPath: "library/scratch.md", title: "Scratch pad", createdAtMs: 1, updatedAtMs: 3
  }
];

function renderNotes(overrides: Partial<typeof window.agentResume> = {}) {
  const host = document.createElement("div");
  host.id = "react-notes";
  document.body.append(host);
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages }),
    onLocaleChanged: () => () => undefined,
    notesListRoot: async () => roots,
    notesList: async () => [
      ...roots,
      {
        noteId: "child-1", scope: "project", projectPath: "/work/app", filename: "child.md",
        relDir: "", relMdPath: "child.md", title: "Release checklist", contentPreview: "",
        createdAtMs: 1, updatedAtMs: 2
      }
    ],
    notesListChildCounts: async () => ({ "t-1": 3 }),
    notesCreate: vi.fn(async () => ({ noteId: "n-new", filename: "2026-01-01-01.md" })),
    notesImport: vi.fn(async () => ({ imported: 0, skipped: 0, errors: [] })),
    ...overrides
  } as unknown as typeof window.agentResume;

  render(
    <I18nProvider>
      <NotesView active />
    </I18nProvider>
  );
  return host;
}

describe("NotesView", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("react-notes")?.remove();
  });

  it("filters roots by segment and auto-selects the first of each", async () => {
    renderNotes();

    // Default segment is tasks: task row visible, project/library rows hidden.
    const tasksTab = await screen.findByRole("tab", { name: "Tasks" });
    expect(tasksTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Ship the release")).toBeTruthy();
    expect(screen.queryByText("App journal")).toBeNull();
    expect(screen.queryByText("Scratch pad")).toBeNull();
    // Child count badge on the task root.
    expect(screen.getByText("3")).toBeTruthy();

    const pane = await screen.findByTestId("note-pane");
    expect(pane.getAttribute("data-note-id")).toBe("t-1");
    expect(pane.getAttribute("data-active")).toBe("true");

    // Switching to the notes library reveals project + library notes and reselects.
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    await waitFor(() => expect(screen.getByText("Project notes")).toBeTruthy());
    expect(screen.getByText("App journal")).toBeTruthy();
    expect(screen.getByText("Scratch pad")).toBeTruthy();
    expect(screen.queryByText("Ship the release")).toBeNull();
    expect(screen.getByTestId("note-pane").getAttribute("data-note-id")).toBe("p-1");
  });

  it("selects another note on row click", async () => {
    renderNotes();
    fireEvent.click(await screen.findByRole("tab", { name: "Notes" }));
    fireEvent.click(await screen.findByText("Scratch pad"));
    const pane = await waitFor(() => {
      const node = screen.getByTestId("note-pane");
      expect(node.getAttribute("data-note-id")).toBe("l-1");
      return node;
    });
    expect(pane).toBeTruthy();
  });

  it("follows onOpenNote from the editor pane", async () => {
    renderNotes();
    await screen.findByTestId("note-pane");
    fireEvent.click(screen.getByText("open-child"));
    await waitFor(() =>
      expect(screen.getByTestId("note-pane").getAttribute("data-note-id")).toBe("child-1"));
  });

  it("searches the whole index once a query is typed", async () => {
    renderNotes();
    await screen.findByRole("tab", { name: "Tasks" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search notes…" }), { target: { value: "checklist" } });

    await waitFor(() => expect(screen.getByText("Results")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Release checklist")).toBeTruthy());
    expect(screen.queryByRole("tab", { name: "Tasks" })).toBeNull();
  });

  it("shows the empty search state when nothing matches", async () => {
    renderNotes();
    await screen.findByRole("tab", { name: "Tasks" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search notes…" }), { target: { value: "zzz-nothing" } });

    await waitFor(() => expect(screen.getByText("No notes match your search.")).toBeTruthy());
  });

  it("creates a note and selects it", async () => {
    renderNotes();
    fireEvent.click(await screen.findByRole("button", { name: "New note" }));

    await waitFor(() => expect(window.agentResume.notesCreate).toHaveBeenCalledWith({ scope: "library" }));
    await waitFor(() =>
      expect(screen.getByTestId("note-pane").getAttribute("data-note-id")).toBe("n-new"));
  });

  it("shows a segment-specific empty state when the segment has no notes", async () => {
    renderNotes({ notesListRoot: async () => [roots[2]], notesList: async () => [roots[2]] });

    expect(await screen.findByText("No tasks yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    await waitFor(() => expect(screen.getByText("Scratch pad")).toBeTruthy());
  });

  it("shows the empty state when there are no notes", async () => {
    renderNotes({
      notesListRoot: async () => [],
      notesList: async () => [],
      notesListChildCounts: async () => ({})
    });
    expect(await screen.findByText("No notes yet")).toBeTruthy();
    expect(screen.getByText("Create your first note to get started.")).toBeTruthy();
    expect(screen.getByText("Select or create a note")).toBeTruthy();
    expect(screen.queryByTestId("note-pane")).toBeNull();
  });
});
