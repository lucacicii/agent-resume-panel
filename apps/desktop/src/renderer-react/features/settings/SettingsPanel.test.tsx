import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SettingsPanel } from "./SettingsPanel";

const messages = {
  "desktop.settings.title": "Settings",
  "desktop.settings.done": "Done",
  "desktop.settings.navLabel": "Settings sections",
  "desktop.settings.paneGeneral": "General",
  "desktop.settings.paneGeneralDesc": "General desc",
  "desktop.settings.paneModels": "Models",
  "desktop.settings.paneModelsDesc": "Models desc",
  "desktop.settings.paneSessions": "Sessions",
  "desktop.settings.paneSessionsDesc": "Sessions desc",
  "desktop.settings.paneWorkbench": "Workbench",
  "desktop.settings.paneWorkbenchDesc": "Workbench desc",
  "desktop.settings.paneReport": "Report",
  "desktop.settings.paneReportDesc": "Report desc",
  "desktop.settings.paneStorage": "Storage",
  "desktop.settings.paneStorageDesc": "Storage desc",
  "desktop.settings.paneUsage": "Usage",
  "desktop.settings.paneUsageDesc": "Usage desc",
  "desktop.settings.paneLogs": "Logs",
  "desktop.settings.paneLogsDesc": "Logs desc",
  "desktop.settings.paneAbout": "About",
  "desktop.settings.paneAboutDesc": "About desc",
  "desktop.settings.toolLlm": "Tool LLM",
  "desktop.settings.toolLlmFootnote": "For summaries and commits",
  "desktop.settings.chatLlm": "Ask & Agent LLM",
  "desktop.settings.chatModelFootnote": "For Ask and Agent chat",
  "desktop.settings.embedding": "Embedding",
  "desktop.settings.embeddingFootnote": "For semantic search",
  "desktop.settings.appearance": "Appearance",
  "desktop.settings.theme": "Theme",
  "desktop.settings.themeDesc": "Theme desc",
  "desktop.settings.themeSystem": "System",
  "desktop.settings.themeLight": "Light",
  "desktop.settings.themeDark": "Dark",
  "desktop.settings.terminalTheme": "Terminal theme",
  "desktop.settings.terminalThemeDesc": "Terminal theme desc",
  "desktop.settings.terminalThemeDefaultDark": "Default Dark",
  "desktop.settings.terminalThemeDefaultLight": "Default Light",
  "desktop.settings.terminalThemeSolarizedDark": "Solarized Dark",
  "desktop.settings.terminalThemeSolarizedLight": "Solarized Light",
  "desktop.settings.terminalThemeOneDark": "One Dark",
  "desktop.settings.terminalThemeDracula": "Dracula",
  "desktop.settings.fieldUiLanguageDescription": "UI language",
  "desktop.settings.fieldUiLanguageOptionAuto": "Auto",
  "desktop.settings.baseUrl": "Base URL",
  "desktop.settings.model": "Model",
  "desktop.settings.apiKey": "API key",
  "desktop.settings.baseUrlOptional": "Base URL (optional)",
  "desktop.settings.apiKeyOptional": "API key (optional)",
  "desktop.settings.outputLanguage": "Output language",
  "desktop.settings.fieldOutputLanguageDescription": "Output lang desc",
  "desktop.settings.fieldOutputLanguageOptionAuto": "Auto",
  "desktop.settings.saving": "Saving…",
  "desktop.settings.saved": "Saved {0}",
  "desktop.settings.schedulerOn": "scheduler on",
  "desktop.settings.schedulerOff": "scheduler off"
};

function renderWindowSettings(initialPane = "general") {
  const host = document.createElement("div");
  host.id = "react-settings";
  document.body.append(host);
  const closeSettingsWindow = vi.fn(async () => ({ ok: true }));
  const saveSettings = vi.fn(async (settings: unknown, options?: { section?: string }) => ({
    file: "/tmp/settings.json",
    settings,
    schedulerEnabled: false,
    options
  }));
  const navigateHandlers: Array<(payload: { pane: string }) => void> = [];
  vi.spyOn(window, "confirm").mockReturnValue(true);
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages }),
    onLocaleChanged: () => () => undefined,
    getSettings: async () => ({
      uiLanguage: "en",
      llm: { baseUrl: "https://example.test/v1", model: "test", apiKey: "" },
      embedding: { model: "text-embedding-3-small" },
      desktop: { theme: "system" }
    }),
    saveSettings,
    closeSettingsWindow,
    onSettingsNavigate: (callback: (payload: { pane: string }) => void) => {
      navigateHandlers.push(callback);
      return () => undefined;
    }
  } as unknown as typeof window.agentResume;
  render(
    <I18nProvider>
      <SettingsPanel variant="window" initialPane={initialPane} />
    </I18nProvider>
  );
  return { host, closeSettingsWindow, saveSettings, navigateHandlers };
}

describe("SettingsPanel (window)", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("react-settings")?.remove();
  });

  it("opens on mount and ignores primary tab changes", async () => {
    const { host } = renderWindowSettings();
    await waitFor(() => expect(host.querySelector(".react-settings-panel")).not.toBeNull());

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" }));
    });
    expect(host.querySelector(".react-settings-panel")).not.toBeNull();
  });

  it("Done closes the settings window via IPC", async () => {
    const { host, closeSettingsWindow } = renderWindowSettings();
    await waitFor(() => expect(host.querySelector(".react-settings-panel")).not.toBeNull());
    const done = host.querySelector("button.ghost-btn");
    expect(done).not.toBeNull();
    fireEvent.click(done!);
    expect(closeSettingsWindow).toHaveBeenCalled();
  });

  it("navigates pane via onSettingsNavigate", async () => {
    const { host, navigateHandlers } = renderWindowSettings("general");
    await waitFor(() => expect(host.querySelector(".react-settings-panel")).not.toBeNull());
    await act(async () => {
      navigateHandlers[0]?.({ pane: "models" });
    });
    await waitFor(() => expect(host.querySelectorAll(".settings-group")).toHaveLength(3));
    expect(host.textContent).toContain("Tool LLM");
  });

  it("separates models by the feature that uses them", async () => {
    const { host } = renderWindowSettings("models");
    await waitFor(() => expect(host.querySelectorAll(".settings-group")).toHaveLength(3));
    expect(host.textContent).toContain("Tool LLM");
    expect(host.textContent).toContain("For summaries and commits");
    expect(host.textContent).toContain("Ask & Agent LLM");
    expect(host.textContent).toContain("For semantic search");
  });

  it("passes section when saving", async () => {
    const { host, saveSettings } = renderWindowSettings("models");
    await waitFor(() => expect(host.querySelector(".settings-group")).not.toBeNull());
    const input = host.querySelector('input[type="text"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: "https://changed.test/v1" } });
    await waitFor(
      () => {
        expect(saveSettings).toHaveBeenCalled();
        const last = saveSettings.mock.calls.at(-1);
        expect(last?.[1]).toMatchObject({ section: "models" });
      },
      { timeout: 2000 }
    );
  });
});
