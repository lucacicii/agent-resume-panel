import { forwardRef, useImperativeHandle } from "react";
import type { GtdStatus } from "@agent-resume/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { FloatingSessionNote, initialSessionNoteContent } from "./FloatingSessionNote";

vi.mock("../../components/CodeEditor", () => ({
  CodeEditor: forwardRef(({ value, onChange, ariaLabel }: { value: string; onChange: (value: string) => void; ariaLabel: string }, ref) => {
    useImperativeHandle(ref, () => ({ focus: vi.fn() }));
    return <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />;
  })
}));

const messages = {
  "desktop.workbench.floatingNote": "Floating note",
  "desktop.workbench.floatingNoteClose": "Close floating note",
  "desktop.workbench.floatingNoteEditor": "Floating note editor",
  "desktop.workbench.floatingNoteLoading": "Loading floating note…",
  "desktop.workbench.floatingNoteCreating": "Creating floating note…",
  "desktop.workbench.floatingNoteDeleting": "Deleting…",
  "desktop.workbench.floatingNoteSaving": "Saving…",
  "desktop.workbench.floatingNoteSaved": "Saved",
  "desktop.workbench.floatingNoteUnsaved": "Unsaved changes",
  "desktop.workbench.floatingNoteLoadFailed": "Could not open floating note.",
  "desktop.workbench.floatingNoteLoadError": "Could not open floating note: {0}",
  "desktop.workbench.floatingNoteSaveFailed": "Save failed: {0}",
  "desktop.workbench.floatingNoteDeleteFailed": "Delete failed: {0}",
  "desktop.notes.deleteNote": "Delete note",
  "desktop.notes.deleteConfirm": "Delete note \"{0}\"? Its assets folder will also be removed.",
  "desktop.workbench.setGtdStatus": "Set GTD status",
  "desktop.workbench.clearGtdStatus": "Clear GTD status",
  "desktop.workbench.gtdStatusSaveFailed": "Could not save GTD status: {0}",
  "desktop.workbench.gtdStatus.inbox": "Inbox",
  "desktop.workbench.gtdStatus.next": "Next",
  "desktop.workbench.gtdStatus.waiting": "Waiting",
  "desktop.workbench.gtdStatus.someday": "Someday",
  "desktop.workbench.gtdStatus.reference": "Reference",
  "desktop.workbench.gtdStatus.done": "Done"
};

const target = {
  provider: "codex",
  sessionId: "session-1",
  projectPath: "/work/app",
  projectName: "app",
  sessionTitle: "Fix renderer"
};

function dispatchPointer(target: EventTarget, type: string, init: { button?: number; clientX?: number; clientY?: number; pointerId?: number }) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  target.dispatchEvent(event);
}

const note = (noteId: string, updatedAtMs: number, content = "# Existing\n") => ({
  noteId,
  scope: "session",
  provider: "codex",
  agentSessionId: "session-1",
  projectPath: "/work/app",
  filename: `${noteId}.md`,
  relDir: "sessions/codex",
  relMdPath: `notes/sessions/codex/${noteId}.md`,
  title: "Existing",
  contentPreview: content,
  createdAtMs: updatedAtMs - 1,
  updatedAtMs
});

function installBridge(overrides: Partial<typeof window.agentResume> = {}) {
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages }),
    onLocaleChanged: () => () => undefined,
    notesList: async () => [],
    notesRead: async ({ noteId }: { noteId: string }) => ({ record: note(noteId, 1), content: "# Existing\n" }),
    notesWrite: vi.fn(async ({ noteId, content }: { noteId: string; content: string }) => ({ noteId, filename: `${noteId}.md`, updatedAtMs: Date.now(), content })),
    notesSetGtdStatus: vi.fn(async ({ noteId, status }: { noteId: string; status: string | null }) => ({ ...note(noteId, Date.now()), gtdStatus: status || undefined })),
    notesDelete: vi.fn(async ({ noteId }: { noteId: string }) => ({ ok: true, deletedNoteIds: [noteId] })),
    notesCreate: vi.fn(async () => ({ noteId: "created-note", filename: "created.md" })),
    ...overrides
  } as unknown as typeof window.agentResume;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("FloatingSessionNote", () => {
  it("uses the latest linked session note and debounces edits", async () => {
    const notesRead = vi.fn(async ({ noteId }: { noteId: string }) => ({
      record: note(noteId, noteId === "latest" ? 20 : 10),
      content: noteId === "latest" ? "# Latest\n" : "# Older\n"
    }));
    const notesCreate = vi.fn(async () => ({ noteId: "created", filename: "created.md" }));
    const notesWrite = vi.fn(async ({ noteId, content }: { noteId: string; content: string }) => ({ noteId, filename: `${noteId}.md`, updatedAtMs: 30, content }));
    installBridge({
      notesList: async () => [note("older", 10), note("latest", 20)],
      notesRead,
      notesCreate,
      notesWrite
    });
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<I18nProvider><FloatingSessionNote target={target} onClose={onClose} /></I18nProvider>);

    await act(async () => { await vi.runAllTimersAsync(); });
    expect(notesRead).toHaveBeenCalledWith({ noteId: "latest" });
    expect(notesCreate).not.toHaveBeenCalled();
    const editor = screen.getByRole("textbox", { name: "Floating note editor" });
    expect(screen.getByText("app")).toBeTruthy();
    expect(screen.getByText("Fix renderer")).toBeTruthy();
    expect((editor as HTMLTextAreaElement).value).toBe("# Latest\n");

    fireEvent.change(editor, { target: { value: "# Latest\nChanged" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(799); });
    expect(notesWrite).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(notesWrite).toHaveBeenCalledWith({ noteId: "latest", content: "# Latest\nChanged" });
  });

  it("sets the floating note GTD status through catalog metadata", async () => {
    const notesSetGtdStatus = vi.fn(async ({ noteId, status }: { noteId: string; status: GtdStatus | null }) => ({ ...note(noteId, 30), gtdStatus: status || undefined }));
    installBridge({ notesSetGtdStatus });
    render(<I18nProvider><FloatingSessionNote target={target} onClose={vi.fn()} /></I18nProvider>);

    await screen.findByRole("textbox", { name: "Floating note editor" });
    fireEvent.change(screen.getByRole("combobox", { name: "Set GTD status" }), { target: { value: "waiting" } });
    await waitFor(() => expect(notesSetGtdStatus).toHaveBeenCalledWith({ noteId: "created-note", status: "waiting" }));
  });

  it("creates the session note with a title and flushes pending content on close", async () => {
    const notesCreate = vi.fn(async () => ({ noteId: "created-note", filename: "created.md" }));
    const notesWrite = vi.fn(async ({ noteId, content }: { noteId: string; content: string }) => ({ noteId, filename: "created.md", updatedAtMs: 2, content }));
    installBridge({ notesCreate, notesWrite });
    const onClose = vi.fn();
    render(<I18nProvider><FloatingSessionNote target={target} onClose={onClose} /></I18nProvider>);

    await waitFor(() => expect(notesCreate).toHaveBeenCalledWith({
      scope: "session",
      projectPath: "/work/app",
      provider: "codex",
      sessionId: "session-1"
    }));
    expect(notesWrite).toHaveBeenCalledWith({ noteId: "created-note", content: initialSessionNoteContent(target) });
    const editor = await screen.findByRole("textbox", { name: "Floating note editor" });
    fireEvent.change(editor, { target: { value: "# Fix renderer\nDraft" } });
    fireEvent.click(screen.getByRole("button", { name: "Close floating note" }));
    await waitFor(() => expect(notesWrite).toHaveBeenLastCalledWith({ noteId: "created-note", content: "# Fix renderer\nDraft" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("confirms deletion, removes the linked session note, and closes the panel", async () => {
    const notesDelete = vi.fn(async ({ noteId }: { noteId: string }) => ({ ok: true, deletedNoteIds: [noteId] }));
    const onClose = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    installBridge({
      notesList: async () => [note("latest", 20)],
      notesRead: async ({ noteId }: { noteId: string }) => ({ record: note(noteId, 20), content: "# Latest\n" }),
      notesDelete
    });
    render(<I18nProvider><FloatingSessionNote target={target} onClose={onClose} /></I18nProvider>);

    await screen.findByRole("textbox", { name: "Floating note editor" });
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    expect(confirm).toHaveBeenCalledWith("Delete note \"app · Fix renderer\"? Its assets folder will also be removed.");
    await waitFor(() => expect(notesDelete).toHaveBeenCalledWith({ noteId: "latest" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not delete the linked session note when confirmation is cancelled", async () => {
    const notesDelete = vi.fn(async ({ noteId }: { noteId: string }) => ({ ok: true, deletedNoteIds: [noteId] }));
    const onClose = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    installBridge({
      notesList: async () => [note("latest", 20)],
      notesRead: async ({ noteId }: { noteId: string }) => ({ record: note(noteId, 20), content: "# Latest\n" }),
      notesDelete
    });
    render(<I18nProvider><FloatingSessionNote target={target} onClose={onClose} /></I18nProvider>);

    await screen.findByRole("textbox", { name: "Floating note editor" });
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    expect(notesDelete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows load errors and closes with Escape", async () => {
    const onClose = vi.fn();
    installBridge({ notesList: async () => { throw new Error("read failed"); } });
    render(<I18nProvider><FloatingSessionNote target={target} onClose={onClose} /></I18nProvider>);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not open floating note: read failed"));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("drags from the title bar and clamps the panel to the viewport", async () => {
    installBridge({
      notesList: async () => [note("latest", 20)],
      notesRead: async ({ noteId }: { noteId: string }) => ({ record: note(noteId, 20), content: "# Latest\n" })
    });
    const previousWidth = window.innerWidth;
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    render(<I18nProvider><FloatingSessionNote target={target} onClose={vi.fn()} /></I18nProvider>);

    const panel = await screen.findByRole("dialog", { name: "Floating note" });
    const rect = {
      left: 100,
      top: 80,
      right: 500,
      bottom: 380,
      width: 400,
      height: 300,
      x: 100,
      y: 80,
      toJSON: () => ({})
    } as DOMRect;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rect);
    const header = panel.querySelector<HTMLElement>(".wb-floating-note-head")!;
    await act(async () => {
      dispatchPointer(header, "pointerdown", { button: 0, clientX: 120, clientY: 100 });
    });
    expect(panel.className).toContain("is-dragging");
    await act(async () => {
      dispatchPointer(window, "pointermove", { clientX: 790, clientY: 590 });
    });

    expect(panel.style.left).toBe("392px");
    expect(panel.style.top).toBe("292px");
    expect(panel.className).toContain("is-dragging");
    await act(async () => dispatchPointer(window, "pointerup", { clientX: 790, clientY: 590 }));
    expect(panel.className).not.toContain("is-dragging");

    Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: previousHeight });
  });

  it("does not start dragging when the close button is pressed", async () => {
    installBridge({
      notesList: async () => [note("latest", 20)],
      notesRead: async ({ noteId }: { noteId: string }) => ({ record: note(noteId, 20), content: "# Latest\n" })
    });
    render(<I18nProvider><FloatingSessionNote target={target} onClose={vi.fn()} /></I18nProvider>);
    const panel = await screen.findByRole("dialog", { name: "Floating note" });
    const closeButton = screen.getByRole("button", { name: "Close floating note" });
    await act(async () => {
      dispatchPointer(closeButton, "pointerdown", { button: 0, clientX: 120, clientY: 100 });
    });
    dispatchPointer(window, "pointermove", { clientX: 500, clientY: 400 });
    expect(panel.style.left).toBe("");
    expect(panel.style.top).toBe("");
  });
});
