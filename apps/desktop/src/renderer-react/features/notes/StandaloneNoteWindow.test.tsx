import { forwardRef, useImperativeHandle } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { StandaloneNoteWindow } from "./StandaloneNoteWindow";

vi.mock("../../components/CodeEditor", () => ({
  CodeEditor: forwardRef(({ value, onChange, ariaLabel }: { value: string; onChange: (value: string) => void; ariaLabel: string }, ref) => {
    useImperativeHandle(ref, () => ({ focus: vi.fn() }));
    return <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />;
  })
}));

const messages = {
  "desktop.standaloneNote.title": "Standalone Note",
  "desktop.standaloneNote.editor": "Standalone note editor",
  "desktop.standaloneNote.close": "Close note",
  "desktop.standaloneNote.pin": "Keep note above all apps",
  "desktop.standaloneNote.unpin": "Stop keeping note above all apps",
  "desktop.standaloneNote.loading": "Loading note…",
  "desktop.standaloneNote.loadFailed": "Could not open note.",
  "desktop.standaloneNote.loadError": "Could not open note: {0}",
  "desktop.standaloneNote.saving": "Saving…",
  "desktop.standaloneNote.deleting": "Deleting…",
  "desktop.standaloneNote.saved": "Saved",
  "desktop.standaloneNote.unsaved": "Unsaved changes",
  "desktop.standaloneNote.saveFailed": "Save failed: {0}",
  "desktop.standaloneNote.deleteFailed": "Delete failed: {0}",
  "desktop.notes.deleteNote": "Delete note",
  "desktop.notes.deleteConfirm": "Delete note \"{0}\"? Its assets folder will also be removed.",
  "desktop.notes.gtdStatusLabel": "Note GTD status",
  "desktop.notes.clearGtdStatus": "Clear GTD status",
  "desktop.workbench.gtdStatus.inbox": "Inbox",
  "desktop.workbench.gtdStatus.next": "Next",
  "desktop.workbench.gtdStatus.waiting": "Waiting",
  "desktop.workbench.gtdStatus.someday": "Someday",
  "desktop.workbench.gtdStatus.reference": "Reference",
  "desktop.workbench.gtdStatus.done": "Done"
};

const record = {
  noteId: "note-1",
  scope: "library",
  filename: "2026-08-05-01.md",
  relDir: "library",
  relMdPath: "notes/library/2026-08-05-01.md",
  title: "Standalone note",
  createdAtMs: 1,
  updatedAtMs: 2
};

function installBridge(overrides: Partial<typeof window.agentResume> = {}) {
  let closeCallback: (() => void) | undefined;
  const closeRequested = vi.fn((callback: () => void) => {
    closeCallback = callback;
    return () => undefined;
  });
  const notesWrite = vi.fn(async ({ noteId, content }: { noteId: string; content: string }) => ({
    noteId,
    filename: record.filename,
    updatedAtMs: Date.now(),
    content
  }));
  const notesDelete = vi.fn(async () => ({ ok: true, deletedNoteIds: [record.noteId] }));
  const notesSetGtdStatus = vi.fn(async ({ noteId, status }: { noteId: string; status: string | null }) => ({ ...record, noteId, gtdStatus: status || undefined }));
  const standaloneNoteSetAlwaysOnTop = vi.fn(async ({ pinned }: { pinned: boolean }) => ({ pinned }));
  const standaloneNoteClose = vi.fn(async () => ({ ok: true }));
  const standaloneNoteCloseReady = vi.fn(async ({ ok }: { ok: boolean }) => ({ ok }));
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages }),
    onLocaleChanged: () => () => undefined,
    notesRead: async () => ({ record, content: "# Standalone note\n" }),
    notesWrite,
    notesDelete,
    notesSetGtdStatus,
    standaloneNoteGetState: async () => ({ noteId: "note-1", pinned: false }),
    standaloneNoteSetAlwaysOnTop,
    standaloneNoteClose,
    standaloneNoteCloseReady,
    onStandaloneNoteCloseRequested: closeRequested,
    ...overrides
  } as unknown as typeof window.agentResume;
  return { closeRequested, getCloseCallback: () => closeCallback, notesWrite, notesDelete, notesSetGtdStatus, standaloneNoteSetAlwaysOnTop, standaloneNoteClose, standaloneNoteCloseReady };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("StandaloneNoteWindow", () => {
  it("loads a Library note and toggles always-on-top", async () => {
    const { standaloneNoteSetAlwaysOnTop } = installBridge();
    render(<I18nProvider><StandaloneNoteWindow noteId="note-1" /></I18nProvider>);

    const editor = await screen.findByRole("textbox", { name: "Standalone note editor" });
    expect((editor as HTMLTextAreaElement).value).toBe("# Standalone note\n");
    fireEvent.click(screen.getByRole("button", { name: "Keep note above all apps" }));
    await waitFor(() => expect(standaloneNoteSetAlwaysOnTop).toHaveBeenCalledWith({ pinned: true }));
  });

  it("sets the note GTD status through catalog metadata", async () => {
    const { notesSetGtdStatus } = installBridge();
    render(<I18nProvider><StandaloneNoteWindow noteId="note-1" /></I18nProvider>);

    await screen.findByRole("textbox", { name: "Standalone note editor" });
    fireEvent.change(screen.getByRole("combobox", { name: "Note GTD status" }), { target: { value: "next" } });
    await waitFor(() => expect(notesSetGtdStatus).toHaveBeenCalledWith({ noteId: "note-1", status: "next" }));
  });

  it("confirms deletion, removes the Library note, and closes the window", async () => {
    const { notesDelete, standaloneNoteClose } = installBridge();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<I18nProvider><StandaloneNoteWindow noteId="note-1" /></I18nProvider>);

    await screen.findByRole("textbox", { name: "Standalone note editor" });
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    expect(confirm).toHaveBeenCalledWith("Delete note \"Standalone note\"? Its assets folder will also be removed.");
    await waitFor(() => expect(notesDelete).toHaveBeenCalledWith({ noteId: "note-1" }));
    await waitFor(() => expect(standaloneNoteClose).toHaveBeenCalledTimes(1));
  });

  it("does not delete when the confirmation is cancelled", async () => {
    const { notesDelete, standaloneNoteClose } = installBridge();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<I18nProvider><StandaloneNoteWindow noteId="note-1" /></I18nProvider>);

    await screen.findByRole("textbox", { name: "Standalone note editor" });
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    expect(notesDelete).not.toHaveBeenCalled();
    expect(standaloneNoteClose).not.toHaveBeenCalled();
  });

  it("debounces edits and flushes them before closing", async () => {
    const { notesWrite, standaloneNoteClose } = installBridge();
    render(<I18nProvider><StandaloneNoteWindow noteId="note-1" /></I18nProvider>);
    const editor = await screen.findByRole("textbox", { name: "Standalone note editor" });

    fireEvent.change(editor, { target: { value: "# Standalone note\nDraft" } });
    await waitFor(() => expect(notesWrite).toHaveBeenCalledWith({ noteId: "note-1", content: "# Standalone note\nDraft" }), { timeout: 2_000 });

    fireEvent.change(editor, { target: { value: "# Standalone note\nFinal" } });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(standaloneNoteClose).toHaveBeenCalledTimes(1));
    expect(notesWrite).toHaveBeenLastCalledWith({ noteId: "note-1", content: "# Standalone note\nFinal" });
  });

  it("answers native close requests only after the pending save succeeds", async () => {
    const { getCloseCallback, notesWrite, standaloneNoteCloseReady } = installBridge();
    render(<I18nProvider><StandaloneNoteWindow noteId="note-1" /></I18nProvider>);
    const editor = await screen.findByRole("textbox", { name: "Standalone note editor" });
    fireEvent.change(editor, { target: { value: "# Standalone note\nBefore quit" } });

    const handler = getCloseCallback();
    expect(handler).toBeTypeOf("function");
    await act(async () => { handler?.(); });
    await waitFor(() => expect(notesWrite).toHaveBeenLastCalledWith({ noteId: "note-1", content: "# Standalone note\nBefore quit" }));
    await waitFor(() => expect(standaloneNoteCloseReady).toHaveBeenCalledWith({ ok: true }));
  });
});
