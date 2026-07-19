import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { NotesPanel } from "./NotesPanel";

vi.mock("../../components/CodeEditor", () => ({
  CodeEditor: ({ value, onChange, onBlur, ariaLabel }: { value: string; onChange: (value: string) => void; onBlur?: () => void; ariaLabel: string }) => (
    <textarea value={value} placeholder={ariaLabel} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
  )
}));

const note = { noteId: "note-1", scope: "library", filename: "renderer.md", relDir: "library", relMdPath: "notes/library/renderer.md", title: "Renderer plan", contentPreview: "Move the Desktop renderer", createdAtMs: 1, updatedAtMs: 2 };

afterEach(() => { cleanup(); document.getElementById("react-notes")?.remove(); });

describe("NotesPanel", () => {
  it("loads, edits, saves, and creates notes through the desktop bridge", async () => {
    const host = document.createElement("div"); host.id = "react-notes"; document.body.append(host);
    const notesWrite = vi.fn(async () => ({ noteId: "note-1", filename: "renderer.md", updatedAtMs: 3 }));
    const notesCreate = vi.fn(async () => ({ noteId: "note-2", filename: "new-note.md" }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { "desktop.notes.filterProjects": "Filter projects", "desktop.notes.listMeta": "{0} of {1} notes", "desktop.notes.librarySection": "Library", "desktop.notes.projectLabel": "Project", "desktop.notes.sessionsSection": "Sessions", "desktop.common.all": "All", "desktop.notes.targetLibrary": "Library", "desktop.notes.targetProject": "Project", "desktop.notes.targetSession": "Session", "desktop.common.newNote": "New note", "desktop.common.refresh": "Refresh", "desktop.notes.noMatchingNotes": "No notes", "desktop.notes.selectOrCreate": "Select a note", "desktop.common.revealInFinder": "Reveal", "desktop.notes.editorPlaceholder": "Edit Markdown", "desktop.common.confirm": "Confirm", "desktop.common.edit": "Edit", "desktop.common.view": "View", "desktop.notes.copyPath": "Copy path", "desktop.notes.deleteNote": "Delete note", "desktop.notes.deleteConfirm": "Delete {0}?", "desktop.tabs.notes": "Notes" } }),
      onLocaleChanged: () => () => undefined,
      notesList: async () => [note],
      listSessions: async () => [],
      notesRead: async ({ noteId }: { noteId: string }) => ({ record: noteId === "note-2" ? { ...note, noteId, filename: "new-note.md", title: "New note" } : note, content: "# Renderer\nInitial" }),
      notesWrite,
      notesCreate,
      notesRename: async () => ({ noteId: "note-1", filename: "renamed.md" }),
      notesDelete: async () => ({ ok: true }),
      notesCopyPath: async () => ({ path: "/notes/renderer.md" }),
      notesReveal: async () => ({ ok: true }),
      notesOpenFolder: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;
    render(<I18nProvider><NotesPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    const row = await screen.findByRole("button", { name: /Renderer plan/ });
    fireEvent.click(row);
    const editor = await screen.findByPlaceholderText("Edit Markdown");
    fireEvent.change(editor, { target: { value: "# Renderer\nChanged" } });
    fireEvent.blur(editor);
    await waitFor(() => expect(notesWrite).toHaveBeenCalledWith({ noteId: "note-1", content: "# Renderer\nChanged" }));
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    await waitFor(() => expect(notesCreate).toHaveBeenCalledWith({ scope: "library" }));
  });
});
