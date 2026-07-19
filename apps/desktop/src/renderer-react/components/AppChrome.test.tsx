import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { AppChrome } from "./AppChrome";

function renderChrome() {
  window.agentResume = {
    getI18nBundle: async () => ({
      locale: "en",
      messages: {
        "desktop.tabs.report": "Report",
        "desktop.tabs.agent": "Agent",
        "desktop.tabs.workbench": "Workbench",
        "desktop.tabs.notes": "Notes",
        "desktop.top.sessionsRefTitle": "Sessions",
        "desktop.top.settingsTitle": "Settings",
        "desktop.top.settingsUpdateAvailable": "Update {0} is available"
      }
    }),
    onLocaleChanged: () => () => undefined
  } as unknown as typeof window.agentResume;

  render(
    <I18nProvider>
      <AppChrome />
    </I18nProvider>
  );
}

describe("AppChrome", () => {
  afterEach(() => cleanup());

  it("reflects legacy tab changes without highlighting a primary tab in Settings", async () => {
    renderChrome();
    const report = await screen.findByRole("button", { name: "Report" });
    expect(report.classList.contains("active")).toBe(true);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "agent" }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Agent" }).classList.contains("active")).toBe(true));

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "settings" }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Agent" }).classList.contains("active")).toBe(false));
  });

  it("reflects the update state emitted by the legacy renderer", async () => {
    renderChrome();
    await screen.findByRole("button", { name: "Report" });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-resume:update-change", { detail: { available: true, version: "0.1.5" } })
      );
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Update 0.1.5 is available" })).not.toBeNull());
  });
});
