import { forwardRef, useImperativeHandle, useRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { collectPreviewSearchRanges, NotesPanel } from "./NotesPanel";

vi.mock("../../components/CodeEditor", () => ({
  CodeEditor: forwardRef(({ value, onChange, onBlur, ariaLabel }: { value: string; onChange: (value: string) => void; onBlur?: () => void; ariaLabel: string }, ref) => {
    const search = useRef({ query: "", current: 0, total: 0 });
    const setQuery = (query: string) => {
      const needle = query.trim().toLocaleLowerCase();
      const haystack = value.toLocaleLowerCase();
      let total = 0;
      let from = 0;
      while (needle && from <= haystack.length - needle.length) {
        const match = haystack.indexOf(needle, from);
        if (match < 0) break;
        total += 1;
        from = match + needle.length;
      }
      search.current = { query: needle, current: total ? 1 : 0, total };
      return { current: search.current.current, total };
    };
    useImperativeHandle(ref, () => ({
      focus: () => undefined,
      find: () => false,
      revealRange: () => false,
      setSearchQuery: setQuery,
      navigateSearch: (direction: "forward" | "backward") => {
        const current = search.current;
        if (current.total) current.current = direction === "forward"
          ? current.current % current.total + 1
          : (current.current - 2 + current.total) % current.total + 1;
        return { current: current.current, total: current.total };
      },
      clearSearch: () => { search.current = { query: "", current: 0, total: 0 }; },
      getSearchResult: () => ({ current: search.current.current, total: search.current.total }),
      getSelectedText: () => ""
    }));
    return <textarea value={value} placeholder={ariaLabel} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />;
  })
}));

const libraryNote = { noteId: "note-1", scope: "library", filename: "renderer.md", relDir: "library", relMdPath: "notes/library/renderer.md", title: "Renderer plan", contentPreview: "Move the Desktop renderer", createdAtMs: 1, updatedAtMs: 2 };
const projectNote = { noteId: "note-2", scope: "project", projectPath: "/work/panel", filename: "project.md", relDir: "projects/panel", relMdPath: "notes/projects/panel/project.md", title: "Project note", contentPreview: "Project specific work", createdAtMs: 2, updatedAtMs: 3 };

const messages = {
  "desktop.notes.filterProjects": "Filter projects",
  "desktop.notes.projectFilter": "Project filter",
  "desktop.notes.listMeta": "{0} of {1} notes",
  "desktop.notes.listMetaFilter": "{0} {1} {2} notes",
  "desktop.notes.listMetaSearch": "{0} {1} {2} notes",
  "desktop.notes.librarySection": "Library",
  "desktop.notes.projectLabel": "Project",
  "desktop.notes.sessionsSection": "Sessions",
  "desktop.notes.targetLibrary": "Library",
  "desktop.notes.targetProject": "Project",
  "desktop.notes.targetSession": "Session",
  "desktop.notes.noMatchingProjects": "No matching projects",
  "desktop.notes.noMatchingNotes": "No matching notes",
  "desktop.notes.noFilterNotes": "No pinned notes",
  "desktop.notes.noNotesInFolder": "No notes in folder",
  "desktop.notes.selectOrCreate": "Select a note",
  "desktop.notes.editorPlaceholder": "Edit Markdown",
  "desktop.notes.deleteNote": "Delete note",
  "desktop.notes.deleteConfirm": "Delete {0}?",
  "desktop.notes.findInNote": "Find in note",
  "desktop.notes.copyPath": "Copy path",
  "desktop.notes.sidebarView": "Notes sidebar view",
  "desktop.notes.searchGtd": "Search GTD tasks",
  "desktop.notes.gtdListMeta": "{0} GTD tasks",
  "desktop.notes.noGtdTasks": "No GTD tasks found",
  "desktop.notes.slashGtdTask": "GTD task",
  "desktop.notes.slashNoteChild": "Child note step",
  "desktop.notes.slashNoteChildDetail": "Add a serial note-child block (auto-materializes on save)",
  "desktop.notes.slashSession": "Execution session",
  "desktop.notes.slashSessionDetail": "Declare a catalog session binding (default codex)",
  "desktop.notes.slashRunApprove": "Run (await approval)",
  "desktop.notes.slashRunApproveDetail": "Serial run of note-child chain; requires approval",
  "desktop.notes.slashRunDraft": "Run (draft)",
  "desktop.notes.slashRunDraftDetail": "Draft run block; not ready to approve yet",
  "desktop.notes.slashResult": "Result block",
  "desktop.notes.slashResultDetail": "Append an execution result summary",
  "desktop.notes.execApproveRun": "Approve & run",
  "desktop.notes.execStartStep": "Start session",
  "desktop.notes.execMarkDone": "Mark step done",
  "desktop.notes.execMarkFailed": "Mark step failed",
  "desktop.notes.execApproving": "Approving…",
  "desktop.notes.execStarting": "Starting…",
  "desktop.notes.execSettling": "Settling…",
  "desktop.notes.execApproved": "Approved {0}/{1}",
  "desktop.notes.execStepStarted": "Started {0}/{1}",
  "desktop.notes.execStepDone": "Step done",
  "desktop.notes.execRunDone": "All done",
  "desktop.notes.execStepFailed": "Failed",
  "desktop.notes.execNoProject": "Project only",
  "desktop.notes.execBarHint": "Executable run: {0}",
  "desktop.notes.execMenuTitle": "Executable state",
  "desktop.notes.execStepMarkDone": "Mark step done",
  "desktop.notes.execStepMarkFailed": "Mark step failed",
  "desktop.notes.execStepReset": "Reset step to planned",
  "desktop.notes.execStepRunning": "Set step running",
  "desktop.notes.execRunReset": "Reset run to awaiting approval",
  "desktop.notes.execRunExecute": "Set run executing",
  "desktop.notes.execSessionReset": "Reset session to idle",
  "desktop.notes.execAppendStep": "Append new step",
  "desktop.notes.execStateUpdated": "Executable state updated",
  "desktop.notes.execStepAppended": "Step appended",
  "desktop.notes.execResumeSession": "Resume session",
  "desktop.notes.execNewSession": "New session",
  "desktop.notes.execSessionResumed": "Session resumed",
  "desktop.notes.execSessionStarted": "Session started",
  "desktop.notes.execSessionNoTarget": "No catalog session to resume for this note.",
  "desktop.notes.linkTree": "Related notes",
  "desktop.notes.newLinkedChild": "New linked child note",
  "desktop.notes.setAsLinkedChild": "Set as child of…",
  "desktop.notes.setAsLinkedChildHint": "Choose a parent note for \"{0}\".",
  "desktop.notes.clearParentLink": "Clear parent link",
  "desktop.notes.linkedChildrenCount": "{0} linked children",
  "desktop.notes.linkTreeTruncated": "Tree truncated",
  "desktop.notes.dragToDetach": "Drop here to unlink",
  "desktop.notes.resizeLinkTree": "Resize related notes",
  "desktop.notes.pinProject": "Pin project",
  "desktop.notes.unpinProject": "Unpin project",
  "desktop.notes.pinNote": "Pin note",
  "desktop.notes.unpinNote": "Unpin note",
  "desktop.notes.renameProject": "Rename project",
  "desktop.notes.changeOwner": "Change owner",
  "desktop.common.all": "All",
  "desktop.common.pinned": "Pinned",
  "desktop.common.active": "Active",
  "desktop.common.newNote": "New note",
  "desktop.common.importMarkdown": "Import Markdown",
  "desktop.common.refresh": "Refresh",
  "desktop.common.revealInFinder": "Reveal",
  "desktop.common.confirm": "Confirm",
  "desktop.common.cancel": "Cancel",
  "desktop.common.close": "Close",
  "desktop.common.closeFind": "Close find",
  "desktop.common.findCount": "{0} / {1}",
  "desktop.common.findPrev": "Previous match",
  "desktop.common.findNext": "Next match",
  "desktop.common.edit": "Edit",
  "desktop.common.view": "View",
  "desktop.common.rename": "Rename",
  "desktop.workbench.resizeProjects": "Resize projects",
  "desktop.workbench.resizeSessions": "Resize sessions",
  "desktop.tabs.notes": "Notes",
  "desktop.workbench.gtdView": "GTD",
  "desktop.workbench.gtdCompleted": "Completed",
  "desktop.workbench.gtdStatus.inbox": "Inbox",
  "desktop.workbench.gtdStatus.next": "Next",
  "desktop.workbench.gtdStatus.waiting": "Waiting",
  "desktop.workbench.gtdStatus.someday": "Someday",
  "desktop.workbench.gtdStatus.reference": "Reference",
  "desktop.workbench.gtdStatus.done": "Done"
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.getElementById("react-notes")?.remove();
});

function installBridge() {
  const notesWrite = vi.fn(async () => ({ noteId: "note-1", filename: "renderer.md", updatedAtMs: 3 }));
  const notesCreate = vi.fn(async () => ({ noteId: "note-3", filename: "new-note.md" }));
  const listSessions = vi.fn(async () => [{ provider: "codex" as const, id: "session-1", title: "Panel session", projectPath: "/work/panel", updatedAt: Date.now() }]);
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages }),
    onLocaleChanged: () => () => undefined,
    notesList: async () => [libraryNote, projectNote],
    notesListLinkedChildIds: async () => [],
    notesListChildCounts: async () => ({}),
    notesGetSubtree: async ({ rootNoteId }: { rootNoteId: string }) => ({
      rootNoteId,
      root: {
        noteId: rootNoteId,
        title: rootNoteId === "note-2" ? "Project note" : "Renderer plan",
        filename: rootNoteId === "note-2" ? "project.md" : "renderer.md",
        projectPath: rootNoteId === "note-2" ? "/work/panel" : undefined,
        children: []
      },
      nodesById: {},
      edges: []
    }),
    notesResolveLinkRoot: async ({ noteId }: { noteId: string }) => ({ rootNoteId: noteId }),
    notesCreateLinkedChild: async () => ({ noteId: "note-4", filename: "child.md" }),
    notesSetParent: async () => ({ ok: true }),
    notesListGtd: async () => [{ text: "Ship GTD", status: "next", line: 3, occurrence: 1, noteId: "note-1", noteTitle: "Renderer plan", scope: "library", relMdPath: "notes/library/renderer.md", updatedAtMs: 2 }],
    listSessions,
    listProjectAliases: async () => ({ "/work/panel": "Panel" }),
    setProjectAlias: async () => ({ ok: true }),
    notesRead: async ({ noteId }: { noteId: string }) => ({ record: noteId === "note-3" ? { ...libraryNote, noteId, filename: "new-note.md", title: "New note" } : noteId === "note-2" ? projectNote : libraryNote, content: "# Renderer\nInitial initial" }),
    notesWrite,
    notesCreate,
    notesMove: async () => ({ noteId: "note-2", filename: "project.md", scope: "library" }),
    notesRename: async () => ({ noteId: "note-1", filename: "renamed.md" }),
    notesDelete: async () => ({ ok: true }),
    notesImport: async () => ({ imported: 0, skipped: 0, errors: [] }),
    notesClipboardHasImage: () => false,
    notesPasteImage: async () => null,
    notesCopyPath: async () => ({ path: "/notes/renderer.md" }),
    notesReveal: async () => ({ ok: true }),
    notesOpenFolder: async () => ({ ok: true }),
    notesExecutableProbe: async ({ noteId }: { noteId: string }) => ({
      runCount: noteId === "note-2" ? 1 : 0,
      runStatus: "awaiting_approval",
      hasRun: noteId === "note-2",
      hasSession: noteId === "note-1",
      sessionStatus: "idle",
      asStep: undefined
    }),
    notesExecutableSetRunStatus: async () => ({ content: "# Renderer" }),
    notesExecutableSetChildStatus: async () => ({ content: "# Renderer", parentNoteId: "note-2" }),
    notesExecutableSetSessionStatus: async () => ({ content: "# Renderer" }),
    notesExecutableAppendStep: async () => ({ content: "# Renderer", childNoteId: "note-4" })
  } as unknown as typeof window.agentResume;
  return { notesWrite, notesCreate, listSessions };
}

describe("NotesPanel", () => {
  it("finds rendered preview text across element boundaries", () => {
    const root = document.createElement("div");
    root.innerHTML = "<span>Hello </span><strong>world</strong><span>. Hello world.</span>";
    const ranges = collectPreviewSearchRanges(root, "lo wo");
    expect(ranges).toHaveLength(2);
    expect(ranges.map((range) => range.toString())).toEqual(["lo wo", "lo wo"]);
    expect(root.innerHTML).toBe("<span>Hello </span><strong>world</strong><span>. Hello world.</span>");
  });

  it("loads, edits, saves, and creates notes through the desktop bridge", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    const { notesWrite, notesCreate, listSessions } = installBridge();
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    await waitFor(() => expect(listSessions).toHaveBeenCalledWith());
    fireEvent.click(await screen.findByRole("button", { name: /Renderer plan/ }));
    const editor = await screen.findByPlaceholderText("Edit Markdown");
    fireEvent.change(editor, { target: { value: "# Renderer\nChanged" } });
    fireEvent.blur(editor);
    await waitFor(() => expect(notesWrite).toHaveBeenCalledWith({ noteId: "note-1", content: "# Renderer\nChanged" }));
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    fireEvent.click(document.querySelector(".notes-target-item") as HTMLButtonElement);
    await waitFor(() => expect(notesCreate).toHaveBeenCalledWith({ scope: "library" }));
  });

  it("closes the target picker after creating a note even when opening it fails", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    const { notesCreate } = installBridge();
    const originalNotesRead = window.agentResume.notesRead;
    vi.spyOn(window.agentResume, "notesRead").mockImplementation(async ({ noteId }) => {
      if (noteId === "note-3") throw new Error("Unable to open the created note");
      return originalNotesRead({ noteId });
    });
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    fireEvent.click(await screen.findByRole("button", { name: "New note" }));
    fireEvent.click(document.querySelector(".notes-target-item") as HTMLButtonElement);
    await waitFor(() => expect(notesCreate).toHaveBeenCalledWith({ scope: "library" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("raises the note list only while the target picker is open", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    installBridge();
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    const pane = document.querySelector(".notes-list-pane") as HTMLElement;
    const toolbar = document.querySelector(".notes-list-toolbar-wrap") as HTMLElement;
    expect(pane.classList.contains("is-target-open")).toBe(false);
    expect(toolbar.classList.contains("is-target-open")).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: "New note" }));
    expect(screen.getByRole("dialog").classList.contains("notes-target-popover")).toBe(true);
    expect(pane.classList.contains("is-target-open")).toBe(true);
    expect(toolbar.classList.contains("is-target-open")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(pane.classList.contains("is-target-open")).toBe(false);
    expect(toolbar.classList.contains("is-target-open")).toBe(false);
  });

  it("uses Workbench-compatible project aliases and shared project pins", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    installBridge();
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    const project = await screen.findByTitle("/work/panel");
    expect(project.textContent).toContain("Panel");
    fireEvent.contextMenu(project);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin project" }));
    expect(JSON.parse(localStorage.getItem("pinned-projects") || "[]")).toEqual(["/work/panel"]);
    fireEvent.click(project);
    const note = await screen.findByRole("button", { name: /Project note/ });
    fireEvent.contextMenu(note);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin note" }));
    expect(JSON.parse(localStorage.getItem("pinned-notes") || "[]")).toEqual(["note-2"]);
  });

  it("searches GTD tasks and opens their source note", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    installBridge();
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    fireEvent.click(await screen.findByRole("tab", { name: "GTD" }));
    expect(await screen.findByText("Ship GTD")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search GTD tasks" }), { target: { value: "Ship" } });
    fireEvent.click(screen.getByRole("button", { name: /Ship GTD/ }));
    expect(await screen.findByText("Renderer plan")).toBeTruthy();
  });

  it("shows the current and total find count and ignores composing Enter", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    installBridge();
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    fireEvent.click(await screen.findByRole("button", { name: /Renderer plan/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Find in note" }));
    const input = screen.getByRole("textbox", { name: "Find in note" });
    fireEvent.change(input, { target: { value: "Initial" } });
    expect(screen.getByText("1 / 2")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Enter", isComposing: true });
    expect(screen.getByText("1 / 2")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByText("2 / 2")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByText("1 / 2")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    expect(screen.getByText("2 / 2")).toBeTruthy();
    fireEvent.change(input, { target: { value: "missing" } });
    expect(screen.getByText("0 / 0").classList.contains("is-empty")).toBe(true);
  });

  it("shows executable state actions in the note context menu and dispatches state fixes", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    installBridge();
    const setRun = vi.spyOn(window.agentResume, "notesExecutableSetRunStatus");
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    const note = await screen.findByRole("button", { name: /Project note/ });
    fireEvent.contextMenu(note);
    const title = await screen.findByText("Executable state");
    expect(title).toBeTruthy();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Set run executing" }));
    await waitFor(() => expect(setRun).toHaveBeenCalledWith({ noteId: "note-2", status: "executing" }));
  });

  it("shows step actions for a note that is a child step of a run", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    installBridge();
    vi.spyOn(window.agentResume, "notesExecutableProbe").mockImplementation(async ({ noteId }) => ({
      runCount: 0,
      runStatus: undefined,
      hasRun: false,
      hasSession: true,
      sessionStatus: "running",
      asStep: { parentNoteId: "note-2", childStatus: "running", parentRunStatus: "executing" }
    }));
    const setChild = vi.spyOn(window.agentResume, "notesExecutableSetChildStatus");
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    const note = await screen.findByRole("button", { name: /Project note/ });
    fireEvent.contextMenu(note);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Mark step done" }));
    await waitFor(() => expect(setChild).toHaveBeenCalledWith({ childNoteId: "note-2", status: "done" }));
  });

  it("appends a new executable step from the note context menu", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    installBridge();
    const append = vi.spyOn(window.agentResume, "notesExecutableAppendStep");
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    const note = await screen.findByRole("button", { name: /Project note/ });
    fireEvent.contextMenu(note);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Append new step" }));
    await waitFor(() => expect(append).toHaveBeenCalledWith({ parentNoteId: "note-2" }));
  });

  it("shows only New session for a project note with a session and no native", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    installBridge();
    vi.spyOn(window.agentResume, "notesExecutableProbe").mockImplementation(async () => ({
      runCount: 0, runStatus: undefined, hasRun: false, hasSession: true,
      sessionStatus: "idle", sessionProvider: "codex", sessionNativeRef: undefined, asStep: undefined
    }));
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    const note = await screen.findByRole("button", { name: /Project note/ });
    fireEvent.contextMenu(note);
    expect(await screen.findByRole("menuitem", { name: "New session" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Resume session" })).toBeNull();
  });

  it("shows only Resume session for a project note with a native session", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    installBridge();
    vi.spyOn(window.agentResume, "notesExecutableProbe").mockImplementation(async () => ({
      runCount: 0, runStatus: undefined, hasRun: false, hasSession: true,
      sessionStatus: "running", sessionProvider: "codex",
      sessionNativeRef: { provider: "codex", sessionId: "s-1" }, asStep: undefined
    }));
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    const note = await screen.findByRole("button", { name: /Project note/ });
    fireEvent.contextMenu(note);
    expect(await screen.findByRole("menuitem", { name: "Resume session" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "New session" })).toBeNull();
  });

  it("shows Resume session for a session-scope note", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    installBridge();
    vi.spyOn(window.agentResume, "notesList").mockImplementation(async () => [
      libraryNote,
      projectNote,
      { noteId: "note-5", scope: "session", provider: "codex", agentSessionId: "sess-5", filename: "session.md", relDir: "sessions/codex", relMdPath: "notes/sessions/codex/session.md", title: "Session note", contentPreview: "session", createdAtMs: 5, updatedAtMs: 5 }
    ]);
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    const note = await screen.findByRole("button", { name: /Session note/ });
    fireEvent.contextMenu(note);
    expect(await screen.findByRole("menuitem", { name: "Resume session" })).toBeTruthy();
  });

  it("hides session actions for a chat/ACP provider", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    installBridge();
    vi.spyOn(window.agentResume, "notesExecutableProbe").mockImplementation(async () => ({
      runCount: 0, runStatus: undefined, hasRun: false, hasSession: true,
      sessionStatus: "running", sessionProvider: "chat",
      sessionNativeRef: { provider: "chat", sessionId: "c-1" }, asStep: undefined
    }));
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    const note = await screen.findByRole("button", { name: /Project note/ });
    fireEvent.contextMenu(note);
    expect(await screen.findByRole("menuitem", { name: "Append new step" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Resume session" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "New session" })).toBeNull();
  });
});
