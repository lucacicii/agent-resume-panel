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
  "desktop.settings.paneNotes": "Notes",
  "desktop.settings.paneNotesDesc": "Notes desc",
  "desktop.settings.paneReport": "Report",
  "desktop.settings.paneReportDesc": "Report desc",
  "desktop.settings.paneStorage": "Storage",
  "desktop.settings.paneStorageDesc": "Storage desc",
  "desktop.settings.paneFieldflow": "Field Flow",
  "desktop.settings.paneFieldflowDesc": "Field Flow desc",
  "desktop.settings.fieldflow.explanationGroup": "Explanation",
  "desktop.settings.fieldflow.explanationLanguage": "Explanation language",
  "desktop.settings.fieldflow.explanationLanguageDesc": "Language for explanations",
  "desktop.settings.fieldflow.explanationLangAuto": "Auto (follow LLM output language)",
  "desktop.settings.fieldflow.explanationLangZh": "中文 (Chinese)",
  "desktop.settings.fieldflow.explanationLangEn": "English",
  "desktop.settings.fieldflow.explanationLangJa": "日本語 (Japanese)",
  "desktop.settings.fieldflow.languageNote": "Fallback note",
  "desktop.settings.fieldflow.scanGroup": "Scan filters",
  "desktop.settings.fieldflow.scanIntro": "Scan intro",
  "desktop.settings.fieldflow.useGitignore": "Use nested gitignore",
  "desktop.settings.fieldflow.useGitignoreDesc": "gitignore desc",
  "desktop.settings.fieldflow.useBuiltinDefaults": "Built-in defaults",
  "desktop.settings.fieldflow.useBuiltinDefaultsDesc": "builtin desc",
  "desktop.settings.fieldflow.useFieldflowIgnore": "Use fieldflowignore",
  "desktop.settings.fieldflow.useFieldflowIgnoreDesc": "fieldflowignore desc",
  "desktop.settings.fieldflow.includePaths": "Include paths",
  "desktop.settings.fieldflow.includePathsDesc": "include desc",
  "desktop.settings.fieldflow.extraIgnore": "Extra ignore",
  "desktop.settings.fieldflow.extraIgnoreDesc": "extra desc",
  "desktop.settings.fieldflow.projectConfigHint": "project config hint",
  "desktop.settings.fieldflow.watchEnabled": "Watch files",
  "desktop.settings.fieldflow.watchEnabledDesc": "watch desc",
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
  "desktop.settings.showApiKey": "Show API key",
  "desktop.settings.hideApiKey": "Hide API key",
  "desktop.settings.baseUrlOptional": "Base URL (optional)",
  "desktop.settings.apiKeyOptional": "API key (optional)",
  "desktop.settings.outputLanguage": "Output language",
  "desktop.settings.fieldOutputLanguageDescription": "Output lang desc",
  "desktop.settings.fieldOutputLanguageOptionAuto": "Auto",
  "desktop.settings.disableThinking": "Disable Thinking",
  "desktop.settings.disableThinkingDesc": "Send thinking:disabled for reasoning models.",
  "desktop.settings.testConnection": "Test Connection",
  "desktop.settings.testConnectionHint": "Uses the values currently in the form above (Save is not required).",
  "desktop.settings.testConnectionTesting": "Testing…",
  "desktop.settings.saving": "Saving…",
  "desktop.settings.saved": "Saved {0}",
  "desktop.settings.schedulerOn": "scheduler on",
  "desktop.settings.schedulerOff": "scheduler off",
  "desktop.settings.newSessionGroup": "New Session",
  "desktop.settings.defaultAgent": "Default agent",
  "desktop.settings.defaultAgentDesc": "CLI or ACP target",
  "desktop.settings.newSessionYolo": "Launch CLI sessions in YOLO mode",
  "desktop.settings.newSessionYoloDesc": "Use provider-specific YOLO flags",
  "desktop.settings.newSessionGroupCli": "CLI",
  "desktop.settings.newSessionGroupAcp": "ACP",
  "desktop.settings.newSessionTarget.askEveryTime": "Ask every time",
  "desktop.settings.acpAutoApprove": "ACP permissions",
  "desktop.settings.acpAutoApproveDesc": "ACP permission policy",
  "desktop.settings.acpAutoApproveAsk": "Ask each time",
  "desktop.settings.acpAutoApproveAllowAll": "Allow all",
  "desktop.settings.acpExperimentalGrokVendorUi": "Experimental Grok UI",
  "desktop.settings.acpExperimentalGrokVendorUiDesc": "Experimental",
  "desktop.settings.notesGroup": "Notes",
  "desktop.settings.notesFootnote": "Notes are Markdown files.",
  "desktop.settings.appData": "App data",
  "desktop.settings.appDataFootnote": "catalog.db lives under Panel home.",
  "desktop.settings.panelHome": "Panel home",
  "desktop.settings.panelHomeFootnote": "Reveal uses saved path.",
  "desktop.common.revealInFinder": "Reveal"
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
  const testModelConnection = vi.fn(async (args: { kind: string; draft: unknown }) => ({
    ok: true,
    message: `Connected mock (${args.kind})`
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
    testModelConnection,
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
  return { host, closeSettingsWindow, saveSettings, testModelConnection, navigateHandlers };
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

  it("renders and saves the Workbench CLI YOLO switch", async () => {
    const { host, saveSettings } = renderWindowSettings("workbench");
    await waitFor(() => expect(host.textContent).toContain("Launch CLI sessions in YOLO mode"));

    const title = [...host.querySelectorAll<HTMLElement>(".settings-row-title")]
      .find((element) => element.textContent === "Launch CLI sessions in YOLO mode");
    expect(title).not.toBeUndefined();
    const row = title?.closest("label");
    const toggle = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(toggle).not.toBeNull();

    fireEvent.click(toggle!);
    await waitFor(() => {
      const last = saveSettings.mock.calls.at(-1);
      expect(last?.[1]).toMatchObject({ section: "workbench" });
      expect((last?.[0] as { workbench?: { newSessionYolo?: boolean } }).workbench?.newSessionYolo).toBe(true);
    }, { timeout: 2000 });
  });

  it("tests each model group with current form values without saving", async () => {
    const { host, testModelConnection, saveSettings } = renderWindowSettings("models");
    await waitFor(() => expect(host.querySelector('[data-testid="settings-test-model-tool"]')).not.toBeNull());
    expect(host.querySelectorAll('[data-testid^="settings-test-model-"]')).toHaveLength(3);

    saveSettings.mockClear();
    fireEvent.click(host.querySelector('[data-testid="settings-test-model-tool"]')!);
    await waitFor(() => expect(testModelConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "tool",
        draft: expect.objectContaining({ llmBaseUrl: "https://example.test/v1", llmModel: "test" })
      })
    ));
    await waitFor(() => expect(host.textContent).toContain("Connected mock (tool)"));
    expect(saveSettings).not.toHaveBeenCalled();

    fireEvent.click(host.querySelector('[data-testid="settings-test-model-chat"]')!);
    await waitFor(() => expect(testModelConnection).toHaveBeenCalledWith(expect.objectContaining({ kind: "chat" })));

    fireEvent.click(host.querySelector('[data-testid="settings-test-model-embedding"]')!);
    await waitFor(() =>
      expect(testModelConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "embedding",
          draft: expect.objectContaining({ embModel: "text-embedding-3-small" })
        })
      )
    );
  });

  it("renders the Field Flow pane and saves the explanation language", async () => {
    const { host, saveSettings } = renderWindowSettings("fieldflow");
    await waitFor(() => expect(host.querySelectorAll(".settings-group").length).toBeGreaterThanOrEqual(2));
    const select = host.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("auto");
    fireEvent.change(select, { target: { value: "zh-cn" } });
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldFlow: expect.objectContaining({ explanationLanguage: "zh-cn", useGitignore: true })
      }),
      expect.objectContaining({ section: "fieldflow" })
    ));
  });

  it("reveals and hides model API keys", async () => {
    const { host } = renderWindowSettings("models");
    await waitFor(() => expect(host.querySelector('[data-testid="settings-api-key-llmApiKey"]')).not.toBeNull());

    const input = host.querySelector('[data-testid="settings-api-key-llmApiKey"]') as HTMLInputElement;
    const toggle = host.querySelector('[data-testid="settings-api-key-reveal-llmApiKey"]') as HTMLButtonElement;
    expect(input.type).toBe("password");
    expect(toggle.getAttribute("aria-label")).toBe("Show API key");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.change(input, { target: { value: "sk-secret-value" } });
    fireEvent.click(toggle);

    expect(input.type).toBe("text");
    expect(input.value).toBe("sk-secret-value");
    expect(toggle.getAttribute("aria-label")).toBe("Hide API key");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(input.type).toBe("password");
    expect(input.value).toBe("sk-secret-value");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    expect(host.querySelectorAll('[data-testid^="settings-api-key-reveal-"]')).toHaveLength(3);
  });



  it("keeps the Data Paths pane free of the Notes provider select", async () => {
    const { host } = renderWindowSettings("storage");
    await waitFor(() => expect(host.textContent).toContain("Panel home"));
    expect(host.querySelector("select.settings-row-control")).toBeNull();
  });
});
