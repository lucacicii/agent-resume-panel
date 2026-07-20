import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n";
import { SettingsPanel } from "./SettingsPanel";

function renderSettings() {
  const host = document.createElement("div");
  host.id = "react-settings";
  document.body.append(host);
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages: {
      "desktop.settings.title": "Settings",
      "desktop.settings.toolLlm": "Tool LLM",
      "desktop.settings.toolLlmFootnote": "For summaries and commits",
      "desktop.settings.chatLlm": "Ask & Agent LLM",
      "desktop.settings.chatModelFootnote": "For Ask and Agent chat",
      "desktop.settings.embedding": "Embedding",
      "desktop.settings.embeddingFootnote": "For semantic search"
    } }),
    onLocaleChanged: () => () => undefined,
    getSettings: async () => ({
      uiLanguage: "en",
      llm: { baseUrl: "https://example.test/v1", model: "test", apiKey: "" },
      embedding: { model: "text-embedding-3-small" }
    })
  } as unknown as typeof window.agentResume;
  render(<I18nProvider><SettingsPanel /></I18nProvider>);
  return host;
}

describe("SettingsPanel", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("react-settings")?.remove();
  });

  it("closes when primary navigation changes", async () => {
    const host = renderSettings();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:settings-open", { detail: "general" }));
    });
    await waitFor(() => expect(host.querySelector(".react-settings-panel")).not.toBeNull());

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" }));
    });
    await waitFor(() => expect(host.querySelector(".react-settings-panel")).toBeNull());
  });

  it("separates models by the feature that uses them", async () => {
    const host = renderSettings();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:settings-open", { detail: "models" }));
    });

    await waitFor(() => expect(host.querySelectorAll(".settings-group")).toHaveLength(3));
    expect(host.textContent).toContain("Tool LLM");
    expect(host.textContent).toContain("For summaries and commits");
    expect(host.textContent).toContain("Ask & Agent LLM");
    expect(host.textContent).toContain("For semantic search");
  });
});
