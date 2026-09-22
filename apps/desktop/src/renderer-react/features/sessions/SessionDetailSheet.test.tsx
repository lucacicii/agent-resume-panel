import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@agent-resume/core";
import { I18nProvider } from "../../i18n";
import { SessionDetailSheet } from "./SessionDetailSheet";

function makeSession(): AgentSession {
  return {
    provider: "codex",
    id: "session-1",
    title: "Fix renderer",
    projectPath: "/work/app",
    updatedAt: 2000,
    sessionSummary: "Refactored the board.",
    messageCount: 12,
    model: "gpt-5",
    branch: "main"
  } as AgentSession;
}

function renderSheet(overrides?: {
  api?: Partial<typeof window.agentResume>;
  onClose?: () => void;
  onTitleChanged?: (key: string, title: string) => void;
}) {
  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        "desktop.common.rename": "Rename",
        "desktop.common.cancel": "Cancel",
        "desktop.common.copied": "Copied",
        "desktop.sessions.autoRename": "AI rename",
        "desktop.sessions.openWorkbench": "Open workbench",
        "desktop.sessions.copyKey": "Copy session id",
        "desktop.sessions.renameFailed": "Rename failed: {0}",
        "desktop.sessions.renamed": "Renamed to \"{0}\"",
        "desktop.sessions.renamedNativeError": "",
        "desktop.sessions.colProvider": "Provider",
        "desktop.sessions.colProject": "Project",
        "desktop.sessions.colUpdated": "Updated",
        "desktop.sessions.colSessionId": "Session id",
        "desktop.sessions.colInfo": "Info",
        "desktop.sessions.colSummary": "Summary",
        "desktop.sessions.messageCount": "{0} messages",
        "desktop.sessions.noTask": "This session is not linked to a task"
      }
    }),
    onLocaleChanged: () => () => undefined,
    previewSession: vi.fn(async () => ({
      session: makeSession(),
      preview: { title: "Fix renderer", messages: [{ role: "user", text: "hello" }] }
    })),
    notesTaskNoteIdForSession: vi.fn(async () => "task-1"),
    ensureTaskWorkbench: vi.fn(async () => ({ workbenchId: "wb-1" })),
    listTaskWorkbenches: vi.fn(async () => [{ workbenchId: "wb-1", taskNoteId: "task-1" }]),
    taskWindowOpen: vi.fn(async () => ({ ok: true as const, created: false })),
    renameSession: vi.fn(async () => ({ title: "Fix renderer", nativeRenamed: true })),
    autoRenameSession: vi.fn(async () => ({ title: "Suggested title", nativeRenamed: true })),
    syncSessions: vi.fn(async () => undefined),
    ...overrides?.api
  } as unknown as typeof window.agentResume;

  render(
    <I18nProvider>
      <SessionDetailSheet
        session={makeSession()}
        onClose={overrides?.onClose ?? (() => undefined)}
        onTitleChanged={overrides?.onTitleChanged}
      />
    </I18nProvider>
  );
}

describe("SessionDetailSheet", () => {
  afterEach(cleanup);

  it("shows the session facts and its transcript", async () => {
    renderSheet();
    expect(await screen.findByText("app")).toBeTruthy();
    expect(screen.getByText("session-1")).toBeTruthy();
    expect(screen.getByText("Refactored the board.")).toBeTruthy();
    expect(screen.getByText("gpt-5 · main · 12 messages")).toBeTruthy();
    await waitFor(() => expect(window.agentResume.previewSession).toHaveBeenCalledWith({
      provider: "codex",
      id: "session-1"
    }));
  });

  it("opens the owning task's workbench window, then closes", async () => {
    const onClose = vi.fn();
    renderSheet({ onClose });
    fireEvent.click(await screen.findByRole("button", { name: "Open workbench" }));
    await waitFor(() => expect(window.agentResume.taskWindowOpen).toHaveBeenCalledWith({
      noteId: "task-1",
      workbenchId: "wb-1",
      title: "Fix renderer"
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renames the session from the head action", async () => {
    const onTitleChanged = vi.fn();
    renderSheet({ onTitleChanged });
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: "Rename" });
    fireEvent.change(input, { target: { value: "Renamed by test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(window.agentResume.renameSession).toHaveBeenCalledWith({
      provider: "codex",
      id: "session-1",
      title: "Renamed by test"
    }));
    expect(onTitleChanged).toHaveBeenCalledWith("codex:session-1", "Renamed by test");
  });

  it("renames the session with the AI suggestion", async () => {
    const onTitleChanged = vi.fn();
    renderSheet({ onTitleChanged });
    fireEvent.click(await screen.findByRole("button", { name: "AI rename" }));
    await waitFor(() => expect(window.agentResume.autoRenameSession).toHaveBeenCalledWith({
      provider: "codex",
      id: "session-1",
      persist: true
    }));
    expect(onTitleChanged).toHaveBeenCalledWith("codex:session-1", "Suggested title");
  });
});
