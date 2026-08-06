import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AppChrome } from "./AppChrome";

function renderChrome(openSettingsWindow = vi.fn(async () => undefined)) {
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
        "desktop.top.sessionsRefTitle": "Sessions",
        "desktop.top.settingsTitle": "Settings",
        "desktop.top.settingsUpdateAvailable": "Update {0} is available"
      }
    }),
    onLocaleChanged: () => () => undefined,
    openSettingsWindow
  } as unknown as typeof window.agentResume;

  render(
    <I18nProvider>
      <AppChrome />
    </I18nProvider>
  );
  return { openSettingsWindow };
}

describe("AppChrome", () => {
  afterEach(() => cleanup());

  it("keeps primary tab active when switching among primary tabs", async () => {
    renderChrome();
    const report = await screen.findByRole("button", { name: "Report" });
    expect(report.classList.contains("active")).toBe(true);
    expect(document.querySelector(".cyber-chrome-breath-line")?.getAttribute("aria-hidden")).toBe("true");

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
      const labels = [...document.querySelectorAll(".primary-tabs .tab")].map((item) => item.textContent);
      expect(labels).toEqual(["Report", "Agent", "Workbench", "Notes", "Flow", "Kanban"]);
    });

  it("opens settings window without changing primary tab", async () => {
    const { openSettingsWindow } = renderChrome();
    const report = await screen.findByRole("button", { name: "Report" });
    expect(report.classList.contains("active")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(openSettingsWindow).toHaveBeenCalledWith({ pane: "general" });
    expect(screen.getByRole("button", { name: "Report" }).classList.contains("active")).toBe(true);
  });

  it("opens about pane from the update button", async () => {
    const { openSettingsWindow } = renderChrome();
    await screen.findByRole("button", { name: "Report" });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-resume:update-change", { detail: { available: true, version: "0.1.5" } })
      );
    });

    const updateBtn = await screen.findByRole("button", { name: "Update 0.1.5 is available" });
    fireEvent.click(updateBtn);
    expect(openSettingsWindow).toHaveBeenCalledWith({ pane: "about" });
  });

  it("reflects the update state emitted by the legacy renderer", async () => {
    renderChrome();
    await screen.findByRole("button", { name: "Report" });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-resume:update-change", { detail: { available: true, version: "0.1.5" } })
      );
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Update 0.1.5 is available" })).not.toBeNull()
    );
  });
});
