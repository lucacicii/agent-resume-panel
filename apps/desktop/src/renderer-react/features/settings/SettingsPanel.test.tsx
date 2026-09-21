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
  "desktop.settings.paneSelection": "Selection",
  "desktop.settings.paneSelectionDesc": "Selection actions",
  "desktop.settings.selectionActions": "Selection actions",
  "desktop.settings.selectionActionsHint": "Shown when you select text.",
  "desktop.settings.selectionBuiltin": "Builtin",
  "desktop.settings.selectionNewAction": "New action",
  "desktop.settings.selectionName": "Name",
  "desktop.settings.selectionActionPrompt": "Prompt",
  "desktop.settings.selectionActionPromptHint": "Use {selection}.",
  "desktop.settings.selectionActionModel": "Model",
  "desktop.settings.selectionActionModelDefault": "Default (Ask / Chat model)",
  "desktop.settings.selectionActionEnabled": "Show in menu",
  "desktop.settings.selectionActionSaved": "Action saved",
  "desktop.settings.selectionActionOrderSaved": "Action order saved",
  "desktop.settings.selectionActionMoveUp": "Move {0} up",
  "desktop.settings.selectionActionMoveDown": "Move {0} down",
  "desktop.settings.selectionDeleteAction": "Delete action",
  "desktop.settings.selectionDeleteActionConfirm": "Delete this action?",
  "desktop.settings.paneNotes": "Notes",
  "desktop.settings.paneNotesDesc": "Notes desc",
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
  "desktop.settings.specificFeatureModels": "Feature-specific models",
  "desktop.settings.specificFeatureModelsFootnote": "Overrides for individual tasks.",
  "desktop.settings.gitCommitModelUse": "Git Commit Messages",
  "desktop.settings.gitCommitModelUseDesc": "Git commit desc",
  "desktop.settings.sessionRenameModelUse": "Session Auto-Rename",
  "desktop.settings.sessionRenameModelUseDesc": "Session rename desc",
  "desktop.settings.sessionSummaryModelUse": "Session Summaries",
  "desktop.settings.sessionSummaryModelUseDesc": "Session summary desc",
  "desktop.settings.reportModelUse": "Scheduled Digests",
  "desktop.settings.reportModelUseDesc": "Report desc",
  "desktop.settings.gtdModelUse": "GTD Task Analysis",
  "desktop.settings.gtdModelUseDesc": "GTD desc",
  "desktop.settings.translateModelUse": "Translation",
  "desktop.settings.translateModelUseDesc": "Translation desc",
  "desktop.settings.modelFollowToolDefault": "Default (Follows Tool LLM)",
  "desktop.settings.modelFollowChatDefault": "Default (Follows Ask / Chat)",
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
  "desktop.settings.scratchDir": "Scratch directory",
  "desktop.settings.composerSlashGroup": "Composer slash phrases",
  "desktop.settings.composerSlashDesc": "Type / in the Workbench composer to run TUI commands or insert a saved phrase.",
  "desktop.settings.composerSlashEmpty": "No slash phrases yet.",
  "desktop.settings.composerSlashTrigger": "Trigger",
  "desktop.settings.composerSlashTriggerPlaceholder": "review",
  "desktop.settings.composerSlashPhrase": "Phrase",
  "desktop.settings.composerSlashPhrasePlaceholder": "Please review this change.",
  "desktop.settings.composerSlashDescription": "Description",
  "desktop.settings.composerSlashDescriptionPlaceholder": "Optional menu subtitle",
  "desktop.settings.composerSlashAdd": "Add phrase",
  "desktop.settings.composerSlashRemove": "Remove",
  "desktop.settings.composerMentionsGroup": "Workspace mentions",
  "desktop.settings.composerMentionsDesc": "Global packs",
  "desktop.settings.composerMentionsEmpty": "No workspace mentions yet.",
  "desktop.settings.composerMentionsId": "Id",
  "desktop.settings.composerMentionsIdPlaceholder": "anfeng",
  "desktop.settings.composerMentionsCwd": "Work folder",
  "desktop.settings.composerMentionsCwdPlaceholder": "/path/to/work",
  "desktop.settings.composerMentionsBrowse": "Browse",
  "desktop.settings.composerMentionsReferences": "Reference folders",
  "desktop.settings.composerMentionsReferencePlaceholder": "/path/to/reference",
  "desktop.settings.composerMentionsAddReference": "Add reference",
  "desktop.settings.composerMentionsRemoveReference": "Remove reference",
  "desktop.settings.composerMentionsAdd": "Add mention",
  "desktop.settings.composerMentionsRemove": "Remove",
  "desktop.settings.composerMentionsWorkspace": "Workspace",
  "desktop.settings.composerMentionsCurrentProject": "Current project",
  "desktop.settings.embeddedEditorGroup": "Embedded editor",
  "desktop.settings.editorEditable": "Editable",
  "desktop.settings.editorEditableDesc": "Editable desc",
  "desktop.settings.editorFontSize": "Editor font size",
  "desktop.settings.editorFontSizeDesc": "Font size desc",
  "desktop.settings.editorWordWrap": "Word wrap",
  "desktop.settings.editorWordWrapDesc": "Wrap desc",
  "desktop.settings.editorTabSize": "Tab size",
  "desktop.settings.editorTabSizeDesc": "Tab desc",
  "desktop.settings.editorTabSize2": "2",
  "desktop.settings.editorTabSize4": "4",
  "desktop.settings.editorTabSize8": "8",
  "desktop.settings.editorAutoSaveDelay": "Autosave delay",
  "desktop.settings.editorAutoSaveDelayDesc": "Autosave desc",
  "desktop.settings.editorAutoSaveDelay300": "300 ms",
  "desktop.settings.editorAutoSaveDelay600": "600 ms",
  "desktop.settings.editorAutoSaveDelay1000": "1000 ms",
  "desktop.settings.editorAutoSaveDelay2000": "2000 ms",
  "desktop.settings.transcriptGroup": "Transcript",
  "desktop.settings.transcriptFontSize": "Transcript font size",
  "desktop.settings.transcriptFontSizeDesc": "Transcript desc",
  "desktop.settings.editorTerminal": "Editor & terminal",
  "desktop.settings.projectEditor": "Project editor",
  "desktop.settings.projectEditorDesc": "Project editor desc",
  "desktop.settings.editorAuto": "Auto-detect",
  "desktop.settings.terminalMode": "Terminal mode",
  "desktop.settings.terminalModeDesc": "Terminal mode desc",
  "desktop.settings.terminalXterm": "Embedded terminal",
  "desktop.settings.terminalExternal": "System default terminal",
  "desktop.settings.terminalEngine": "Terminal engine",
  "desktop.settings.terminalEngineDesc": "Engine desc",
  "desktop.settings.terminalEngineXterm": "xterm.js",
  "desktop.settings.terminalEngineGhosttyWeb": "Ghostty",
  "desktop.settings.terminalThemeFollowApp": "Follow app",
  "desktop.settings.editorTheme": "Editor theme",
  "desktop.settings.editorThemeDesc": "Editor theme desc",
  "desktop.settings.editorThemeFollowApp": "Follow app",
  "desktop.settings.editorThemeLight": "Light",
  "desktop.settings.editorThemeDark": "Dark",
  "desktop.settings.terminalRenderer": "Terminal renderer",
  "desktop.settings.terminalRendererDesc": "Renderer desc",
  "desktop.settings.terminalRendererWebgl": "WebGL",
  "desktop.settings.terminalRendererCanvas": "Canvas",
  "desktop.settings.cmdT": "⌘T shortcut",
  "desktop.settings.cmdTDesc": "⌘T desc",
  "desktop.settings.cmdTNewTerminal": "New Terminal",
  "desktop.settings.cmdTNewSession": "New Session",
  "desktop.settings.gitCommitMessageGroup": "Git commit message",
  "desktop.settings.gitCommitMessageStyle": "Commit style",
  "desktop.settings.gitCommitMessageStyleDesc": "Commit style desc",
  "desktop.settings.gitCommitMessageStyleConventional": "Conventional",
  "desktop.settings.gitCommitMessageStyleGitmoji": "Gitmoji",
  "desktop.settings.gitCommitMessageStyleCustom": "Custom",
  "desktop.settings.gitNestedScanGroup": "Nested git scan",
  "desktop.settings.gitNestedScanMaxDepth": "Max depth",
  "desktop.settings.gitNestedScanMaxDepthDesc": "Max depth desc",
  "desktop.settings.gitNestedScanIgnoreDirs": "Ignore dirs",
  "desktop.settings.gitNestedScanIgnoreDirsDesc": "Ignore dirs desc",
  "desktop.settings.notesGroup": "Notes",
  "desktop.settings.notesFootnote": "Notes are Markdown files.",
  "desktop.settings.appData": "App data",
  "desktop.settings.appDataFootnote": "catalog.db lives under Panel home.",
  "desktop.settings.panelHome": "Panel home",
  "desktop.settings.panelHomeFootnote": "Reveal uses saved path.",
  "desktop.common.revealInFinder": "Reveal",
  "desktop.settings.selectionCreateAction": "Create"
};

function renderWindowSettings(initialPane = "general", overrides?: Record<string, unknown>) {
  const host = document.createElement("div");
  host.id = "react-settings";
  document.body.append(host);
  const saveSettings = vi.fn(async (settings: unknown, options?: { section?: string }) => ({
    file: "/tmp/settings.json",
    settings,
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
  const contextMenuShow = vi.fn(async (): Promise<string | null> => null);
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
    onSettingsNavigate: (callback: (payload: { pane: string }) => void) => {
      navigateHandlers.push(callback);
      return () => undefined;
    },
    selectionListActions: vi.fn(async () => []),
    selectionCreateAction: vi.fn(async () => ({ actionId: "custom-action" })),
    selectionUpdateAction: vi.fn(async () => ({ actionId: "custom-action" })),
    selectionDeleteAction: vi.fn(async () => ({ ok: true })),
    contextMenuShow,
    ...overrides
  } as unknown as typeof window.agentResume;
  render(
    <I18nProvider>
      <SettingsPanel initialPane={initialPane} />
    </I18nProvider>
  );
  return { host, saveSettings, providersTestConnection, providersFetchModels, navigateHandlers, contextMenuShow };
}

describe("SettingsPanel (window)", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("react-settings")?.remove();
  });

  it("renders the panel in the window and ignores primary tab changes", async () => {
    const { host } = renderWindowSettings();
    await waitFor(() => expect(host.querySelector(".react-settings-panel")).not.toBeNull());
    // A Settings window has no overlay, no backdrop, and no dialog semantics.
    expect(host.querySelector(".settings-overlay")).toBeNull();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" }));
    });
    expect(host.querySelector(".react-settings-panel")).not.toBeNull();
  });

  it("has no Done button: ⌘W closes the window", async () => {
    const { host } = renderWindowSettings();
    await waitFor(() => expect(host.querySelector(".react-settings-panel")).not.toBeNull());
    expect(host.querySelector("button.ghost-btn")).toBeNull();
  });

  it("navigates pane via onSettingsNavigate", async () => {
    const { host, navigateHandlers } = renderWindowSettings("general");
    await waitFor(() => expect(host.querySelector(".react-settings-panel")).not.toBeNull());
    await act(async () => {
      navigateHandlers[0]?.({ pane: "providers" });
    });
    await waitFor(() => expect(host.querySelectorAll(".settings-group")).toHaveLength(2));
    expect(host.textContent).toContain("Ask / Chat");
  });

  it("shows composer slash phrases at the top of the Workbench pane", async () => {
    const { host } = renderWindowSettings("workbench");
    await waitFor(() => expect(host.querySelector(".react-settings-panel")).not.toBeNull());
    const titles = Array.from(host.querySelectorAll(".settings-group-title")).map((el) => el.textContent);
    expect(titles[0]).toBe("New Session");
    expect(titles[1]).toBe("Composer slash phrases");
    expect(host.textContent).toContain("No slash phrases yet.");
    expect(host.textContent).toContain("Add phrase");
  });

  it("renders the provider pool with kind badges and per-use-case model selectors", async () => {
    const { host } = renderWindowSettings("providers");
    await waitFor(() => expect(host.querySelector(".settings-provider-list")).not.toBeNull());
    expect(Array.from(host.querySelectorAll(".settings-group-title")).map((el) => el.textContent)).toEqual([
      "Providers",
      "Feature-specific models"
    ]);
    expect(host.querySelectorAll(".settings-provider-item")).toHaveLength(1);
    expect(host.textContent).toContain("Example");
    expect(host.textContent).toContain("Ask / Chat");
    expect(host.textContent).toContain("Embedding");
    expect(host.textContent).toContain("Image");
    expect(host.textContent).toContain("Git Commit Messages");
    expect(host.textContent).toContain("Session Auto-Rename");
    expect(host.textContent).toContain("Session Summaries");
    expect(host.textContent).toContain("Scheduled Digests");
    expect(host.textContent).toContain("GTD Task Analysis");
    expect(host.textContent).toContain("Translation");
    // 7 text selectors + 1 embedding selector = 8 selectors (image selector shows empty hint because pool has no image models).
    expect(host.querySelectorAll('[data-testid^="settings-model-select-"]')).toHaveLength(8);
    expect(host.querySelector('[data-testid="settings-model-select-chat"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-model-select-git-commit"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-model-select-session-rename"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-model-select-session-summary"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-model-select-report"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-model-select-gtd"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-model-select-translate"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-model-select-embedding"]')).not.toBeNull();
    // No image models in the pool → the image selector shows an empty hint instead.
    expect(host.querySelector('[data-testid="settings-model-select-image"]')).toBeNull();
    expect(host.textContent).toContain("No image models.");
    // Kind badges on fetched/manual model rows.
    expect(host.querySelectorAll('[data-testid^="settings-provider-model-kind-"]')).toHaveLength(2);
  });

  it("has no manual Save/Discard controls in the settings panes", async () => {
    const { host } = renderWindowSettings("providers");
    await waitFor(() => expect(host.querySelector('[data-testid="settings-provider-name"]')).not.toBeNull());
    expect(host.querySelector('[data-testid^="settings-save-"]')).toBeNull();
    expect(host.querySelector('[data-testid^="settings-discard-"]')).toBeNull();
    expect(host.querySelector(".settings-unsaved-banner")).toBeNull();
  });

  it("auto-saves provider text inputs on blur, not while typing", async () => {
    const { host, saveSettings } = renderWindowSettings("providers");
    await waitFor(() => expect(host.querySelector('[data-testid="settings-provider-name"]')).not.toBeNull());
    const input = host.querySelector('[data-testid="settings-provider-name"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    expect(saveSettings).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => {
      const last = saveSettings.mock.calls.at(-1);
      expect(last?.[1]).toMatchObject({ section: "providers" });
      const saved = last?.[0] as { providers?: Array<{ name: string }> };
      expect(saved.providers?.[0].name).toBe("Renamed");
    });
  });

  it("skips the auto-save when a blurred input did not change", async () => {
    const { host, saveSettings } = renderWindowSettings("providers");
    await waitFor(() => expect(host.querySelector('[data-testid="settings-provider-name"]')).not.toBeNull());
    const input = host.querySelector('[data-testid="settings-provider-name"]') as HTMLInputElement;
    fireEvent.blur(input);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(saveSettings).not.toHaveBeenCalled();
    expect(input.value).toBe("Example");
  });

  it("auto-saves toggles immediately", async () => {
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
    });
  });

  it("auto-saves number inputs on blur", async () => {
    const { host, saveSettings } = renderWindowSettings("sessions");
    await waitFor(() => expect(host.querySelector('input[type="number"]')).not.toBeNull());
    const input = [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')][0];
    fireEvent.change(input, { target: { value: "500" } });
    expect(saveSettings).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => {
      const last = saveSettings.mock.calls.at(-1);
      expect(last?.[1]).toMatchObject({ section: "sessions" });
      expect((last?.[0] as { sessionSync?: { maxItems?: number } }).sessionSync?.maxItems).toBe(500);
    });
  });

  it("fetches provider models and tests the connection without saving", async () => {
    const { host, providersTestConnection, providersFetchModels, saveSettings, contextMenuShow } = renderWindowSettings("providers");
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
    const addSelect = host.querySelector('[data-testid="settings-add-model-select"]') as HTMLButtonElement;
    expect(addSelect).not.toBeNull();
    contextMenuShow.mockResolvedValueOnce("dall-e-3");
    fireEvent.click(addSelect);
    await waitFor(() => expect(addSelect.getAttribute("aria-label")).toContain("dall-e-3"));
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
    const kindSelect = host.querySelector('[data-testid="settings-provider-test-kind"]') as HTMLButtonElement;
    contextMenuShow.mockResolvedValueOnce("embedding");
    fireEvent.click(kindSelect);
    await waitFor(() => expect(kindSelect.getAttribute("aria-label")).toContain("Embedding"));
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

  it("reorders selection actions from the Selection settings list", async () => {
    const actions = [
      {
        actionId: "translate",
        name: "Translate",
        prompt: "Translate:\n{selection}",
        sortOrder: 0,
        enabled: true,
        createdAtMs: 1,
        updatedAtMs: 1
      },
      {
        actionId: "explain",
        name: "Explain",
        prompt: "Explain:\n{selection}",
        sortOrder: 1,
        enabled: true,
        createdAtMs: 2,
        updatedAtMs: 2
      }
    ];
    const selectionReorderActions = vi.fn(async () => [actions[1], actions[0]]);
    const { host } = renderWindowSettings("selection", {
      selectionListActions: vi.fn(async () => actions),
      selectionReorderActions
    });

    await waitFor(() => expect(host.querySelector(".selection-settings-action-row")).not.toBeNull());
    fireEvent.click(host.querySelector('[title="Move Translate down"]') as HTMLButtonElement);

    await waitFor(() => expect(selectionReorderActions).toHaveBeenCalledWith({
      actionIds: ["explain", "translate"]
    }));
    await waitFor(() => {
      const names = [...host.querySelectorAll(".selection-settings-action-row .selection-settings-item")]
        .map((item) => item.firstChild?.textContent ?? "");
      expect(names).toContain("Explain");
      expect(names.indexOf("Explain")).toBeLessThan(names.indexOf("Translate"));
    });
    expect(host.textContent).toContain("Action order saved");
  });

  it("restores selection action order when reordering fails", async () => {
    const actions = [
      {
        actionId: "translate",
        name: "Translate",
        prompt: "Translate:\n{selection}",
        sortOrder: 0,
        enabled: true,
        createdAtMs: 1,
        updatedAtMs: 1
      },
      {
        actionId: "explain",
        name: "Explain",
        prompt: "Explain:\n{selection}",
        sortOrder: 1,
        enabled: true,
        createdAtMs: 2,
        updatedAtMs: 2
      }
    ];
    const { host } = renderWindowSettings("selection", {
      selectionListActions: vi.fn(async () => actions),
      selectionReorderActions: vi.fn(async () => {
        throw new Error("Reorder failed");
      })
    });

    await waitFor(() => expect(host.querySelector(".selection-settings-action-row")).not.toBeNull());
    fireEvent.click(host.querySelector('[title="Move Translate down"]') as HTMLButtonElement);

    await waitFor(() => expect(host.textContent).toContain("Reorder failed"));
    const names = [...host.querySelectorAll(".selection-settings-action-row .selection-settings-item")]
      .map((item) => item.firstChild?.textContent ?? "");
    expect(names.indexOf("Translate")).toBeLessThan(names.indexOf("Explain"));
  });
});
