import { describe, expect, it } from "vitest";
import type { PanelSettings } from "@agent-resume/core";
import {
  embeddingSearchIdentityChanged,
  generalDraftFromSettings,
  generalPatch,
  providersDraftFromSettings,
  providersPatch,
  normalizeOutputLanguage,
  notesDraftFromSettings,
  notesPatch,
  formatShortcutForDisplay,
  reportDraftFromSettings,
  reportPatch,
  sessionsDraftFromSettings,
  sessionsPatch,
  storageDraftFromSettings,
  storagePatch,
  workbenchDraftFromSettings,
  workbenchPatch
} from "./model";

const settings: PanelSettings = {
  uiLanguage: "en",
  llm: { baseUrl: "https://tool.example/v1", model: "tool", apiKey: "tool-key" },
  embedding: { model: "text-embedding-3-small" },
  providers: [
    {
      id: "p1",
      name: "Tool",
      baseUrl: "https://tool.example/v1",
      apiKey: "tool-key",
      models: [
        { id: "tool", kind: "text" },
        { id: "text-embedding-3-small", kind: "embedding" }
      ]
    }
  ],
  modelSelections: {
    tool: { providerId: "p1", modelId: "tool" },
    chat: { providerId: "p1", modelId: "tool" },
    embedding: { providerId: "p1", modelId: "text-embedding-3-small" }
  },
  llmOptions: {
    tool: { outputLanguage: "auto", maxContextChars: 120_000, requestTimeoutMs: 300_000, disableThinking: false },
    chat: { disableThinking: false }
  }
};

describe("settings model", () => {
  it("normalizes legacy output-language values", () => {
    expect(normalizeOutputLanguage("Chinese")).toBe("zh-cn");
    expect(normalizeOutputLanguage("unexpected")).toBe("auto");
  });

  it("reads provider selections and llm options into the providers draft", () => {
    const draft = providersDraftFromSettings(settings);
    expect(draft.providers).toHaveLength(1);
    expect(draft.toolSelection).toEqual({ providerId: "p1", modelId: "tool" });
    expect(draft.chatSelection).toEqual({ providerId: "p1", modelId: "tool" });
    expect(draft.embeddingSelection).toEqual({ providerId: "p1", modelId: "text-embedding-3-small" });
    expect(draft.toolOutputLanguage).toBe("auto");
    expect(draft.toolMaxContextChars).toBe(120_000);
    expect(draft.chatDisableThinking).toBe(false);
    expect(generalDraftFromSettings(settings).desktopTheme).toBe("system");
    expect(generalDraftFromSettings(settings).alwaysAllowAgentNonDestructiveOperations).toBe(false);
  });

  it("persists the provider pool and drops empty/invalid selections on save", () => {
    const patch = providersPatch(settings, {
      ...providersDraftFromSettings(settings),
      chatSelection: {},
      toolMaxContextChars: 99_999
    });
    expect(patch.providers).toHaveLength(1);
    expect(patch.providers?.[0].name).toBe("Tool");
    expect(patch.modelSelections?.tool).toEqual({ providerId: "p1", modelId: "tool" });
    expect(patch.modelSelections?.chat).toBeUndefined();
    expect(patch.llmOptions?.tool?.maxContextChars).toBe(99_999);
  });

  it("normalizes draft providers and keeps selections referencing existing models", () => {
    const patch = providersPatch(settings, {
      ...providersDraftFromSettings(settings),
      providers: [
        { id: "p1", name: "Tool", baseUrl: "https://tool.example/v1", apiKey: "tool-key", models: [{ id: "tool", kind: "text" }] },
        { id: "empty", name: "", baseUrl: "https://bad.example/v1", models: [] },
        { id: "p1", name: "Duplicate", baseUrl: "https://other.example/v1", models: [] }
      ],
      embeddingSelection: { providerId: "p1", modelId: "missing-model" }
    });
    expect(patch.providers).toHaveLength(1);
    // Embedding model was removed, so the selection is dropped.
    expect(patch.modelSelections?.embedding).toBeUndefined();
  });

  it("keeps non-delete Agent approval enabled by default and persists an explicit opt-in", () => {
    const draft = generalDraftFromSettings(settings);
    const patch = generalPatch(settings, { ...draft, alwaysAllowAgentNonDestructiveOperations: true });
    expect(patch.desktop?.alwaysAllowAgentNonDestructiveOperations).toBe(true);
    expect(patch.desktop?.alwaysAllowAgentWriteOperations).toBe(false);
  });

  it("maps the legacy Agent approval setting to the non-delete policy", () => {
    expect(generalDraftFromSettings({
      ...settings,
      desktop: { ...settings.desktop, alwaysAllowAgentWriteOperations: true }
    }).alwaysAllowAgentNonDestructiveOperations).toBe(true);
  });

  it("detects embedding identity changes for model or provider base URL", () => {
    const draft = providersDraftFromSettings(settings);
    expect(embeddingSearchIdentityChanged(settings, draft)).toBe(false);
    expect(embeddingSearchIdentityChanged(settings, { ...draft, embeddingSelection: { providerId: "p1", modelId: "other-embedding" } })).toBe(true);
    expect(embeddingSearchIdentityChanged(settings, {
      ...draft,
      providers: [
        { id: "p1", name: "Tool", baseUrl: "https://other.example/v1", apiKey: "tool-key", models: draft.providers[0].models },
        ...draft.providers.slice(1)
      ]
    })).toBe(true);
    expect(embeddingSearchIdentityChanged(settings, { ...draft, providers: [
      { ...draft.providers[0], apiKey: "new-key" }
    ] })).toBe(false);
  });

  it("clamps the session sync limit", () => {
    const draft = sessionsDraftFromSettings(settings);
    const patch = sessionsPatch(settings, { ...draft, maxItems: 999_999 });
    expect(patch.sessionSync?.maxItems).toBe(50_000);
  });

  it("defaults and persists the global standalone note shortcut", () => {
    const draft = notesDraftFromSettings(settings);
    expect(draft.newStandaloneNoteShortcut).toBe("CommandOrControl+D");
    expect(draft.recentStandaloneNoteShortcut).toBe("CommandOrControl+Shift+D");
    const patch = notesPatch(settings, {
      newStandaloneNoteShortcut: " CommandOrControl+Shift+D ",
      recentStandaloneNoteShortcut: " CommandOrControl+Alt+D "
    });
    expect(patch.notes?.newStandaloneNoteShortcut).toBe("CommandOrControl+Shift+D");
    expect(patch.notes?.recentStandaloneNoteShortcut).toBe("CommandOrControl+Alt+D");
    expect(notesPatch(settings, {
      newStandaloneNoteShortcut: "",
      recentStandaloneNoteShortcut: ""
    }).notes?.newStandaloneNoteShortcut).toBe("");
    expect(notesPatch(settings, {
      newStandaloneNoteShortcut: "",
      recentStandaloneNoteShortcut: ""
    }).notes?.recentStandaloneNoteShortcut).toBe("");
    expect(formatShortcutForDisplay("CommandOrControl+Shift+D", "MacIntel")).toBe("⌘⇧D");
    expect(formatShortcutForDisplay("CommandOrControl+Shift+D", "Win32")).toBe("Ctrl+Shift+D");
  });

  it("persists session summary auto settings with clamps", () => {
    const draft = sessionsDraftFromSettings(settings);
    expect(draft.summaryAutoEnabled).toBe(true);
    expect(draft.summaryStaleDelayMinutes).toBe(30);
    const patch = sessionsPatch(settings, {
      ...draft,
      summaryAutoEnabled: false,
      summaryStaleDelayMinutes: 9999,
      summaryMissingDelayMinutes: -1,
      summaryAutoConcurrency: 9,
      summaryAutoMaxPerTick: 0
    });
    expect(patch.sessionSummaryAuto?.enabled).toBe(false);
    expect(patch.sessionSummaryAuto?.staleDelayMinutes).toBe(1440);
    expect(patch.sessionSummaryAuto?.missingDelayMinutes).toBe(0);
    expect(patch.sessionSummaryAuto?.concurrency).toBe(3);
    expect(patch.sessionSummaryAuto?.maxPerTick).toBe(1);
  });

  it("persists transcript index settings independent of summary", () => {
    const draft = sessionsDraftFromSettings(settings);
    expect(draft.transcriptIndexEnabled).toBe(true);
    expect(draft.transcriptQuietDelayMinutes).toBe(15);
    const patch = sessionsPatch(settings, {
      ...draft,
      transcriptIndexEnabled: false,
      transcriptQuietDelayMinutes: 9999,
      transcriptIndexMaxPerTick: 0,
      transcriptIndexConcurrency: 8
    });
    expect(patch.sessionTranscriptIndex?.enabled).toBe(false);
    expect(patch.sessionTranscriptIndex?.quietDelayMinutes).toBe(1440);
    expect(patch.sessionTranscriptIndex?.maxPerTick).toBe(1);
    expect(patch.sessionTranscriptIndex?.concurrency).toBe(3);
  });

  it("persists summary embedding index settings", () => {
    const draft = sessionsDraftFromSettings(settings);
    expect(draft.embeddingIndexEnabled).toBe(true);
    expect(draft.embeddingQuietDelayMinutes).toBe(0);
    expect(draft.embeddingIndexMaxPerTick).toBe(5);
    const patch = sessionsPatch(settings, {
      ...draft,
      embeddingIndexEnabled: false,
      embeddingQuietDelayMinutes: 12,
      embeddingIndexMaxPerTick: 99,
      embeddingIndexConcurrency: 9
    });
    expect(patch.sessionEmbeddingIndex?.enabled).toBe(false);
    expect(patch.sessionEmbeddingIndex?.quietDelayMinutes).toBe(12);
    expect(patch.sessionEmbeddingIndex?.maxPerTick).toBe(50);
    expect(patch.sessionEmbeddingIndex?.concurrency).toBe(4);
  });

  it("persists auto-tagging settings with clamps", () => {
    const draft = sessionsDraftFromSettings(settings);
    expect(draft.autoTaggingEnabled).toBe(true);
    expect(draft.autoTagHalfLifeDays).toBe(7);
    expect(draft.autoTagMaxTagsPerItem).toBe(6);
    const patch = sessionsPatch(settings, {
      ...draft,
      autoTaggingEnabled: false,
      autoTagHalfLifeDays: 999,
      autoTagPruneThreshold: 0,
      autoTagMaxTagsPerItem: 1,
      autoTagHitBoost: 99,
      autoTagConsensusFactor: 0
    });
    expect(patch.autoTagging?.enabled).toBe(false);
    expect(patch.autoTagging?.halfLifeDays).toBe(90);
    expect(patch.autoTagging?.pruneThreshold).toBe(0.1);
    expect(patch.autoTagging?.maxTagsPerItem).toBe(3);
    expect(patch.autoTagging?.hitBoost).toBe(5);
    expect(patch.autoTagging?.consensusFactor).toBe(0.5);
  });

  it("normalizes workbench editor values and persists nested scan inputs", () => {
    const invalidSettings = { ...settings, workbench: { editor: { fontSize: 99, tabSize: 3, autoSaveDelayMs: 50 } } } as unknown as PanelSettings;
    const draft = workbenchDraftFromSettings(invalidSettings);
    expect(draft.editorFontSize).toBe(24);
    expect(draft.transcriptFontSize).toBe(14);
    expect(draft.editorTabSize).toBe(4);
    expect(draft.editorAutoSaveDelayMs).toBe(600);

    const patch = workbenchPatch(settings, { ...draft, gitNestedScanIgnoreDirs: "node_modules\n\ndist\n" });
    expect(patch.workbench?.gitNestedScanIgnoreDirs).toEqual(["node_modules", "dist"]);
    expect(patch.workbench?.transcriptFontSize).toBe(14);
  });

  it("round-trips composer slash phrases and drops invalid triggers", () => {
    const draft = workbenchDraftFromSettings(settings);
    expect(draft.composerSlashPhrases).toEqual([]);

    const patched = workbenchPatch(settings, {
      ...draft,
      composerSlashPhrases: [
        { trigger: "/Review", phrase: "Please review this change." },
        { trigger: "review", phrase: "duplicate" },
        { trigger: "bad trigger", phrase: "no spaces" },
        { trigger: "fix", phrase: "Fix the failing tests.", description: "  unit  " }
      ]
    });
    expect(patched.workbench?.composerSlashPhrases).toEqual([
      { trigger: "Review", phrase: "Please review this change." },
      { trigger: "fix", phrase: "Fix the failing tests.", description: "unit" }
    ]);

    const loaded = workbenchDraftFromSettings({
      ...settings,
      workbench: patched.workbench
    });
    expect(loaded.composerSlashPhrases).toEqual(patched.workbench?.composerSlashPhrases);

    const emptied = workbenchPatch(settings, { ...draft, composerSlashPhrases: [] });
    expect(emptied.workbench?.composerSlashPhrases).toEqual([]);
  });

  it("defaults and clamps workbench transcript markdown font size", () => {
    expect(workbenchDraftFromSettings(settings).transcriptFontSize).toBe(14);

    const oversized = workbenchDraftFromSettings({
      ...settings,
      workbench: { transcriptFontSize: 99 }
    } as unknown as PanelSettings);
    expect(oversized.transcriptFontSize).toBe(24);

    const persisted = workbenchPatch(settings, { ...oversized, transcriptFontSize: 18 });
    expect(persisted.workbench?.transcriptFontSize).toBe(18);
  });

  it("migrates legacy defaultNewSessionProvider and persists ACP targets", () => {
    const draft = workbenchDraftFromSettings({
      ...settings,
      workbench: { defaultNewSessionProvider: "claude" }
    });
    expect(draft.defaultNewSessionTarget).toBe("cli:claude");
    expect(draft.acpAutoApprovePermissions).toBe("ask");

    const acpDraft = workbenchDraftFromSettings({
      ...settings,
      workbench: { defaultNewSessionTarget: "acp:claude" },
      acp: { autoApprovePermissions: "allowAll" }
    });
    expect(acpDraft.defaultNewSessionTarget).toBe("acp:claude");
    expect(acpDraft.acpAutoApprovePermissions).toBe("allowAll");

    const patch = workbenchPatch(settings, {
      ...acpDraft,
      defaultNewSessionTarget: "acp:codex",
      acpAutoApprovePermissions: "ask"
    });
    expect(patch.workbench?.defaultNewSessionTarget).toBe("acp:codex");
    expect(patch.acp?.autoApprovePermissions).toBe("ask");
  });

  it("defaults and persists the Workbench CLI YOLO preference", () => {
    const draft = workbenchDraftFromSettings(settings);
    expect(draft.newSessionYolo).toBe(false);

    const patch = workbenchPatch(settings, { ...draft, newSessionYolo: true });
    expect(patch.workbench?.newSessionYolo).toBe(true);

    const loadedDraft = workbenchDraftFromSettings({
      ...settings,
      workbench: { newSessionYolo: true }
    });
    expect(loadedDraft.newSessionYolo).toBe(true);
  });

  it("preserves an explicit empty Workbench new-session target", () => {
    const draft = workbenchDraftFromSettings({
      ...settings,
      workbench: { defaultNewSessionProvider: "claude", defaultNewSessionTarget: "" }
    });
    expect(draft.defaultNewSessionTarget).toBe("");
    expect(draft.defaultProvider).toBe("claude");

    const patch = workbenchPatch(settings, { ...draft, defaultNewSessionTarget: "" });
    expect(patch.workbench?.defaultNewSessionTarget).toBe("");
    expect(patch.workbench?.defaultNewSessionProvider).toBe("claude");
  });

  it("defaults and normalizes workbench terminal theme presets", () => {
    const defaultDraft = workbenchDraftFromSettings(settings);
    expect(defaultDraft.terminalTheme).toBe("follow-app");

    const invalid = workbenchDraftFromSettings({
      ...settings,
      workbench: { terminalTheme: "not-a-theme" as never }
    });
    expect(invalid.terminalTheme).toBe("follow-app");

    const patch = workbenchPatch(settings, {
      ...defaultDraft,
      terminalTheme: "dracula"
    });
    expect(patch.workbench?.terminalTheme).toBe("dracula");
    expect(defaultDraft.editorTheme).toBe("follow-app");
  });

  it("forces dark appearance for dark-only visual themes and persists effects", () => {
    const draft = generalDraftFromSettings(settings);
    const patch = generalPatch(settings, {
      ...draft,
      visualTheme: "cyberpunk",
      desktopTheme: "light",
      themeEffects: "reduced"
    });
    expect(patch.desktop?.visualTheme).toBe("cyberpunk");
    expect(patch.desktop?.theme).toBe("dark");
    expect(patch.desktop?.themeEffects).toBe("reduced");
  });

  it("defaults and persists workbench terminal renderer (webgl / force canvas)", () => {
    const defaultDraft = workbenchDraftFromSettings(settings);
    expect(defaultDraft.terminalRenderer).toBe("webgl");

    const invalid = workbenchDraftFromSettings({
      ...settings,
      workbench: { terminalRenderer: "dom" as never }
    });
    expect(invalid.terminalRenderer).toBe("webgl");

    const canvasDraft = workbenchDraftFromSettings({
      ...settings,
      workbench: { terminalRenderer: "canvas" }
    });
    expect(canvasDraft.terminalRenderer).toBe("canvas");

    const patch = workbenchPatch(settings, {
      ...defaultDraft,
      terminalRenderer: "canvas"
    });
    expect(patch.workbench?.terminalRenderer).toBe("canvas");
  });

  it("defaults and persists workbench terminal engine (xterm / ghostty-web)", () => {
    const defaultDraft = workbenchDraftFromSettings(settings);
    expect(defaultDraft.terminalEngine).toBe("xterm");

    const ghosttyDraft = workbenchDraftFromSettings({
      ...settings,
      workbench: { terminalEngine: "ghostty-web" }
    });
    expect(ghosttyDraft.terminalEngine).toBe("ghostty-web");

    const patch = workbenchPatch(settings, {
      ...defaultDraft,
      terminalEngine: "ghostty-web"
    });
    expect(patch.workbench?.terminalEngine).toBe("ghostty-web");
  });

  it("preserves report invariants and only stores non-default agent homes", () => {
    const report = reportPatch(settings, { ...reportDraftFromSettings(settings), dailyHour: 30 });
    expect(report.report?.scheduleDailyHour).toBe(23);
    expect(report.report?.includeTranscripts).toBe(true);
    expect(report.report?.maxDigestLlmCalls).toBe(100);

    const preservedLimit = reportPatch(
      { ...settings, report: { maxDigestLlmCalls: 300 } },
      reportDraftFromSettings({ ...settings, report: { maxDigestLlmCalls: 300 } })
    );
    expect(preservedLimit.report?.maxDigestLlmCalls).toBe(300);

    const storage = storagePatch({ ...settings, agentHomes: { codexHome: "~/old-codex" } }, { ...storageDraftFromSettings(settings), panelHome: "~/panel", codexHome: "~/custom-codex" });
    expect(storage.panelHome).toBe("~/panel");
    expect(storage.agentHomes).toEqual({ codexHome: "~/custom-codex" });

    const reset = storagePatch({ ...settings, agentHomes: { codexHome: "~/old-codex" } }, storageDraftFromSettings(settings));
    expect(reset.agentHomes).toBeUndefined();
  });


});
