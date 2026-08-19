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
  it("stays visible until i18n and the initial session sync finish", async () => {
    const bundle = deferred<{ locale: string; messages: Record<string, string> }>();
    const sync = deferred<unknown>();
    const syncSessions = vi.fn(() => sync.promise);
    window.agentResume = {
      getI18nBundle: () => bundle.promise,
      onLocaleChanged: () => () => undefined,
      syncSessions
    } as unknown as typeof window.agentResume;

    renderStartupMask();

    expect(screen.getByRole("status").textContent).toContain("Syncing agent sessions…");
    expect(syncSessions).not.toHaveBeenCalled();

    await act(async () => {
      bundle.resolve({
        locale: "en",
        messages: { "desktop.workbench.syncingSessions": "Syncing agent sessions…" }
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(syncSessions).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status").textContent).toContain("Syncing agent sessions…");

    await act(async () => {
      sync.resolve({});
      await sync.promise;
    });
    await waitFor(() => expect(document.querySelector(".app-startup-mask")?.className).toContain("is-hiding"));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull(), { timeout: 1_000 });
  });

  it("dismisses when the initial session sync fails", async () => {
    const syncSessions = vi.fn(async () => {
      throw new Error("sync unavailable");
    });
    window.agentResume = {
      getI18nBundle: async () => ({
        locale: "en",
        messages: { "desktop.workbench.syncingSessions": "Syncing agent sessions…" }
      }),
      onLocaleChanged: () => () => undefined,
      syncSessions
    } as unknown as typeof window.agentResume;

    renderStartupMask();

    await waitFor(() => expect(syncSessions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector(".app-startup-mask")?.className).toContain("is-hiding"));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull(), { timeout: 1_000 });
  });
});
