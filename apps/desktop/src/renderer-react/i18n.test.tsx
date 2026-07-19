import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider, useI18n } from "./i18n";

function Probe(): React.JSX.Element {
  const { t } = useI18n();
  return <span>{t("desktop.test.value", "Agent")}</span>;
}

describe("i18n", () => {
  it("renders translated values from the desktop bridge", async () => {
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { "desktop.test.value": "Hello, {0}" } }),
      onLocaleChanged: () => () => undefined
    } as unknown as typeof window.agentResume;

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    expect(await screen.findByText("Hello, Agent")).not.toBeNull();
    expect(document.documentElement.classList.contains("i18n-ready")).toBe(true);
  });
});
