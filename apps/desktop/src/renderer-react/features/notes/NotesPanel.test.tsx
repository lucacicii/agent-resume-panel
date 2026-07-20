import { forwardRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { NotesPanel } from "./NotesPanel";

vi.mock("../../components/CodeEditor", () => ({
  CodeEditor: forwardRef(({ value, onChange, onBlur, ariaLabel }: { value: string; onChange: (value: string) => void; onBlur?: () => void; ariaLabel: string }, _ref) => (
    <textarea value={value} placeholder={ariaLabel} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
  ))
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
  "desktop.common.edit": "Edit",
  "desktop.common.view": "View",
  "desktop.common.rename": "Rename",
  "desktop.workbench.resizeProjects": "Resize projects",
  "desktop.workbench.resizeSessions": "Resize sessions",
  "desktop.tabs.notes": "Notes"
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.getElementById("react-notes")?.remove();
});

function installBridge() {
  const notesWrite = vi.fn(async () => ({ noteId: "note-1", filename: "renderer.md", updatedAtMs: 3 }));
  const notesCreate = vi.fn(async () => ({ noteId: "note-3", filename: "new-note.md" }));
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages }),
    onLocaleChanged: () => () => undefined,
    notesList: async () => [libraryNote, projectNote],
    listSessions: async () => [{ provider: "codex", id: "session-1", title: "Panel session", projectPath: "/work/panel", updatedAt: Date.now() }],
    listProjectAliases: async () => ({ "/work/panel": "Panel" }),
    setProjectAlias: async () => ({ ok: true }),
    notesRead: async ({ noteId }: { noteId: string }) => ({ record: noteId === "note-3" ? { ...libraryNote, noteId, filename: "new-note.md", title: "New note" } : noteId === "note-2" ? projectNote : libraryNote, content: "# Renderer\nInitial" }),
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
    notesOpenFolder: async () => ({ ok: true })
  } as unknown as typeof window.agentResume;
  return { notesWrite, notesCreate };
}

describe("NotesPanel", () => {
  it("loads, edits, saves, and creates notes through the desktop bridge", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    const { notesWrite, notesCreate } = installBridge();
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    fireEvent.click(await screen.findByRole("button", { name: /Renderer plan/ }));
    const editor = await screen.findByPlaceholderText("Edit Markdown");
    fireEvent.change(editor, { target: { value: "# Renderer\nChanged" } });
    fireEvent.blur(editor);
    await waitFor(() => expect(notesWrite).toHaveBeenCalledWith({ noteId: "note-1", content: "# Renderer\nChanged" }));
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    fireEvent.click(document.querySelector(".notes-target-item") as HTMLButtonElement);
    await waitFor(() => expect(notesCreate).toHaveBeenCalledWith({ scope: "library" }));
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
});
