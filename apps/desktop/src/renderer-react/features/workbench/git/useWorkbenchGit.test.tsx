import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { useWorkbenchGit } from "./useWorkbenchGit";

const messages = { "desktop.workbench.gitStatusRefreshFailed": "Could not refresh Git status: {0}" };

function installBridge(status: () => Promise<unknown>) {
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages }),
    onLocaleChanged: () => () => undefined,
    terminalGitStatus: status
  } as unknown as typeof window.agentResume;
}

function renderGit(projects: string[]) {
  return renderHook(
    () => useWorkbenchGit({
      active: true,
      selectedProjects: projects,
      selectedProjectsRef: { current: projects },
      side: "git",
      onGitMutated: () => undefined,
      notifyStatus: () => undefined
    }),
    { wrapper: I18nProvider }
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWorkbenchGit unmount", () => {
  it("stops waiting out an in-flight status call after unmount", async () => {
    // Hold the status lock forever: the wait loop can only end by noticing that
    // the component unmounted.
    const pending = new Promise<never>(() => undefined);
    installBridge(() => pending);

    const { result, unmount } = renderGit(["/work/app"]);
    await waitFor(() => expect(window.agentResume.terminalGitStatus).toBeDefined());

    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    // A user-initiated refresh while the lock is held enters the wait loop,
    // which reschedules itself on a 50ms window timer.
    void result.current.refreshGit(true);
    await waitFor(() => expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 50)).toBe(true));

    unmount();
    const afterUnmount = setTimeoutSpy.mock.calls.filter((call) => call[1] === 50).length;

    await new Promise((resolve) => setTimeout(resolve, 200));

    // No new 50ms polls: the loop exited instead of polling a torn-down window.
    const afterWait = setTimeoutSpy.mock.calls.filter((call) => call[1] === 50).length;
    expect(afterWait).toBe(afterUnmount);
  });
});
