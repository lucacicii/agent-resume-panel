import { describe, expect, it } from "vitest";
import type { PanelSettings } from "@agent-resume/core";
import { settingsChangedToCustomEvents } from "./settingsBroadcast";

const base: PanelSettings = {
  uiLanguage: "en",
  llm: { baseUrl: "https://example.test/v1", model: "test", apiKey: "" },
  embedding: { model: "text-embedding-3-small" },
  providers: [
    {
      id: "p1",
      name: "Example",
      baseUrl: "https://example.test/v1",
      models: [
        { id: "test", kind: "text" },
        { id: "text-embedding-3-small", kind: "embedding" }
      ]
    }
  ],
  modelSelections: {
    tool: { providerId: "p1", modelId: "test" },
    embedding: { providerId: "p1", modelId: "text-embedding-3-small" }
  }
};

describe("settingsChangedToCustomEvents", () => {
  it("broadcasts saved settings plus a complete classic appearance state", () => {
    const events = settingsChangedToCustomEvents({ settings: base, section: "workbench" });
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ name: "agent-resume:settings-saved", detail: { settings: base, section: "workbench" } });
    expect(events[1]).toMatchObject({
      name: "agent-resume:appearance-change",
      detail: { visualTheme: "classic", requestedAppearance: "system", effects: "full", density: "comfortable" }
    });
  });

  it("forces the dark-only theme state across windows", () => {
    const settings = { ...base, desktop: { theme: "light" as const, visualTheme: "dos" as const, themeEffects: "reduced" as const } };
    const events = settingsChangedToCustomEvents({ settings, section: "general" });
    expect(events[1]).toEqual({
      name: "agent-resume:appearance-change",
      detail: expect.objectContaining({ visualTheme: "dos", requestedAppearance: "dark", appearance: "dark", effects: "reduced", density: "compact" })
    });
  });
});
