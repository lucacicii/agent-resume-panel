import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { StartupMask } from "./StartupMask";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderStartupMask() {
  return render(
    <StrictMode>
      <I18nProvider>
        <StartupMask />
      </I18nProvider>
    </StrictMode>
  );
}

describe("StartupMask", () => {
  it("stays visible until i18n is ready, then hides and dismisses", async () => {
    const bundle = deferred<{ locale: string; messages: Record<string, string> }>();
    window.agentResume = {
      getI18nBundle: () => bundle.promise,
      onLocaleChanged: () => () => undefined
    } as unknown as typeof window.agentResume;

    renderStartupMask();

    expect(document.querySelector(".app-startup-mask")).not.toBeNull();
    expect(document.querySelector(".app-startup-mask")?.className).not.toContain("is-hiding");

    await act(async () => {
      bundle.resolve({
        locale: "en",
        messages: {}
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(document.querySelector(".app-startup-mask")?.className).toContain("is-hiding"));
    await waitFor(() => expect(document.querySelector(".app-startup-mask")).toBeNull(), { timeout: 1_000 });
  });

  it("dismisses immediately when prefers-reduced-motion is active", async () => {
    window.agentResume = {
      getI18nBundle: async () => ({
        locale: "en",
        messages: {}
      }),
      onLocaleChanged: () => () => undefined
    } as unknown as typeof window.agentResume;

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));

    try {
      renderStartupMask();
      await waitFor(() => expect(document.querySelector(".app-startup-mask")).toBeNull());
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
