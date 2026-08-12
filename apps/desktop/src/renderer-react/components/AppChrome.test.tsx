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
});
