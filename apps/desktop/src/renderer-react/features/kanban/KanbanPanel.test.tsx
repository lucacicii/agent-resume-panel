import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, GtdStatus } from "@agent-resume/core";
import { I18nProvider } from "../../i18n";
import { KanbanPanel } from "./KanbanPanel";

vi.mock("../../components/CodeEditor", () => ({
  CodeEditor: forwardRef(({ value, onChange, ariaLabel }: { value: string; onChange: (value: string) => void; ariaLabel: string }, ref) => {
    useImperativeHandle(ref, () => ({ focus: vi.fn() }));
    return <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />;
  })
}));

type TestNote = {
  noteId: string;
  scope: "library" | "project" | "session";
  provider?: string;
  agentSessionId?: string;
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
  workbenchOpenSession?: (args: { provider: string; id: string }) => Promise<{
    external?: boolean;
    mode?: string;
    command?: string;
    cwd?: string;
  }>;
} = {}) {
  const setSessionGtdStatus = vi.fn(async () => ({ ok: true }));
  const notesSetGtdStatus = vi.fn(async ({ noteId, status }: { noteId: string; status: GtdStatus | null }) => ({ ...note, noteId, gtdStatus: status || undefined }));
  const notesCreate = vi.fn(async () => ({ noteId: "created-kanban", filename: "2026-08-06-01.md" }));
  const notesWrite = vi.fn(async ({ noteId, content }: { noteId: string; content: string }) => ({ noteId, filename: "plan.md", content, updatedAtMs: Date.now() }));
  const notesDelete = vi.fn(async ({ noteId }: { noteId: string }) => ({ ok: true, deletedNoteIds: [noteId] }));
  const notesListChildCounts = vi.fn(async () => ({} as Record<string, number>));
  const notesResumeSession = vi.fn(async ({ sessionId }: { sessionId: string }) => ({
    ok: true,
    command: `codex resume ${sessionId}`,
    cwd: "/work/agent-resume-panel",
    mode: "xterm"
  }));
  const notes = options.notes ?? (options.doneNote
    ? [note, { ...note, noteId: "note-done", title: "Finished task", gtdStatus: "done" as const }]
    : [note]);
  const noteRecords = new Map(notes.map((item) => [item.noteId, item]));
  const notesRead = vi.fn(async ({ noteId }: { noteId: string }) => ({
    record: noteRecords.get(noteId) ?? { ...note, noteId },
    content: "# Hello\nWorld"
  }));
  const notesMove = vi.fn(async ({ noteId, owner }: { noteId: string; owner: { scope: TestNote["scope"]; projectPath?: string } }) => {
    const current = noteRecords.get(noteId) ?? { ...note, noteId };
    const next = {
      ...current,
      scope: owner.scope,
      projectPath: owner.scope === "project" ? owner.projectPath : undefined
    };
    noteRecords.set(noteId, next);
    return next;
  });
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
        "desktop.kanban.addNote": "Add {0} note",
        "desktop.kanban.scope.library": "Library",
        "desktop.kanban.scope.project": "Project",
        "desktop.kanban.scope.session": "Session",
        "desktop.kanban.projects": "Projects",
        "desktop.kanban.allProjects": "All projects",
        "desktop.kanban.noProjects": "No projects yet",
        "desktop.kanban.resumeSession": "Run",
        "desktop.kanban.resumeFailed": "Resume failed",
        "desktop.notes.filterProjects": "Filter projects…",
        "desktop.notes.projectLabel": "Project",
        "desktop.notes.targetLibrary": "Standalone",
        "desktop.common.showSidebar": "Show sidebar",
        "desktop.common.hideSidebar": "Hide sidebar",
        "desktop.common.search": "Search",
        "desktop.common.refresh": "Refresh",
        "desktop.common.justNow": "Just now",
        "desktop.common.minutesAgo": "{0} min ago",
        "desktop.common.hoursAgo": "{0} h ago",
        "desktop.common.daysAgo": "{0} d ago",
        "desktop.notes.librarySection": "Library",
        "desktop.workbench.floatingNote": "Floating note",
        "desktop.workbench.floatingNoteClose": "Close floating note",
        "desktop.workbench.floatingNoteEditor": "Floating note editor",
        "desktop.workbench.floatingNoteLoading": "Loading floating note…",
        "desktop.workbench.floatingNoteCreating": "Creating floating note…",
        "desktop.workbench.floatingNoteLoadError": "Could not open floating note: {0}",
        "desktop.workbench.floatingNoteSaveFailed": "Save failed: {0}",
        "desktop.workbench.floatingNoteDeleteFailed": "Delete failed: {0}",
        "desktop.workbench.floatingNoteDeleting": "Deleting…",
        "desktop.workbench.floatingNoteSaving": "Saving…",
        "desktop.workbench.floatingNoteSaved": "Saved",
        "desktop.workbench.floatingNoteUnsaved": "Unsaved changes",
        "desktop.notes.deleteNote": "Delete note",
        "desktop.notes.deletingNote": "Deleting…",
        "desktop.notes.deleteTimeout": "Deletion is taking too long. Please try again.",
        "desktop.notes.deleteConfirm": "Delete note \"{0}\"?",
        "desktop.notes.deleteWithChildren": "Delete note \"{0}\" and its {1} linked child note(s)?",
        "desktop.workbench.setGtdStatus": "Set GTD status",
        "desktop.workbench.clearGtdStatus": "Clear GTD status",
        "desktop.workbench.gtdStatusSaveFailed": "Could not save GTD status: {0}",
        "desktop.common.edit": "Edit",
        "desktop.common.preview": "Preview",
        "desktop.common.save": "Save",
        "desktop.common.saved": "Saved",
        "desktop.common.loadingPreview": "Loading preview",
        "desktop.notes.editorPlaceholder": "Edit markdown…",
        "desktop.agent.openInNotes": "Open in Notes",
        "desktop.agent.resumeSession": "Resume",
        "desktop.agent.resumeStarted": "Resume started: {0} {1}",
        "desktop.kanban.noteView": "View",
        "desktop.sessions.summarizing": "Summarizing…",
        "desktop.sessions.renaming": "Renaming…",
        "desktop.sessions.summaryGenerated": "Summary generated",
        "desktop.sessions.renamed": "Renamed to {0}",
        "desktop.sessions.renamedNativeError": " (native: {0})",
        "desktop.sessions.noMessages": "No messages",
        "desktop.sessions.truncated": "(truncated)"
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
    notesCreate,
    notesResumeSession,
    notesRead,
    notesMove,
    notesWrite,
    notesDelete,
    notesListChildCounts,
    notesClipboardHasImage: async () => false,
    notesPasteImage: async () => null,
    previewSession: async () => ({
      session: { ...session, sessionSummary: "A short summary" },
      preview: { title: session.title, messages: [{ role: "user", text: "hello world" }] }
    }),
    summarizeSession: async () => ({ summary: "A short summary" }),
    autoRenameSession: async () => ({ title: "Renamed session", nativeRenamed: true, nativeError: null }),
    workbenchOpenSession: options.workbenchOpenSession ?? (async () => ({ external: true })),
    onSessionsSynced: () => () => undefined
  } as unknown as typeof window.agentResume;

  render(
    <I18nProvider>
      <KanbanPanel />
    </I18nProvider>
  );
  return { setSessionGtdStatus, notesSetGtdStatus, notesCreate, notesWrite, notesResumeSession, notesMove, notesDelete, notesListChildCounts };
}

function activate() {
  act(() => {
    window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "kanban" }));
  });
}

const dataTransfer = { setData: () => undefined, effectAllowed: "" };

describe("KanbanPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    const host = document.createElement("div");
    host.id = "react-kanban";
    document.body.appendChild(host);
    // AppChrome hosts per-tab toolbars in the app header; mirror that DOM here.
    const headerSlot = document.createElement("div");
    headerSlot.id = "app-header-slot";
    document.body.appendChild(headerSlot);
  });
  afterEach(() => {
    cleanup();
    document.querySelectorAll("#react-kanban, #app-header-slot").forEach((node) => node.remove());
  });

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

  it("shows a per-column plus only in Notes filter and creates a project note", async () => {
    const { notesCreate } = renderKanban();
    activate();
    await screen.findByRole("button", { name: /Quarterly plan/ });

    expect(document.querySelector(".kanban-column-add-note")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    await waitFor(() => expect(document.querySelectorAll(".kanban-column-add-note")).toHaveLength(5));
    expect(document.querySelector(".kanban-column.is-done .kanban-column-add-note")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Agent Resume" }));
    const nextPlus = document.querySelector<HTMLButtonElement>(".kanban-column.is-next .kanban-column-add-note");
    expect(nextPlus).toBeTruthy();
    fireEvent.click(nextPlus!);

    await waitFor(() => expect(notesCreate).toHaveBeenCalledWith(expect.objectContaining({
      scope: "project",
      projectPath: "/work/agent-resume-panel"
    })));
  });

  it("creates a library note from Notes filter when no project is selected", async () => {
    const { notesCreate } = renderKanban();
    activate();
    await screen.findByRole("button", { name: /Quarterly plan/ });
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    const inboxPlus = document.querySelector<HTMLButtonElement>(".kanban-column.is-inbox .kanban-column-add-note");
    expect(inboxPlus).toBeTruthy();
    fireEvent.click(inboxPlus!);

    await waitFor(() => expect(notesCreate).toHaveBeenCalledWith(expect.objectContaining({ scope: "library" })));
  });

  it("opens a note in a centered modal and saves edits", async () => {
    const { notesWrite } = renderKanban();
    activate();
    const noteCard = await screen.findByRole("button", { name: /Quarterly plan/ });
    fireEvent.click(noteCard);

    const dialog = await screen.findByRole("dialog", { name: /Quarterly plan/ });
    expect(document.querySelector(".sheet-modal-panel")).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByText(/Hello/)).toBeTruthy());

    fireEvent.click(within(dialog).getAllByRole("tab").find((tab) => tab.querySelector('[data-theme-icon="pencil"]'))!);
    const editor = await within(dialog).findByRole("textbox", { name: "Edit markdown…" });
    fireEvent.change(editor, { target: { value: "# Edited\n" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(notesWrite).toHaveBeenCalledWith({ noteId: "note-1", content: "# Edited\n" }));
  });

  it("moves a note to a selected project from the preview modal", async () => {
    const { notesMove } = renderKanban();
    activate();
    const noteCard = await screen.findByRole("button", { name: /Quarterly plan/ });
    fireEvent.click(noteCard);

    const dialog = await screen.findByRole("dialog", { name: /Quarterly plan/ });
    const project = within(dialog).getByRole("combobox", { name: "Project" });
    expect((project as HTMLSelectElement).value).toBe("");
    expect(within(dialog).getByRole("option", { name: "Standalone" })).toBeTruthy();
    expect(within(dialog).getByRole("option", { name: "Agent Resume" })).toBeTruthy();
    expect(within(dialog).getByRole("option", { name: "Other" })).toBeTruthy();

    fireEvent.change(project, { target: { value: "/work/agent-resume-panel" } });
    await waitFor(() => expect(notesMove).toHaveBeenCalledWith({
      noteId: "note-1",
      owner: { scope: "project", projectPath: "/work/agent-resume-panel" }
    }));
    await waitFor(() => expect((project as HTMLSelectElement).value).toBe("/work/agent-resume-panel"));
  });

  it("moves a project note back to the library from the preview modal", async () => {
    const { notesMove } = renderKanban({ notes: [projectNote] });
    activate();
    const noteCard = await screen.findByRole("button", { name: /Design doc/ });
    fireEvent.click(noteCard);

    const dialog = await screen.findByRole("dialog", { name: /Design doc/ });
    const project = await within(dialog).findByRole("combobox", { name: "Project" });
    await waitFor(() => expect((project as HTMLSelectElement).value).toBe("/work/agent-resume-panel"));

    fireEvent.change(project, { target: { value: "" } });
    await waitFor(() => expect(notesMove).toHaveBeenCalledWith({
      noteId: "note-proj",
      owner: { scope: "library" }
    }));
    await waitFor(() => expect((project as HTMLSelectElement).value).toBe(""));
  });

  it("deletes a note from the preview modal after confirmation and closes it", async () => {
    const stub = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { notesDelete, notesListChildCounts } = renderKanban();
    activate();
    const noteCard = await screen.findByRole("button", { name: /Quarterly plan/ });
    fireEvent.click(noteCard);

    const dialog = await screen.findByRole("dialog", { name: /Quarterly plan/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete note" }));

    await waitFor(() => expect(notesDelete).toHaveBeenCalledWith({ noteId: "note-1" }));
    expect(notesListChildCounts).toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector(".sheet-modal-panel")).toBeNull());
    stub.mockRestore();
  });

  it("aborts deletion when the confirmation is declined", async () => {
    const stub = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { notesDelete } = renderKanban();
    activate();
    const noteCard = await screen.findByRole("button", { name: /Quarterly plan/ });
    fireEvent.click(noteCard);

    const dialog = await screen.findByRole("dialog", { name: /Quarterly plan/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete note" }));

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(notesDelete).not.toHaveBeenCalled();
    expect(document.querySelector(".sheet-modal-panel")).not.toBeNull();
    stub.mockRestore();
  });

  it("warns about linked child notes when deleting a note with children", async () => {
    const stub = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { notesDelete } = renderKanban();
    window.agentResume.notesListChildCounts = async () => ({ "note-1": 3 });
    activate();
    const noteCard = await screen.findByRole("button", { name: /Quarterly plan/ });
    fireEvent.click(noteCard);

    const dialog = await screen.findByRole("dialog", { name: /Quarterly plan/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete note" }));

    await waitFor(() =>
      expect(window.confirm).toHaveBeenCalledWith("Delete note \"Quarterly plan\" and its 3 linked child note(s)?")
    );
    await waitFor(() => expect(notesDelete).toHaveBeenCalledWith({ noteId: "note-1" }));
    stub.mockRestore();
  });

  it("bails out of the deleting state when the delete never settles", async () => {
    const stub = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderKanban();
    activate();
    const noteCard = await screen.findByRole("button", { name: /Quarterly plan/ });
    fireEvent.click(noteCard);
    const dialog = await screen.findByRole("dialog", { name: /Quarterly plan/ });

    const stalledDelete = vi.fn(async ({ noteId }: { noteId: string }) =>
      new Promise<{ ok: boolean; deletedNoteIds: string[] }>(() => { /* never settles */ })
    );
    window.agentResume.notesDelete = stalledDelete;
    vi.useFakeTimers();
    try {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete note" }));
      // Flush the child-count microtask so the deleting state paints.
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(stalledDelete).toHaveBeenCalledWith({ noteId: "note-1" });
      expect(within(dialog).getByText("Deleting…")).toBeTruthy();
      // The delete never resolves; the timeout must restore the button.
      await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
      expect(within(dialog).getByText("Delete note")).toBeTruthy();
      expect(within(dialog).getByText("Deletion is taking too long. Please try again.")).toBeTruthy();
    } finally {
      vi.useRealTimers();
      stub.mockRestore();
    }
  });

  it("opens a session in a centered modal showing only the clicked session's detail", async () => {
    renderKanban({ sessions: [session, sessionB] });
    activate();
    const sessionCard = await screen.findByRole("button", { name: /Ship Kanban/ });
    fireEvent.click(sessionCard);

    const dialog = await screen.findByRole("dialog", { name: /Ship Kanban/ });
    expect(document.querySelector(".sheet-modal-panel")).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByText("hello world")).toBeTruthy());
    // The modal shows only the current session's detail, not the session list.
    expect(within(dialog).queryByText(/Other project task/)).toBeNull();
  });

  const sessionNote: TestNote = {
    noteId: "note-session",
    scope: "session" as const,
    provider: "codex",
    agentSessionId: "session-1",
    filename: "bound.md",
    relDir: "",
    relMdPath: "bound.md",
    title: "Bound note",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    gtdStatus: "next" as const
  };

  it("shows a Run button on a session-bound note card and resumes its session", async () => {
    const { notesResumeSession } = renderKanban({ notes: [sessionNote], sessions: [] });
    activate();
    const card = await screen.findByRole("button", { name: /Bound note/ });
    const runBtn = within(card).getByRole("button", { name: "Run" });
    fireEvent.click(runBtn);
    await waitFor(() => expect(notesResumeSession).toHaveBeenCalledWith({ provider: "codex", sessionId: "session-1" }));
    // The card Run button must not open the note modal.
    expect(document.querySelector(".sheet-modal-panel")).toBeNull();
  });

  it("does not open the note modal when pressing Enter on the Run button", async () => {
    const { notesResumeSession } = renderKanban({ notes: [sessionNote], sessions: [] });
    activate();
    const card = await screen.findByRole("button", { name: /Bound note/ });
    const runBtn = within(card).getByRole("button", { name: "Run" });
    fireEvent.keyDown(runBtn, { key: "Enter" });
    expect(document.querySelector(".sheet-modal-panel")).toBeNull();
    fireEvent.click(runBtn);
    await waitFor(() => expect(notesResumeSession).toHaveBeenCalledWith({ provider: "codex", sessionId: "session-1" }));
  });

  it("hides the Run button for non-session notes and chat/cursor-ide-bound notes", async () => {
    const chatNote = { ...sessionNote, noteId: "note-chat", provider: "chat" as const, title: "Chat note" };
    const cursorNote = { ...sessionNote, noteId: "note-cursor", provider: "cursor-ide" as const, title: "Cursor note" };
    renderKanban({ notes: [note, projectNote, chatNote, cursorNote], sessions: [] });
    activate();
    await screen.findByRole("button", { name: /Quarterly plan/ });
    expect(screen.queryAllByRole("button", { name: "Run" })).toHaveLength(0);
  });

  it("runs a bound note from the detail modal and closes it on xterm resume", async () => {
    const { notesResumeSession } = renderKanban({ notes: [sessionNote], sessions: [] });
    activate();
    fireEvent.click(await screen.findByRole("button", { name: /Bound note/ }));
    const dialog = await screen.findByRole("dialog", { name: /Bound note/ });
    const runBtn = within(dialog).getByRole("button", { name: "Run" });
    fireEvent.click(runBtn);
    await waitFor(() => expect(notesResumeSession).toHaveBeenCalledWith({ provider: "codex", sessionId: "session-1" }));
    await waitFor(() => expect(document.querySelector(".sheet-modal-panel")).toBeNull());
  });

  it("session detail modal resume dispatches workbench-open-session and closes on xterm", async () => {
    const opened: unknown[] = [];
    const onOpen = (event: Event) => opened.push((event as CustomEvent).detail);
    window.addEventListener("agent-resume:workbench-open-session", onOpen);
    try {
      const workbenchOpenSession = vi.fn(async () => ({
        mode: "xterm",
        command: "codex resume session-1",
        cwd: "/work/agent-resume-panel",
        external: false
      }));
      renderKanban({ sessions: [session], workbenchOpenSession });
      activate();
      fireEvent.click(await screen.findByRole("button", { name: /Ship Kanban/ }));
      const dialog = await screen.findByRole("dialog", { name: /Ship Kanban/ });
      fireEvent.click(within(dialog).getByRole("button", { name: "Resume" }));
      await waitFor(() => expect(workbenchOpenSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1" }));
      await waitFor(() => expect(opened[0]).toMatchObject({ provider: "codex", id: "session-1", projectPath: "/work/agent-resume-panel" }));
      await waitFor(() => expect(document.querySelector(".sheet-modal-panel")).toBeNull());
    } finally {
      window.removeEventListener("agent-resume:workbench-open-session", onOpen);
    }
  });

  it("session detail modal resume keeps the modal open for external resumes", async () => {
    const opened: unknown[] = [];
    const onOpen = (event: Event) => opened.push((event as CustomEvent).detail);
    window.addEventListener("agent-resume:workbench-open-session", onOpen);
    try {
      renderKanban({ sessions: [session] }); // default workbenchOpenSession => external
      activate();
      fireEvent.click(await screen.findByRole("button", { name: /Ship Kanban/ }));
      const dialog = await screen.findByRole("dialog", { name: /Ship Kanban/ });
      fireEvent.click(within(dialog).getByRole("button", { name: "Resume" }));
      await waitFor(() => expect(opened).toHaveLength(0));
      expect(document.querySelector(".sheet-modal-panel")).toBeTruthy();
    } finally {
      window.removeEventListener("agent-resume:workbench-open-session", onOpen);
    }
  });
});
