import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { BrowserIpcEvent, BrowserSessionState } from "../../../shared/browserTypes";
import { WorkbenchPanel } from "./WorkbenchPanel";

const session: BrowserSessionState = {
  id: "b1",
  projectPath: "/work/app",
  partition: "persist:agent-browser",
  createdAt: 0,
  tabs: [
    { tabId: "t1", url: "http://localhost:3000", title: "Local app", loading: false, canGoBack: false, canGoForward: false }
  ],
  activeTabId: "t1",
  surface: { kind: "workbench", windowId: 1 },
  owners: [],
  policy: { allowHosts: [], blockHosts: [], allowPopups: false, maxTabs: 6 }
};

const MESSAGES: Record<string, string> = {
  "desktop.workbench.sidePanelBrowser": "Browser",
  "desktop.workbench.sidePanelExplorer": "Explorer",
  "desktop.workbench.sidePanelGit": "Git",
  "desktop.workbench.sidePanelScripts": "Scripts",
  "desktop.workbench.sidePanelSearch": "Search",
  "desktop.workbench.selectProjectHint": "Select a project",
  "desktop.workbench.selectSessionHint": "Select a session",
  "desktop.workbench.newTerminal": "New terminal",
  "desktop.workbench.newSession": "New session",
  "desktop.workbench.allSessions": "All sessions",
  "desktop.workbench.noSessionsInProject": "No sessions",
  "desktop.workbench.noProjects": "No projects",
  "desktop.browser.newBrowser": "New Browser",
  "desktop.browser.probeEmpty": "No browser in this directory yet",
  "desktop.browser.probeOpenSource": "Open source in workbench",
  "desktop.browser.probeSendToSession": "Send to session",
  "desktop.browser.probeTargetInspect": "Picked <{0}>",
  "desktop.browser.probeConsole": "Console",
  "desktop.browser.console.fix": "Send error to session",
  "desktop.browser.console.fixHeading": "HEADING",
  "desktop.browser.console.fixText": "Error: {0}",
  "desktop.browser.console.fixOutro": "OUTRO",
  "desktop.browser.probe.inspectHeading": "INSPECT-HEADING",
  "desktop.browser.probe.element": "- Target element: <{0}>",
  "desktop.browser.probe.selector": "- Selector: {0}",
  "desktop.browser.probe.source": "- Source: {0}:{1}",
  "desktop.common.close": "Close",
  "desktop.common.copy": "Copy",
  "desktop.common.cancel": "Cancel",
  "desktop.common.confirm": "Confirm"
};

type Call = { method: string; args: unknown };

function stubApi(): { calls: Call[]; emit: (event: BrowserIpcEvent) => void; get: (method: string) => Call[] } {
  const calls: Call[] = [];
  const listeners = new Set<(event: BrowserIpcEvent) => void>();
  const record =
    (method: string) =>
    (args?: unknown) => {
      calls.push({ method, args });
      return Promise.resolve({ ok: true });
    };
  const explicit: Record<string, unknown> = {
    getI18nBundle: async () => ({ locale: "en", messages: MESSAGES }),
    onLocaleChanged: () => () => undefined,
    onWorkbenchCmdT: () => () => undefined,
    onWorkbenchCmdW: () => () => undefined,
    onWorkbenchCmdP: () => () => undefined,
    onWorkbenchCmdShiftP: () => () => undefined,
    onTerminalData: () => () => undefined,
    onTerminalExit: () => () => undefined,
    onTerminalRespawned: () => () => undefined,
    onBrowserEvent: (callback: (event: BrowserIpcEvent) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
    listSessions: async () => [],
    listProjectAliases: async () => ({}),
    notesListTasks: async () => [],
    listTaskWorkbenches: async () => [],
    ensureTaskWorkbench: async () => null,
    setTaskWorkbenchLayout: async () => ({ ok: true }),
    workbenchListScripts: async () => ({ truncated: false, packages: [] }),
    workbenchOpenPath: async (args: { filePath: string }) => {
      calls.push({ method: "workbenchOpenPath", args });
      return { kind: "text", content: "// src", encoding: "utf8", version: "v1", size: 6, mtimeMs: 1 };
    },
    terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
    browserGet: async (args: { browserId: string }) => {
      calls.push({ method: "browserGet", args });
      return args.browserId === session.id ? session : null;
    },
    browserCreate: async (args: { projectPath: string }) => {
      calls.push({ method: "browserCreate", args });
      return { ...session, id: "b-new", projectPath: args.projectPath };
    },
    browserSetProbeActive: record("browserSetProbeActive"),
    browserSetVisible: record("browserSetVisible"),
    workbenchListDirectory: async () => ({ entries: [], truncated: false }),
    browserAttachBounds: record("browserAttachBounds"),
    browserSetInspectMode: record("browserSetInspectMode"),
    browserClearMarkups: record("browserClearMarkups"),
    browserSetZoom: record("browserSetZoom"),
    browserClearDevtoolsLogs: record("browserClearDevtoolsLogs"),
    browserToggleDevTools: record("browserToggleDevTools"),
    browserNavigate: record("browserNavigate"),
    terminalCreate: record("terminalCreate")
  };
  window.agentResume = new Proxy(explicit, {
    get: (target, property: string) => {
      if (property in target) return target[property];
      // Subscriptions must hand back a cleanup function; everything else is awaited rpc.
      return (...args: unknown[]) => (typeof args[0] === "function" ? () => undefined : Promise.resolve(undefined));
    }
  }) as unknown as typeof window.agentResume;
  return {
    calls,
    emit: (event) => listeners.forEach((listener) => listener(event)),
    get: (method) => calls.filter((call) => call.method === method)
  };
}

async function mountWorkbench(): Promise<void> {
  const host = document.createElement("div");
  host.id = "react-workbench";
  document.body.append(host);
  document.documentElement.dataset.windowMode = "task";
  render(
    <I18nProvider>
      <WorkbenchPanel />
    </I18nProvider>
  );
  await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("agent-resume:workbench-task", {
        detail: {
          noteId: "wi-browser",
          title: "Browser task",
          status: "inbox",
          sessions: [],
          projects: ["/work/app"],
          primaryProject: "/work/app"
        }
      })
    );
  });
}

describe("WorkbenchPanel browser side panel wiring", () => {
  afterEach(cleanup);
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }) as unknown as typeof window.matchMedia;
  });

  it("opens the panel from the header tool and drives the probe lifecycle", async () => {
    const api = stubApi();
    await mountWorkbench();

    fireEvent.click(await screen.findByRole("button", { name: "Browser" }));
    const sidePanel = document.querySelector(".wb-side-panel");
    expect(sidePanel).not.toBeNull();
    expect(sidePanel?.textContent).toContain("No browser in this directory yet");

    // Empty state creates a session in the panel's own directory.
    fireEvent.click(await screen.findByText("New Browser"));
    await waitFor(() => expect(api.get("browserCreate")).toHaveLength(1));
    expect(api.get("browserCreate")[0].args).toEqual({ projectPath: "/work/app", startUrl: undefined, surface: "workbench" });

    // Registering the session (agent-created or its own) turns the panel live.
    act(() => api.emit({ type: "state", session }));
    expect((await screen.findAllByText("Local app")).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.get("browserSetProbeActive")).toHaveLength(1));
    expect(api.get("browserSetProbeActive")[0].args).toMatchObject({
      browserId: "b1",
      tabId: "t1",
      active: true,
      strings: { dialogTitle: "desktop.browser.probeScript.dialogTitle", noTarget: "desktop.browser.probeScript.noTarget" }
    });
    await waitFor(() => expect(api.get("browserAttachBounds").length).toBeGreaterThan(0));
    expect(api.get("browserAttachBounds")[0].args).toMatchObject({ browserId: "b1" });

    // A pick reaches the tray, and its source button opens the file in the workbench.
    act(() =>
      api.emit({
        type: "probeInspect",
        browserId: "b1",
        tabId: "t1",
        target: {
          tagName: "div",
          selector: "div.card",
          textSnippet: "Total",
          rect: { top: 0, left: 0, width: 10, height: 10 },
          sourceFile: "src/Card.vue",
          sourceLine: 12
        }
      })
    );
    fireEvent.click(await screen.findByText("Open source in workbench"));
    await waitFor(() => expect(api.get("workbenchOpenPath")).toHaveLength(1));
    expect(api.get("workbenchOpenPath")[0].args).toEqual({ rootPath: "/work/app", filePath: "src/Card.vue" });

    // Sending runs the whole handler chain: prompt build -> WorkbenchPanel draft/fallback.
    // With no session in scope the panel drops the text and asks for a new session, so the
    // observable contract here is that the tray is cleared and nothing throws.
    fireEvent.click(screen.getByText("Send to session"));
    await waitFor(() => expect(screen.queryByText("Picked <div>")).toBeNull());

    // Console errors arrive collapsed; expanding shows the reported error with its fix button.
    act(() =>
      api.emit({
        type: "devtoolsLog",
        browserId: "b1",
        tabId: "t1",
        entry: { id: "cdp_1", timestamp: 0, level: "error", category: "runtime", text: "boom" }
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Console" }));
    expect(await screen.findByText("Send error to session")).toBeTruthy();
  });

  it("releases the probe when the panel view is replaced", async () => {
    const api = stubApi();
    await mountWorkbench();
    fireEvent.click(await screen.findByRole("button", { name: "Browser" }));
    act(() => api.emit({ type: "state", session }));
    await waitFor(() => expect(api.get("browserSetProbeActive")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Scripts" }));
    await waitFor(() =>
      expect(api.get("browserSetProbeActive").at(-1)?.args).toEqual({ browserId: "b1", tabId: "t1", active: false })
    );
  });
});
