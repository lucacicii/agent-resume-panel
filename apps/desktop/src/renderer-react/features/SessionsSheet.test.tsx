import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@agent-resume/core";
import { I18nProvider } from "../i18n";
import { SessionsSheet } from "./SessionsSheet";

const session: AgentSession = {
  provider: "codex",
  id: "session-1",
  title: "Implement renderer migration",
  projectPath: "/work/agent-resume-panel",
  updatedAt: 1_700_000_000_000
};

function renderSessions() {
  const summarizeSession = vi.fn(async () => ({ summary: "Migrated the application shell.", language: "en", session }));
  const autoRenameSession = vi.fn(async () => ({
    title: "Migrate Desktop renderer",
    previousTitle: session.title,
    session,
    nativeRenamed: true
  }));

  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        "desktop.sessions.sheetTitle": "Sessions (reference)",
        "desktop.sessions.refreshList": "Refresh list",
        "desktop.sessions.previewHint": "Select a session",
        "desktop.sessions.meta": "{0} sessions · sync every {1}{2}",
        "desktop.sessions.lastSynced": " · last sync {0}",
        "desktop.sessions.summarizing": "Summarizing…",
        "desktop.sessions.summaryGenerated": "Summary generated",
        "desktop.sessions.renaming": "Renaming…",
        "desktop.sessions.renamed": "Renamed to {0}",
        "desktop.sessions.renamedNativeError": " ({0})",
        "desktop.sessions.noMessages": "No messages",
        "desktop.sessions.truncated": "(truncated)",
        "desktop.common.loading": "Loading…",
        "desktop.common.loadingPreview": "Loading preview…",
        "desktop.common.oneMinute": "1 min"
      }
    }),
    onLocaleChanged: () => () => undefined,
    listSessions: async () => [session],
    previewSession: async () => ({
      session,
      preview: { title: session.title, messages: [{ role: "user", text: "Please migrate the renderer." }] }
    }),
    summarizeSession,
    autoRenameSession,
    syncSessions: async () => ({ sessionCount: 1, syncedAt: 1_700_000_000_000, warnings: [] }),
    onSessionsSynced: () => () => undefined
  } as unknown as typeof window.agentResume;

  render(
    <I18nProvider>
      <SessionsSheet />
    </I18nProvider>
  );
  return { summarizeSession, autoRenameSession };
}

describe("SessionsSheet", () => {
  afterEach(() => cleanup());

  it("loads a session preview and supports summary and rename actions", async () => {
    const { summarizeSession, autoRenameSession } = renderSessions();

    await act(async () => {
      window.dispatchEvent(new Event("agent-resume:sessions-open"));
    });
    const row = await screen.findByRole("button", { name: /Implement renderer migration/ });
    fireEvent.click(row);
    await screen.findByText("Please migrate the renderer.");

    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));
    await waitFor(() => expect(summarizeSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1" }));
    await screen.findByText("Migrated the application shell.");

    fireEvent.click(screen.getByRole("button", { name: "Auto Rename" }));
    await waitFor(() => expect(autoRenameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1" }));
    await waitFor(() => expect(screen.getAllByText("Migrate Desktop renderer")).toHaveLength(2));
  });
});
