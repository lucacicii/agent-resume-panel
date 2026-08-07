import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import {
  WorkbenchPanel,
  advanceDiffSearchMatchIndex,
  collectDiffSearchMatches,
  findDiffSearchMatchIndex,
  workbenchActiveFilePath
} from "./WorkbenchPanel";

const notificationMocks = vi.hoisted(() => ({ notifyDesktop: vi.fn() }));
type MockBuffer = {
  type: "normal" | "alternate";
  viewportY: number;
  baseY: number;
  cursorY: number;
  cursorX: number;
  length: number;
};
type MockTerminalInstance = {
  cols: number;
  rows: number;
  options: Record<string, unknown>;
  buffer: { active: MockBuffer; normal: MockBuffer; alternate: MockBuffer };
  focusCalls: number;
  scrollTopCalls: number;
  scrollBottomCalls: number;
  setBuffer: (type: "normal" | "alternate", viewportY: number, baseY: number) => void;
};
const xtermMocks = vi.hoisted(() => ({
  instances: [] as MockTerminalInstance[],
  resizeObservers: [] as Array<() => void>,
  fitDimensions: { cols: 80, rows: 24 }
}));

vi.mock("../../components/Notifications", () => notificationMocks);

vi.mock("../../components/CodeEditor", () => ({
  CodeEditor: forwardRef(({ value, onChange, onBlur, ariaLabel }: {
    value: string;
    onChange: (value: string) => void;
    onBlur?: () => void;
    ariaLabel: string;
  }, ref) => {
    const search = useRef({ query: "", current: 0, total: 0 });
    const setQuery = (query: string) => {
      const needle = query.trim().toLocaleLowerCase();
      const haystack = value.toLocaleLowerCase();
      let total = 0;
      let from = 0;
      while (needle) {
        const match = haystack.indexOf(needle, from);
        if (match < 0) break;
        total += 1;
        from = match + needle.length;
      }
      search.current = { query: needle, current: total ? 1 : 0, total };
      return { current: search.current.current, total };
    };
    useImperativeHandle(ref, () => ({
      focus: () => undefined,
      find: () => false,
      revealRange: () => false,
      setSearchQuery: setQuery,
      navigateSearch: (direction: "forward" | "backward") => {
        const current = search.current;
        if (current.total) current.current = direction === "forward"
          ? current.current % current.total + 1
          : (current.current - 2 + current.total) % current.total + 1;
        return { current: current.current, total: current.total };
      },
      clearSearch: () => { search.current = { query: "", current: 0, total: 0 }; },
      getSearchResult: () => ({ current: search.current.current, total: search.current.total }),
      getSelectedText: () => ""
    }));
    return <textarea value={value} placeholder={ariaLabel} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />;
  })
}));

vi.mock("@pierre/diffs", () => ({
  parseDiffFromFile: vi.fn(() => ({ hunks: [] }))
}));

vi.mock("@pierre/diffs/react", () => ({
  CodeView: forwardRef((_: { options?: Record<string, unknown> }, ref) => {
    useImperativeHandle(ref, () => ({ scrollTo: vi.fn() }));
    return <div data-testid="workbench-code-view" />;
  })
}));

vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80;
  rows = 24;
  options: Record<string, unknown>;
  unicode = { activeVersion: "6" };
  private normalBuffer: MockBuffer = { type: "normal", viewportY: 0, baseY: 0, cursorY: 0, cursorX: 0, length: 24 };
  private alternateBuffer: MockBuffer = { type: "alternate", viewportY: 0, baseY: 0, cursorY: 0, cursorX: 0, length: 24 };
  private resizeListeners = new Set<(event: { cols: number; rows: number }) => void>();
  private scrollListeners = new Set<(position: number) => void>();
  private writeListeners = new Set<() => void>();
  private bufferListeners = new Set<(buffer: MockBuffer) => void>();
  buffer = {
    active: this.normalBuffer,
    normal: this.normalBuffer,
    alternate: this.alternateBuffer,
    onBufferChange: (listener: (buffer: MockBuffer) => void) => {
      this.bufferListeners.add(listener);
      return { dispose: () => this.bufferListeners.delete(listener) };
    }
  };
  focusCalls = 0;
  scrollTopCalls = 0;
  scrollBottomCalls = 0;
  constructor(options: Record<string, unknown>) {
    this.options = options;
    xtermMocks.instances.push(this);
  }
  loadAddon(addon: { activate?: (terminal: unknown) => void }) { addon.activate?.(this); }
  open() {}
  focus() { this.focusCalls += 1; }
  write() { this.writeListeners.forEach((listener) => listener()); }
  getSelection() { return ""; }
  clearTextureAtlas() {}
  refresh() {}
  onData() { return { dispose() {} }; }
  onResize(listener: (event: { cols: number; rows: number }) => void) {
    this.resizeListeners.add(listener);
    return { dispose: () => this.resizeListeners.delete(listener) };
  }
  onScroll(listener: (position: number) => void) {
    this.scrollListeners.add(listener);
    return { dispose: () => this.scrollListeners.delete(listener) };
  }
  onWriteParsed(listener: () => void) {
    this.writeListeners.add(listener);
    return { dispose: () => this.writeListeners.delete(listener) };
  }
  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.resizeListeners.forEach((listener) => listener({ cols, rows }));
  }
  scrollToTop() {
    this.scrollTopCalls += 1;
    this.buffer.active.viewportY = 0;
    this.scrollListeners.forEach((listener) => listener(0));
  }
  scrollToBottom() {
    this.scrollBottomCalls += 1;
    this.buffer.active.viewportY = this.buffer.active.baseY;
    this.scrollListeners.forEach((listener) => listener(this.buffer.active.baseY));
  }
  setBuffer(type: "normal" | "alternate", viewportY: number, baseY: number) {
    const target = type === "normal" ? this.normalBuffer : this.alternateBuffer;
    target.viewportY = viewportY;
    target.baseY = baseY;
    this.buffer.active = target;
    this.bufferListeners.forEach((listener) => listener(target));
    this.scrollListeners.forEach((listener) => listener(viewportY));
  }
  dispose() {}
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class {
  private terminal: { cols: number; rows: number; resize: (cols: number, rows: number) => void } | null = null;
  activate(terminal: { cols: number; rows: number; resize: (cols: number, rows: number) => void }) { this.terminal = terminal; }
  fit() {
    const dimensions = this.proposeDimensions();
    if (this.terminal && (this.terminal.cols !== dimensions.cols || this.terminal.rows !== dimensions.rows)) {
      this.terminal.resize(dimensions.cols, dimensions.rows);
    }
  }
  proposeDimensions() { return { ...xtermMocks.fitDimensions }; }
} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class {
  onContextLoss() { return { dispose() {} }; }
  dispose() {}
} }));
vi.mock("@xterm/addon-canvas", () => ({ CanvasAddon: class {
  dispose() {}
} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {
  dispose() {}
} }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {
  dispose() {}
} }));
vi.mock("@xterm/addon-clipboard", () => ({
  Base64: class {},
  ClipboardAddon: class {
    dispose() {}
  }
}));
vi.mock("@xterm/addon-image", () => ({ ImageAddon: class {
  dispose() {}
} }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {
  findNext() { return false; }
  findPrevious() { return false; }
  clearDecorations() {}
  onDidChangeResults() { return { dispose() {} }; }
  dispose() {}
} }));
vi.stubGlobal("ResizeObserver", class {
  constructor(callback: ResizeObserverCallback) {
    xtermMocks.resizeObservers.push(() => callback([], this as unknown as ResizeObserver));
  }
  observe() {}
  disconnect() {}
});

afterEach(() => {
  cleanup();
  notificationMocks.notifyDesktop.mockClear();
  xtermMocks.instances.length = 0;
  xtermMocks.resizeObservers.length = 0;
  xtermMocks.fitDimensions = { cols: 80, rows: 24 };
  document.getElementById("react-workbench")?.remove();
  localStorage.removeItem("workbench-sidebar-view");
  localStorage.removeItem("workbench-selected-project");
  localStorage.removeItem("workbench-quick-access-project");
});

const ARROW_TEST_MESSAGES: Record<string, string> = {
  "desktop.notes.filterProjects": "Filter projects",
  "desktop.notes.projectFilter": "Project filter",
  "desktop.common.search": "Search",
  "desktop.common.all": "All",
  "desktop.common.active": "Active",
  "desktop.common.pinned": "Pinned",
  "desktop.common.refresh": "Refresh",
  "desktop.common.loading": "Loading…",
  "desktop.workbench.sidebarView": "Workbench sidebar view",
  "desktop.workbench.projectsView": "Project view",
  "desktop.workbench.gtdView": "GTD view",
  "desktop.workbench.filterGtdSessions": "Filter GTD sessions",
  "desktop.workbench.filterProjects": "Filter projects",
  "desktop.workbench.allSessions": "All sessions",
  "desktop.workbench.noSessionsInProject": "No sessions",
  "desktop.workbench.noProjects": "No projects",
  "desktop.workbench.sidePanelExplorer": "Explorer",
  "desktop.workbench.sidePanelGit": "Git",
  "desktop.workbench.sidePanelNoChanges": "No changes",
  "desktop.workbench.sidePanelStaged": "Staged",
  "desktop.workbench.sidePanelChanges": "Changes",
  "desktop.workbench.sidePanelGitUnavailable": "Git unavailable",
  "desktop.workbench.sidePanelNoRoot": "No root",
  "desktop.workbench.newTerminal": "New terminal",
  "desktop.workbench.newSession": "New session",
  "desktop.workbench.selectSessionHint": "Select a session",
  "desktop.workbench.selectProjectHint": "Select a project",
  "desktop.workbench.externalTerminalHint": "Opened externally",
  "desktop.workbench.terminalLabel": "Terminal {0}",
  "desktop.workbench.closeTerminal": "Close terminal",
  "desktop.workbench.terminalTabs": "Terminal tabs"
};

const FOLDER_DRAG_TEST_MESSAGES: Record<string, string> = {
  "desktop.notes.filterProjects": "Filter projects",
  "desktop.notes.projectFilter": "Project filter",
  "desktop.common.search": "Search",
  "desktop.common.all": "All",
  "desktop.common.active": "Active",
  "desktop.common.pinned": "Pinned",
  "desktop.common.close": "Close",
  "desktop.common.cancel": "Cancel",
  "desktop.common.confirm": "Confirm",
  "desktop.common.rename": "Rename",
  "desktop.common.refresh": "Refresh",
  "desktop.workbench.allSessions": "All sessions",
  "desktop.workbench.unclassifiedSessions": "Unclassified",
  "desktop.workbench.noSessionsInProject": "No sessions",
  "desktop.workbench.noProjects": "No projects",
  "desktop.workbench.sidePanelExplorer": "Explorer",
  "desktop.workbench.sidePanelGit": "Git",
  "desktop.workbench.newTerminal": "New terminal",
  "desktop.workbench.newSession": "New session",
  "desktop.workbench.selectSessionHint": "Select a session",
  "desktop.workbench.selectProjectHint": "Select a project",
  "desktop.workbench.externalTerminalHint": "Opened externally",
  "desktop.workbench.terminalLabel": "Terminal {0}",
  "desktop.workbench.moveToFolder": "Move to folder…",
  "desktop.workbench.removeFromFolder": "Move to Unclassified",
  "desktop.workbench.moveSessionTitle": "Move session {0}",
  "desktop.workbench.moveSessionHint": "Choose a folder",
  "desktop.workbench.folderProjectUnavailable": "Project unavailable",
  "desktop.workbench.newFolder": "New folder",
  "desktop.workbench.newSubfolder": "New subfolder",
  "desktop.workbench.renameFolder": "Rename folder",
  "desktop.workbench.deleteFolder": "Delete folder",
  "desktop.workbench.folderName": "Folder name",
  "desktop.workbench.folderNameEmpty": "Folder name cannot be empty",
  "desktop.workbench.deleteFolderConfirm": "Delete folder {0}?"
};

describe("WorkbenchPanel", () => {
  it("collects case-insensitive matches across both Git diff sides", () => {
    expect(collectDiffSearchMatches("const Value = 1;\nvalue++;", "const Value = 2;\nreturn value;", " VALUE ")).toEqual([
      { side: "old", from: 6, to: 11 },
      { side: "old", from: 17, to: 22 },
      { side: "new", from: 6, to: 11 },
      { side: "new", from: 24, to: 29 }
    ]);
    expect(collectDiffSearchMatches("old", "new", "missing")).toEqual([]);
  });

  it("keeps the selected Git diff match as the current search position", () => {
    const matches = collectDiffSearchMatches("value value", "value", "value");
    expect(findDiffSearchMatchIndex(matches, "old", 6, 11)).toBe(1);
    expect(findDiffSearchMatchIndex(matches, "new", 0, 5)).toBe(2);
    expect(findDiffSearchMatchIndex(matches, "old", 0, 4)).toBe(-1);
  });

  it("cycles Git diff search forward and backward across the boundaries", () => {
    expect(advanceDiffSearchMatchIndex(-1, 3, "forward")).toBe(0);
    expect(advanceDiffSearchMatchIndex(2, 3, "forward")).toBe(0);
    expect(advanceDiffSearchMatchIndex(3, 3, "backward")).toBe(2);
    expect(advanceDiffSearchMatchIndex(0, 3, "backward")).toBe(2);
    expect(advanceDiffSearchMatchIndex(0, 0, "forward")).toBe(-1);
  });

  it("uses the active Git diff file path for Explorer selection", () => {
    expect(workbenchActiveFilePath("/work/app", undefined, {
      path: "packages/desktop/src/one.ts",
      repoRoot: "/work/app/",
      repoPath: "/src/one.ts"
    })).toBe("/work/app/src/one.ts");
    expect(workbenchActiveFilePath("/work/app/apps/desktop", undefined, {
      path: "apps/desktop/src/one.ts",
      repoRoot: "/work/app",
      repoPath: "apps/desktop/src/one.ts"
    })).toBe("/work/app/apps/desktop/src/one.ts");
    expect(workbenchActiveFilePath("/work/app", "/work/app/src/editor.ts", {
      path: "src/diff.ts",
      repoRoot: "/work/app",
      repoPath: "src/diff.ts"
    })).toBe("/work/app/src/editor.ts");
  });

  it("synchronizes the active Git diff with both file trees", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const first = {
      path: "src/one.ts",
      repoPath: "src/one.ts",
      repoRoot: "/work/app",
      status: "M",
      staged: false,
      unstaged: true
    };
    const second = {
      path: "src/two.ts",
      repoPath: "src/two.ts",
      repoRoot: "/work/app",
      status: "M",
      staged: false,
      unstaged: true
    };
    const terminalGitDiffSides = vi.fn(async ({ path }: { cwd: string; path: string; staged: boolean }) => ({
      oldLabel: "HEAD",
      newLabel: "Working Tree",
      oldText: `old ${path}`,
      newText: `new ${path}`,
      hunks: []
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects",
        "desktop.notes.projectFilter": "Project filter",
        "desktop.common.search": "Search",
        "desktop.common.all": "All",
        "desktop.common.active": "Active",
        "desktop.common.pinned": "Pinned",
        "desktop.common.refresh": "Refresh",
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.noSessionsInProject": "No sessions",
        "desktop.workbench.noProjects": "No projects",
        "desktop.workbench.sidePanelExplorer": "Explorer",
        "desktop.workbench.sidePanelGit": "Git",
        "desktop.workbench.sidePanelNoChanges": "No changes",
        "desktop.workbench.sidePanelStaged": "Staged",
        "desktop.workbench.sidePanelChanges": "Changes",
        "desktop.workbench.sidePanelGitUnavailable": "Git unavailable",
        "desktop.workbench.sidePanelNoRoot": "No root",
        "desktop.workbench.newTerminal": "New terminal",
        "desktop.workbench.newSession": "New session",
        "desktop.workbench.selectSessionHint": "Select a session",
        "desktop.workbench.selectProjectHint": "Select a project",
        "desktop.workbench.externalTerminalHint": "Opened externally",
        "desktop.workbench.terminalLabel": "Terminal {0}",
        "desktop.workbench.gitDiscard": "Discard changes"
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
      terminalGitStatus: async () => ({
        isRepo: true,
        root: "/work/app",
        staged: [],
        unstaged: [first, second],
        nestedRepos: [],
        tracking: []
      }),
      terminalGitFetch: async () => ({ ok: true }),
      terminalGitDiffSides,
      workbenchListDirectory: async ({ dirPath }: { dirPath: string }) => ({
        entries: dirPath === "/work/app"
          ? [{ name: "src", path: "/work/app/src", isDirectory: true }]
          : dirPath === "/work/app/src"
            ? [
                { name: "one.ts", path: "/work/app/src/one.ts", isDirectory: false },
                { name: "two.ts", path: "/work/app/src/two.ts", isDirectory: false }
              ]
            : []
      })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByTitle("/work/app"));
    fireEvent.click(screen.getAllByRole("button", { name: "Git" })[0]!);

    const firstGitFile = await screen.findByTitle("src/one.ts");
    fireEvent.click(firstGitFile);
    await waitFor(() => expect(terminalGitDiffSides).toHaveBeenCalledWith({ cwd: "/work/app", path: "src/one.ts", staged: false }));
    await waitFor(() => expect(document.querySelector(".wb-diff-title")?.textContent).toBe("src/one.ts"));

    fireEvent.click(await screen.findByTitle("src/two.ts"));
    await waitFor(() => expect(terminalGitDiffSides).toHaveBeenCalledWith({ cwd: "/work/app", path: "src/two.ts", staged: false }));
    await waitFor(() => expect(document.querySelector(".wb-diff-title")?.textContent).toBe("src/two.ts"));
    expect(screen.getByTitle("src/one.ts").closest(".wb-git-tree-file")?.classList.contains("is-selected")).toBe(false);
    expect(screen.getByTitle("src/two.ts").closest(".wb-git-tree-file")?.classList.contains("is-selected")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Explorer" }));
    const explorerTree = await waitFor(() => {
      const tree = document.querySelector<HTMLElement>(".wb-explorer-file-tree");
      if (!tree) throw new Error("Explorer tree not mounted");
      return tree;
    });
    const selectedExplorerFile = await within(explorerTree).findByText("two.ts");
    await waitFor(() => expect(selectedExplorerFile.closest("[role=treeitem]")?.getAttribute("aria-selected")).toBe("true"));
  });

  it("loads project sessions and restores the selected session through the desktop bridge", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchOpenSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/app", external: true }));
    const listSessions = vi.fn(async () => [
      { provider: "codex" as const, id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 },
      { provider: "claude" as const, id: "session-2", title: "Write tests", projectPath: "/work/docs", updatedAt: 2 }
    ]);
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
      listSessions,
      workbenchOpenSession
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const fixRenderer = await screen.findByRole("button", { name: /Fix renderer/ });
    expect(listSessions).toHaveBeenCalledWith();
    const providerTag = fixRenderer.querySelector(".wb-list-item-preview .s-provider-tag");
    expect(providerTag?.classList.contains("s-provider-tag")).toBe(true);
    expect(providerTag?.getAttribute("data-provider")).toBe("codex");
    expect(providerTag?.textContent).toBe("codex");
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[title="/work/app"]')!);
    expect(screen.queryByRole("button", { name: /Write tests/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(workbenchOpenSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1" }));
  });

  it("renders nested Workbench folders and filters sessions by the selected folder", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const listWorkbenchSessionFolders = vi.fn(async () => ({
      folders: [
        { folderId: "campaign", projectId: "project-1", parentId: null, name: "Campaign", createdAtMs: 1, updatedAtMs: 1 },
        { folderId: "phase-1", projectId: "project-1", parentId: "campaign", name: "Phase 1", createdAtMs: 2, updatedAtMs: 2 }
      ],
      assignments: [
        { projectId: "project-1", provider: "codex", agentSessionId: "session-1", folderId: "campaign", updatedAtMs: 1 }
      ]
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.cancel": "Cancel", "desktop.common.confirm": "Confirm", "desktop.common.rename": "Rename", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.unclassifiedSessions": "Unclassified", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.moveToFolder": "Move to folder…", "desktop.workbench.removeFromFolder": "Move to Unclassified", "desktop.workbench.moveSessionTitle": "Move session {0}", "desktop.workbench.moveSessionHint": "Choose a folder", "desktop.workbench.folderProjectUnavailable": "Project unavailable", "desktop.workbench.newFolder": "New folder", "desktop.workbench.newSubfolder": "New subfolder", "desktop.workbench.renameFolder": "Rename folder", "desktop.workbench.deleteFolder": "Delete folder", "desktop.workbench.folderName": "Folder name", "desktop.workbench.folderNameEmpty": "Folder name cannot be empty", "desktop.workbench.deleteFolderConfirm": "Delete folder {0}?"
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
        { provider: "codex" as const, id: "session-1", title: "Campaign work", projectPath: "/work/app", projectId: "project-1", updatedAt: 1 },
        { provider: "codex" as const, id: "session-2", title: "Unsorted work", projectPath: "/work/app", projectId: "project-1", updatedAt: 2 }
      ],
      listProjects: async () => [{ projectId: "project-1", portableKey: "/work/app", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/app", pathMissing: false, sessionCount: 2 }],
      listWorkbenchSessionFolders,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await screen.findByTitle("Campaign");
    expect(screen.queryByText("Phase 1")).toBeNull();
    const campaignButton = screen.getByTitle("Campaign");
    fireEvent.click(campaignButton);
    await waitFor(() => expect(screen.getByRole("button", { name: /Campaign work/ })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Unsorted work/ })).toBeNull();
    fireEvent.click(campaignButton.querySelector(".wb-session-folder-chevron")!);
    expect(screen.getByText("Phase 1")).toBeTruthy();
    expect(listWorkbenchSessionFolders).toHaveBeenCalledWith({ projectId: "project-1" });
  });

  it("drags a session onto a same-project folder and persists the assignment", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const assignWorkbenchSessionToFolder = vi.fn(async () => ({
      projectId: "project-1",
      provider: "codex",
      agentSessionId: "session-2",
      folderId: "campaign",
      updatedAtMs: 1
    }));
    const listWorkbenchSessionFolders = vi.fn(async () => ({
      folders: [
        { folderId: "campaign", projectId: "project-1", parentId: null, name: "Campaign", createdAtMs: 1, updatedAtMs: 1 }
      ],
      assignments: []
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: FOLDER_DRAG_TEST_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex" as const, id: "session-1", title: "Campaign work", projectPath: "/work/app", projectId: "project-1", updatedAt: 1 },
        { provider: "codex" as const, id: "session-2", title: "Unsorted work", projectPath: "/work/app", projectId: "project-1", updatedAt: 2 }
      ],
      listProjects: async () => [{ projectId: "project-1", portableKey: "/work/app", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/app", pathMissing: false, sessionCount: 2 }],
      listWorkbenchSessionFolders,
      assignWorkbenchSessionToFolder,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const session = await screen.findByRole("button", { name: /Unsorted work/ });
    expect(session.hasAttribute("draggable")).toBe(true);
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(session, { dataTransfer });
    fireEvent.drop(screen.getByTitle("Campaign"), { dataTransfer });
    await waitFor(() => expect(assignWorkbenchSessionToFolder).toHaveBeenCalledWith({
      projectId: "project-1",
      provider: "codex",
      agentSessionId: "session-2",
      folderId: "campaign"
    }));
  });

  it("removes a folder assignment when a session is dropped on Unclassified", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const removeWorkbenchSessionFromFolder = vi.fn(async () => ({ ok: true }));
    const listWorkbenchSessionFolders = vi.fn(async () => ({
      folders: [
        { folderId: "campaign", projectId: "project-1", parentId: null, name: "Campaign", createdAtMs: 1, updatedAtMs: 1 }
      ],
      assignments: [
        { projectId: "project-1", provider: "codex", agentSessionId: "session-1", folderId: "campaign", updatedAtMs: 1 }
      ]
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: FOLDER_DRAG_TEST_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex" as const, id: "session-1", title: "Campaign work", projectPath: "/work/app", projectId: "project-1", updatedAt: 1 },
        { provider: "codex" as const, id: "session-2", title: "Unsorted work", projectPath: "/work/app", projectId: "project-1", updatedAt: 2 }
      ],
      listProjects: async () => [{ projectId: "project-1", portableKey: "/work/app", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/app", pathMissing: false, sessionCount: 2 }],
      listWorkbenchSessionFolders,
      removeWorkbenchSessionFromFolder,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const session = await screen.findByRole("button", { name: /Campaign work/ });
    const unclassified = await waitFor(() => {
      const row = document.querySelector<HTMLElement>(".wb-session-folder-root");
      if (!row) throw new Error("unclassified row not rendered");
      return row;
    });
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(session, { dataTransfer });
    fireEvent.drop(unclassified, { dataTransfer });
    await waitFor(() => expect(removeWorkbenchSessionFromFolder).toHaveBeenCalledWith({
      provider: "codex",
      agentSessionId: "session-1"
    }));
  });

  it("does not assign a session dropped into another project's folder", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const assignWorkbenchSessionToFolder = vi.fn(async () => ({ ok: true }));
    const listWorkbenchSessionFolders = vi.fn(async ({ projectId }: { projectId: string }) => {
      if (projectId === "project-1") {
        return {
          folders: [{ folderId: "campaign", projectId: "project-1", parentId: null, name: "Campaign", createdAtMs: 1, updatedAtMs: 1 }],
          assignments: []
        };
      }
      return {
        folders: [{ folderId: "docs", projectId: "project-2", parentId: null, name: "Docs", createdAtMs: 1, updatedAtMs: 1 }],
        assignments: []
      };
    });
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: FOLDER_DRAG_TEST_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex" as const, id: "session-1", title: "App work", projectPath: "/work/app", projectId: "project-1", updatedAt: 2 },
        { provider: "codex" as const, id: "session-2", title: "Docs work", projectPath: "/work/docs", projectId: "project-2", updatedAt: 1 }
      ],
      listProjects: async () => [
        { projectId: "project-1", portableKey: "/work/app", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/app", pathMissing: false, sessionCount: 1 },
        { projectId: "project-2", portableKey: "/work/docs", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/docs", pathMissing: false, sessionCount: 1 }
      ],
      listWorkbenchSessionFolders,
      assignWorkbenchSessionToFolder,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const session = await screen.findByRole("button", { name: /App work/ });
    const docsFolder = await screen.findByTitle("Docs");
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(session, { dataTransfer });
    fireEvent.drop(docsFolder, { dataTransfer });
    expect(assignWorkbenchSessionToFolder).not.toHaveBeenCalled();
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
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith({ cwd: "/work/app", provider: "codex", executionMode: "standard" }));

    fireEvent.contextMenu(screen.getByRole("button", { name: /Fix renderer/ }));
    await screen.findByRole("menuitem", { name: "Preview" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview" }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    window.removeEventListener("agent-resume:sessions-preview", onPreview);
  });

  it("auto renames a session from its context menu", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const autoRenameSession = vi.fn(async () => ({
      title: "Auto renamed session",
      previousTitle: "Fix renderer",
      session: { provider: "codex", id: "session-1", title: "Auto renamed session", projectPath: "/work/app", updatedAt: 1 },
      nativeRenamed: true,
      nativeError: null
    }));
    const listSessions = vi.fn(async () => [
      { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }
    ]);
    const onMutated = vi.fn();
    window.addEventListener("agent-resume:sessions-mutated", onMutated);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.sidebarView": "Workbench sidebar view", "desktop.workbench.projectsView": "Project view", "desktop.workbench.gtdView": "GTD view", "desktop.workbench.filterGtdSessions": "Filter GTD sessions", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.openInChatGpt": "Open in ChatGPT", "desktop.workbench.preview": "Preview", "desktop.workbench.autoRename": "Auto rename", "desktop.workbench.autoRenaming": "Auto renaming…", "desktop.sessions.renamed": "Renamed to {0}"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions,
      autoRenameSession,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const session = await screen.findByRole("button", { name: /Fix renderer/ });
    fireEvent.contextMenu(session);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Auto rename" }));
    await waitFor(() => expect(autoRenameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1", persist: true }));
    await waitFor(() => expect(listSessions.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(onMutated).toHaveBeenCalled());
    window.removeEventListener("agent-resume:sessions-mutated", onMutated);
  });

  it("auto renames an inactive session after two minutes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const autoRenameSession = vi.fn(async () => ({
      title: "Auto renamed session",
      previousTitle: "Fix renderer",
      session: { provider: "codex", id: "session-1", title: "Auto renamed session", projectPath: "/work/app", updatedAt: 1 },
      nativeRenamed: true,
      nativeError: undefined
    }));
    const listSessions = vi.fn(async () => [
      { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }
    ]);
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
    const terminalDestroy = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.loading": "Loading…", "desktop.workbench.sidebarView": "Workbench sidebar view", "desktop.workbench.projectsView": "Project view", "desktop.workbench.gtdView": "GTD view", "desktop.workbench.filterGtdSessions": "Filter GTD sessions", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.autoRename": "Auto rename", "desktop.workbench.autoRenaming": "Auto renaming…", "desktop.sessions.renamed": "Renamed to {0}"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions,
      autoRenameSession,
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn,
      terminalDestroy,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    try {
      render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
      fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
      await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));

      await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
      expect(autoRenameSession).not.toHaveBeenCalled();

      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
      await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
      await waitFor(() => expect(autoRenameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1", persist: true }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels delayed auto rename when the session is reactivated", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const autoRenameSession = vi.fn(async () => ({
      title: "Auto renamed session",
      previousTitle: "Fix renderer",
      session: { provider: "codex", id: "session-1", title: "Auto renamed session", projectPath: "/work/app", updatedAt: 1 },
      nativeRenamed: true,
      nativeError: undefined
    }));
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
    const terminalDestroy = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.loading": "Loading…", "desktop.workbench.sidebarView": "Workbench sidebar view", "desktop.workbench.projectsView": "Project view", "desktop.workbench.gtdView": "GTD view", "desktop.workbench.filterGtdSessions": "Filter GTD sessions", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.autoRename": "Auto rename", "desktop.workbench.autoRenaming": "Auto renaming…", "desktop.sessions.renamed": "Renamed to {0}"
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
      autoRenameSession,
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn,
      terminalDestroy,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    try {
      render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
      fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
      await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));

      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
      fireEvent.click(document.querySelector<HTMLButtonElement>(".wb-terminal-tab-label")!);

      await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
      expect(autoRenameSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto renames a closed session after two minutes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const autoRenameSession = vi.fn(async () => ({
      title: "Auto renamed session",
      previousTitle: "Fix renderer",
      session: { provider: "codex", id: "session-1", title: "Auto renamed session", projectPath: "/work/app", updatedAt: 1 },
      nativeRenamed: true,
      nativeError: undefined
    }));
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
    const terminalDestroy = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.loading": "Loading…", "desktop.workbench.sidebarView": "Workbench sidebar view", "desktop.workbench.projectsView": "Project view", "desktop.workbench.gtdView": "GTD view", "desktop.workbench.filterGtdSessions": "Filter GTD sessions", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.autoRename": "Auto rename", "desktop.workbench.autoRenaming": "Auto renaming…", "desktop.sessions.renamed": "Renamed to {0}"
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
      autoRenameSession,
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn,
      terminalDestroy,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    try {
      render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
      fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
      await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));

      const closeButton = host.querySelector<HTMLButtonElement>(".wb-terminal-tab-close");
      expect(closeButton).toBeTruthy();
      fireEvent.click(closeButton!);
      await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
      await waitFor(() => expect(autoRenameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1", persist: true }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("mount note opens the first project root note without creating when roots exist", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const notesCreate = vi.fn(async () => ({ noteId: "new-note", filename: "new.md" }));
    const notesListRoot = vi.fn(async () => [
      {
        noteId: "root-old",
        scope: "project",
        projectPath: "/work/app",
        filename: "old.md",
        relDir: "projects/app",
        relMdPath: "notes/projects/app/old.md",
        title: "Older root",
        createdAtMs: 1,
        updatedAtMs: 10
      },
      {
        noteId: "root-new",
        scope: "project",
        projectPath: "/work/app",
        filename: "new.md",
        relDir: "projects/app",
        relMdPath: "notes/projects/app/new.md",
        title: "Newer root",
        createdAtMs: 2,
        updatedAtMs: 99
      },
      {
        noteId: "other-project",
        scope: "project",
        projectPath: "/work/other",
        filename: "other.md",
        relDir: "projects/other",
        relMdPath: "notes/projects/other/other.md",
        title: "Other",
        createdAtMs: 3,
        updatedAtMs: 1000
      }
    ]);
    const openNote = vi.fn();
    const tabRequest = vi.fn();
    window.addEventListener("agent-resume:open-note", openNote);
    window.addEventListener("agent-resume:tab-request", tabRequest);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.cancel": "Cancel", "desktop.common.confirm": "Confirm", "desktop.common.rename": "Rename", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New Session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.mountNote": "Mount note"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex", projectContextMenu: ["note"] } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchGetProjectEditor: async () => ({ selected: "vscode", available: true, editor: { id: "vscode", label: "VS Code" } }),
      notesListRoot,
      notesCreate
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const project = await screen.findByTitle("/work/app");
    fireEvent.contextMenu(project);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Mount note" }));
    await waitFor(() => expect(notesListRoot).toHaveBeenCalled());
    expect(notesCreate).not.toHaveBeenCalled();
    expect(openNote).toHaveBeenCalled();
    expect((openNote.mock.calls.at(-1)?.[0] as CustomEvent<string>).detail).toBe("root-new");
    expect(tabRequest).toHaveBeenCalled();
    window.removeEventListener("agent-resume:open-note", openNote);
    window.removeEventListener("agent-resume:tab-request", tabRequest);
  });

  it("mount note creates a note when the project has no root notes", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const notesCreate = vi.fn(async () => ({ noteId: "created-note", filename: "created.md" }));
    const notesListRoot = vi.fn(async () => []);
    const openNote = vi.fn();
    window.addEventListener("agent-resume:open-note", openNote);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.cancel": "Cancel", "desktop.common.confirm": "Confirm", "desktop.common.rename": "Rename", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New Session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.mountNote": "Mount note"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex", projectContextMenu: ["note"] } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchGetProjectEditor: async () => ({ selected: "vscode", available: true, editor: { id: "vscode", label: "VS Code" } }),
      notesListRoot,
      notesCreate
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const project = await screen.findByTitle("/work/app");
    fireEvent.contextMenu(project);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Mount note" }));
    await waitFor(() => expect(notesCreate).toHaveBeenCalledWith({ scope: "project", projectPath: "/work/app" }));
    expect((openNote.mock.calls.at(-1)?.[0] as CustomEvent<string>).detail).toBe("created-note");
    window.removeEventListener("agent-resume:open-note", openNote);
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

  it("shows terminal history jump controls only for normal-buffer scrollback", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.terminalScrollTop": "Scroll to terminal top", "desktop.workbench.terminalScrollBottom": "Scroll to terminal bottom"
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
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    const terminal = xtermMocks.instances[0];
    expect(terminal.options.allowTransparency).toBe(true);
    expect((terminal.options.theme as { background?: string }).background).toBe("rgba(0, 0, 0, 0)");

    act(() => terminal.setBuffer("normal", 5, 10));
    fireEvent.click(await screen.findByRole("button", { name: "Scroll to terminal top" }));
    expect(terminal.scrollTopCalls).toBe(1);
    expect(terminal.focusCalls).toBe(1);
    expect(screen.queryByRole("button", { name: "Scroll to terminal top" })).toBeNull();
    expect(screen.getByRole("button", { name: "Scroll to terminal bottom" })).toBeTruthy();

    act(() => terminal.setBuffer("alternate", 0, 0));
    expect(screen.queryByRole("button", { name: "Scroll to terminal top" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scroll to terminal bottom" })).toBeNull();
  });

  it("coalesces terminal fitting, deduplicates PTY resize, and preserves bottom intent", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalResize = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal"
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
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    await waitFor(() => expect(terminalResize).toHaveBeenCalledWith({ id: 1, cols: 80, rows: 24 }));
    terminalResize.mockClear();
    const terminal = xtermMocks.instances[0];
    const terminalHost = document.querySelector<HTMLElement>(".wb-terminal-host")!;
    Object.defineProperties(terminalHost, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 500 }
    });

    act(() => terminal.setBuffer("normal", 12, 12));
    xtermMocks.fitDimensions = { cols: 100, rows: 30 };
    act(() => {
      xtermMocks.resizeObservers.forEach((notify) => notify());
      window.dispatchEvent(new Event("resize"));
    });
    await waitFor(() => expect(terminalResize).toHaveBeenCalledWith({ id: 1, cols: 100, rows: 30 }));
    expect(terminalResize).toHaveBeenCalledTimes(1);
    expect(terminal.scrollBottomCalls).toBe(1);

    act(() => terminal.setBuffer("normal", 5, 12));
    xtermMocks.fitDimensions = { cols: 110, rows: 32 };
    act(() => xtermMocks.resizeObservers.forEach((notify) => notify()));
    await waitFor(() => expect(terminalResize).toHaveBeenCalledWith({ id: 1, cols: 110, rows: 32 }));
    expect(terminal.scrollBottomCalls).toBe(1);
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

  it("refreshes an open CLI session tab label when the session title changes", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let title = "Fix renderer";
    const listSessions = vi.fn(async () => [{
      provider: "codex" as const,
      id: "session-1",
      title,
      projectPath: "/work/app",
      updatedAt: 1
    }]);
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
      onSessionsSynced: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions,
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab-label")?.textContent).toBe("Fix renderer"));

    title = "Renamed renderer";
    act(() => window.dispatchEvent(new CustomEvent("agent-resume:sessions-mutated", { detail: { kind: "session-title" } })));

    await waitFor(() => expect(document.querySelector(".wb-terminal-tab-label")?.textContent).toBe("Renamed renderer"));
    expect(document.querySelectorAll(".wb-terminal-tab")).toHaveLength(1);
  });

  it("refreshes an open ACP session tab label from the latest session title", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let title = "ACP chat";
    const listSessions = vi.fn(async () => [{
      provider: "chat" as const,
      id: "chat-1",
      title,
      projectPath: "/work/app",
      updatedAt: 1
    }]);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeAcpChat": "Close chat"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      onSessionsSynced: () => () => undefined,
      onAcpStream: () => () => undefined,
      acpConnect: async () => ({ record: { acpSessionId: "native-1" } }),
      acpDisconnect: async () => ({ ok: true }),
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions,
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /ACP chat/ }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab-label")?.textContent).toBe("ACP chat"));

    title = "Renamed ACP chat";
    act(() => window.dispatchEvent(new CustomEvent("agent-resume:sessions-mutated", { detail: { kind: "session-title" } })));

    await waitFor(() => expect(document.querySelector(".wb-terminal-tab-label")?.textContent).toBe("Renamed ACP chat"));
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
    const newSessionButton = screen.getByRole("button", { name: "New session" }) as HTMLButtonElement;
    const newTerminalButton = screen.getByRole("button", { name: "New terminal" }) as HTMLButtonElement;
    expect(document.querySelector('[data-pane-group="session"] > .wb-pane-tab-group-label')).toBe(newSessionButton);
    expect(document.querySelector('[data-pane-group="terminal"] > .wb-pane-tab-group-label')).toBe(newTerminalButton);
    expect(document.querySelector(".wb-terminal-tabs-actions")).toBeNull();

    fireEvent.click(newTerminalButton);
    await waitFor(() => expect(document.querySelector(".wb-terminal-loading")).toBeTruthy());
    expect(screen.getByRole("status").textContent).toContain("Loading");
    await act(async () => resolveSpawn({ id: 11 }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-loading")).toBeNull());
    expect(terminalSpawn).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[data-pane-group="terminal"] .wb-terminal-tab')).toHaveLength(1);
    expect(document.querySelectorAll('[data-pane-group="session"] .wb-terminal-tab')).toHaveLength(0);
    expect(document.querySelector('[data-pane-group="code"]')).toBeNull();

    fireEvent.click(newSessionButton);
    await waitFor(() => expect(newSessionButton.disabled).toBe(true));
    expect(newTerminalButton.disabled).toBe(true);
    expect(newSessionButton.querySelector(".spin")).not.toBeNull();
    await waitFor(() => expect(document.querySelector(".wb-terminal-loading")).toBeTruthy());
    await act(async () => resolveNewSession({ mode: "xterm", command: "codex", cwd: "/work/app" }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(newSessionButton.disabled).toBe(false));
    expect(newTerminalButton.disabled).toBe(false);
    expect(document.querySelector(".wb-terminal-loading")).toBeTruthy();
    await act(async () => resolveSpawn({ id: 12 }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-loading")).toBeNull());
    expect(document.querySelectorAll('[data-pane-group="terminal"] .wb-terminal-tab')).toHaveLength(1);
    expect(document.querySelectorAll('[data-pane-group="session"] .wb-terminal-tab')).toHaveLength(1);
  });

  it("asks for a CLI or ACP target when the default new-session target is empty", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchNewSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/app" }));
    const acpCreateSession = vi.fn(async ({ projectPath, provider }: { projectPath: string; provider: string }) => ({
      id: "acp-new",
      title: "ACP session",
      projectPath,
      provider,
      createdAt: 1,
      updatedAt: 1,
      messageCount: 0
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.terminalTabs": "Terminal tabs",
        "desktop.settings.defaultAgent": "Default agent", "desktop.settings.newSessionGroupCli": "CLI (terminal)", "desktop.settings.newSessionGroupAcp": "ACP (visual chat)", "desktop.settings.newSessionTarget.cli_codex": "Codex", "desktop.settings.newSessionTarget.cli_claude": "Claude", "desktop.settings.newSessionTarget.cli_grok": "Grok", "desktop.settings.newSessionTarget.cli_agy": "Antigravity", "desktop.settings.newSessionTarget.cli_opencode": "OpenCode", "desktop.settings.newSessionTarget.cli_pi": "Pi", "desktop.settings.newSessionTarget.cli_cursor": "Cursor CLI", "desktop.settings.newSessionTarget.cli_prime": "Prime Agent", "desktop.settings.newSessionTarget.acp_claude": "ACP · Claude Code", "desktop.settings.newSessionTarget.acp_codex": "ACP · Codex", "desktop.settings.newSessionTarget.acp_grok": "ACP · Grok Build", "desktop.settings.newSessionTarget.acp_opencode": "ACP · OpenCode", "desktop.settings.newSessionTarget.acp_pi": "ACP · Pi", "desktop.settings.newSessionTarget.acp_prime": "ACP · Prime Agent"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex", defaultNewSessionTarget: "" } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchNewSession,
      acpCreateSession,
      onAcpStream: () => () => undefined,
      acpConnect: async () => ({ record: { id: "acp-new", title: "ACP session", projectPath: "/work/app", provider: "codex", createdAt: 1, updatedAt: 1, messageCount: 0 }, init: {} }),
      acpDisconnect: async () => ({ ok: true }),
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByTitle("/work/app"));
    const newSessionButton = screen.getByRole("button", { name: "New session" });

    fireEvent.click(newSessionButton);
    const menu = await screen.findByRole("menu", { name: "Default agent" });
    expect(newSessionButton.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Claude" }));
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith({ cwd: "/work/app", provider: "claude", executionMode: "standard" }));
    expect(screen.queryByRole("menu", { name: "Default agent" })).toBeNull();

    fireEvent.click(newSessionButton);
    const reopenedMenu = await screen.findByRole("menu", { name: "Default agent" });
    fireEvent.click(within(reopenedMenu).getByRole("menuitem", { name: "ACP · Codex" }));
    await waitFor(() => expect(acpCreateSession).toHaveBeenCalledWith({ projectPath: "/work/app", provider: "codex" }));

    fireEvent.click(newSessionButton);
    const primeMenu = await screen.findByRole("menu", { name: "Default agent" });
    fireEvent.click(within(primeMenu).getByRole("menuitem", { name: "ACP · Prime Agent" }));
    await waitFor(() => expect(acpCreateSession).toHaveBeenCalledWith({ projectPath: "/work/app", provider: "prime" }));
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

  it("shows a pending new session until catalog sync supplies its session id", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let onSessionsSynced: ((result: { syncedAt: number }) => void) | undefined;
    let catalogSessions = [{ provider: "codex", id: "existing", title: "Existing session", projectPath: "/work/app", updatedAt: 1 }];
    const workbenchOpenSession = vi.fn();
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.terminalTabs": "Terminal tabs"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onSessionsSynced: (callback: (result: { syncedAt: number }) => void) => { onSessionsSynced = callback; return () => undefined; },
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => catalogSessions,
      workbenchNewSession: async () => ({ mode: "xterm", command: "codex", cwd: "/work/app" }),
      workbenchOpenSession,
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByTitle("/work/app"));
    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    const pending = await waitFor(() => {
      const row = [...document.querySelectorAll<HTMLButtonElement>(".wb-list-item")]
        .find((item) => item.textContent?.includes("New session app"));
      if (!row) throw new Error("pending session row not rendered");
      return row;
    });
    expect(pending.hasAttribute("draggable")).toBe(false);
    expect([...document.querySelectorAll<HTMLButtonElement>(".wb-list-item")]
      .find((item) => item.textContent?.includes("Existing session"))?.hasAttribute("draggable")).toBe(true);
    expect(document.querySelector(".wb-folder-row.has-wb-activity .wb-folder-activity-dot")).not.toBeNull();
    expect(document.querySelectorAll(".wb-session-activity-dot")).toHaveLength(1);
    fireEvent.click(pending);
    expect(workbenchOpenSession).not.toHaveBeenCalled();

    catalogSessions = [
      ...catalogSessions,
      { provider: "codex", id: "new-id", title: "Catalog session", projectPath: "/work/app", updatedAt: Date.now() }
    ];
    await act(async () => onSessionsSynced?.({ syncedAt: Date.now() }));

    await waitFor(() => expect([...document.querySelectorAll<HTMLButtonElement>(".wb-list-item")]
      .some((item) => item.textContent?.includes("Catalog session"))).toBe(true));
    await waitFor(() => expect([...document.querySelectorAll(".wb-list-item")].some((item) => item.textContent?.includes("New session app"))).toBe(false));
    expect(document.querySelectorAll(".wb-session-activity-dot")).toHaveLength(1);
  });

  it("reports state-changing Git actions and keeps refreshes silent", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const gitFilePath = "public/files/授信额度申请批量导入.xlsx";
    const gitFile = {
      path: gitFilePath,
      repoPath: gitFilePath,
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
    let failPush = false;
    const terminalGitPush = vi.fn(async () => {
      if (failPush) throw new Error("remote rejected");
      return { ok: true };
    });
    const terminalGitPull = vi.fn(async () => { throw new Error("no upstream"); });
    const terminalGitCommit = vi.fn(async () => ({ ok: true }));
    let resolveCommitSuggestion: ((value: {
      message: string;
      source: "llm" | "heuristic";
      fallbackReason?: "unconfigured" | "request-failed";
    }) => void) | undefined;
    const terminalGitSuggestCommit = vi.fn(() => new Promise<{
      message: string;
      source: "llm" | "heuristic";
      fallbackReason?: "unconfigured" | "request-failed";
    }>((resolve) => { resolveCommitSuggestion = resolve; }));
    const terminalGitBranches = vi.fn(async () => ({
      mode: "direct" as const,
      current: "main",
      branches: ["feature-local", "main"],
      localBranches: ["feature-local", "main"],
      remoteBranches: [{ remote: "origin", name: "feature/ui", fullName: "origin/feature/ui" }],
      repoRoot: "/work/app"
    }));
    const terminalGitCheckout = vi.fn(async () => ({ branch: "feature/ui", repoRoot: "/work/app" }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.cancel": "Cancel", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.sidePanelNoChanges": "No changes", "desktop.workbench.sidePanelStaged": "Staged", "desktop.workbench.sidePanelChanges": "Changes", "desktop.workbench.sidePanelGitUnavailable": "Git unavailable", "desktop.workbench.sidePanelNoRoot": "No root", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.gitCommit": "Commit", "desktop.workbench.gitCommitAndPush": "Commit & Push", "desktop.workbench.gitCommitAndPushSucceeded": "Commit and push completed.", "desktop.workbench.gitCommitDialogTitle": "Commit changes", "desktop.workbench.resizeCommitInput": "Resize commit input", "desktop.workbench.gitCommitAutoGenerate": "Auto generate", "desktop.workbench.gitCommitSuggestedLlm": "AI message", "desktop.workbench.gitCommitSuggestedUnconfigured": "Rule message", "desktop.workbench.gitCommitSuggestedFallback": "Fallback message", "desktop.workbench.gitPush": "Push", "desktop.workbench.gitPull": "Pull", "desktop.workbench.gitLog": "Git log", "desktop.workbench.gitPushSucceeded": "Push completed.", "desktop.workbench.gitPullFailed": "Pull failed: {0}", "desktop.workbench.gitCommitSucceeded": "Commit completed.", "desktop.workbench.gitCommitSucceededPushFailed": "Commit completed, but push failed: {0}", "desktop.workbench.gitStatusRefreshFailed": "Could not refresh Git status: {0}", "desktop.workbench.gitBranchTracking": "{0}  ↑{1}  ↓{2}", "desktop.workbench.gitNoUpstream": "{0} · no upstream", "desktop.workbench.switchBranch": "Switch branch", "desktop.workbench.gitLocalBranches": "Local Branches", "desktop.workbench.gitRemoteBranches": "Remote Branches", "desktop.workbench.gitNoLocalBranches": "No local branches", "desktop.workbench.gitNoRemoteBranches": "No origin branches", "desktop.workbench.checkoutBranchSucceeded": "Switched to branch {0}.", "desktop.workbench.checkoutBranchFailed": "Could not switch branch: {0}"
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
      terminalGitCommit,
      terminalGitSuggestCommit,
      terminalGitBranches,
      terminalGitCheckout
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

    const branchTrigger = await screen.findByRole("button", { name: "Switch branch: main" });
    fireEvent.click(branchTrigger);
    expect(await screen.findByText("Local Branches")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Switch branch" })).toBeNull());
    fireEvent.click(branchTrigger);
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Switch branch" })).toBeNull());
    fireEvent.click(branchTrigger);
    expect(await screen.findByText("Local Branches")).toBeTruthy();
    expect(screen.getByText("Remote Branches")).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "main" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "origin/feature/ui" }));
    await waitFor(() => expect(terminalGitCheckout).toHaveBeenCalledWith({
      cwd: "/work/app",
      branch: "feature/ui",
      remote: "origin",
      repoRoot: "/work/app"
    }));
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Switch branch" })).toBeNull());
    fireEvent.click(branchTrigger);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "feature-local" }));
    await waitFor(() => expect(terminalGitCheckout).toHaveBeenLastCalledWith({
      cwd: "/work/app",
      branch: "feature-local",
      repoRoot: "/work/app"
    }));
    notificationMocks.notifyDesktop.mockClear();

    const gitActions = document.querySelector(".wb-git-actions")!;
    fireEvent.click(gitActions.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!);
    await waitFor(() => expect(terminalGitStatus.mock.calls.length).toBeGreaterThan(autoStatusCalls));
    expect(notificationMocks.notifyDesktop).not.toHaveBeenCalled();

    fireEvent.click(gitActions.querySelector<HTMLButtonElement>('button[aria-label="Push"]')!);
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenLastCalledWith({ text: "Push completed.", kind: "ok" }));

    fireEvent.click(gitActions.querySelector<HTMLButtonElement>('button[aria-label="Pull"]')!);
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenLastCalledWith({ text: "Pull failed: no upstream", kind: "error" }));

    expect(screen.queryByRole("dialog", { name: "Commit changes" })).toBeNull();
    expect(gitActions.querySelector<HTMLButtonElement>('button[aria-label="Commit"]')).toBeNull();
    const messageField = await screen.findByRole("textbox", { name: "Commit changes" });
    expect(document.querySelector(".wb-git-commit-composer")).not.toBeNull();

    // The commit input height drag handle sits above the input (top edge resize).
    const resizer = screen.getByRole("separator", { name: "Resize commit input" });
    expect(resizer.getAttribute("aria-orientation")).toBe("horizontal");
    expect(resizer.classList.contains("pane-resizer")).toBe(true);
    expect(resizer.classList.contains("is-horizontal")).toBe(true);
    expect(resizer.nextElementSibling).toBe(messageField);
    Object.defineProperty(messageField, "offsetHeight", { configurable: true, value: 100 });
    const pointerDown = new MouseEvent("pointerdown", { bubbles: true, clientY: 200 });
    resizer.dispatchEvent(pointerDown);
    expect(document.body.classList.contains("is-pane-resizing")).toBe(true);
    expect(document.body.classList.contains("is-pane-resizing-row")).toBe(true);
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 150 }));
    await waitFor(() => expect(messageField.style.height).toBe("150px"));
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 100 }));
    await waitFor(() => expect(messageField.style.height).toBe("190px"));
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 400 }));
    await waitFor(() => expect(messageField.style.height).toBe("96px"));
    window.dispatchEvent(new MouseEvent("pointerup"));
    expect(document.body.classList.contains("is-pane-resizing")).toBe(false);
    expect(document.body.classList.contains("is-pane-resizing-row")).toBe(false);
    const changeCheckbox = screen.getByRole("checkbox", { name: gitFilePath });
    expect(changeCheckbox.getAttribute("aria-checked")).toBe("true");
    expect(await screen.findByText("授信额度申请批量导入.xlsx")).toBeTruthy();

    const autoGenerate = screen.getByRole("button", { name: "Auto generate" });
    expect((autoGenerate as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(autoGenerate);
    await waitFor(() => expect(terminalGitSuggestCommit).toHaveBeenCalledWith({
      repoRoot: "/work/app",
      paths: [gitFilePath]
    }));
    expect(autoGenerate.getAttribute("aria-busy")).toBe("true");
    expect(autoGenerate.classList.contains("is-loading")).toBe(true);
    expect(autoGenerate.querySelector(".wb-git-cyber-loading")).not.toBeNull();
    await act(async () => resolveCommitSuggestion?.({ message: "fix: generated selection", source: "llm" }));
    await waitFor(() => expect(messageField).toHaveProperty("value", "fix: generated selection"));
    expect(autoGenerate.getAttribute("aria-busy")).toBe("false");
    expect(autoGenerate.classList.contains("is-loading")).toBe(false);

    fireEvent.click(changeCheckbox);
    expect((autoGenerate as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(changeCheckbox);
    expect((autoGenerate as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(messageField, { target: { value: "draft before standalone push" } });
    fireEvent.click(gitActions.querySelector<HTMLButtonElement>('button[aria-label="Push"]')!);
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenLastCalledWith({ text: "Push completed.", kind: "ok" }));
    expect(messageField).toHaveProperty("value", "draft before standalone push");

    fireEvent.change(messageField, { target: { value: "feat: add toasts" } });
    notificationMocks.notifyDesktop.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Commit & Push" }));
    await waitFor(() => expect(terminalGitCommit).toHaveBeenCalledWith({
      repoRoot: "/work/app",
      message: "feat: add toasts",
      paths: [gitFilePath]
    }));
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenCalledWith({ text: "Commit and push completed.", kind: "ok" }));
    expect(notificationMocks.notifyDesktop).toHaveBeenCalledTimes(1);
    expect(messageField).toHaveProperty("value", "");

    fireEvent.change(messageField, { target: { value: "fix: normal commit" } });
    notificationMocks.notifyDesktop.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() => expect(terminalGitCommit).toHaveBeenCalledWith({
      repoRoot: "/work/app",
      message: "fix: normal commit",
      paths: [gitFilePath]
    }));
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenCalledWith({ text: "Commit completed.", kind: "ok" }));
    expect(notificationMocks.notifyDesktop).toHaveBeenCalledTimes(1);
    expect(messageField).toHaveProperty("value", "");

    fireEvent.change(messageField, { target: { value: "feat: keep draft" } });
    failPush = true;
    notificationMocks.notifyDesktop.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Commit & Push" }));
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenCalledWith({ text: "Commit completed, but push failed: remote rejected", kind: "error" }));
    expect(notificationMocks.notifyDesktop).toHaveBeenCalledTimes(1);
    expect(messageField).toHaveProperty("value", "feat: keep draft");
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
      await waitFor(() => expect(terminalGitFetch.mock.calls.length).toBeGreaterThanOrEqual(1));
      const afterActivate = terminalGitStatus.mock.calls.length;
      const fetchesAfterActivate = terminalGitFetch.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      await waitFor(() => expect(terminalGitStatus.mock.calls.length).toBeGreaterThan(afterActivate));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      await waitFor(() => expect(terminalGitFetch.mock.calls.length).toBeGreaterThan(fetchesAfterActivate));
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
    expect(notificationMocks.notifyDesktop).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(document.querySelector(".wb-git-branch-popover")).toBeNull());

    fireEvent.click(branchButton);
    await waitFor(() => expect(document.querySelector(".wb-git-branch-popover")).toBeTruthy());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".wb-git-branch-popover")).toBeNull());
  });

  it("opens the search side panel from Cmd+Shift+F bridge", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let onWorkbenchCmdShiftF: (() => void) | undefined;
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelSearch": "Search", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.sidePanelNoRoot": "Select a project", "desktop.workbench.searchPlaceholder": "Search in project", "desktop.workbench.searchOptions": "Search options", "desktop.workbench.searchMatchCase": "Match Case", "desktop.workbench.searchWholeWord": "Match Whole Word", "desktop.workbench.searchUseRegex": "Use Regular Expression", "desktop.workbench.searchHint": "Type to search", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onWorkbenchCmdShiftF: (callback: () => void) => {
        onWorkbenchCmdShiftF = callback;
        return () => undefined;
      },
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchSearchTextCancel: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await screen.findByRole("button", { name: /Fix renderer/ });
    expect(screen.queryByRole("searchbox", { name: "Search" })).toBeNull();
    act(() => onWorkbenchCmdShiftF?.());
    const searchInput = await screen.findByRole("searchbox", { name: "Search" });
    await waitFor(() => expect(document.activeElement).toBe(searchInput));
  });

  it("opens the search side panel and shows project content matches", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchSearchText = vi.fn(async () => ({
      matches: [{
        path: "/work/app/src/main.ts",
        relativePath: "src/main.ts",
        line: 12,
        column: 3,
        endColumn: 9,
        preview: "const findme = 1;"
      }],
      truncated: false,
      filesSearched: 3,
      engine: "node" as const
    }));
    const workbenchInspectFile = vi.fn(async () => ({
      kind: "text" as const,
      content: "const findme = 1;\nfindme();\n",
      encoding: "utf8" as const,
      version: "v1",
      size: 18,
      mtimeMs: 1
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.findCount": "{0} / {1}", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelSearch": "Search", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.sidePanelNoRoot": "Select a project", "desktop.workbench.searchPlaceholder": "Search in project", "desktop.workbench.searchOptions": "Search options", "desktop.workbench.searchMatchCase": "Match Case", "desktop.workbench.searchWholeWord": "Match Whole Word", "desktop.workbench.searchUseRegex": "Use Regular Expression", "desktop.workbench.searchHint": "Type to search", "desktop.workbench.searchSearching": "Searching…", "desktop.workbench.searchNoResults": "No results", "desktop.workbench.searchResultSummary": "{0} results in {1} files", "desktop.workbench.searchTruncated": "results limited", "desktop.workbench.searchFailed": "Search failed: {0}", "desktop.workbench.quickAccessProjectPlaceholder": "Search projects by name or path", "desktop.workbench.quickAccessSelectProject": "Select project", "desktop.workbench.quickAccessNoProjects": "No matching projects", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.fileSaved": "Saved", "desktop.workbench.fileModified": "Modified", "desktop.workbench.fileSaving": "Saving…", "desktop.common.save": "Save", "desktop.workbench.closeFile": "Close file"
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
        { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 2 },
        { provider: "claude", id: "session-2", title: "Other project", projectPath: "/work/other", updatedAt: 1 }
      ],
      workbenchSearchText,
      workbenchSearchTextCancel: async () => ({ ok: true }),
      workbenchInspectFile,
      workbenchListDirectory: async ({ dirPath }: { dirPath: string }) => ({
        entries: dirPath === "/work/app"
          ? [{ name: "src", path: "/work/app/src", isDirectory: true }]
          : dirPath === "/work/app/src"
            ? [{ name: "main.ts", path: "/work/app/src/main.ts", isDirectory: false }]
            : []
      })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByTitle("/work/app"));
    fireEvent.click(screen.getByRole("button", { name: "Search", pressed: false }));
    const searchInput = await screen.findByRole("searchbox", { name: "Search" });
    fireEvent.change(searchInput, { target: { value: "findme" } });
    await waitFor(() => expect(workbenchSearchText).toHaveBeenCalled());
    expect(workbenchSearchText).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rootPath: "/work/app",
        query: "findme"
      })
    );
    await screen.findByText("src/main.ts");
    expect(screen.getByText("const findme = 1;")).toBeTruthy();
    expect(screen.getByText("1 results in 1 files")).toBeTruthy();
    // Avoid mounting CodeMirror in jsdom (needs matchMedia); assert open intent via IPC.
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
    fireEvent.click(screen.getByText("const findme = 1;"));
    await waitFor(() => expect(workbenchInspectFile).toHaveBeenCalledWith({
      rootPath: "/work/app",
      filePath: "/work/app/src/main.ts"
    }));
    await waitFor(() => expect(document.querySelectorAll('[data-pane-group="code"] .wb-terminal-tab.is-editor')).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Explorer", pressed: false }));
    await waitFor(() => expect(document.querySelector(
      '[data-wb-entry-path="/work/app/src/main.ts"]'
    )?.getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Search", pressed: false }));
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const findInput = await waitFor(() => {
      const input = document.querySelector<HTMLInputElement>(".wb-editor-find-input");
      expect(input).not.toBeNull();
      return input!;
    });
    await waitFor(() => expect(document.activeElement).toBe(findInput));
    fireEvent.change(findInput, { target: { value: "findme" } });
    const findCount = document.querySelector(".wb-editor-find-count");
    await waitFor(() => expect(findCount?.textContent).toBe("1 / 2"));
    fireEvent.keyDown(findInput, { key: "Enter" });
    await waitFor(() => expect(findCount?.textContent).toBe("2 / 2"));

    const editor = screen.getByPlaceholderText("/work/app/src/main.ts");
    editor.focus();
    const editorEnter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    editor.dispatchEvent(editorEnter);
    expect(editorEnter.defaultPrevented).toBe(false);
    expect(findCount?.textContent).toBe("2 / 2");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".wb-editor-find-input")).toBeNull();

    const projectSearchInput = screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement;
    projectSearchInput.setSelectionRange(2, 2);
    fireEvent.keyDown(projectSearchInput, { key: "ArrowLeft" });
    expect(screen.queryByRole("combobox", { name: "Select project" })).toBeNull();

    projectSearchInput.setSelectionRange(0, 0);
    fireEvent.keyDown(projectSearchInput, { key: "ArrowLeft" });
    let projectPicker = screen.getByRole("combobox", { name: "Select project" });
    expect(screen.getByRole("option", { name: /app.*\/work\/app/i }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(projectPicker, { key: "Escape" });
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("findme");

    const restoredSearchInput = screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement;
    restoredSearchInput.setSelectionRange(0, 0);
    fireEvent.keyDown(restoredSearchInput, { key: "ArrowLeft" });
    projectPicker = screen.getByRole("combobox", { name: "Select project" });
    fireEvent.keyDown(projectPicker, { key: "ArrowDown" });
    fireEvent.keyDown(projectPicker, { key: "Enter" });

    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("findme");
    await waitFor(() => expect(workbenchSearchText).toHaveBeenLastCalledWith(
      expect.objectContaining({ rootPath: "/work/other", query: "findme" })
    ));
    expect(screen.getByText("Search")).toBeTruthy();
  });

  it("opens all-branch file history from Explorer and returns to Explorer", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchGitFileLog = vi.fn(async () => ({
      repoRoot: "/work/app",
      repoPath: "src/app.ts",
      commits: [{
        hash: "1234567890abcdef1234567890abcdef12345678",
        shortHash: "1234567",
        author: "Developer",
        date: 1,
        subject: "Update app",
        parents: [],
        decorations: "origin/feature",
        refs: { heads: ["feature"], remotes: ["origin/feature"], tags: [], isHead: false, primaryLabel: "feature" }
      }],
      layout: {
        laneWidth: 18,
        rowHeight: 52,
        maxColumns: 1,
        columnColors: [0],
        rows: [{
          index: 0,
          commitColumn: 0,
          incomingTracks: [],
          outgoingTracks: [],
          curves: [],
          colorIndex: 0,
          isHead: false
        }]
      }
    }));
    const terminalGitShow = vi.fn(async () => ({
      hash: "1234567890abcdef1234567890abcdef12345678",
      shortHash: "1234567",
      author: "Developer",
      date: 1,
      subject: "Update app",
      body: "Commit body",
      files: [{ status: "M", path: "src/app.ts" }]
    }));
    const clipboardWriteText = vi.fn();
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.copy": "Copy", "desktop.common.copyPath": "Copy Path", "desktop.common.paste": "Paste", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.sidePanelNoRoot": "Select a project", "desktop.workbench.sidePanelScripts": "Scripts", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.explorerGitFileHistory": "View Git File History", "desktop.workbench.explorerRevealInFinder": "Reveal in Finder", "desktop.workbench.gitFileHistoryTitle": "File history · {0}", "desktop.workbench.gitFileHistoryBackToExplorer": "Back to Explorer", "desktop.workbench.gitFileHistoryLoading": "Loading file history…", "desktop.workbench.gitFileHistoryEmpty": "No commits found for this file", "desktop.workbench.gitFileHistoryLoadFailed": "Could not load file history: {0}", "desktop.workbench.gitLogBackToList": "Back to commit history", "desktop.workbench.gitLogNoFiles": "No changed files", "desktop.workbench.gitLogUntitled": "(untitled)", "desktop.workbench.gitCopyCommitHash": "Copy commit hash", "desktop.workbench.gitCopyBranchName": "Copy branch name"
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
      workbenchListDirectory: async ({ dirPath }: { dirPath: string }) => ({
        entries: dirPath === "/work/app"
          ? [{ name: "app.ts", path: "/work/app/src/app.ts", isDirectory: false }]
          : []
      }),
      workbenchClipboardHasFiles: async () => ({ hasFiles: false }),
      workbenchGitFileLog,
      terminalGitShow,
      clipboardWriteText
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByTitle("/work/app"));
    fireEvent.click(screen.getByRole("button", { name: "Explorer", pressed: false }));
    const fileRow = (await screen.findByText("app.ts")).closest("[role=treeitem]")!;
    fireEvent.contextMenu(fileRow, { clientX: 20, clientY: 30 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "View Git File History" }));

    await waitFor(() => expect(workbenchGitFileLog).toHaveBeenCalledWith({
      rootPath: "/work/app",
      filePath: "/work/app/src/app.ts",
      limit: 150
    }));
    expect(await screen.findByText("File history · app.ts")).toBeTruthy();
    expect(await screen.findByText("feature")).toBeTruthy();
    const remoteBranch = await screen.findByText("origin/feature");
    fireEvent.contextMenu(remoteBranch, { clientX: 30, clientY: 40 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy branch name" }));
    expect(clipboardWriteText).toHaveBeenLastCalledWith("origin/feature");
    const commitRow = await screen.findByRole("button", { name: /Update app/ });
    fireEvent.contextMenu(commitRow, { clientX: 30, clientY: 40 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy commit hash" }));
    expect(clipboardWriteText).toHaveBeenLastCalledWith("1234567890abcdef1234567890abcdef12345678");
    fireEvent.click(commitRow);
    await waitFor(() => expect(terminalGitShow).toHaveBeenCalledWith({
      repoRoot: "/work/app",
      hash: "1234567890abcdef1234567890abcdef12345678"
    }));
    expect(await screen.findByText("Commit body")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to commit history" }));
    expect(await screen.findByRole("button", { name: /Update app/ })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Back to Explorer" }).at(-1)!);
    expect(await screen.findByText("Explorer")).toBeTruthy();
    expect(await screen.findByText("app.ts")).toBeTruthy();
  });

  it("opens a Git change from its context menu in Workbench or the default app", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const gitFile = {
      path: "apps/desktop/src/app.ts",
      repoPath: "apps/desktop/src/app.ts",
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
      tracking: []
    }));
    const workbenchInspectFile = vi.fn(async () => ({
      kind: "text" as const,
      content: "export const app = true;\n",
      encoding: "utf8" as const,
      version: "v1",
      size: 25,
      mtimeMs: 1
    }));
    const workbenchOpenPath = vi.fn(async () => ({ ok: true }));
    const clipboardWriteText = vi.fn();
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
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.refresh": "Refresh", "desktop.common.copyPath": "Copy Path", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.sidePanelNoChanges": "No changes", "desktop.workbench.sidePanelStaged": "Staged", "desktop.workbench.sidePanelChanges": "Changes", "desktop.workbench.sidePanelGitUnavailable": "Git unavailable", "desktop.workbench.sidePanelNoRoot": "No root", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.fileOpen": "Open File", "desktop.workbench.fileOpenDefault": "Open with default app", "desktop.workbench.gitDiscard": "Discard changes"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app/apps/desktop", updatedAt: 1 }],
      terminalGitStatus,
      terminalGitFetch: async () => ({ ok: true }),
      workbenchInspectFile,
      workbenchOpenPath,
      clipboardWriteText
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByTitle("/work/app/apps/desktop"));
    fireEvent.click(screen.getAllByRole("button", { name: "Git" })[0]!);

    const gitRow = await screen.findByTitle("apps/desktop/src/app.ts");
    fireEvent.contextMenu(gitRow, { clientX: 40, clientY: 50 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open File" }));
    await waitFor(() => expect(workbenchInspectFile).toHaveBeenCalledWith({
      rootPath: "/work/app/apps/desktop",
      filePath: "/work/app/apps/desktop/src/app.ts"
    }));
    await waitFor(() => expect(document.querySelectorAll('[data-pane-group="code"] .wb-terminal-tab.is-editor')).toHaveLength(1));
    expect(screen.queryByRole("menuitem", { name: "Open File" })).toBeNull();

    fireEvent.contextMenu(gitRow, { clientX: 40, clientY: 50 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open with default app" }));
    await waitFor(() => expect(workbenchOpenPath).toHaveBeenCalledWith({
      rootPath: "/work/app/apps/desktop",
      filePath: "/work/app/apps/desktop/src/app.ts"
    }));
    expect(screen.queryByRole("menuitem", { name: "Open with default app" })).toBeNull();

    fireEvent.contextMenu(gitRow, { clientX: 40, clientY: 50 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy Path" }));
    expect(clipboardWriteText).toHaveBeenCalledWith("/work/app/apps/desktop/src/app.ts");
    expect(screen.queryByRole("menuitem", { name: "Copy Path" })).toBeNull();
  });

  it("discards a Git file after confirmation and refreshes its status", async () => {
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
    let hasChange = true;
    const terminalGitStatus = vi.fn(async () => ({
      isRepo: true,
      root: "/work/app",
      staged: [],
      unstaged: hasChange ? [gitFile] : [],
      nestedRepos: [],
      tracking: []
    }));
    const terminalGitDiscardChange = vi.fn(async () => {
      hasChange = false;
      return { ok: true };
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.sidePanelNoChanges": "No changes", "desktop.workbench.sidePanelStaged": "Staged", "desktop.workbench.sidePanelChanges": "Changes", "desktop.workbench.sidePanelGitUnavailable": "Git unavailable", "desktop.workbench.sidePanelNoRoot": "No root", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.gitDiscard": "Discard changes", "desktop.workbench.gitDiscardConfirm": "Discard all staged and working tree changes to \"{0}\"? This cannot be undone.", "desktop.workbench.gitDiscardUntrackedConfirm": "Delete untracked \"{0}\"? This cannot be undone.", "desktop.workbench.gitDiscardSucceeded": "Discarded changes to {0}.", "desktop.workbench.gitDiscardFailed": "Could not discard changes: {0}"
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
      terminalGitFetch: async () => ({ ok: true }),
      terminalGitDiscardChange
    } as unknown as typeof window.agentResume;

    try {
      render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
      fireEvent.click(await screen.findByTitle("/work/app"));
      fireEvent.click(screen.getAllByRole("button", { name: "Git" })[0]!);
      const discard = await screen.findByRole("button", { name: "Discard changes src/app.ts" });
      fireEvent.click(discard);
      expect(confirm).toHaveBeenCalledWith('Discard all staged and working tree changes to "src/app.ts"? This cannot be undone.');
      await waitFor(() => expect(terminalGitDiscardChange).toHaveBeenCalledWith({ repoRoot: "/work/app", path: "src/app.ts" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Discard changes src/app.ts" })).toBeNull());
      expect(notificationMocks.notifyDesktop).toHaveBeenCalledWith({ text: "Discarded changes to src/app.ts.", kind: "ok" });
    } finally {
      confirm.mockRestore();
    }
  });

  it("discards every unique Git change under a directory without touching siblings", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const stagedOnly = { path: "src/staged.ts", repoPath: "src/staged.ts", repoRoot: "/work/app", status: "M", staged: true, unstaged: false };
    const stagedAndUnstaged = { path: "src/both.ts", repoPath: "src/both.ts", repoRoot: "/work/app", status: "M", staged: true, unstaged: true };
    const unstagedCopy = { ...stagedAndUnstaged, staged: false };
    const untracked = { path: "src/untracked.ts", repoPath: "src/untracked.ts", repoRoot: "/work/app", status: "?", staged: false, unstaged: true };
    const sibling = { path: "sibling/keep.ts", repoPath: "sibling/keep.ts", repoRoot: "/work/app", status: "M", staged: false, unstaged: true };
    const remaining = new Set([stagedOnly.repoPath, stagedAndUnstaged.repoPath, untracked.repoPath, sibling.repoPath]);
    const terminalGitStatus = vi.fn(async () => ({
      isRepo: true,
      root: "/work/app",
      staged: [stagedOnly, stagedAndUnstaged].filter((change) => remaining.has(change.repoPath)),
      unstaged: [unstagedCopy, untracked, sibling].filter((change) => remaining.has(change.repoPath)),
      nestedRepos: [],
      tracking: []
    }));
    const terminalGitDiscardChange = vi.fn(async ({ path }: { repoRoot: string; path: string }) => {
      remaining.delete(path);
      return { ok: true };
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.sidePanelNoChanges": "No changes", "desktop.workbench.sidePanelStaged": "Staged", "desktop.workbench.sidePanelChanges": "Changes", "desktop.workbench.sidePanelGitUnavailable": "Git unavailable", "desktop.workbench.sidePanelNoRoot": "No root", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.gitDiscard": "Discard changes", "desktop.workbench.gitDiscardDirectoryConfirm": "Discard all staged, working tree, and untracked changes under \"{0}\" ({1} files)? This cannot be undone.", "desktop.workbench.gitDiscardSucceeded": "Discarded changes to {0}."
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
      terminalGitFetch: async () => ({ ok: true }),
      terminalGitDiscardChange
    } as unknown as typeof window.agentResume;

    try {
      render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
      fireEvent.click(await screen.findByTitle("/work/app"));
      fireEvent.click(screen.getAllByRole("button", { name: "Git" })[0]!);
      fireEvent.click((await screen.findAllByRole("button", { name: "Discard changes src" }))[0]!);
      expect(terminalGitDiscardChange).not.toHaveBeenCalled();
      fireEvent.click((await screen.findAllByRole("button", { name: "Discard changes src" }))[0]!);

      expect(confirm).toHaveBeenCalledWith('Discard all staged, working tree, and untracked changes under "src" (3 files)? This cannot be undone.');
      await waitFor(() => expect(terminalGitDiscardChange).toHaveBeenCalledTimes(3));
      expect(terminalGitDiscardChange.mock.calls.map(([args]) => args)).toEqual([
        { repoRoot: "/work/app", path: "src/staged.ts" },
        { repoRoot: "/work/app", path: "src/both.ts" },
        { repoRoot: "/work/app", path: "src/untracked.ts" }
      ]);
      expect(remaining).toEqual(new Set(["sibling/keep.ts"]));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Discard changes src" })).toBeNull());
      expect(notificationMocks.notifyDesktop).toHaveBeenCalledWith({ text: "Discarded changes to src.", kind: "ok" });
    } finally {
      confirm.mockRestore();
    }
  });

  it("keeps processing a Git directory after one file fails and reports a partial result", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const first = { path: "src/first.ts", repoPath: "src/first.ts", repoRoot: "/work/app", status: "M", staged: false, unstaged: true };
    const second = { path: "src/second.ts", repoPath: "src/second.ts", repoRoot: "/work/app", status: "M", staged: false, unstaged: true };
    const remaining = new Set([first.repoPath, second.repoPath]);
    const terminalGitStatus = vi.fn(async () => ({
      isRepo: true,
      root: "/work/app",
      staged: [],
      unstaged: [first, second].filter((change) => remaining.has(change.repoPath)),
      nestedRepos: [],
      tracking: []
    }));
    const terminalGitDiscardChange = vi.fn(async ({ path }: { repoRoot: string; path: string }) => {
      if (path === first.repoPath) throw new Error("locked");
      remaining.delete(path);
      return { ok: true };
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.sidePanelNoChanges": "No changes", "desktop.workbench.sidePanelStaged": "Staged", "desktop.workbench.sidePanelChanges": "Changes", "desktop.workbench.sidePanelGitUnavailable": "Git unavailable", "desktop.workbench.sidePanelNoRoot": "No root", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.gitDiscard": "Discard changes", "desktop.workbench.gitDiscardDirectoryConfirm": "Discard all staged, working tree, and untracked changes under \"{0}\" ({1} files)? This cannot be undone.", "desktop.workbench.gitDiscardDirectoryPartial": "Discarded {0} of {1} changes under {2}; the remaining changes failed: {3}"
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
      terminalGitFetch: async () => ({ ok: true }),
      terminalGitDiscardChange
    } as unknown as typeof window.agentResume;

    try {
      render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
      fireEvent.click(await screen.findByTitle("/work/app"));
      fireEvent.click(screen.getAllByRole("button", { name: "Git" })[0]!);
      fireEvent.click(await screen.findByRole("button", { name: "Discard changes src" }));

      await waitFor(() => expect(terminalGitDiscardChange).toHaveBeenCalledTimes(2));
      expect(remaining).toEqual(new Set(["src/first.ts"]));
      expect(notificationMocks.notifyDesktop).toHaveBeenCalledWith({
        text: "Discarded 1 of 2 changes under src; the remaining changes failed: locked",
        kind: "error"
      });
    } finally {
      confirm.mockRestore();
    }
  });

  it("supplements a truncated Quick Access index before opening a deep path", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    localStorage.setItem("workbench-selected-project", "/work/app");
    localStorage.setItem("workbench-quick-access-project", "/work/app");
    let openQuickFiles: () => void = () => undefined;
    const workbenchListFiles = vi.fn(async () => ({
      files: [{ path: "/work/app/noise.ts", relativePath: "noise.ts", kind: "file" as const }],
      truncated: true,
      engine: "node" as const
    }));
    const deepRelativePath = "web-manager/src/views/sysFinanceCenter/internetPaymentManage/prePaybankPayFail/index.vue";
    const workbenchSearchPaths = vi.fn(async () => ({
      files: [{ path: `/work/app/${deepRelativePath}`, relativePath: deepRelativePath, kind: "file" as const }],
      truncated: false,
      engine: "rg" as const
    }));
    const workbenchInspectFile = vi.fn(async () => ({
      kind: "external" as const,
      reason: "too-large" as const,
      size: 3_000_000,
      mtimeMs: 1
    }));
    const workbenchOpenPath = vi.fn(async () => ({ ok: true }));
    const onTabRequest = vi.fn();
    window.addEventListener("agent-resume:tab-request", onTabRequest);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.quickAccessDialog": "Quick Access",
        "desktop.workbench.quickAccessFilePlaceholder": "Search files by path",
        "desktop.workbench.quickAccessLoading": "Loading",
        "desktop.workbench.quickAccessNoFiles": "No files",
        "desktop.workbench.quickAccessNoProject": "No project",
        "desktop.workbench.quickAccessClose": "Close",
        "desktop.workbench.quickAccessTruncated": "Limited"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdP: (callback: () => void) => { openQuickFiles = callback; return () => undefined; },
      onWorkbenchCmdShiftP: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      workbenchListFiles,
      workbenchListFilesCancel: async () => ({ ok: true }),
      workbenchSearchPaths,
      workbenchSearchPathsCancel: async () => ({ ok: true }),
      workbenchInspectFile,
      workbenchOpenPath
    } as unknown as typeof window.agentResume;

    try {
      render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
      await act(async () => openQuickFiles());
      expect(await screen.findByRole("dialog", { name: "Quick Access" })).toBeTruthy();
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "sysFinanceCenter/internetPaymentManage/prePaybankPayFail" }
      });
      await waitFor(() => expect(workbenchSearchPaths).toHaveBeenCalledWith({
        rootPath: "/work/app",
        query: "sysFinanceCenter/internetPaymentManage/prePaybankPayFail"
      }));
      fireEvent.click(await screen.findByText("index.vue"));
      await waitFor(() => expect(workbenchInspectFile).toHaveBeenCalledWith({
        rootPath: "/work/app",
        filePath: `/work/app/${deepRelativePath}`
      }));
      expect(workbenchOpenPath).toHaveBeenCalledWith({
        rootPath: "/work/app",
        filePath: `/work/app/${deepRelativePath}`
      });
      expect(onTabRequest).toHaveBeenCalled();
    } finally {
      window.removeEventListener("agent-resume:tab-request", onTabRequest);
    }
  });

  it("switches projects from the command palette and closes Quick Access", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    localStorage.setItem("workbench-selected-project", "/work/app");
    localStorage.setItem("workbench-quick-access-project", "/work/app");
    let openCommands: () => void = () => undefined;
    const onTabRequest = vi.fn();
    window.addEventListener("agent-resume:tab-request", onTabRequest);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.quickAccessDialog": "Quick Access",
        "desktop.workbench.quickAccessFilePlaceholder": "Search files by path",
        "desktop.workbench.quickAccessProjectPlaceholder": "Search projects",
        "desktop.workbench.quickAccessCommandPlaceholder": "Type a command",
        "desktop.workbench.quickAccessNoFiles": "No files",
        "desktop.workbench.quickAccessNoProjects": "No projects",
        "desktop.workbench.quickAccessNoCommands": "No commands",
        "desktop.workbench.quickAccessNoProject": "No project",
        "desktop.workbench.quickAccessClose": "Close",
        "desktop.workbench.quickAccessSelectProject": "Select project",
        "desktop.workbench.quickAccessSwitchProject": "Workbench: Switch Project…"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdP: () => () => undefined,
      onWorkbenchCmdShiftP: (callback: () => void) => { openCommands = callback; return () => undefined; },
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex", id: "session-1", title: "App", projectPath: "/work/app", updatedAt: 2 },
        { provider: "claude", id: "session-2", title: "Other", projectPath: "/work/other", updatedAt: 1 }
      ]
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await waitFor(() => expect(screen.getByTitle("/work/app")).toBeTruthy());
    await act(async () => openCommands());

    let input = await screen.findByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: ">switch" } });
    expect(await screen.findByRole("option", { name: "Workbench: Switch Project…" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });

    input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.placeholder).toBe("Search projects");
    expect(screen.getByRole("option", { name: /app.*\/work\/app/i }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "Escape" });
    input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe(">switch");

    fireEvent.keyDown(input, { key: "Enter" });
    input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Quick Access" })).toBeNull());
    expect(localStorage.getItem("workbench-selected-project")).toBe("/work/other");
    expect(onTabRequest).toHaveBeenCalledWith(expect.objectContaining({ detail: "workbench" }));
    window.removeEventListener("agent-resume:tab-request", onTabRequest);
  });

  it("launches note tasks with note-yolo mode, noteId, and initial prompt", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let catalogSessions = [
      { provider: "codex", id: "session-1", title: "Existing", projectPath: "/work/app", updatedAt: 1 }
    ];
    const workbenchNewSession = vi.fn(async () => {
      catalogSessions = [
        ...catalogSessions,
        { provider: "codex", id: "session-note", title: "Note task", projectPath: "/work/app", updatedAt: Date.now() }
      ];
      return {
        mode: "xterm" as const,
        command: "codex --cd '/work/app' --dangerously-bypass-approvals-and-sandbox",
        cwd: "/work/app"
      };
    });
    const terminalInput = vi.fn(async () => ({ ok: true }));
    const listSessions = vi.fn(async () => catalogSessions);
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
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex", terminalMode: "external-system" } }),
      listSessions,
      workbenchNewSession,
      terminalSpawn: async () => ({ id: 42 }),
      terminalInput,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await waitFor(() => expect(screen.getByTitle("/work/app")).toBeTruthy());

    const launched = new Promise<{ requestId: string; ok: boolean; catalogProvider?: string; sessionId?: string }>((resolve) => {
      window.addEventListener("agent-resume:workbench-session-launched", ((event: Event) => {
        resolve((event as CustomEvent).detail);
      }) as EventListener, { once: true });
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-launch-session", {
        detail: {
          requestId: "notes-run-test-1",
          channel: "cli",
          provider: "codex",
          cwd: "/work/app",
          title: "Leaf note task",
          noteId: "note-leaf-1",
          initialPrompt: 'Call note_read with noteId "note-leaf-1"',
          executionMode: "note-yolo"
        }
      }));
    });

    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith({
      cwd: "/work/app",
      provider: "codex",
      executionMode: "note-yolo",
      noteId: "note-leaf-1",
      initialPrompt: 'Call note_read with noteId "note-leaf-1"'
    }));

    const result = await launched;
    expect(result).toMatchObject({
      requestId: "notes-run-test-1",
      ok: true,
      catalogProvider: "codex",
      sessionId: "session-note"
    });
  });

  it("opens a floating note from an active CLI session tab and creates the session note", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const notesList = vi.fn(async () => []);
    const notesCreate = vi.fn(async () => ({ noteId: "floating-note", filename: "floating.md" }));
    const notesWrite = vi.fn(async ({ noteId, content }: { noteId: string; content: string }) => ({ noteId, filename: "floating.md", updatedAtMs: 3, content }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.loading": "Loading…", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.addFloatingNote": "Add floating note", "desktop.workbench.openFloatingNote": "Open floating note", "desktop.workbench.floatingNote": "Floating note", "desktop.workbench.floatingNoteClose": "Close floating note", "desktop.workbench.floatingNoteEditor": "Floating note editor", "desktop.workbench.floatingNoteCreating": "Creating floating note…", "desktop.workbench.floatingNoteLoading": "Loading floating note…", "desktop.workbench.floatingNoteSaving": "Saving…", "desktop.workbench.floatingNoteSaved": "Saved", "desktop.workbench.floatingNoteUnsaved": "Unsaved changes", "desktop.workbench.floatingNoteSaveFailed": "Save failed: {0}", "desktop.workbench.floatingNoteLoadError": "Could not open floating note: {0}", "desktop.workbench.floatingNoteLoadFailed": "Could not open floating note."
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
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalGitStatus: async () => ({ isRepo: false, root: null, staged: [], unstaged: [], nestedRepos: [], tracking: [] }),
      terminalGitFetch: async () => ({ ok: true }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true }),
      notesList,
      notesCreate,
      notesWrite
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-session.active")).toBeTruthy());

    fireEvent.contextMenu(document.querySelector<HTMLElement>(".wb-terminal-tab.is-session.active")!);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add floating note" }));
    await waitFor(() => expect(notesCreate).toHaveBeenCalledWith({
      scope: "session",
      projectPath: "/work/app",
      provider: "codex",
      sessionId: "session-1"
    }));
    await waitFor(() => expect(notesWrite).toHaveBeenCalledWith({ noteId: "floating-note", content: "# app · Fix renderer\n\n" }));
    expect(notesList).toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Floating note" })).toBeTruthy();
  });

  it("opens the newest linked note from the session list without creating another note", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const notesRead = vi.fn(async ({ noteId }: { noteId: string }) => ({
      record: { noteId, scope: "session", provider: "codex", agentSessionId: "session-1", projectPath: "/work/app", filename: `${noteId}.md`, relDir: "sessions/codex", relMdPath: `notes/sessions/codex/${noteId}.md`, createdAtMs: 1, updatedAtMs: noteId === "new" ? 20 : 10 },
      content: noteId === "new" ? "# Newest\n" : "# Older\n"
    }));
    const notesCreate = vi.fn(async () => ({ noteId: "unexpected", filename: "unexpected.md" }));
    const notes = [
      { noteId: "old", scope: "session", provider: "codex", agentSessionId: "session-1", projectPath: "/work/app", filename: "old.md", relDir: "sessions/codex", relMdPath: "notes/sessions/codex/old.md", createdAtMs: 1, updatedAtMs: 10 },
      { noteId: "new", scope: "session", provider: "codex", agentSessionId: "session-1", projectPath: "/work/app", filename: "new.md", relDir: "sessions/codex", relMdPath: "notes/sessions/codex/new.md", createdAtMs: 2, updatedAtMs: 20 }
    ];
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.rename": "Rename", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.openInChatGpt": "Open in ChatGPT", "desktop.workbench.preview": "Preview", "desktop.workbench.mountNote": "Mount note", "desktop.workbench.addFloatingNote": "Add floating note", "desktop.workbench.openFloatingNote": "Open floating note", "desktop.workbench.removeFromPanel": "Remove from panel", "desktop.workbench.setGtdStatus": "Set GTD status", "desktop.workbench.gtdStatus.inbox": "Inbox", "desktop.workbench.gtdStatus.next": "Next", "desktop.workbench.gtdStatus.waiting": "Waiting", "desktop.workbench.gtdStatus.someday": "Someday", "desktop.workbench.gtdStatus.reference": "Reference", "desktop.workbench.gtdStatus.done": "Done", "desktop.workbench.floatingNote": "Floating note", "desktop.workbench.floatingNoteClose": "Close floating note", "desktop.workbench.floatingNoteEditor": "Floating note editor", "desktop.workbench.floatingNoteLoading": "Loading floating note…", "desktop.workbench.floatingNoteCreating": "Creating floating note…", "desktop.workbench.floatingNoteSaved": "Saved", "desktop.workbench.floatingNoteUnsaved": "Unsaved changes", "desktop.workbench.floatingNoteSaving": "Saving…", "desktop.workbench.floatingNoteLoadFailed": "Could not open floating note.", "desktop.workbench.floatingNoteLoadError": "Could not open floating note: {0}", "desktop.workbench.floatingNoteSaveFailed": "Save failed: {0}"
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
      notesList: async () => notes,
      notesRead,
      notesCreate
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const session = await screen.findByRole("button", { name: /Fix renderer/ });
    fireEvent.contextMenu(session);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open floating note" }));
    await waitFor(() => expect(notesRead).toHaveBeenCalledWith({ noteId: "new" }));
    expect(notesCreate).not.toHaveBeenCalled();
  });

  it("uses chat plus ACP record id for an ACP tab floating note", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const notesCreate = vi.fn(async () => ({ noteId: "acp-note", filename: "acp.md" }));
    const notesWrite = vi.fn(async ({ noteId, content }: { noteId: string; content: string }) => ({ noteId, filename: "acp.md", updatedAtMs: 3, content }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.loading": "Loading…", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.addFloatingNote": "Add floating note", "desktop.workbench.openFloatingNote": "Open floating note", "desktop.workbench.floatingNote": "Floating note", "desktop.workbench.floatingNoteClose": "Close floating note", "desktop.workbench.floatingNoteEditor": "Floating note editor", "desktop.workbench.floatingNoteCreating": "Creating floating note…", "desktop.workbench.floatingNoteLoading": "Loading floating note…", "desktop.workbench.floatingNoteSaving": "Saving…", "desktop.workbench.floatingNoteSaved": "Saved", "desktop.workbench.floatingNoteUnsaved": "Unsaved changes", "desktop.workbench.floatingNoteSaveFailed": "Save failed: {0}", "desktop.workbench.floatingNoteLoadError": "Could not open floating note: {0}", "desktop.workbench.floatingNoteLoadFailed": "Could not open floating note.", "desktop.workbench.acpEmptyTitle": "ACP chat", "desktop.workbench.acpEmptyHint": "Send a message", "desktop.workbench.acpInputPlaceholder": "Message", "desktop.workbench.acpConnecting": "Connecting…", "desktop.workbench.acpReady": "Ready", "desktop.workbench.acpError": "Error", "desktop.workbench.acpAttachImage": "Attach image", "desktop.workbench.acpAttachFile": "Attach file", "desktop.workbench.acpSlashCommands": "Commands", "desktop.workbench.acpPermissionTitle": "Permission request", "desktop.workbench.acpQuestionTitle": "Question", "desktop.workbench.acpQuestionSubmit": "Submit", "desktop.workbench.acpQuestionSkip": "Skip", "desktop.workbench.acpMode": "Mode", "desktop.workbench.acpModel": "Model", "desktop.workbench.acpProvider.claude": "Claude Code"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      onAcpStream: () => () => undefined,
      acpConnect: async () => ({ record: { id: "record-1", title: "ACP task", projectPath: "/work/app", provider: "claude", acpSessionId: "native-1", createdAt: 1, updatedAt: 1 }, init: {} }),
      acpDisconnect: async () => ({ ok: true }),
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "chat", id: "record-1", title: "ACP task", projectPath: "/work/app", acpProvider: "claude", updatedAt: 1 }],
      notesList: async () => [],
      notesCreate,
      notesWrite,
      terminalGitStatus: async () => ({ isRepo: false, root: null, staged: [], unstaged: [], nestedRepos: [], tracking: [] }),
      terminalGitFetch: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /ACP task/ }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-acp.active")).toBeTruthy());
    fireEvent.contextMenu(document.querySelector<HTMLElement>(".wb-terminal-tab.is-acp.active")!);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add floating note" }));
    await waitFor(() => expect(notesCreate).toHaveBeenCalledWith({
      scope: "session",
      projectPath: "/work/app",
      provider: "chat",
      sessionId: "record-1"
    }));
  });

  it("switches between session, terminal, and code groups with Cmd+Arrow", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let onWorkbenchCmdArrow: ((direction: "left" | "right" | "up" | "down") => void) | undefined;
    let spawnSeq = 0;
    const terminalGitDiffSides = vi.fn(async () => ({
      oldLabel: "HEAD",
      newLabel: "Working Tree",
      oldText: "old",
      newText: "new",
      hunks: []
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: ARROW_TEST_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onWorkbenchCmdArrow: (callback: (direction: "left" | "right" | "up" | "down") => void) => {
        onWorkbenchCmdArrow = callback;
        return () => undefined;
      },
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex", id: "session-a", title: "Session A", projectPath: "/work/app", updatedAt: 3 },
        { provider: "codex", id: "session-b", title: "Session B", projectPath: "/work/app", updatedAt: 2 }
      ],
      workbenchOpenSession: async ({ id }: { id: string }) => ({
        mode: "xterm",
        command: `codex resume ${id}`,
        cwd: "/work/app"
      }),
      terminalSpawn: async () => ({ id: ++spawnSeq }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalGitStatus: async () => ({
        isRepo: true,
        root: "/work/app",
        staged: [],
        unstaged: [{
          path: "src/a.ts",
          repoPath: "src/a.ts",
          repoRoot: "/work/app",
          status: "M",
          staged: false,
          unstaged: true
        }],
        nestedRepos: [],
        tracking: []
      }),
      terminalGitFetch: async () => ({ ok: true }),
      terminalGitDiffSides,
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    const tabByLabel = (title: string) => [...document.querySelectorAll(".wb-terminal-tab")].find((tab) =>
      tab.querySelector(".wb-terminal-tab-label")?.textContent === title
    );
    fireEvent.click(await screen.findByRole("button", { name: /Session A/ }));
    await waitFor(() => expect(tabByLabel("Session A")).toBeTruthy());
    fireEvent.click(await screen.findByRole("button", { name: /Session B/ }));
    await waitFor(() => expect(tabByLabel("Session B")?.classList.contains("active")).toBe(true));

    act(() => onWorkbenchCmdArrow?.("left"));
    await waitFor(() => expect(tabByLabel("Session A")?.classList.contains("active")).toBe(true));
    act(() => onWorkbenchCmdArrow?.("right"));
    await waitFor(() => expect(tabByLabel("Session B")?.classList.contains("active")).toBe(true));

    fireEvent.click(screen.getAllByRole("button", { name: "Git" })[0]!);
    fireEvent.click(await screen.findByTitle("src/a.ts"));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-diff.active")?.textContent).toContain("a.ts"));

    act(() => onWorkbenchCmdArrow?.("up"));
    await waitFor(() => expect(tabByLabel("Session B")?.classList.contains("active")).toBe(true));
    act(() => onWorkbenchCmdArrow?.("down"));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-diff.active")?.textContent).toContain("a.ts"));

    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-terminal.active")?.textContent).toContain("Terminal 1"));
    act(() => onWorkbenchCmdArrow?.("down"));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-diff.active")?.textContent).toContain("a.ts"));
    act(() => onWorkbenchCmdArrow?.("up"));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-terminal.active")?.textContent).toContain("Terminal 1"));
    act(() => onWorkbenchCmdArrow?.("up"));
    await waitFor(() => expect(tabByLabel("Session B")?.classList.contains("active")).toBe(true));
    act(() => onWorkbenchCmdArrow?.("up"));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-diff.active")?.textContent).toContain("a.ts"));
  });

  it("focuses the session TUI after arrow navigation, including delayed PTY spawn", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let onWorkbenchCmdArrow: ((direction: "left" | "right" | "up" | "down") => void) | undefined;
    let spawnSeq = 0;
    const spawnResolvers = new Map<string, (result: { id: number }) => void>();
    const terminalSpawn = vi.fn(({ command }: { command: string }) => new Promise<{ id: number }>((resolve) => {
      spawnResolvers.set(command, resolve);
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: ARROW_TEST_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onWorkbenchCmdArrow: (callback: (direction: "left" | "right" | "up" | "down") => void) => {
        onWorkbenchCmdArrow = callback;
        return () => undefined;
      },
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex", id: "session-a", title: "Session A", projectPath: "/work/app", updatedAt: 3 },
        { provider: "codex", id: "session-b", title: "Session B", projectPath: "/work/app", updatedAt: 2 }
      ],
      workbenchOpenSession: async ({ id }: { id: string }) => ({
        mode: "xterm",
        command: `codex resume ${id}`,
        cwd: "/work/app"
      }),
      terminalSpawn,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalGitStatus: async () => ({
        isRepo: false,
        root: null,
        staged: [],
        unstaged: [],
        nestedRepos: [],
        tracking: []
      }),
      terminalGitFetch: async () => ({ ok: true }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    const tabByLabel = (title: string) => [...document.querySelectorAll(".wb-terminal-tab")].find((tab) =>
      tab.querySelector(".wb-terminal-tab-label")?.textContent === title
    );
    fireEvent.click(await screen.findByRole("button", { name: /Session A/ }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    await act(async () => spawnResolvers.get("codex resume session-a")!({ id: ++spawnSeq }));
    await waitFor(() => expect(xtermMocks.instances[0]?.focusCalls).toBe(0));

    fireEvent.click(await screen.findByRole("button", { name: /Session B/ }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(2));
    expect(tabByLabel("Session B")?.classList.contains("active")).toBe(true);

    act(() => onWorkbenchCmdArrow?.("left"));
    await waitFor(() => expect(tabByLabel("Session A")?.classList.contains("active")).toBe(true));
    await waitFor(() => expect(xtermMocks.instances[0]?.focusCalls).toBeGreaterThan(0));

    act(() => onWorkbenchCmdArrow?.("right"));
    await waitFor(() => expect(tabByLabel("Session B")?.classList.contains("active")).toBe(true));
    expect(xtermMocks.instances[1]?.focusCalls).toBe(0);

    await act(async () => spawnResolvers.get("codex resume session-b")!({ id: ++spawnSeq }));
    await waitFor(() => expect(xtermMocks.instances[1]?.focusCalls).toBeGreaterThan(0));
  });

  it("focuses the TUI after agent resume, including delayed PTY spawn", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let spawnSeq = 0;
    const spawnResolvers = new Map<string, (result: { id: number }) => void>();
    const terminalSpawn = vi.fn(({ command }: { command: string }) => new Promise<{ id: number }>((resolve) => {
      spawnResolvers.set(command, resolve);
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: ARROW_TEST_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onWorkbenchCmdArrow: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      terminalSpawn,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalGitStatus: async () => ({
        isRepo: false,
        root: null,
        staged: [],
        unstaged: [],
        nestedRepos: [],
        tracking: []
      }),
      terminalGitFetch: async () => ({ ok: true }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    const resume = (id: string) => window.dispatchEvent(new CustomEvent("agent-resume:workbench-resume", {
      detail: { provider: "codex", id, command: `codex resume ${id}`, cwd: "/work/app", title: `Session ${id}` }
    }));

    // New pane: focus is deferred until the PTY spawn resolves.
    await act(async () => resume("session-c"));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    expect(xtermMocks.instances[0]?.focusCalls).toBe(0);
    await act(async () => spawnResolvers.get("codex resume session-c")!({ id: ++spawnSeq }));
    await waitFor(() => expect(xtermMocks.instances[0]?.focusCalls).toBeGreaterThan(0));

    // Existing pane: a second resume focuses the already-open terminal immediately.
    const before = xtermMocks.instances[0]!.focusCalls;
    await act(async () => resume("session-c"));
    await waitFor(() => expect(xtermMocks.instances[0]?.focusCalls).toBeGreaterThan(before));
  });
});
