import { describe, expect, it } from "vitest";
import type { PanelSettings } from "@agent-resume/core";
import { generalDraftFromSettings, modelsDraftFromSettings, modelsPatch, normalizeOutputLanguage, reportDraftFromSettings, reportPatch, sessionsDraftFromSettings, sessionsPatch, storageDraftFromSettings, storagePatch, workbenchDraftFromSettings, workbenchPatch } from "./model";

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

    const patch = modelsPatch(settings, { ...modelsDraftFromSettings(settings), chatModel: "", embBaseUrl: " " });
    expect(patch.chatLlm?.model).toBeUndefined();
    expect(patch.embedding?.baseUrl).toBeUndefined();
  });

  it("clamps the session sync limit and retains the safe Alma defaults", () => {
    const draft = sessionsDraftFromSettings(settings);
    expect(draft.hideCronAlma).toBe(true);
    const patch = sessionsPatch(settings, { ...draft, maxItems: 999_999 });
    expect(patch.sessionSync?.maxItems).toBe(50_000);
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

  it("preserves report invariants and only stores non-default agent homes", () => {
    const report = reportPatch(settings, { ...reportDraftFromSettings(settings), dailyHour: 30 });
    expect(report.report?.scheduleDailyHour).toBe(23);
    expect(report.report?.includeTranscripts).toBe(true);

    const storage = storagePatch({ ...settings, agentHomes: { codexHome: "~/old-codex" } }, { ...storageDraftFromSettings(settings), panelHome: "~/panel", codexHome: "~/custom-codex" });
    expect(storage.panelHome).toBe("~/panel");
    expect(storage.agentHomes).toEqual({ codexHome: "~/custom-codex" });

    const reset = storagePatch({ ...settings, agentHomes: { codexHome: "~/old-codex" } }, storageDraftFromSettings(settings));
    expect(reset.agentHomes).toBeUndefined();
  });
});
