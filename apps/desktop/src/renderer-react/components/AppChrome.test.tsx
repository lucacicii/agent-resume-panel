import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AppChrome } from "./AppChrome";

function renderChrome(options?: {
  standaloneNoteList?: Array<{ noteId: string; title: string }>;
}) {
  let openSessionsHandler: (() => void) | undefined;
  let notesChangedHandler: ((notes: Array<{ noteId: string; title: string }>) => void) | undefined;
  const standaloneNoteOpen = vi.fn(async () => ({ ok: true as const }));
  const standaloneNoteList = vi.fn(async () => options?.standaloneNoteList ?? []);
  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        "desktop.tabs.report": "Report",
        "desktop.tabs.agent": "Agent",
        "desktop.tabs.workbench": "Workbench",
        "desktop.tabs.notes": "Notes",
        "desktop.tabs.flow": "Flow",
        "desktop.tabs.kanban": "Kanban",
        "desktop.workbench.sessionDot.awaiting": "Waiting for you",
        "desktop.workbench.sessionDot.possiblyAwaiting": "May need attention",
        "desktop.workbench.sessionDot.running": "Running",
        "desktop.workbench.sessionDot.connecting": "Connecting",
        "desktop.workbench.sessionDot.error": "Error"
      }
    }),
    onLocaleChanged: () => () => undefined,
    onOpenSessions: (callback: () => void) => {
      openSessionsHandler = callback;
      return () => undefined;
    },
    standaloneNoteList,
    onStandaloneNotesChanged: (callback: (notes: Array<{ noteId: string; title: string }>) => void) => {
      notesChangedHandler = callback;
      return () => undefined;
    },
    standaloneNoteOpen
  } as unknown as typeof window.agentResume;

  render(
    <I18nProvider>
      <AppChrome />
    </I18nProvider>
  );
  return {
    getOpenSessionsHandler: () => openSessionsHandler,
    pushNoteDots: (notes: Array<{ noteId: string; title: string }>) => notesChangedHandler?.(notes),
    standaloneNoteOpen,
    standaloneNoteList
  };
}

describe("AppChrome", () => {
  afterEach(() => cleanup());

  it("keeps primary tab active when switching among primary tabs", async () => {
    renderChrome();
    const report = await screen.findByRole("button", { name: "Report" });
    expect(report.classList.contains("active")).toBe(true);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Agent" }).classList.contains("active")).toBe(true)
    );
  });

  it("places Flow immediately after Notes in primary navigation", async () => {
    renderChrome();
    await screen.findByRole("button", { name: "Flow" });
    const labels = [...document.querySelectorAll(".app-nav-rail .rail-btn")].map((item) =>
      item.getAttribute("aria-label")
    );
    expect(labels).toEqual(["Report", "Agent", "Workbench", "Notes", "Flow", "Kanban"]);
  });

  it("requests the primary tab when a rail button is clicked", async () => {
    renderChrome();
    await screen.findByRole("button", { name: "Report" });
    const listener = vi.fn();
    window.addEventListener("agent-resume:tab-change", listener);
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: "notes" }));
    window.removeEventListener("agent-resume:tab-change", listener);
  });

  it("opens the sessions reference when requested from the native menu", async () => {
    const { getOpenSessionsHandler } = renderChrome();
    await screen.findByRole("button", { name: "Report" });
    const listener = vi.fn();
    window.addEventListener("agent-resume:sessions-open", listener);
    const handler = getOpenSessionsHandler();
    expect(handler).toBeDefined();
    await act(async () => handler?.());
    expect(listener).toHaveBeenCalled();
    window.removeEventListener("agent-resume:sessions-open", listener);
  });

  it("renders one dot per active session and shows a tooltip with the full title on hover", async () => {
    renderChrome();
    await screen.findByRole("button", { name: "Report" });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:active-sessions", { detail: [
        { paneKey: "terminal:1", projectPath: "/proj/a", title: "A very long session title here", sessionKey: "cli:s1", status: "open" },
        { paneKey: "acp:abc", projectPath: "/proj/a", title: "Short", sessionKey: "chat:abc", status: "open" }
      ] }));
    });
    const dots = [...document.querySelectorAll<HTMLButtonElement>(".rail-session-dot-btn")];
    expect(dots).toHaveLength(2);
    expect(dots[0].getAttribute("aria-label")).toBe("A very long session title here");
    expect(dots[0].hasAttribute("title")).toBe(false);
    expect(dots[1].getAttribute("aria-label")).toBe("Short");

    fireEvent.mouseOver(dots[0]);
    expect((await screen.findByRole("tooltip")).textContent).toBe("A very long session title here");
  });

  it("applies status classes and tooltip suffixes for runtime states", async () => {
    renderChrome();
    await screen.findByRole("button", { name: "Report" });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:active-sessions", { detail: [
        {
          paneKey: "acp:await",
          projectPath: "/p",
          title: "Needs you",
          sessionKey: "chat:await",
          status: "awaiting_user",
          awaitingConfidence: "confirmed"
        },
        {
          paneKey: "terminal:run",
          projectPath: "/p",
          title: "Busy",
          sessionKey: "cli:run",
          status: "running"
        },
        {
          paneKey: "terminal:maybe",
          projectPath: "/p",
          title: "Quiet TUI",
          sessionKey: "cli:maybe",
          status: "awaiting_user",
          awaitingConfidence: "possible"
        }
      ] }));
    });
    const dots = [...document.querySelectorAll<HTMLButtonElement>(".rail-session-dot-btn")];
    expect(dots).toHaveLength(3);
    expect(dots[0].querySelector(".rail-session-dot")?.classList.contains("is-awaiting")).toBe(true);
    expect(dots[1].querySelector(".rail-session-dot")?.classList.contains("is-running")).toBe(true);
    expect(dots[0].getAttribute("aria-label")).toContain("Waiting for you");
    expect(dots[1].getAttribute("aria-label")).toContain("Running");
    expect(dots[2].getAttribute("aria-label")).toContain("May need attention");
  });

  it("renders no dots when no sessions are open", async () => {
    renderChrome();
    await screen.findByRole("button", { name: "Report" });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:active-sessions", { detail: [] }));
    });
    expect(document.querySelectorAll(".rail-session-dot-btn").length).toBe(0);
  });

  it("requests workbench and focuses the session when a dot is clicked", async () => {
    renderChrome();
    await screen.findByRole("button", { name: "Report" });
    const tabReq = vi.fn();
    const focusReq = vi.fn();
    window.addEventListener("agent-resume:tab-request", tabReq);
    window.addEventListener("agent-resume:workbench-focus-session", focusReq);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:active-sessions", { detail: [
        { paneKey: "terminal:9", projectPath: "/proj/x", title: "Alpha", sessionKey: "cli:s9", status: "open" }
      ] }));
    });
    const dot = document.querySelector<HTMLButtonElement>(".rail-session-dot-btn");
    expect(dot).not.toBeNull();
    fireEvent.click(dot!);
    expect(tabReq).toHaveBeenCalledWith(expect.objectContaining({ detail: "workbench" }));
    expect(focusReq).toHaveBeenCalledWith(expect.objectContaining({
      detail: { paneKey: "terminal:9", projectPath: "/proj/x" }
    }));
    window.removeEventListener("agent-resume:tab-request", tabReq);
    window.removeEventListener("agent-resume:workbench-focus-session", focusReq);
  });

  it("renders floating note dots above session dots and focuses a note on click", async () => {
    const { standaloneNoteOpen, pushNoteDots } = renderChrome({
      standaloneNoteList: [{ noteId: "n1", title: "Scratch pad" }]
    });
    await screen.findByRole("button", { name: "Report" });
    await waitFor(() => expect(document.querySelectorAll(".rail-note-dot-btn").length).toBe(1));

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:active-sessions", { detail: [
        { paneKey: "terminal:1", projectPath: "/p", title: "Session A", sessionKey: "cli:s1", status: "open" }
      ] }));
    });

    const bottom = document.querySelector(".rail-bottom-dots");
    expect(bottom).not.toBeNull();
    const notesCluster = bottom!.querySelector(".rail-notes-dots");
    const sessionsCluster = bottom!.querySelector(".rail-session-dots");
    expect(notesCluster).not.toBeNull();
    expect(sessionsCluster).not.toBeNull();
    expect(
      Boolean(notesCluster!.compareDocumentPosition(sessionsCluster!) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);

    const noteDot = document.querySelector<HTMLButtonElement>(".rail-note-dot-btn");
    expect(noteDot?.getAttribute("aria-label")).toBe("Scratch pad");
    const tabReq = vi.fn();
    window.addEventListener("agent-resume:tab-request", tabReq);
    fireEvent.click(noteDot!);
    await waitFor(() => expect(standaloneNoteOpen).toHaveBeenCalledWith({ noteId: "n1" }));
    expect(tabReq).not.toHaveBeenCalled();
    window.removeEventListener("agent-resume:tab-request", tabReq);

    await act(async () => {
      pushNoteDots([]);
    });
    expect(document.querySelectorAll(".rail-note-dot-btn").length).toBe(0);
    expect(document.querySelector(".rail-session-dots")).not.toBeNull();
  });

  it("updates floating note dots when the open-notes list changes", async () => {
    const { pushNoteDots } = renderChrome();
    await screen.findByRole("button", { name: "Report" });
    expect(document.querySelectorAll(".rail-note-dot-btn").length).toBe(0);

    await act(async () => {
      pushNoteDots([
        { noteId: "a", title: "Alpha note" },
        { noteId: "b", title: "Beta note" }
      ]);
    });
    const dots = [...document.querySelectorAll<HTMLButtonElement>(".rail-note-dot-btn")];
    expect(dots).toHaveLength(2);
    expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual(["Alpha note", "Beta note"]);
  });
});
