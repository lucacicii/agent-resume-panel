import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { WorkbenchPanel } from "./WorkbenchPanel";

vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80;
  rows = 24;
  loadAddon() {}
  open() {}
  focus() {}
  write() {}
  onData() { return { dispose() {} }; }
  dispose() {}
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {
  fit() {}
  proposeDimensions() { return { cols: 80, rows: 24 }; }
} }));
vi.stubGlobal("ResizeObserver", class {
  observe() {}
  disconnect() {}
});

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
      onWorkbenchCmdW: () => () => undefined,
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
      onWorkbenchCmdW: () => () => undefined,
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
      onWorkbenchCmdW: () => () => undefined,
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

  it("keeps embedded terminals alive across navigation, project, and terminal switches", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 });
    const terminalDestroy = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 },
        { provider: "codex", id: "session-2", title: "Review tests", projectPath: "/work/app", updatedAt: 2 },
        { provider: "codex", id: "session-3", title: "Write docs", projectPath: "/work/docs", updatedAt: 3 }
      ],
      workbenchOpenSession: async ({ id }: { id: string }) => ({ mode: "xterm", command: `codex resume ${id}`, cwd: "/work/app" }),
      terminalSpawn,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy,
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const sessionButton = (title: string) => [...document.querySelectorAll<HTMLButtonElement>(".wb-list-item")]
      .find((button) => button.textContent?.includes(title));
    await waitFor(() => expect(sessionButton("Fix renderer")).toBeTruthy());
    fireEvent.click(sessionButton("Fix renderer")!);
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    fireEvent.click(sessionButton("Review tests")!);
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(2));

    fireEvent.click(document.querySelector<HTMLButtonElement>(".wb-terminal-tab-label")!);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "report" })));
    expect(terminalDestroy).not.toHaveBeenCalled();

    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[title="/work/docs"]')!);
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[title="/work/app"]')!);
    expect(terminalSpawn).toHaveBeenCalledTimes(2);
    expect(terminalDestroy).not.toHaveBeenCalled();
    expect(document.querySelector(".wb-terminal-tab-close")).toBeTruthy();
  });

  it("closes the active terminal when the main-process Cmd+W bridge fires", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let onWorkbenchCmdW: (() => void) | undefined;
    const setWorkbenchActive = vi.fn();
    const terminalDestroy = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal"
      } }),
      onLocaleChanged: () => () => undefined,
      setWorkbenchActive,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: (callback: () => void) => { onWorkbenchCmdW = callback; return () => undefined; },
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy,
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await screen.findByRole("button", { name: "Close terminal" });
    expect(setWorkbenchActive).toHaveBeenCalledWith(true);
    act(() => onWorkbenchCmdW?.());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Close terminal" })).toBeNull());
    expect(terminalDestroy).toHaveBeenCalledWith({ id: 1 });
  });
});
