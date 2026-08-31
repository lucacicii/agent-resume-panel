import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SettingsPanel } from "./SettingsPanel";

interface MockProviderFetchModelsResult {
  ok: boolean;
  models?: Array<{ id: string; kind: string }>;
  message?: string;
}

const messages = {
  "desktop.settings.title": "Settings",
  "desktop.settings.done": "Done",
  "desktop.settings.navLabel": "Settings sections",
  "desktop.settings.paneGeneral": "General",
  "desktop.settings.paneGeneralDesc": "General desc",
  "desktop.settings.paneProviders": "Providers",
  "desktop.settings.paneProvidersDesc": "Provider pool",
  "desktop.settings.paneSessions": "Sessions",
  "desktop.settings.paneSessionsDesc": "Sessions desc",
  "desktop.settings.paneWorkbench": "Workbench",
  "desktop.settings.paneWorkbenchDesc": "Workbench desc",
  "desktop.settings.paneIm": "IM",
  "desktop.settings.paneImDesc": "IM role templates",
  "desktop.settings.imTemplates": "Roles",
  "desktop.settings.imTemplatesHint": "Edit agent, prompt, and tools.",
  "desktop.settings.imBuiltin": "Builtin",
  "desktop.settings.imNewTemplate": "New template",
  "desktop.settings.imName": "Name",
  "desktop.settings.imAgent": "Agent",
  "desktop.settings.imModel": "Model",
  "desktop.settings.imModelDefault": "Default",
  "desktop.settings.imModelCustom": "Custom",
  "desktop.settings.imModelPlaceholder": "e.g. claude-3-7-sonnet-20250219",
  "desktop.settings.imModelHint": "Model hint",
  "desktop.settings.imPrompt": "Prompt",
  "desktop.settings.imTools": "Tools",
  "desktop.settings.imToolRead": "Read files",
  "desktop.settings.imToolReadAlways": "Every role can list and read the whole project folder.",
  "desktop.settings.imToolWrite": "Write files",
  "desktop.settings.imToolExecute": "Run commands",
  "desktop.settings.imSaved": "Template saved",
  "desktop.settings.imDeleteTemplate": "Delete template",
  "desktop.settings.imActions": "Selection actions",
  "desktop.settings.imActionsHint": "Shown when you select text.",
  "desktop.settings.imNewAction": "New action",
  "desktop.settings.imActionKind": "Type",
  "desktop.settings.imActionKindContext": "Context",
  "desktop.settings.imActionKindIndependent": "Independent",
  "desktop.settings.imActionPrompt": "Prompt",
  "desktop.settings.imActionPromptHint": "Use {selection}.",
  "desktop.settings.imActionModel": "Model",
  "desktop.settings.imActionModelDefault": "Default (Ask / Chat model)",
  "desktop.settings.imActionEnabled": "Show in menu",
  "desktop.settings.imActionSaved": "Action saved",
  "desktop.settings.imDeleteAction": "Delete action",
  "desktop.im.agent.pi": "Pi",
  "desktop.im.agent.claude": "Claude Code",
  "desktop.im.agent.codex": "Codex",
  "desktop.settings.paneNotes": "Notes",
  "desktop.settings.paneNotesDesc": "Notes desc",
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
  "desktop.settings.toolModelUse": "Tool LLM",
  "desktop.settings.toolModelUseDesc": "For summaries",
  "desktop.settings.chatModelUse": "Ask / Chat",
  "desktop.settings.chatModelUseDesc": "For Ask and Agent chat",
  "desktop.settings.embeddingModelUse": "Embedding",
  "desktop.settings.embeddingModelUseDesc": "For semantic search",
  "desktop.settings.imageModelUse": "Image",
  "desktop.settings.imageModelUseDesc": "Image generation",
  "desktop.settings.useCaseModels": "Use-case models",
  "desktop.settings.useCaseModelsFootnote": "Each feature picks a model by kind.",
  "desktop.settings.providerList": "Providers",
  "desktop.settings.providerListLabel": "Provider list",
  "desktop.settings.providerListEmpty": "No providers yet.",
  "desktop.settings.providerAdd": "Add",
  "desktop.settings.providerRemove": "Remove provider",
  "desktop.settings.providerRemoveConfirm": "Remove provider?",
  "desktop.settings.providerNewName": "New provider",
  "desktop.settings.providerDetail": "Provider",
  "desktop.settings.providerDetailEmpty": "Select a provider.",
  "desktop.settings.providerName": "Name",
  "desktop.settings.providerFetchModels": "Fetch models",
  "desktop.settings.providerFetchingModels": "Fetching models…",
  "desktop.settings.providerFetchedModels": "Fetched {0} models",
  "desktop.settings.providerFetchFailed": "Fetch failed.",
  "desktop.settings.providerNoModels": "No models yet.",
  "desktop.settings.providerModels": "Models",
  "desktop.settings.providerModelsFootnote": "Kinds: text, image, embedding.",
  "desktop.settings.modelKind": "Model kind",
  "desktop.settings.modelKindText": "Text",
  "desktop.settings.modelKindImage": "Image",
  "desktop.settings.modelKindEmbedding": "Embedding",
  "desktop.settings.modelAdd": "Add model",
  "desktop.settings.modelAddId": "Model id",
  "desktop.settings.selectFetchedModel": "Select fetched model ({0} available)…",
  "desktop.settings.orCustomModelId": "Or enter custom model ID",
  "desktop.settings.modelRemove": "Remove model",
  "desktop.settings.modelPlaceholder": "—",
  "desktop.settings.noTextModelsHint": "No text models.",
  "desktop.settings.noEmbeddingModelsHint": "No embedding models.",
  "desktop.settings.noImageModelsHint": "No image models.",
  "desktop.settings.testConnectionKind": "Kind to test",
  "desktop.settings.disableThinkingChatDesc": "Chat thinking desc",
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
  "desktop.settings.apiKey": "API key",
  "desktop.settings.showApiKey": "Show API key",
  "desktop.settings.hideApiKey": "Hide API key",
  "desktop.settings.outputLanguage": "Output language",
  "desktop.settings.fieldOutputLanguageDescription": "Output lang desc",
  "desktop.settings.fieldOutputLanguageOptionAuto": "Auto",
  "desktop.settings.disableThinking": "Disable Thinking",
  "desktop.settings.disableThinkingDesc": "Send thinking:disabled for reasoning models.",
  "desktop.settings.testConnection": "Test Connection",
  "desktop.settings.testConnectionTesting": "Testing…",
  "desktop.settings.saving": "Saving…",
  "desktop.settings.saved": "Saved {0}",
  "desktop.settings.schedulerOn": "scheduler on",
  "desktop.settings.schedulerOff": "scheduler off",
  "desktop.settings.embeddingModelChangeConfirm": "Embedding change confirm",
  "desktop.settings.embeddingModelChangeCancelled": "Cancelled",
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
  "desktop.common.revealInFinder": "Reveal",
  "desktop.settings.save": "Save",
  "desktop.settings.discard": "Discard",
  "desktop.settings.cancel": "Cancel",
  "desktop.settings.saveAndContinue": "Save and continue",
  "desktop.settings.discardAndContinue": "Discard and continue",
  "desktop.settings.unsavedConfirm": "Unsaved confirm",
  "desktop.settings.unsavedHint": "Unsaved changes"
};

function renderWindowSettings(initialPane = "general", overrides?: Record<string, unknown>) {
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
  const providersTestConnection = vi.fn(async (args: { kind: string; provider: unknown; modelId: string }) => ({
    ok: true,
    message: `Connected mock (${args.kind}:${args.modelId})`
  }));
  const providersFetchModels = vi.fn(async (args: { baseUrl: string; apiKey?: string }): Promise<MockProviderFetchModelsResult> => ({
    ok: true,
    models: [
      { id: "test", kind: "text" },
      { id: "text-embedding-3-small", kind: "embedding" },
      { id: "dall-e-3", kind: "image" }
    ]
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
      providers: [
        {
          id: "p1",
          name: "Example",
          baseUrl: "https://example.test/v1",
          apiKey: "sk-test",
          models: [
            { id: "test", kind: "text" },
            { id: "text-embedding-3-small", kind: "embedding" }
          ]
        }
      ],
      modelSelections: {
        tool: { providerId: "p1", modelId: "test" },
        chat: { providerId: "p1", modelId: "test" },
        embedding: { providerId: "p1", modelId: "text-embedding-3-small" }
      },
      llmOptions: {
        tool: { outputLanguage: "auto", maxContextChars: 120000, requestTimeoutMs: 300000, disableThinking: false },
        chat: { disableThinking: false }
      },
      desktop: { theme: "system" }
    }),
    saveSettings,
    providersTestConnection,
    providersFetchModels,
    closeSettingsWindow,
    onSettingsNavigate: (callback: (payload: { pane: string }) => void) => {
      navigateHandlers.push(callback);
      return () => undefined;
    },
    imListTemplates: vi.fn(async () => []),
    imCreateTemplate: vi.fn(async () => ({ templateId: "custom" })),
    imUpdateTemplate: vi.fn(async () => ({ templateId: "custom" })),
    imDeleteTemplate: vi.fn(async () => ({ ok: true })),
    imListSelectionActions: vi.fn(async () => []),
    imCreateSelectionAction: vi.fn(async () => ({ actionId: "custom-action" })),
    imUpdateSelectionAction: vi.fn(async () => ({ actionId: "custom-action" })),
    imDeleteSelectionAction: vi.fn(async () => ({ ok: true })),
    ...overrides
  } as unknown as typeof window.agentResume;
  render(
    <I18nProvider>
      <SettingsPanel variant="window" initialPane={initialPane} />
    </I18nProvider>
  );
  return { host, closeSettingsWindow, saveSettings, providersTestConnection, providersFetchModels, navigateHandlers };
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
      navigateHandlers[0]?.({ pane: "providers" });
    });
    await waitFor(() => expect(host.querySelectorAll(".settings-group")).toHaveLength(3));
    expect(host.textContent).toContain("Tool LLM");
  });

  it("renders the provider pool with kind badges and per-use-case model selectors", async () => {
    const { host } = renderWindowSettings("providers");
    await waitFor(() => expect(host.querySelector(".settings-provider-list")).not.toBeNull());
    expect(host.querySelectorAll(".settings-provider-item")).toHaveLength(1);
    expect(host.textContent).toContain("Example");
    expect(host.textContent).toContain("Tool LLM");
    expect(host.textContent).toContain("Ask / Chat");
    expect(host.textContent).toContain("Embedding");
    expect(host.textContent).toContain("Image");
    // Use-case selectors enumerate the provider pool filtered by kind.
    expect(host.querySelectorAll('[data-testid^="settings-model-select-"]')).toHaveLength(3);
    expect(host.querySelector('[data-testid="settings-model-select-text"]')).not.toBeNull();
    // No image models in the pool → the image selector shows an empty hint instead.
    expect(host.querySelector('[data-testid="settings-model-select-image"]')).toBeNull();
    expect(host.textContent).toContain("No image models.");
    expect(host.querySelector('[data-testid="settings-model-select-embedding"]')).not.toBeNull();
    // Kind badges on fetched/manual model rows.
    expect(host.querySelectorAll('[data-testid^="settings-provider-model-kind-"]')).toHaveLength(2);
  });

  it("requires explicit Save to persist provider changes", async () => {
    const { host, saveSettings } = renderWindowSettings("providers");
    await waitFor(() => expect(host.querySelector('[data-testid="settings-provider-name"]')).not.toBeNull());
    const input = host.querySelector('[data-testid="settings-provider-name"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    await waitFor(() => expect(host.querySelector('[data-testid="settings-save-providers"]') as HTMLButtonElement | null).not.toBeNull());
    expect(saveSettings).not.toHaveBeenCalled();
    const saveBtn = host.querySelector('[data-testid="settings-save-providers"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalled();
      const last = saveSettings.mock.calls.at(-1);
      expect(last?.[1]).toMatchObject({ section: "providers" });
      const saved = last?.[0] as { providers?: Array<{ name: string }> };
      expect(saved.providers?.[0].name).toBe("Renamed");
    });
  });

  it("discards provider changes and disables Save when clean", async () => {
    const { host, saveSettings } = renderWindowSettings("providers");
    await waitFor(() => expect(host.querySelector('[data-testid="settings-save-providers"]')).not.toBeNull());
    const input = host.querySelector('[data-testid="settings-provider-name"]') as HTMLInputElement;
    const saveBtn = host.querySelector('[data-testid="settings-save-providers"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "Renamed" } });
    await waitFor(() => expect((host.querySelector('[data-testid="settings-save-providers"]') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(host.querySelector('[data-testid="settings-discard-providers"]')!);
    expect(input.value).toBe("Example");
    expect((host.querySelector('[data-testid="settings-save-providers"]') as HTMLButtonElement).disabled).toBe(true);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("renders and saves the Workbench CLI YOLO switch via Save", async () => {
    const { host, saveSettings } = renderWindowSettings("workbench");
    await waitFor(() => expect(host.textContent).toContain("Launch CLI sessions in YOLO mode"));

    const title = [...host.querySelectorAll<HTMLElement>(".settings-row-title")]
      .find((element) => element.textContent === "Launch CLI sessions in YOLO mode");
    expect(title).not.toBeUndefined();
    const row = title?.closest("label");
    const toggle = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(toggle).not.toBeNull();

    fireEvent.click(toggle!);
    expect(saveSettings).not.toHaveBeenCalled();
    fireEvent.click(host.querySelector('[data-testid="settings-save-workbench"]')!);
    await waitFor(() => {
      const last = saveSettings.mock.calls.at(-1);
      expect(last?.[1]).toMatchObject({ section: "workbench" });
      expect((last?.[0] as { workbench?: { newSessionYolo?: boolean } }).workbench?.newSessionYolo).toBe(true);
    });
  });

  it("fetches provider models and tests the connection without saving", async () => {
    const { host, providersTestConnection, providersFetchModels, saveSettings } = renderWindowSettings("providers");
    await waitFor(() => expect(host.querySelector('[data-testid="settings-fetch-provider-models"]')).not.toBeNull());
    saveSettings.mockClear();

    fireEvent.click(host.querySelector('[data-testid="settings-fetch-provider-models"]')!);
    await waitFor(() => expect(providersFetchModels).toHaveBeenCalledWith({
      baseUrl: "https://example.test/v1",
      apiKey: "sk-test"
    }));
    await waitFor(() => expect(host.textContent).toContain("dall-e-3"));
    expect(saveSettings).not.toHaveBeenCalled();

    // Selecting a fetched model from the dropdown auto-populates the ID and kind, then Add adds it
    const addSelect = host.querySelector('[data-testid="settings-add-model-select"]') as HTMLSelectElement;
    expect(addSelect).not.toBeNull();
    fireEvent.change(addSelect, { target: { value: "dall-e-3" } });
    fireEvent.click(host.querySelector('[data-testid="settings-add-model"]')!);
    await waitFor(() => expect(host.querySelector('[data-testid="settings-remove-model-dall-e-3"]')).not.toBeNull());

    // Test connection defaults to the text kind and uses the tool selection model.
    fireEvent.click(host.querySelector('[data-testid="settings-test-provider"]')!);
    await waitFor(() => expect(providersTestConnection).toHaveBeenCalledWith(expect.objectContaining({
      kind: "text",
      provider: expect.objectContaining({ baseUrl: "https://example.test/v1", apiKey: "sk-test" }),
      modelId: "test"
    })));
    await waitFor(() => expect(host.textContent).toContain("Connected mock (text:test)"));

    // Switch the kind to embedding and test again with the embedding model.
    const kindSelect = host.querySelector('[data-testid="settings-provider-test-kind"]') as HTMLSelectElement;
    fireEvent.change(kindSelect, { target: { value: "embedding" } });
    fireEvent.click(host.querySelector('[data-testid="settings-test-provider"]')!);
    await waitFor(() => expect(providersTestConnection).toHaveBeenCalledWith(expect.objectContaining({
      kind: "embedding",
      modelId: "text-embedding-3-small"
    })));
  });

  it("rejects fetch failures and shows the message", async () => {
    const { host, providersFetchModels } = renderWindowSettings("providers");
    await waitFor(() => expect(host.querySelector('[data-testid="settings-fetch-provider-models"]')).not.toBeNull());
    providersFetchModels.mockResolvedValueOnce({ ok: false, message: "Provider has no /models endpoint" });
    fireEvent.click(host.querySelector('[data-testid="settings-fetch-provider-models"]')!);
    await waitFor(() => expect(host.textContent).toContain("Provider has no /models endpoint"));
  });

  it("adds and removes providers and models", async () => {
    const { host } = renderWindowSettings("providers");
    await waitFor(() => expect(host.querySelector('[data-testid="settings-add-provider"]')).not.toBeNull());

    fireEvent.click(host.querySelector('[data-testid="settings-add-provider"]')!);
    await waitFor(() => expect(host.querySelectorAll(".settings-provider-item")).toHaveLength(2));

    // Adding a model to the currently selected (new) provider.
    const addModelId = host.querySelector('[data-testid="settings-add-model-id"]') as HTMLInputElement;
    fireEvent.change(addModelId, { target: { value: "custom-model" } });
    fireEvent.click(host.querySelector('[data-testid="settings-add-model"]')!);
    await waitFor(() => expect(host.textContent).toContain("custom-model"));

    // Remove the model again.
    fireEvent.click(host.querySelector('[data-testid="settings-remove-model-custom-model"]')!);
    await waitFor(() => expect(host.textContent).not.toContain("custom-model"));

    // Remove the provider.
    const removeButtons = host.querySelectorAll('[data-testid^="settings-remove-provider-"]');
    fireEvent.click(removeButtons[0]!);
    await waitFor(() => expect(host.querySelectorAll(".settings-provider-item")).toHaveLength(1));
  });

  it("reveals and hides the provider API key", async () => {
    const { host } = renderWindowSettings("providers");
    await waitFor(() => expect(host.querySelector('[data-testid="settings-provider-api-key"]')).not.toBeNull());

    const input = host.querySelector('[data-testid="settings-provider-api-key"]') as HTMLInputElement;
    const toggle = host.querySelector('[data-testid="settings-provider-api-key-reveal"]') as HTMLButtonElement;
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
  });

  it("keeps the Data Paths pane free of the Notes provider select", async () => {
    const { host } = renderWindowSettings("storage");
    await waitFor(() => expect(host.textContent).toContain("Panel home"));
    expect(host.querySelector("select.settings-row-control")).toBeNull();
  });

  it("wraps the IM pane in the scrollable settings body and titles the group Roles", async () => {
    const { host } = renderWindowSettings("im");
    await waitFor(() => expect(host.querySelector(".settings-pane-body")).not.toBeNull());
    const paneBody = host.querySelector(".settings-pane-body");
    expect(paneBody?.querySelector(".settings-group-title")?.textContent).toBe("Roles");
    expect(paneBody?.className).toContain("settings-pane-body");
    expect(paneBody?.querySelectorAll(".settings-group").length).toBeGreaterThanOrEqual(2);
    expect(host.textContent).toContain("Model");
  });

  it("allows selecting and typing a model for role templates in IM settings", async () => {
    const imUpdateTemplate = vi.fn(async () => ({ templateId: "role_developer" }));
    const { host } = renderWindowSettings("im", {
      imListTemplates: vi.fn(async () => [
        {
          templateId: "role_developer",
          name: "Developer",
          persona: "You are Developer.",
          agent: "claude",
          model: "claude-3-7-sonnet-20250219",
          permissions: "write",
          tools: { fsRead: true, fsWrite: true, execute: true },
          createdAtMs: 1000,
          updatedAtMs: 1000
        }
      ]),
      imUpdateTemplate
    });

    await waitFor(() => expect(host.textContent).toContain("Developer"));
    await waitFor(() => expect(host.querySelector(".im-settings-editor")).not.toBeNull());

    const selects = host.querySelectorAll(".im-settings-editor select");
    const modelSelect = selects[1] as HTMLSelectElement;
    expect(modelSelect).not.toBeNull();
    expect(modelSelect.value).toBe("claude-3-7-sonnet-20250219");

    fireEvent.change(modelSelect, { target: { value: "claude-opus" } });
    const saveBtn = host.querySelector(".im-add-role-actions button.btn.primary") as HTMLButtonElement;
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(imUpdateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: "role_developer",
          model: "claude-opus"
        })
      );
    });
  });
});