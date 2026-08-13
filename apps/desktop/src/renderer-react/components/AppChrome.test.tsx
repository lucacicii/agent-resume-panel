import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AppChrome } from "./AppChrome";

function renderChrome() {
  let openSessionsHandler: (() => void) | undefined;
  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        "desktop.tabs.report": "Report",
        "desktop.tabs.agent": "Agent",
        "desktop.tabs.workbench": "Workbench",
        "desktop.tabs.notes": "Notes",
        "desktop.tabs.flow": "Flow",
        "desktop.tabs.kanban": "Kanban"
      }
    }),
    onLocaleChanged: () => () => undefined,
    onOpenSessions: (callback: () => void) => {
      openSessionsHandler = callback;
      return () => undefined;
    }
  } as unknown as typeof window.agentResume;

  render(
    <I18nProvider>
      <AppChrome />
    </I18nProvider>
  );
  return { getOpenSessionsHandler: () => openSessionsHandler };
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
        { paneKey: "terminal:1", projectPath: "/proj/a", title: "A very long session title here", sessionKey: "cli:s1" },
        { paneKey: "acp:abc", projectPath: "/proj/a", title: "Short", sessionKey: "chat:abc" }
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
        { paneKey: "terminal:9", projectPath: "/proj/x", title: "Alpha", sessionKey: "cli:s9" }
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
});
