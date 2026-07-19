import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { WorkbenchPanel } from "./WorkbenchPanel";

vi.mock("@xterm/xterm", () => ({ Terminal: class {} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {} }));

afterEach(() => {
  cleanup();
  document.getElementById("react-workbench")?.remove();
});

describe("WorkbenchPanel", () => {
  it("loads project sessions and restores the selected session through the desktop bridge", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchOpenSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/app", external: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listSessions: async () => [
        { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 },
        { provider: "claude", id: "session-2", title: "Write tests", projectPath: "/work/docs", updatedAt: 2 }
      ],
      workbenchOpenSession
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await screen.findByRole("button", { name: /Fix renderer/ });
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[title="/work/app"]')!);
    expect(screen.queryByRole("button", { name: /Write tests/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(workbenchOpenSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1" }));
  });
});
