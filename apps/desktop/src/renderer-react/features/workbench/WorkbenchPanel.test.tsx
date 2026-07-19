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
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
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

  it("opens develop-equivalent project and session context actions", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchNewSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/app" }));
    const onPreview = vi.fn();
    window.addEventListener("agent-resume:sessions-preview", onPreview);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.cancel": "Cancel", "desktop.common.confirm": "Confirm", "desktop.common.rename": "Rename", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New Session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.pinProject": "Pin project", "desktop.workbench.unpinProject": "Unpin project", "desktop.workbench.openInApp": "Open in {0}", "desktop.workbench.mountNote": "Mount note", "desktop.workbench.renameProject": "Rename project", "desktop.workbench.openInChatGpt": "Open in ChatGPT", "desktop.workbench.preview": "Preview", "desktop.workbench.removeFromPanel": "Remove from panel"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchGetProjectEditor: async () => ({ selected: "vscode", available: true, editor: { id: "vscode", label: "VS Code" } }),
      workbenchNewSession,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const project = await screen.findByTitle("/work/app");
    fireEvent.contextMenu(project);
    await screen.findByRole("menuitem", { name: "Pin project" });
    fireEvent.click(screen.getByRole("menuitem", { name: "New Session" }));
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith({ cwd: "/work/app", provider: "codex" }));

    fireEvent.contextMenu(screen.getByRole("button", { name: /Fix renderer/ }));
    await screen.findByRole("menuitem", { name: "Preview" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview" }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    window.removeEventListener("agent-resume:sessions-preview", onPreview);
  });

  it("matches develop session search focus and Escape behavior", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }]
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await screen.findByRole("button", { name: /Fix renderer/ });
    const searchButton = screen.getByRole("button", { name: "Search" });
    fireEvent.click(searchButton);
    const searchInput = screen.getByRole("searchbox", { name: "Search" });
    await waitFor(() => expect(document.activeElement).toBe(searchInput));
    fireEvent.change(searchInput, { target: { value: "renderer" } });
    fireEvent.keyDown(searchInput, { key: "Escape" });
    expect(searchInput).toHaveProperty("value", "");
    fireEvent.keyDown(searchInput, { key: "Escape" });
    await waitFor(() => expect(searchButton.getAttribute("aria-expanded")).toBe("false"));
  });
});
