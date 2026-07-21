import { describe, expect, it } from "vitest";
import type { PanelSettings } from "@agent-resume/core";
import { settingsChangedToCustomEvents } from "./settingsBroadcast";

const base: PanelSettings = {
  uiLanguage: "en",
  llm: { baseUrl: "https://example.test/v1", model: "test", apiKey: "" },
  embedding: { model: "text-embedding-3-small" }
};

describe("settingsChangedToCustomEvents", () => {
  it("always emits settings-saved with section", () => {
    const events = settingsChangedToCustomEvents({
      settings: base,
      section: "workbench"
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      name: "agent-resume:settings-saved",
      detail: { settings: base, section: "workbench" }
    });
  });

  it("also emits theme-change when desktop theme is set", () => {
    const settings = {
      ...base,
      desktop: { theme: "dark" as const }
    };
    const events = settingsChangedToCustomEvents({ settings, section: "general" });
    expect(events.map((e) => e.name)).toEqual([
      "agent-resume:settings-saved",
      "agent-resume:theme-change"
    ]);
    expect(events[1]).toEqual({ name: "agent-resume:theme-change", detail: "dark" });
  });
});
