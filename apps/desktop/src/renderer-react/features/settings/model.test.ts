import { describe, expect, it } from "vitest";
import type { PanelSettings } from "@agent-resume/core";
import {
  embeddingSearchIdentityChanged,
  generalDraftFromSettings,
  generalPatch,
  modelsDraftFromSettings,
  modelsPatch,
  normalizeOutputLanguage,
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
  embedding: { model: "text-embedding-3-small" }
};

describe("settings model", () => {
  it("normalizes legacy output-language values", () => {
    expect(normalizeOutputLanguage("Chinese")).toBe("zh-cn");
    expect(normalizeOutputLanguage("unexpected")).toBe("auto");
  });

  it("uses tool LLM values as chat fallbacks and preserves optional blanks on save", () => {
    expect(modelsDraftFromSettings(settings).chatModel).toBe("tool");
    expect(generalDraftFromSettings(settings).desktopTheme).toBe("system");
    expect(generalDraftFromSettings(settings).alwaysAllowAgentNonDestructiveOperations).toBe(false);

    const patch = modelsPatch(settings, { ...modelsDraftFromSettings(settings), chatModel: "", embBaseUrl: " " });
    expect(patch.chatLlm?.model).toBeUndefined();
    expect(patch.embedding?.baseUrl).toBeUndefined();
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

  it("detects embedding identity changes for model or base URL", () => {
    const draft = modelsDraftFromSettings(settings);
    expect(embeddingSearchIdentityChanged(settings, draft)).toBe(false);
    expect(embeddingSearchIdentityChanged(settings, { ...draft, embModel: "other-model" })).toBe(true);
    expect(embeddingSearchIdentityChanged(settings, { ...draft, embBaseUrl: "https://other.example/v1" })).toBe(true);
    expect(embeddingSearchIdentityChanged(settings, { ...draft, embApiKey: "new-key" })).toBe(false);
  });

  it("clamps the session sync limit", () => {
    const draft = sessionsDraftFromSettings(settings);
    const patch = sessionsPatch(settings, { ...draft, maxItems: 999_999 });
    expect(patch.sessionSync?.maxItems).toBe(50_000);
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

  it("normalizes workbench editor values and persists nested scan inputs", () => {
    const invalidSettings = { ...settings, workbench: { editor: { fontSize: 99, tabSize: 3, autoSaveDelayMs: 50 } } } as unknown as PanelSettings;
    const draft = workbenchDraftFromSettings(invalidSettings);
    expect(draft.editorFontSize).toBe(24);
    expect(draft.editorTabSize).toBe(4);
    expect(draft.editorAutoSaveDelayMs).toBe(600);

    const patch = workbenchPatch(settings, { ...draft, gitNestedScanIgnoreDirs: "node_modules\n\ndist\n" });
    expect(patch.workbench?.gitNestedScanIgnoreDirs).toEqual(["node_modules", "dist"]);
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
