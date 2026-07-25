import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { WorkbenchPanel } from "./WorkbenchPanel";

const notificationMocks = vi.hoisted(() => ({ notifyDesktop: vi.fn() }));

vi.mock("../../components/Notifications", () => notificationMocks);

vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80;
  rows = 24;
  loadAddon() {}
  open() {}
  focus() {}
  write() {}
  onData() { return { dispose() {} }; }
  onResize() { return { dispose() {} }; }
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
  notificationMocks.notifyDesktop.mockClear();
  document.getElementById("react-workbench")?.remove();
  localStorage.removeItem("workbench-sidebar-view");
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
    const fixRenderer = await screen.findByRole("button", { name: /Fix renderer/ });
    const providerTag = fixRenderer.querySelector(".wb-list-item-preview .s-provider-tag");
    expect(providerTag?.classList.contains("s-provider-tag")).toBe(true);
    expect(providerTag?.getAttribute("data-provider")).toBe("codex");
    expect(providerTag?.textContent).toBe("codex");
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
    // Default project context menu includes newSession (pin is optional / settings-driven).
    await screen.findByRole("menuitem", { name: "New Session" });
    fireEvent.click(screen.getByRole("menuitem", { name: "New Session" }));
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith({ cwd: "/work/app", provider: "codex" }));

    fireEvent.contextMenu(screen.getByRole("button", { name: /Fix renderer/ }));
    await screen.findByRole("menuitem", { name: "Preview" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview" }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    window.removeEventListener("agent-resume:sessions-preview", onPreview);
  });

  it("hides catalog projects with zero sessions", async () => {
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
      listSessions: async () => [
        { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", projectId: "proj-app", updatedAt: 1 }
      ],
      listProjects: async () => [
        {
          projectId: "proj-app",
          portableKey: "~/work/app",
          alias: "app",
          hidden: false,
          pinned: false,
          lastSeenAtMs: 1,
          updatedAtMs: 1,
          localPath: "/work/app",
          pathMissing: false,
          sessionCount: 1
        },
        {
          projectId: "proj-empty",
          portableKey: "~/work/empty",
          alias: "empty",
          hidden: false,
          pinned: true,
          lastSeenAtMs: 2,
          updatedAtMs: 2,
          localPath: "/work/empty",
          pathMissing: false,
          sessionCount: 0
        }
      ]
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await screen.findByTitle("/work/app");
    expect(document.querySelector('button[title="/work/empty"]')).toBeNull();
    expect(screen.queryByText("empty")).toBeNull();
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

  it("locates an already-open embedded session instead of reopening it", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let resolveOpen: (result: { mode: "xterm"; command: string; cwd: string }) => void = () => undefined;
    const workbenchOpenSession = vi.fn(() => new Promise<{ mode: "xterm"; command: string; cwd: string }>((resolve) => { resolveOpen = resolve; }));
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
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
        { provider: "codex", id: "session-2", title: "Write docs", projectPath: "/work/docs", updatedAt: 2 }
      ],
      workbenchOpenSession,
      terminalSpawn,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const sessionButton = () => screen.getByRole("button", { name: /Fix renderer/ });
    fireEvent.click(sessionButton());
    fireEvent.click(sessionButton());
    expect(workbenchOpenSession).toHaveBeenCalledTimes(1);

    await act(async () => resolveOpen({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[title="/work/docs"]')!);
    fireEvent.click(screen.getByRole("button", { name: /All sessions/ }));
    fireEvent.click(sessionButton());

    expect(workbenchOpenSession).toHaveBeenCalledTimes(1);
    expect(terminalSpawn).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".wb-terminal-tab-label")?.textContent).toBe("Fix renderer");
    expect(document.querySelector<HTMLButtonElement>('button[title="/work/app"]')?.className).toContain("active");
  });

  it("marks and filters only sessions whose workbench terminal remains open", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
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
        { provider: "codex", id: "recent", title: "Recently updated", projectPath: "/work/app", updatedAt: Date.now() },
        { provider: "codex", id: "older", title: "Older session", projectPath: "/work/app", updatedAt: 1 }
      ],
      workbenchOpenSession: async ({ id }: { id: string }) => ({ mode: "xterm", command: `codex resume ${id}`, cwd: "/work/app" }),
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await screen.findByRole("button", { name: /Recently updated/ });
    const sessionFilters = document.querySelectorAll<HTMLButtonElement>(".wb-session-filter-wrap [role=tab]");
    fireEvent.click(sessionFilters[1]);
    expect(screen.queryByRole("button", { name: /Recently updated/ })).toBeNull();

    fireEvent.click(sessionFilters[0]);
    fireEvent.click(screen.getByRole("button", { name: /Recently updated/ }));
    await screen.findByRole("button", { name: "Close terminal" });
    await waitFor(() => expect(document.querySelector(".wb-list-item .wb-session-activity-dot")).not.toBeNull());

    fireEvent.click(sessionFilters[1]);
    expect(document.querySelector(".wb-list-item")?.textContent).toContain("Recently updated");
    expect(screen.queryByRole("button", { name: /Older session/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Recently updated/ })).toBeNull());
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

  it("after Cmd+W activates the most recently used remaining terminal tab", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let onWorkbenchCmdW: (() => void) | undefined;
    let spawnSeq = 0;
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.terminalTabs": "Terminal tabs"
      } }),
      onLocaleChanged: () => () => undefined,
      setWorkbenchActive: () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: (callback: () => void) => { onWorkbenchCmdW = callback; return () => undefined; },
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex", id: "session-a", title: "Session A", projectPath: "/work/app", updatedAt: 3 },
        { provider: "codex", id: "session-b", title: "Session B", projectPath: "/work/app", updatedAt: 2 },
        { provider: "codex", id: "session-c", title: "Session C", projectPath: "/work/app", updatedAt: 1 }
      ],
      workbenchOpenSession: async ({ id }: { id: string }) => ({ mode: "xterm", command: `codex resume ${id}`, cwd: "/work/app" }),
      terminalSpawn: async () => ({ id: ++spawnSeq }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    // Open A → B → C (C is active), then switch back to A so MRU previous is C.
    fireEvent.click(await screen.findByRole("button", { name: /Session A/ }));
    await waitFor(() => expect(document.querySelectorAll(".wb-terminal-tab").length).toBe(1));
    fireEvent.click(await screen.findByRole("button", { name: /Session B/ }));
    await waitFor(() => expect(document.querySelectorAll(".wb-terminal-tab").length).toBe(2));
    fireEvent.click(await screen.findByRole("button", { name: /Session C/ }));
    await waitFor(() => expect(document.querySelectorAll(".wb-terminal-tab").length).toBe(3));

    const tabByLabel = (title: string) => [...document.querySelectorAll(".wb-terminal-tab")].find((tab) =>
      tab.querySelector(".wb-terminal-tab-label")?.textContent === title
    );
    fireEvent.click(tabByLabel("Session A")!.querySelector("button.wb-terminal-tab-label")!);
    await waitFor(() => expect(tabByLabel("Session A")?.classList.contains("active")).toBe(true));

    act(() => onWorkbenchCmdW?.());

    await waitFor(() => {
      expect(document.querySelectorAll(".wb-terminal-tab").length).toBe(2);
      // Previous MRU after A→B→C→A is C, not the first remaining tab B.
      expect(tabByLabel("Session C")?.classList.contains("active")).toBe(true);
      expect(tabByLabel("Session B")?.classList.contains("active")).toBe(false);
      expect(tabByLabel("Session A")).toBeUndefined();
    });
  });

  it("shows loading until the new terminal PTY is ready", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let resolveSpawn: (result: { id: number }) => void = () => undefined;
    const terminalSpawn = vi.fn(() => new Promise<{ id: number }>((resolve) => { resolveSpawn = resolve; }));
    let resolveNewSession: (result: { mode: "xterm"; command: string; cwd: string }) => void = () => undefined;
    const workbenchNewSession = vi.fn(() => new Promise<{ mode: "xterm"; command: string; cwd: string }>((resolve) => {
      resolveNewSession = resolve;
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.loading": "Loading…", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.terminalTabs": "Terminal tabs"
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
      workbenchNewSession,
      terminalSpawn,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByTitle("/work/app"));
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-loading")).toBeTruthy());
    expect(screen.getByRole("status").textContent).toContain("Loading");
    await act(async () => resolveSpawn({ id: 11 }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-loading")).toBeNull());
    expect(terminalSpawn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-loading")).toBeTruthy());
    await act(async () => resolveNewSession({ mode: "xterm", command: "codex", cwd: "/work/app" }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(2));
    expect(document.querySelector(".wb-terminal-loading")).toBeTruthy();
    await act(async () => resolveSpawn({ id: 12 }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-loading")).toBeNull());
  });

  it("does not leave loading visible for external-system new sessions", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchNewSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/app" }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.loading": "Loading…", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.terminalTabs": "Terminal tabs"
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
      workbenchNewSession,
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByTitle("/work/app"));
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector(".wb-terminal-loading")).toBeNull());
    expect(screen.getByRole("button", { name: "New session" }).hasAttribute("disabled")).toBe(false);
  });

  it("reports manual Git actions and keeps automatic refreshes silent", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const gitFile = {
      path: "src/app.ts",
      repoPath: "src/app.ts",
      repoRoot: "/work/app",
      status: "M",
      staged: false,
      unstaged: true
    };
    const terminalGitStatus = vi.fn(async () => ({
      isRepo: true,
      root: "/work/app",
      staged: [],
      unstaged: [gitFile],
      nestedRepos: [],
      tracking: [{ repoRoot: "/work/app", branch: "main", upstream: "origin/main", ahead: 1, behind: 2 }]
    }));
    const terminalGitFetch = vi.fn(async () => ({ ok: true }));
    const terminalGitPush = vi.fn(async () => ({ ok: true }));
    const terminalGitPull = vi.fn(async () => { throw new Error("no upstream"); });
    const terminalGitCommit = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.cancel": "Cancel", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.sidePanelNoChanges": "No changes", "desktop.workbench.sidePanelStaged": "Staged", "desktop.workbench.sidePanelChanges": "Changes", "desktop.workbench.sidePanelGitUnavailable": "Git unavailable", "desktop.workbench.sidePanelNoRoot": "No root", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.gitCommit": "Commit", "desktop.workbench.gitCommitAndPush": "Commit & Push", "desktop.workbench.gitCommitDialogTitle": "Commit changes", "desktop.workbench.gitCommitAutoGenerate": "Auto generate", "desktop.workbench.gitCommitSuggestedLlm": "AI message", "desktop.workbench.gitCommitSuggestedUnconfigured": "Rule message", "desktop.workbench.gitCommitSuggestedFallback": "Fallback message", "desktop.workbench.gitPush": "Push", "desktop.workbench.gitPull": "Pull", "desktop.workbench.gitLog": "Git log", "desktop.workbench.gitStatusRefreshed": "Git status refreshed.", "desktop.workbench.gitPushSucceeded": "Push completed.", "desktop.workbench.gitPullFailed": "Pull failed: {0}", "desktop.workbench.gitCommitSucceeded": "Commit completed.", "desktop.workbench.gitStatusRefreshFailed": "Could not refresh Git status: {0}", "desktop.workbench.gitBranchTracking": "{0}  ↑{1}  ↓{2}", "desktop.workbench.gitNoUpstream": "{0} · no upstream"
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
      terminalGitStatus,
      terminalGitFetch,
      terminalGitPush,
      terminalGitPull,
      terminalGitCommit
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByTitle("/work/app"));
    // Auto status/fetch runs while Workbench is active even before opening the Git side panel.
    await waitFor(() => expect(terminalGitStatus.mock.calls.length).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(terminalGitFetch).toHaveBeenCalledWith({ repoRoot: "/work/app" }));
    const autoStatusCalls = terminalGitStatus.mock.calls.length;
    expect(notificationMocks.notifyDesktop).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "Git" })[0]!);
    await waitFor(() => expect(document.querySelector(".wb-git-panel")).not.toBeNull());
    await waitFor(() => {
      const tracking = document.querySelector(".wb-git-tracking");
      expect(tracking?.textContent || "").toContain("main");
      expect(tracking?.textContent || "").toMatch(/↑\s*1/);
      expect(tracking?.textContent || "").toMatch(/↓\s*2/);
    });

    const gitActions = document.querySelector(".wb-git-actions")!;
    fireEvent.click(gitActions.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!);
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenLastCalledWith({ text: "Git status refreshed.", kind: "ok" }));
    expect(terminalGitStatus.mock.calls.length).toBeGreaterThan(autoStatusCalls);

    fireEvent.click(gitActions.querySelector<HTMLButtonElement>('button[aria-label="Push"]')!);
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenLastCalledWith({ text: "Push completed.", kind: "ok" }));

    fireEvent.click(gitActions.querySelector<HTMLButtonElement>('button[aria-label="Pull"]')!);
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenLastCalledWith({ text: "Pull failed: no upstream", kind: "error" }));

    expect(screen.queryByRole("dialog", { name: "Commit changes" })).toBeNull();
    expect(gitActions.querySelector<HTMLButtonElement>('button[aria-label="Commit"]')).toBeNull();
    const messageField = await screen.findByRole("textbox", { name: "Commit changes" });
    expect(document.querySelector(".wb-git-commit-composer")).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: "src/app.ts" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.change(messageField, { target: { value: "feat: add toasts" } });
    fireEvent.click(screen.getByRole("button", { name: "Commit & Push" }));
    await waitFor(() => expect(terminalGitCommit).toHaveBeenCalledWith({
      repoRoot: "/work/app",
      message: "feat: add toasts",
      paths: ["src/app.ts"]
    }));
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenLastCalledWith({ text: "Push completed.", kind: "ok" }));
    expect(notificationMocks.notifyDesktop).toHaveBeenCalledWith({ text: "Commit completed.", kind: "ok" });
  });

  it("polls git status while Workbench is active without opening the Git panel", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalGitStatus = vi.fn(async () => ({
      isRepo: true,
      root: "/work/app",
      staged: [],
      unstaged: [],
      nestedRepos: [],
      tracking: [{ repoRoot: "/work/app", branch: "develop", upstream: null, ahead: 0, behind: 0 }]
    }));
    const terminalGitFetch = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.gitBranchTracking": "{0}  ↑{1}  ↓{2}", "desktop.workbench.gitNoUpstream": "{0} · no upstream"
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
      terminalGitStatus,
      terminalGitFetch
    } as unknown as typeof window.agentResume;

    try {
      render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
      fireEvent.click(await screen.findByTitle("/work/app"));
      await waitFor(() => expect(terminalGitStatus.mock.calls.length).toBeGreaterThanOrEqual(1));
      const afterActivate = terminalGitStatus.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      await waitFor(() => expect(terminalGitStatus.mock.calls.length).toBeGreaterThan(afterActivate));
      expect(notificationMocks.notifyDesktop).not.toHaveBeenCalled();
      // Git side panel closed — tracking is stored but not rendered.
      expect(screen.queryByText("develop · no upstream")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows GTD status, filters the GTD view, and updates it from the session menu", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const setSessionGtdStatus = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.rename": "Rename", "desktop.workbench.sidebarView": "Workbench sidebar view", "desktop.workbench.projectsView": "Project view", "desktop.workbench.gtdView": "GTD view", "desktop.workbench.filterGtdSessions": "Filter GTD sessions", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.openInChatGpt": "Open in ChatGPT", "desktop.workbench.preview": "Preview", "desktop.workbench.mountNote": "Mount note", "desktop.workbench.removeFromPanel": "Remove", "desktop.workbench.setGtdStatus": "Set GTD status", "desktop.workbench.clearGtdStatus": "Clear GTD status", "desktop.workbench.gtdStatusSaveFailed": "Save failed: {0}", "desktop.workbench.gtdStatusLabel": "GTD status: {0}", "desktop.workbench.gtdCompleted": "Completed", "desktop.workbench.gtdStatus.inbox": "Inbox", "desktop.workbench.gtdStatus.next": "Next", "desktop.workbench.gtdStatus.waiting": "Waiting", "desktop.workbench.gtdStatus.someday": "Someday", "desktop.workbench.gtdStatus.reference": "Reference", "desktop.workbench.gtdStatus.done": "Done"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessionGtdStatuses: async () => ({ "codex:next-session": "next" }),
      setSessionGtdStatus,
      listSessions: async () => [
        { provider: "codex", id: "next-session", title: "Ship GTD view", projectPath: "/work/app", updatedAt: 2 },
        { provider: "claude", id: "inbox-session", title: "Triage feedback", projectPath: "/work/docs", updatedAt: 1 }
      ],
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const nextSession = await screen.findByRole("button", { name: /Ship GTD view/ });
    expect(nextSession.querySelector(".wb-gtd-status-badge")?.textContent).toBe("Next");

    fireEvent.contextMenu(nextSession);
    const waitingTag = await screen.findByRole("menuitemradio", { name: "Waiting" });
    expect(waitingTag.classList.contains("wb-gtd-context-tag")).toBe(true);
    expect(waitingTag.closest(".wb-session-context-menu")).toBeTruthy();
    fireEvent.click(waitingTag);
    await waitFor(() => expect(setSessionGtdStatus).toHaveBeenCalledWith({ provider: "codex", id: "next-session", status: "waiting" }));
    expect(nextSession.querySelector(".wb-gtd-status-badge")?.textContent).toBe("Waiting");

    fireEvent.contextMenu(nextSession);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Done" }));
    await waitFor(() => expect(setSessionGtdStatus).toHaveBeenCalledWith({ provider: "codex", id: "next-session", status: "done" }));
    expect(nextSession.querySelector(".wb-gtd-status-badge")?.textContent).toBe("Done");

    fireEvent.click(screen.getByRole("tab", { name: "GTD view" }));
    const completed = screen.getByRole("button", { name: /^Completed/ });
    expect(completed.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /^Done/ })).toBeNull();
    fireEvent.click(completed);
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    expect(screen.getByRole("button", { name: /Ship GTD view/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Triage feedback/ })).toBeNull();
  });

  it("dismisses the branch popover on outside click and Escape", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.loading": "Loading", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.gitBranchesLoaded": "Branches loaded"
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
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "direct", isRepo: true, branch: "main", repoRoot: "/work/app", nestedRepos: [] }),
      terminalGitBranches: async () => ({ mode: "direct", current: "main", branches: ["main", "feature"], repoRoot: "/work/app" }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    const branchButton = await screen.findByRole("button", { name: "main" });
    expect(branchButton.closest(".wb-detail-head")).not.toBeNull();
    fireEvent.click(branchButton);
    await waitFor(() => expect(document.querySelector(".wb-git-branch-popover")).toBeTruthy());
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(document.querySelector(".wb-git-branch-popover")).toBeNull());

    fireEvent.click(branchButton);
    await waitFor(() => expect(document.querySelector(".wb-git-branch-popover")).toBeTruthy());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".wb-git-branch-popover")).toBeNull());
  });
});
