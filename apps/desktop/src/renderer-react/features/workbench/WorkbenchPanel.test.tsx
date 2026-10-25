import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { WorkbenchPanel } from "./WorkbenchPanel";
import { WB_PATH_DND_MIME } from "./workbenchDnd";
import type { GtdStatus } from "@agent-resume/core";

const notificationMocks = vi.hoisted(() => ({ notifyDesktop: vi.fn() }));
type MockBuffer = {
  type: "normal" | "alternate";
  viewportY: number;
  baseY: number;
  cursorY: number;
  cursorX: number;
  length: number;
  /** Buffer content by absolute line index (used by the TUI redraw scan). */
  lines: string[];
  getLine: (y: number) => { translateToString: () => string } | undefined;
  /** Internal fields mirrored from viewportY/baseY (xterm exposes these on the core buffer only). */
  ydisp: number;
  ybase: number;
};
type MockTerminalInstance = {
  cols: number;
  rows: number;
  options: Record<string, unknown>;
  buffer: { active: MockBuffer; normal: MockBuffer; alternate: MockBuffer };
  customKeyEventHandler: ((event: KeyboardEvent) => boolean) | null;
  focusCalls: number;
  scrollTopCalls: number;
  scrollBottomCalls: number;
  scrollLineCalls: number[];
  scrollLinesCalls: number[];
  scrollPagesCalls: number[];
  wheelDeltas: number[];
  refreshCalls: number;
  _core: { _bufferService: { buffer: MockBuffer } };
  setBuffer: (type: "normal" | "alternate", viewportY: number, baseY: number) => void;
  /** Simulates the user typing into the live TUI. */
  emitData: (data: string) => void;
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
  }),
  // The diff pane mounts the pool provider; the mock only has to pass through.
  WorkerPoolContextProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>
}));

vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80;
  rows = 24;
  options: Record<string, unknown>;
  unicode = { activeVersion: "6" };
  refreshCalls = 0;
  /** Mirrors the runtime layout: the public `buffer.active` view and xterm's
   *  internal `_core._bufferService.buffer` share one object per buffer. */
  _core: { _bufferService: { buffer: MockBuffer } };
  private normalBuffer: MockBuffer = {
    type: "normal", baseY: 0, cursorY: 0, cursorX: 0, length: 24,
    lines: [], ydisp: 0, ybase: 0,
    /** xterm's viewportY is a getter over the internal ydisp; mirror that so a
     *  viewport moved through the core buffer is visible on the public view. */
    get viewportY() { return this.ydisp; },
    set viewportY(value: number) { this.ydisp = value; },
    getLine: (y) => {
      const text = this.normalBuffer.lines[y];
      return text === undefined ? undefined : { translateToString: () => text };
    }
  };
  private alternateBuffer: MockBuffer = {
    type: "alternate", baseY: 0, cursorY: 0, cursorX: 0, length: 24,
    lines: [], ydisp: 0, ybase: 0,
    get viewportY() { return this.ydisp; },
    set viewportY(value: number) { this.ydisp = value; },
    getLine: (y) => {
      const text = this.alternateBuffer.lines[y];
      return text === undefined ? undefined : { translateToString: () => text };
    }
  };
  private dataListeners = new Set<(data: string) => void>();
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
  customKeyEventHandler: ((event: KeyboardEvent) => boolean) | null = null;
  scrollTopCalls = 0;
  scrollBottomCalls = 0;
  scrollLineCalls: number[] = [];
  scrollLinesCalls: number[] = [];
  scrollPagesCalls: number[] = [];
  wheelDeltas: number[] = [];
  constructor(options: Record<string, unknown>) {
    this.options = options;
    this._core = { _bufferService: { buffer: this.normalBuffer } };
    xtermMocks.instances.push(this);
  }
  loadAddon(addon: { activate?: (terminal: unknown) => void }) { addon.activate?.(this); }
  open(host: HTMLElement) {
    const root = document.createElement("div");
    root.className = "xterm";
    const viewport = document.createElement("div");
    viewport.className = "xterm-viewport";
    const screen = document.createElement("div");
    screen.className = "xterm-screen";
    root.append(viewport, screen);
    host.append(root);
    viewport.addEventListener("wheel", (event) => this.wheelDeltas.push(event.deltaY));
  }
  focus() { this.focusCalls += 1; }
  write() { this.writeListeners.forEach((listener) => listener()); }
  getSelection() { return ""; }
  clearTextureAtlas() {}
  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener);
    return { dispose: () => { this.dataListeners.delete(listener); } };
  }
  emitData(data: string) { this.dataListeners.forEach((listener) => listener(data)); }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
    this.customKeyEventHandler = handler;
  }
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
  scrollLines(amount: number) { this.scrollLinesCalls.push(amount); }
  scrollPages(amount: number) { this.scrollPagesCalls.push(amount); }
  scrollToLine(line: number) { this.scrollLineCalls.push(line); }
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
    target.ydisp = viewportY;
    target.ybase = baseY;
    this.buffer.active = target;
    if (type === "normal") this._core._bufferService.buffer = target;
    this.bufferListeners.forEach((listener) => listener(target));
    this.scrollListeners.forEach((listener) => listener(viewportY));
  }
  refresh() { this.refreshCalls += 1; }
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

const contextMenuShow = vi.fn(async (_args: { x: number; y: number; items: Array<{ id?: string; label?: string }> }): Promise<string | null> => null);
const chooseContextMenuItem = (label: string) => {
  contextMenuShow.mockImplementationOnce(async (args) => args.items.find((item) => item.label === label)?.id ?? null);
};

beforeEach(() => {
  localStorage.setItem("workbench-sidebar-view-v2", "workitems");
  // AppChrome hosts per-tab toolbars in the app header; mirror that DOM here.
  const headerSlot = document.createElement("div");
  headerSlot.id = "app-header-slot";
  document.body.append(headerSlot);
  let currentApi: unknown;
  Object.defineProperty(window, "agentResume", {
    configurable: true,
    get() {
      return currentApi as typeof window.agentResume;
    },
    set(value: unknown) {
      const api = value as {
        querySessionsPage?: unknown;
        listSessions?: () => Promise<Array<{
          provider: string;
          id: string;
          title: string;
          projectPath: string;
          projectId?: string;
          updatedAt: number;
        }>>;
      } | null;
      if (api && typeof api.querySessionsPage !== "function" && typeof api.listSessions === "function") {
        currentApi = {
          ...api,
          querySessionsPage: querySessionsPageFromList(api.listSessions)
        };
        return;
      }
      currentApi = value;
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  notificationMocks.notifyDesktop.mockClear();
  contextMenuShow.mockImplementation(async () => null);
  xtermMocks.instances.length = 0;
  xtermMocks.resizeObservers.length = 0;
  xtermMocks.fitDimensions = { cols: 80, rows: 24 };
  document.getElementById("react-workbench")?.remove();
  document.getElementById("app-header-slot")?.remove();
  localStorage.removeItem("workbench-sidebar-view-v2");
  localStorage.removeItem("workbench-selected-project");
  localStorage.removeItem("workbench-quick-access-project");
  // Per-workbench UI state is stored as `<key>` or `<key>:<workbenchId>`; clear
  // both shapes so a test that toggles one cannot leak into the next.
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("wb-diff-session-alongside")) localStorage.removeItem(key);
  }
  Reflect.deleteProperty(window, "agentResume");
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
  "desktop.workbench.tasksView": "Tasks",
  "desktop.workbench.taskNoProject": "No project yet",
  "desktop.workbench.resourceView": "Repository",
  "desktop.workbench.filterTasks": "Filter tasks",
  "desktop.workbench.noTasks": "No tasks yet",
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
  "desktop.workbench.terminalTabs": "Terminal tabs",
  "desktop.workbench.sidePanelTranscript": "Transcript",
  "desktop.workbench.transcriptOutline": "Turns",
  "desktop.workbench.transcriptSearchPlaceholder": "Search this conversation",
  "desktop.workbench.transcriptNeedSession": "Open a session",
  "desktop.workbench.transcriptNoMatches": "No matching turns",
  "desktop.workbench.transcriptRoleUser": "User",
  "desktop.workbench.transcriptRoleAssistant": "Assistant",
  "desktop.workbench.transcriptShowMarkdown": "Show Markdown preview",
  "desktop.workbench.transcriptShowOriginal": "Show original text",
  "desktop.workbench.transcriptThinking": "Thinking",
  "desktop.common.loadingPreview": "Loading preview…",
  "desktop.sessions.noMessages": "No messages",
  "desktop.sessions.truncated": "(truncated)",
  "desktop.workbench.terminalComposerPlaceholder": "Type a command for the agent…",
  "desktop.workbench.terminalComposerHint": "Click to type a command.",
  "desktop.workbench.terminalComposerSend": "Send to terminal",
  "desktop.workbench.terminalComposerSuggestions": "Command suggestions",
  "desktop.workbench.terminalComposerDropHint": "Drop to insert path",
  "desktop.workbench.terminalComposerHintLine": "Enter pastes",
  "desktop.workbench.terminalComposerMove": "Move input box",
  "desktop.workbench.terminalComposerClose": "Close session",
  "desktop.workbench.terminalComposerTips": "Sent messages",
  "desktop.workbench.terminalComposerSlashSuggestions": "Slash commands",
  "desktop.workbench.tuiSlash.help": "Show TUI commands",
  "desktop.workbench.tuiSlash.clear": "Clear the conversation",
  "desktop.workbench.tuiSlash.compact": "Compact context",
  "desktop.workbench.tuiSlash.model": "Switch model",
  "desktop.workbench.tuiSlash.new": "Start a new session",
  "desktop.workbench.tuiSlash.quit": "Quit the agent",
  "desktop.workbench.tuiSlash.exit": "Exit the agent",
  "desktop.workbench.tuiSlash.review": "Review changes",
  "desktop.workbench.tuiSlash.undo": "Undo last change",
  "desktop.workbench.tuiSlash.redo": "Redo last change",
  "desktop.workbench.tuiSlash.resume": "Resume a session",
  "desktop.workbench.tuiSlash.tokens": "Show token usage",
  "desktop.workbench.tuiSlash.init": "Initialize project files",
  "desktop.workbench.tuiSlash.share": "Share this session",
  "desktop.workbench.tuiSlash.permissions": "Permission settings",
  "desktop.workbench.resizeSidePanel": "Resize side panel",
  "desktop.workbench.terminalConsole": "Terminal Console",
  "desktop.common.collapse": "Collapse",
  "desktop.common.expand": "Expand"
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

function querySessionsPageFromList(
  listSessions: () => Promise<Array<{
    provider: string;
    id: string;
    title: string;
    projectPath: string;
    projectId?: string;
    updatedAt: number;
  }>>
) {
  return async (args?: { keys?: Array<{ provider: string; id: string }>; projectPath?: string; projectId?: string }) => {
    let sessions = await listSessions();
    if (args?.projectId) {
      // Production filters by project_id. Tests often omit projectId on fixtures,
      // so keep those rows and only drop an explicit mismatch.
      sessions = sessions.filter((session) => session.projectId == null || session.projectId === args.projectId);
    } else if (args?.projectPath) sessions = sessions.filter((session) => session.projectPath === args.projectPath);
    if (args?.keys) {
      const keys = new Set(args.keys.map((key) => `${key.provider}:${key.id}`));
      sessions = sessions.filter((session) => keys.has(`${session.provider}:${session.id}`));
    }
    return { sessions, total: sessions.length };
  };
}

/** Opens a text file as a Workbench editor tab via the Quick Access (⌘P) file picker. */
function setupWorkbenchEditorTest(filePath: string, content: string): { openQuickFiles: () => void } {
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
  const workbenchSearchPaths = vi.fn(async () => ({
    files: [{
      path: filePath,
      relativePath: filePath.split("/").at(-1) || filePath,
      kind: "file" as const
    }],
    truncated: false,
    engine: "rg" as const
  }));
  const workbenchInspectFile = vi.fn(async () => ({
    kind: "text" as const,
    content,
    encoding: "utf8" as const,
    version: "v1",
    size: content.length,
    mtimeMs: 1
  }));
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
      "desktop.notes.filterProjects": "Filter projects",
      "desktop.notes.projectFilter": "Project filter",
      "desktop.common.search": "Search",
      "desktop.common.all": "All",
      "desktop.common.active": "Active",
      "desktop.common.pinned": "Pinned",
      "desktop.common.close": "Close",
      "desktop.common.refresh": "Refresh",
      "desktop.common.save": "Save",
      "desktop.common.edit": "Edit",
      "desktop.workbench.allSessions": "All sessions",
      "desktop.workbench.noSessionsInProject": "No sessions",
      "desktop.workbench.noProjects": "No projects",
      "desktop.workbench.sidePanelExplorer": "Explorer",
      "desktop.workbench.sidePanelGit": "Git",
      "desktop.workbench.newTerminal": "New terminal",
      "desktop.workbench.newSession": "New session",
      "desktop.workbench.selectSessionHint": "Select a session",
      "desktop.workbench.selectProjectHint": "Select a project",
      "desktop.workbench.closeFile": "Close file",
      "desktop.workbench.preview": "Preview",
      "desktop.workbench.fileSaved": "Saved",
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
    workbenchInspectFile
  } as unknown as typeof window.agentResume;
  render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
  return { openQuickFiles };
}

const PATH_DND_MESSAGES: Record<string, string> = {
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
  "desktop.workbench.sidePanelTranscript": "Transcript",
  "desktop.workbench.newTerminal": "New terminal",
  "desktop.workbench.newSession": "New session",
  "desktop.workbench.selectSessionHint": "Select a session",
  "desktop.workbench.selectProjectHint": "Select a project",
  "desktop.workbench.externalTerminalHint": "Opened externally",
  "desktop.workbench.terminalLabel": "Terminal {0}",
  "desktop.workbench.closeTerminal": "Close terminal",
  "desktop.workbench.terminalTabs": "Terminal tabs"
};

type PathDataTransfer = {
  types: string[];
  dropEffect: string;
  effectAllowed: string;
  setData: (type: string, value: string) => void;
  getData: (type: string) => string;
};

/** Minimal DataTransfer stand-in with the same shape the renderer expects. */
function createPathDataTransfer(init?: { types?: string[]; path?: string; mime?: string }): PathDataTransfer {
  const values = new Map<string, string>();
  const types: string[] = [...(init?.types || [])];
  if (init?.path) values.set(init.mime || WB_PATH_DND_MIME, init.path);
  return {
    types,
    dropEffect: "none",
    effectAllowed: "none",
    setData(type, value) {
      values.set(type, value);
      if (!types.includes(type)) types.push(type);
    },
    getData(type) {
      return values.get(type) || "";
    }
  };
}

async function activateTaskDirectory(path = "/work/app", extra: {
  noteId?: string;
  title?: string;
  sessions?: string[];
  projects?: string[];
} = {}): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", {
      detail: {
        noteId: extra.noteId ?? "wi-test",
        title: extra.title ?? "Test task",
        status: "next",
        // Omit sessions unless the test wants a scoped list: an empty array
        // hides every catalog session from the middle pane.
        ...(extra.sessions ? { sessions: extra.sessions } : {}),
        projects: extra.projects ?? [path],
        primaryProject: path
      }
    }));
  });
}

/** The neutral workspace a multi-repo task launches its sessions from. */
const WORKSPACE_CWD = "/Users/lucas/.agent-resume-panel/.desktop/workspaces/wi-multi";

describe("WorkbenchPanel", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(workbenchOpenSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1" }));
  });

  it("activates the assigned project when resuming a moved session", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    // Session was moved: assigned project /work/docs, native cwd /work/app.
    const workbenchOpenSession = vi.fn(async () => ({
      mode: "embedded",
      cwd: "/work/app",
      command: "codex resume --cd /work/app session-1"
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.close": "Close", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.resumeCommandMissing": "Could not build a resume command", "desktop.workbench.pathMissingHint": "Local folder not found on this machine"
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
        { provider: "codex" as const, id: "session-1", title: "Moved work", projectPath: "/work/docs", nativeProjectPath: "/work/app", projectOverridden: true, updatedAt: 2 },
        { provider: "claude" as const, id: "session-2", title: "Docs work", projectPath: "/work/docs", updatedAt: 1 }
      ],
      listProjects: async () => [
        { projectId: "project-1", portableKey: "/work/app", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/app", pathMissing: false, sessionCount: 1 },
        { projectId: "project-2", portableKey: "/work/docs", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/docs", pathMissing: false, sessionCount: 1 }
      ],
      listWorkbenchSessionFolders: async () => ({ folders: [], assignments: [] }),
      terminalSpawn: async () => ({ id: 1 }),
      terminalDestroy: async () => ({ ok: true }),
      workbenchOpenSession
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/docs");
    const moved = await screen.findByRole("button", { name: /Moved work/ });
    fireEvent.click(moved);
    await waitFor(() => expect(workbenchOpenSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1" }));
    expect(document.querySelector(".wb-detail-project-path")?.textContent).toBe("/work/docs");
  });

  it("moves a session to a task from the context menu", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const sessions = [
      { provider: "codex" as const, id: "session-1", title: "App work", projectPath: "/work/app", projectId: "project-1", updatedAt: 2 },
      { provider: "codex" as const, id: "session-2", title: "Docs work", projectPath: "/work/docs", projectId: "project-2", updatedAt: 1 }
    ];
    const notesLinkSessionToTask = vi.fn(async () => ({ noteId: "task-1" }));
    const listSessions = vi.fn(async () => sessions);
    const listProjects = vi.fn(async () => [
      { projectId: "project-1", portableKey: "/work/app", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/app", pathMissing: false, sessionCount: sessions.filter((item) => item.projectId === "project-1").length },
      { projectId: "project-2", portableKey: "/work/docs", alias: "Docs", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/docs", pathMissing: false, sessionCount: sessions.filter((item) => item.projectId === "project-2").length }
    ]);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        ...FOLDER_DRAG_TEST_MESSAGES,
        "desktop.workbench.moveToTask": "Move to task…",
        "desktop.workbench.moveToTaskTitle": "Move session {0} to…",
        "desktop.workbench.moveToTaskHint": "Reassigns this session to a task in the panel.",
        "desktop.workbench.moveToTaskRunning": "Moving…",
        "desktop.workbench.moveToTaskDone": "Moved session to {0}."
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
      querySessionsPage: querySessionsPageFromList(listSessions),
      listProjects,
      listWorkbenchSessionFolders: async () => ({ folders: [], assignments: [] }),
      notesListTasks: async () => [
        { noteId: "task-1", scope: "library", filename: "task-1.md", relDir: "", relMdPath: "task-1.md", title: "Ship the release", createdAtMs: 1, updatedAtMs: 1, work: { sessions: [] } }
      ],
      notesLinkSessionToTask,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.contextMenu(await screen.findByRole("button", { name: /App work/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move to task…" }));
    const dialog = await screen.findByRole("dialog", { name: "Move to task…" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Ship the release/ }));
    await waitFor(() => expect(notesLinkSessionToTask).toHaveBeenCalledWith({
      noteId: "task-1",
      sessionKey: "codex:session-1",
      projectPath: "/work/app"
    }));
  });

  it("shows an error when there is no task to move into", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const notesLinkSessionToTask = vi.fn();
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        ...FOLDER_DRAG_TEST_MESSAGES,
        "desktop.workbench.moveToTask": "Move to task…",
        "desktop.workbench.moveToTaskNoTargets": "No tasks available to move into."
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
        { provider: "codex" as const, id: "session-1", title: "App work", projectPath: "/work/app", projectId: "project-1", updatedAt: 1 }
      ],
      querySessionsPage: querySessionsPageFromList(async () => [
        { provider: "codex" as const, id: "session-1", title: "App work", projectPath: "/work/app", projectId: "project-1", updatedAt: 1 }
      ]),
      listProjects: async () => [
        { projectId: "project-1", portableKey: "/work/app", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/app", pathMissing: false, sessionCount: 1 }
      ],
      listWorkbenchSessionFolders: async () => ({ folders: [], assignments: [] }),
      notesListTasks: async () => [],
      notesLinkSessionToTask,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.contextMenu(await screen.findByRole("button", { name: /App work/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move to task…" }));
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenCalledWith({ text: "No tasks available to move into.", kind: "error" }));
    expect(notesLinkSessionToTask).not.toHaveBeenCalled();
  });

  it("opens develop-equivalent project and session context actions", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchNewSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/app" }));
    const onPreview = vi.fn();
    window.addEventListener("agent-resume:workbench-open-session", onPreview);
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
      workbenchNewSession,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    fireEvent.click(await waitFor(() => document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement));
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith({
      cwd: "/work/app",
      provider: "codex",
      executionMode: "standard",
      taskNoteId: "wi-test"
    }));

    fireEvent.contextMenu(screen.getByRole("button", { name: /Fix renderer/ }));
    await screen.findByRole("menuitem", { name: "Preview" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Preview" }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    window.removeEventListener("agent-resume:workbench-open-session", onPreview);
  });

  it("opens a Thunder visual chat pane for the thunder:visual new-session target", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchNewSession = vi.fn(async () => ({ mode: "xterm", command: "thunder-tui", cwd: "/work/app" }));
    const acpCreateSession = vi.fn();
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.newSession": "New session",
        "desktop.workbench.thunderChat": "Thunder Chat",
        "desktop.workbench.closeThunderChat": "Close Thunder chat",
        "desktop.workbench.selectSessionHint": "Select a session",
        "desktop.workbench.selectProjectHint": "Select a project",
        "desktop.common.loading": "Loading…"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionTarget: "thunder:visual" } }),
      listSessions: async () => [],
      workbenchNewSession,
      acpCreateSession,
      thunderGetStatus: async () => ({ available: true, repoPath: "/thunder", daemonPath: "/thunder/daemon", tuiPath: "/thunder/tui", models: [] }),
      thunderChatListConversations: async () => [],
      thunderChatGetConversation: async () => null,
      thunderChatGetActiveStream: async () => null,
      thunderChatGetTrace: async () => null,
      onThunderChatEvent: () => () => undefined,
      onThunderModelsChanged: () => () => undefined,
      onThunderModeChanged: () => () => undefined,
      thunderChatGetPermissionState: async () => ({ mode: "yolo" }),
      thunderChatSetMode: async () => ({ mode: "yolo" }),
      thunderChatAnswerUi: async () => true,
      notesRead: async () => ({ record: { work: { projects: [] } }, content: "" }),
      notesListTasks: async () => [],
      notesLinkSessionToTask: vi.fn(async () => ({}))
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    fireEvent.click(await waitFor(() => document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-thunder")).toBeTruthy());
    expect(workbenchNewSession).not.toHaveBeenCalled();
    expect(acpCreateSession).not.toHaveBeenCalled();
  });

  it("launches the Thunder TUI through workbenchNewSession for cli:thunder", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchNewSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/app", external: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.newSession": "New session",
        "desktop.workbench.newSessionTitle": "New session {0}",
        "desktop.workbench.selectSessionHint": "Select a session",
        "desktop.workbench.selectProjectHint": "Select a project",
        "desktop.common.loading": "Loading…"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionTarget: "cli:thunder" } }),
      listSessions: async () => [],
      workbenchNewSession,
      notesRead: async () => ({ record: { work: { projects: [] } }, content: "" }),
      notesListTasks: async () => []
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    fireEvent.click(await waitFor(() => document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement));
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith({
      cwd: "/work/app",
      provider: "thunder",
      executionMode: "standard",
      taskNoteId: "wi-test"
    }));
  });

  it("lists a Thunder conversation and opens it as a visual pane", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.newSession": "New session",
        "desktop.workbench.thunderChat": "Thunder Chat",
        "desktop.workbench.closeThunderChat": "Close Thunder chat",
        "desktop.workbench.openThunderChat": "Open as visual chat",
        "desktop.workbench.resumeThunderTui": "Resume in Thunder TUI",
        "desktop.workbench.selectSessionHint": "Select a session",
        "desktop.workbench.selectProjectHint": "Select a project",
        "desktop.common.loading": "Loading…"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      contextMenuShow,
      workbenchNewSession: vi.fn(async () => ({ mode: "external-system", cwd: "/work/app", external: true })),
      thunderGetStatus: async () => ({ available: true, repoPath: "/thunder", daemonPath: "/thunder/daemon", tuiPath: "/thunder/tui", models: [] }),
      thunderChatListConversations: async () => [{
        id: "sess_external",
        title: "Earlier Thunder chat",
        workspace: "/work/app",
        status: "active",
        message_count: 2,
        turn_count: 1,
        total_tokens: 5,
        created_at_ms: Date.now() - 1000,
        updated_at_ms: Date.now() - 500
      }],
      thunderChatGetConversation: async () => ({
        id: "sess_external",
        title: "Earlier Thunder chat",
        workspace: "/work/app",
        status: "active",
        messages: [],
        created_at_ms: 0,
        updated_at_ms: 0
      }),
      thunderChatGetActiveStream: async () => null,
      thunderChatGetTrace: async () => null,
      onThunderChatEvent: () => () => undefined,
      onThunderModelsChanged: () => () => undefined,
      onThunderModeChanged: () => () => undefined,
      thunderChatGetPermissionState: async () => ({ mode: "yolo" }),
      thunderChatSetMode: async () => ({ mode: "yolo" }),
      thunderChatAnswerUi: async () => true,
      notesRead: async () => ({ record: { work: { projects: [] } }, content: "" }),
      notesListTasks: async () => []
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    const row = await screen.findByText("Earlier Thunder chat");
    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-thunder")).toBeTruthy());

    // The row context menu can resume the same conversation in the native TUI.
    fireEvent.contextMenu(document.querySelector(".wb-list-item") as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Resume in Thunder TUI" }));
    await waitFor(() => expect(window.agentResume.workbenchNewSession).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/work/app",
      provider: "thunder",
      resumeSessionId: "sess_external"
    })));
  });

  const thunderConversation = (overrides: Record<string, unknown> = {}) => ({
    id: "sess_external",
    title: "Earlier Thunder chat",
    workspace: "/work/app",
    status: "active",
    message_count: 2,
    turn_count: 1,
    total_tokens: 5,
    created_at_ms: Date.now() - 1000,
    updated_at_ms: Date.now() - 500,
    ...overrides
  });

  /** Thunder rows need the full visual-chat stub set, even when a test never opens one. */
  const thunderWorkbenchApi = (overrides: Record<string, unknown> = {}) => ({
    getI18nBundle: async () => ({ locale: "en", messages: {
      "desktop.workbench.newSession": "New session",
      "desktop.workbench.thunderChat": "Thunder Chat",
      "desktop.workbench.openThunderChat": "Open as visual chat",
      "desktop.workbench.resumeThunderTui": "Resume in Thunder TUI",
      "desktop.workbench.preview": "Preview",
      "desktop.workbench.mountNote": "Mount note",
      "desktop.workbench.addFloatingNote": "Add floating note",
      "desktop.workbench.openFloatingNote": "Open floating note",
      "desktop.workbench.autoRename": "Auto rename",
      "desktop.workbench.moveToTask": "Move to task",
      "desktop.workbench.removeFromPanel": "Remove from panel",
      "desktop.workbench.setGtdStatus": "Set GTD status",
      "desktop.workbench.clearGtdStatus": "Clear GTD status",
      "desktop.workbench.gtdStatusLabel": "GTD status: {0}",
      "desktop.workbench.gtdStatusSaveFailed": "Save failed: {0}",
      "desktop.workbench.gtdStatus.inbox": "To do",
      "desktop.workbench.gtdStatus.next": "In progress",
      "desktop.workbench.gtdStatus.waiting": "Waiting",
      "desktop.workbench.gtdStatus.done": "Done",
      "desktop.workbench.deleteThunderConversation": "Delete Thunder conversation",
      "desktop.workbench.deleteThunderConversationConfirm": "Delete Thunder conversation \"{0}\"?",
      "desktop.workbench.listMetaSearch": "{0} · search \"{1}\" · {2} sessions",
      "desktop.workbench.selectSessionHint": "Select a session",
      "desktop.workbench.selectProjectHint": "Select a project",
      "desktop.gtd.unmarked": "Unmarked",
      "desktop.gtd.unmarkedHint": "No GTD status",
      "desktop.common.delete": "Delete",
      "desktop.common.loading": "Loading…"
    } }),
    onLocaleChanged: () => () => undefined,
    onWorkbenchCmdT: () => () => undefined,
    onWorkbenchCmdW: () => () => undefined,
    onTerminalData: () => () => undefined,
    onTerminalExit: () => () => undefined,
    onTerminalRespawned: () => () => undefined,
    listProjectAliases: async () => ({}),
    getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
    listSessions: async () => [],
    contextMenuShow,
    workbenchNewSession: vi.fn(async () => ({ mode: "external-system", cwd: "/work/app", external: true })),
    thunderGetStatus: async () => ({ available: true, repoPath: "/thunder", daemonPath: "/thunder/daemon", tuiPath: "/thunder/tui", models: [] }),
    thunderChatListConversations: async () => [thunderConversation()],
    thunderChatGetConversation: async () => ({ ...thunderConversation(), messages: [] }),
    thunderChatGetActiveStream: async () => null,
    thunderChatGetTrace: async () => null,
    onThunderChatEvent: () => () => undefined,
    onThunderModelsChanged: () => () => undefined,
    onThunderModeChanged: () => () => undefined,
    thunderChatGetPermissionState: async () => ({ mode: "yolo" }),
    thunderChatSetMode: async () => ({ mode: "yolo" }),
    thunderChatAnswerUi: async () => true,
    notesRead: async () => ({ record: { work: { projects: [] } }, content: "" }),
    notesListTasks: async () => [],
    ...overrides
  } as unknown as typeof window.agentResume);

  it("interleaves Thunder conversations with catalog sessions by recency", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const now = Date.now();
    const catalogSession = (id: string, title: string, updatedAt: number) => ({
      provider: "codex" as const,
      id,
      title,
      projectPath: "/work/app",
      updatedAt
    });
    window.agentResume = thunderWorkbenchApi({
      listSessions: async () => [
        catalogSession("s-old", "Older catalog session", now - 3000),
        catalogSession("s-new", "Newer catalog session", now - 1000)
      ],
      thunderChatListConversations: async () => [
        thunderConversation({ id: "t-mid", title: "Thunder in between", updated_at_ms: now - 2000 }),
        thunderConversation({ id: "t-old", title: "Oldest Thunder chat", updated_at_ms: now - 4000 })
      ]
    });

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");

    // One timeline, not catalog-then-Thunder: a conversation touched between the
    // two sessions sorts between them, and the stalest row of either store sinks.
    await waitFor(() => expect(document.querySelectorAll(".wb-list-item-title")).toHaveLength(4));
    expect([...document.querySelectorAll(".wb-list-item-title")].map((item) => item.textContent)).toEqual([
      "Newer catalog session",
      "Thunder in between",
      "Older catalog session",
      "Oldest Thunder chat"
    ]);
  });

  it("counts Thunder rows in the list meta line", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const catalogSession = (id: string, updatedAt: number) => ({
      provider: "codex" as const,
      id,
      title: id,
      projectPath: "/work/app",
      updatedAt
    });
    window.agentResume = thunderWorkbenchApi({
      listSessions: async () => [catalogSession("s-1", 2), catalogSession("s-2", 1)],
      thunderChatListConversations: async () => [
        thunderConversation({ id: "t-1", title: "Thunder one" }),
        thunderConversation({ id: "t-2", title: "Thunder two" }),
        thunderConversation({ id: "t-3", title: "Thunder three" })
      ]
    });

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");

    // Both halves count every row the list can hold, Thunder included — a count
    // that stopped at the catalog read "2 / 2" above five rows.
    await waitFor(() => expect(document.querySelectorAll(".wb-list-item-title")).toHaveLength(5));
    expect(document.querySelector(".wb-list-meta")?.textContent).toBe("5 / 5");

    // Search narrows the numerator and leaves the denominator whole.
    fireEvent.change(document.querySelector(".wb-note-search") as HTMLInputElement, { target: { value: "Thunder two" } });
    await waitFor(() => expect(document.querySelectorAll(".wb-list-item-title")).toHaveLength(1));
    expect(document.querySelector(".wb-list-meta")?.textContent).toBe("Test task · search \"Thunder two\" · 1 sessions");
  });

  it("scopes Thunder rows to the task's own links, not shared project roots", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    window.agentResume = thunderWorkbenchApi({
      thunderChatListConversations: async () => [
        // Started by the task that previously owned /work/app (now archived):
        // nothing links it to this task, so it must not surface here.
        thunderConversation({ id: "old-chat", title: "Archived task chat", workspace: "/work/app" }),
        // A chat that merely shares a directory with the task is not linked either.
        thunderConversation({ id: "workspace-chat", title: "Task workspace chat", workspace: "/work/tasks/wi-new" }),
        // Explicitly linked from a pane, even though its cwd is elsewhere.
        thunderConversation({ id: "linked-chat", title: "Linked chat", workspace: "/elsewhere" })
      ]
    });

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app", { noteId: "wi-new", sessions: ["thunder:linked-chat"] });

    await screen.findByText("Linked chat");
    await waitFor(() => expect(screen.queryByText("Archived task chat")).toBeNull());
    await waitFor(() => expect(screen.queryByText("Task workspace chat")).toBeNull());
  });

  it("gives a Thunder row the overlay session menu plus its two Thunder actions", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    window.agentResume = thunderWorkbenchApi();

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");

    const row = await screen.findByRole("button", { name: /Earlier Thunder chat/ });
    fireEvent.contextMenu(row);

    // The catalog sessions' menu, rendered as the same overlay (not a native NSMenu).
    const openAsChat = await screen.findByRole("menuitem", { name: "Open as visual chat" });
    expect(openAsChat.closest(".wb-session-context-menu")).toBeTruthy();
    for (const label of ["Resume in Thunder TUI", "Add floating note", "Mount note", "Auto rename", "Move to task", "Delete Thunder conversation"]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("menuitemradio", { name: "Waiting" })).toBeTruthy();
    // Neither has a Thunder equivalent: no transcript preview, and no catalog hide.
    expect(screen.queryByRole("menuitem", { name: "Preview" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Remove from panel" })).toBeNull();
  });

  it("shows and sets a Thunder row's GTD status", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const setSessionGtdStatus = vi.fn(async () => ({ ok: true }));
    window.agentResume = thunderWorkbenchApi({
      listSessionGtdStatuses: async () => ({ "thunder:sess_external": "next" }),
      setSessionGtdStatus
    });

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");

    const row = await screen.findByRole("button", { name: /Earlier Thunder chat/ });
    await waitFor(() => expect(row.querySelector(".wb-gtd-status-badge")?.textContent).toBe("In progress"));

    fireEvent.contextMenu(row);
    const waitingTag = await screen.findByRole("menuitemradio", { name: "Waiting" });
    expect(waitingTag.classList.contains("wb-gtd-context-tag")).toBe(true);
    fireEvent.click(waitingTag);
    await waitFor(() => expect(setSessionGtdStatus).toHaveBeenCalledWith({ provider: "thunder", id: "sess_external", status: "waiting" }));
    expect(row.querySelector(".wb-gtd-status-badge")?.textContent).toBe("Waiting");
  });

  it("deletes a Thunder conversation from the row menu, closing its visual pane", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const conversations = [thunderConversation()];
    // A fresh array per call: the panel stores the list as state, and reusing the
    // reference would let React bail out of the re-render after the delete.
    const thunderChatListConversations = vi.fn(async () => [...conversations]);
    const thunderChatDeleteConversation = vi.fn(async () => {
      conversations.length = 0;
      return true;
    });
    window.agentResume = thunderWorkbenchApi({
      thunderChatListConversations,
      thunderChatDeleteConversation
    });

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");

    const row = await screen.findByRole("button", { name: /Earlier Thunder chat/ });
    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-thunder")).toBeTruthy());
    const listCallsBeforeDelete = thunderChatListConversations.mock.calls.length;

    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Thunder conversation" }));

    await waitFor(() => expect(thunderChatDeleteConversation).toHaveBeenCalledWith({ sessionId: "sess_external" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Earlier Thunder chat"));
    // The pane and the row both go: neither may point at a conversation that is gone.
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-thunder")).toBeNull());
    expect(thunderChatListConversations.mock.calls.length).toBeGreaterThan(listCallsBeforeDelete);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Earlier Thunder chat/ })).toBeNull());
    confirm.mockRestore();
  });

  it("binds a Thunder TUI pane to its conversation, resuming by id and discovering a fresh one", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let conversations: Array<Record<string, unknown>> = [{
      id: "sess_external",
      title: "Earlier Thunder chat",
      workspace: "/work/app",
      status: "active",
      message_count: 2,
      turn_count: 1,
      total_tokens: 5,
      created_at_ms: Date.now() - 1000,
      updated_at_ms: Date.now() - 500
    }];
    const previewSession = vi.fn(async ({ id }: { id: string }) => ({
      session: { provider: "thunder", id, title: id, projectPath: "/work/app", updatedAt: 1 },
      preview: { title: id, messages: [] }
    }));
    const workbenchNewSession = vi.fn(async (args: { resumeSessionId?: string }) => ({
      mode: "xterm",
      command: args.resumeSessionId ? `/thunder/tui --session ${args.resumeSessionId}` : "/thunder/tui",
      cwd: "/work/app"
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.newSession": "New session",
        "desktop.workbench.thunderChat": "Thunder Chat",
        "desktop.workbench.openThunderChat": "Open as visual chat",
        "desktop.workbench.resumeThunderTui": "Resume in Thunder TUI",
        "desktop.workbench.splitViewMode": "Split View",
        "desktop.workbench.selectSessionHint": "Select a session",
        "desktop.workbench.selectProjectHint": "Select a project",
        "desktop.workbench.newSessionTitle": "New session {0}",
        "desktop.sessions.noMessages": "No messages"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionTarget: "cli:thunder" } }),
      listSessions: async () => [],
      contextMenuShow,
      workbenchNewSession,
      previewSession,
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true }),
      thunderGetStatus: async () => ({ available: true, repoPath: "/thunder", daemonPath: "/thunder/daemon", tuiPath: "/thunder/tui", models: [] }),
      thunderChatListConversations: async () => conversations,
      notesRead: async () => ({ record: { work: { projects: [] } }, content: "" }),
      notesListTasks: async () => []
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    await screen.findByText("Earlier Thunder chat");

    // Resuming from the row's context menu knows the conversation up front.
    fireEvent.contextMenu(document.querySelector(".wb-list-item") as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Resume in Thunder TUI" }));
    await waitFor(() => expect(previewSession).toHaveBeenCalledWith({ provider: "thunder", id: "sess_external" }));

    // A fresh TUI mints its conversation in-process: the pane starts fullscreen
    // with nothing to observe, and binds once the conversation shows up.
    previewSession.mockClear();
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith(expect.objectContaining({ provider: "thunder" })));
    await waitFor(() => expect(document.querySelector(".wb-terminal-fullscreen-bar")).not.toBeNull());

    conversations = [
      ...conversations,
      {
        id: "sess_new",
        title: "Fresh Thunder chat",
        workspace: "/work/app",
        status: "active",
        message_count: 2,
        turn_count: 1,
        total_tokens: 5,
        created_at_ms: Date.now(),
        updated_at_ms: Date.now()
      }
    ];
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    fireEvent.click(document.querySelector(".wb-terminal-mode-toggle-btn") as HTMLButtonElement);
    await waitFor(() => expect(previewSession).toHaveBeenCalledWith({ provider: "thunder", id: "sess_new" }));
  });

  it("binds a restored Thunder TUI pane to the conversation its own command resumes", async () => {
    localStorage.setItem("wb-session-view-mode", "hybrid");
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const previewSession = vi.fn(async ({ id }: { id: string }) => ({
      session: { provider: "thunder", id, title: id, projectPath: "/work/app", updatedAt: 1 },
      preview: { title: id, messages: [{ role: "user", text: `turn ${id}` }] }
    }));
    const terminalListForWorkbench = vi.fn(async () => [{ id: 77, cwd: "/work/app", cols: 80, rows: 24 }]);
    const layoutJson = JSON.stringify({
      openNoteIds: [],
      activePaneKey: "terminal:tui",
      terminals: [{
        key: "terminal:tui",
        ptyId: 77,
        title: "Thunder TUI",
        group: "session",
        cwd: "/work/app",
        projectPath: "/work/app",
        command: "/thunder/tui --session 'sess_old'"
      }]
    });
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.newSession": "New session",
        "desktop.workbench.selectSessionHint": "Select a session"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [],
      ensureTaskWorkbench: async () => ({ workbenchId: "wb-restore" }),
      listTaskWorkbenches: async () => [{
        workbenchId: "wb-restore",
        taskNoteId: "wi-restore",
        name: "",
        projectPath: "/work/app",
        position: 0,
        layoutJson,
        createdAtMs: 1,
        updatedAtMs: 2
      }],
      listTaskWorkbenchSessionLinks: async () => [],
      setTaskWorkbenchLayout: async () => ({ ok: true }),
      terminalListForWorkbench,
      terminalSpawn: vi.fn(async () => ({ id: 999 })),
      terminalAttach: vi.fn(async () => ({ ok: true, replay: "" })),
      terminalDetach: async () => ({ ok: true }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      workbenchSetFileWatch: async () => ({ rootPaths: [] }),
      previewSession,
      // Registered long before the app restarted: only the command line can
      // still name it, and only the hint binding finds it.
      thunderChatListConversations: async () => [{
        id: "sess_old",
        title: "Old Thunder chat",
        workspace: "/work/app",
        status: "active",
        message_count: 2,
        turn_count: 1,
        total_tokens: 5,
        created_at_ms: 1,
        updated_at_ms: 2
      }]
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-restore", title: "Restored", status: "next", sessions: [],
        projects: ["/work/app"], primaryProject: "/work/app", workbenchId: "wb-restore"
      } }));
    });

    await waitFor(() => expect(terminalListForWorkbench).toHaveBeenCalledWith({ workbenchId: "wb-restore" }));
    await waitFor(() => expect(previewSession).toHaveBeenCalledWith({ provider: "thunder", id: "sess_old" }));
    await waitFor(() => expect(document.querySelector(".wb-transcript-body")?.textContent).toContain("turn sess_old"));
  });

  it("pairs each fresh Thunder TUI pane with the conversation it registered", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const conversation = (id: string, createdAtMs: number) => ({
      id,
      title: id,
      workspace: "/work/app",
      status: "active",
      message_count: 2,
      turn_count: 1,
      total_tokens: 5,
      created_at_ms: createdAtMs,
      updated_at_ms: createdAtMs
    });
    // Both conversations are already registered when the panes start, so the
    // pairing is decided by launch order, not by whichever row arrived first.
    const conversations = [conversation("sess_first", Date.now()), conversation("sess_second", Date.now() + 1)];
    const previewSession = vi.fn(async ({ id }: { id: string }) => ({
      session: { provider: "thunder", id, title: id, projectPath: "/work/app", updatedAt: 1 },
      preview: { title: id, messages: [{ role: "user", text: `turn ${id}` }] }
    }));
    const workbenchNewSession = vi.fn(async () => ({ mode: "xterm", command: "/thunder/tui", cwd: "/work/app" }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.newSession": "New session",
        "desktop.workbench.selectSessionHint": "Select a session",
        "desktop.workbench.selectProjectHint": "Select a project",
        "desktop.workbench.newSessionTitle": "New session {0}",
        "desktop.workbench.splitViewMode": "Split View"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionTarget: "cli:thunder" } }),
      listSessions: async () => [],
      notesListTasks: async () => [],
      previewSession,
      workbenchNewSession,
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true }),
      thunderGetStatus: async () => ({ available: true, repoPath: "/thunder", daemonPath: "/thunder/daemon", tuiPath: "/thunder/tui", models: [] }),
      thunderChatListConversations: async () => conversations,
      notesRead: async () => ({ record: { work: { projects: [] } }, content: "" })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    await screen.findByText("sess_first");

    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);
    await waitFor(() => expect(document.querySelector(".wb-terminal-fullscreen-bar")).not.toBeNull());
    fireEvent.click(document.querySelector(".wb-terminal-mode-toggle-btn") as HTMLButtonElement);
    await waitFor(() => expect(document.querySelector(".wb-transcript-body")?.textContent).toContain("turn sess_first"));

    // The second pane cannot take the conversation the first one already owns,
    // so it binds the remaining one.
    previewSession.mockClear();
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);
    await waitFor(() => expect(document.querySelectorAll(".wb-terminal-tab").length).toBe(2));
    fireEvent.click(document.querySelector(".wb-terminal-mode-toggle-btn") as HTMLButtonElement);
    await waitFor(() => expect(previewSession).toHaveBeenCalledWith({ provider: "thunder", id: "sess_second" }));
    expect(previewSession).not.toHaveBeenCalledWith({ provider: "thunder", id: "sess_first" });
  });

  it("leaves an older Thunder TUI pane unbound when the conversation appears after a newer pane started", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    // A conversation from another workspace is on record from the start, so the
    // panel is ready — but it can never be a binding candidate for these panes.
    let conversations: Array<Record<string, unknown>> = [{
      id: "sess_other",
      title: "Other workspace chat",
      workspace: "/work/other",
      status: "active",
      message_count: 2,
      turn_count: 1,
      total_tokens: 5,
      created_at_ms: Date.now(),
      updated_at_ms: Date.now()
    }];
    const previewSession = vi.fn(async ({ id }: { id: string }) => ({
      session: { provider: "thunder", id, title: id, projectPath: "/work/app", updatedAt: 1 },
      preview: { title: id, messages: [{ role: "user", text: `turn ${id}` }] }
    }));
    const workbenchNewSession = vi.fn(async () => ({ mode: "xterm", command: "/thunder/tui", cwd: "/work/app" }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.newSession": "New session",
        "desktop.workbench.selectSessionHint": "Select a session",
        "desktop.workbench.selectProjectHint": "Select a project",
        "desktop.workbench.newSessionTitle": "New session {0}",
        "desktop.workbench.splitViewMode": "Split View"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionTarget: "cli:thunder" } }),
      listSessions: async () => [],
      notesListTasks: async () => [],
      previewSession,
      workbenchNewSession,
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true }),
      thunderGetStatus: async () => ({ available: true, repoPath: "/thunder", daemonPath: "/thunder/daemon", tuiPath: "/thunder/tui", models: [] }),
      thunderChatListConversations: async () => conversations,
      notesRead: async () => ({ record: { work: { projects: [] } }, content: "" })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    await screen.findByText("Other workspace chat");

    // Two panes start back to back while the store is still empty; the
    // conversation that then appears belongs to the newer one, and the older
    // pane must not claim it just because it started first.
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);
    await waitFor(() => expect(document.querySelectorAll(".wb-terminal-tab").length).toBe(1));
    fireEvent.click(document.querySelector(".wb-terminal-mode-toggle-btn") as HTMLButtonElement);
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);
    await waitFor(() => expect(document.querySelectorAll(".wb-terminal-tab").length).toBe(2));
    // The second launch reopened the terminal fullscreen, so ask for the split
    // again on the pane that is now active.
    fireEvent.click(document.querySelector(".wb-terminal-mode-toggle-btn") as HTMLButtonElement);
    expect(previewSession).not.toHaveBeenCalled();

    conversations = [...conversations, {
      id: "sess_late",
      title: "Late conversation",
      workspace: "/work/app",
      status: "active",
      message_count: 2,
      turn_count: 1,
      total_tokens: 5,
      created_at_ms: Date.now() + 50,
      updated_at_ms: Date.now() + 50
    }];

    // The discovery poll is what notices the conversation, so this waits past
    // one poll interval.
    await waitFor(() => expect(previewSession).toHaveBeenCalledWith({ provider: "thunder", id: "sess_late" }), { timeout: 6000 });
    expect(previewSession).toHaveBeenCalledTimes(1);
  });

  it("keeps a Thunder discovery pane off the conversation an open visual chat is showing", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const previewSession = vi.fn(async ({ id }: { id: string }) => ({
      session: { provider: "thunder", id, title: id, projectPath: "/work/app", updatedAt: 1 },
      preview: { title: id, messages: [] }
    }));
    // Fresh enough to fall inside a new pane's discovery window.
    const conversations = [{
      id: "sess_open",
      title: "Open Thunder chat",
      workspace: "/work/app",
      status: "active",
      message_count: 2,
      turn_count: 1,
      total_tokens: 5,
      created_at_ms: Date.now(),
      updated_at_ms: Date.now()
    }];
    const listConversations = vi.fn(async () => conversations);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.newSession": "New session",
        "desktop.workbench.thunderChat": "Thunder Chat",
        "desktop.workbench.closeThunderChat": "Close Thunder chat",
        "desktop.workbench.openThunderChat": "Open as visual chat",
        "desktop.workbench.resumeThunderTui": "Resume in Thunder TUI",
        "desktop.workbench.selectSessionHint": "Select a session",
        "desktop.workbench.selectProjectHint": "Select a project",
        "desktop.workbench.splitViewMode": "Split View",
        "desktop.common.loading": "Loading…"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionTarget: "cli:thunder" } }),
      listSessions: async () => [],
      notesListTasks: async () => [],
      notesRead: async () => ({ record: { work: { projects: [] } }, content: "" }),
      previewSession,
      workbenchNewSession: vi.fn(async () => ({ mode: "xterm", command: "/thunder/tui", cwd: "/work/app" })),
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true }),
      thunderGetStatus: async () => ({ available: true, repoPath: "/thunder", daemonPath: "/thunder/daemon", tuiPath: "/thunder/tui", models: [] }),
      thunderChatListConversations: listConversations,
      thunderChatGetConversation: async () => ({
        id: "sess_open",
        title: "Open Thunder chat",
        workspace: "/work/app",
        status: "active",
        messages: [],
        created_at_ms: 0,
        updated_at_ms: 0
      }),
      thunderChatGetActiveStream: async () => null,
      thunderChatGetTrace: async () => null,
      onThunderChatEvent: () => () => undefined,
      onThunderModelsChanged: () => () => undefined,
      onThunderModeChanged: () => () => undefined,
      thunderChatGetPermissionState: async () => ({ mode: "yolo" }),
      thunderChatSetMode: async () => ({ mode: "yolo" }),
      thunderChatAnswerUi: async () => true
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");

    // Open the conversation as a visual chat, then start a TUI beside it.
    fireEvent.click(await screen.findByText("Open Thunder chat"));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-thunder")).not.toBeNull());
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);
    await waitFor(() => expect(document.querySelector(".wb-terminal-fullscreen-bar")).not.toBeNull());
    fireEvent.click(document.querySelector(".wb-terminal-mode-toggle-btn") as HTMLButtonElement);

    // The TUI pane stays unbound — there is no conversation left for it — so it
    // observes nothing, then or once a discovery poll has seen the store.
    expect(previewSession).not.toHaveBeenCalled();
    const pollsBefore = listConversations.mock.calls.length;
    await waitFor(() => expect(listConversations.mock.calls.length).toBeGreaterThan(pollsBefore), { timeout: 6000 });
    expect(previewSession).not.toHaveBeenCalled();
  });

  it("auto renames a session from its context menu", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const autoRenameSession = vi.fn(async () => ({
      title: "Auto renamed session",
      previousTitle: "Fix renderer",
      session: { provider: "codex", id: "session-1", title: "Auto renamed session", projectPath: "/work/app", updatedAt: 1 },
      nativeRenamed: false
    }));
    const renameSession = vi.fn(async () => ({
      session: { provider: "codex", id: "session-1", title: "Auto renamed session · app", projectPath: "/work/app", updatedAt: 1 },
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
      renameSession,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const session = await screen.findByRole("button", { name: /Fix renderer/ });
    fireEvent.contextMenu(session);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Auto rename" }));
    await waitFor(() => expect(autoRenameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1", persist: false }));
    await waitFor(() => expect(renameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1", title: "Auto renamed session · app" }));
    await waitFor(() => expect(listSessions.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(onMutated).toHaveBeenCalled());
    expect(notificationMocks.notifyDesktop).not.toHaveBeenCalled();
    window.removeEventListener("agent-resume:sessions-mutated", onMutated);
  });

  it("notifies on failure when auto rename cannot update the native store", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const autoRenameSession = vi.fn(async () => ({
      title: "Auto renamed session",
      previousTitle: "Fix renderer",
      session: { provider: "codex", id: "session-1", title: "Auto renamed session", projectPath: "/work/app", updatedAt: 1 },
      nativeRenamed: false
    }));
    const renameSession = vi.fn(async () => ({
      session: { provider: "codex", id: "session-1", title: "Auto renamed session · app", projectPath: "/work/app", updatedAt: 1 },
      nativeRenamed: false,
      nativeError: "native boom"
    }));
    const listSessions = vi.fn(async () => [
      { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }
    ]);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.sidebarView": "Workbench sidebar view", "desktop.workbench.projectsView": "Project view", "desktop.workbench.gtdView": "GTD view", "desktop.workbench.filterGtdSessions": "Filter GTD sessions", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.openInChatGpt": "Open in ChatGPT", "desktop.workbench.preview": "Preview", "desktop.workbench.autoRename": "Auto rename", "desktop.sessions.renamed": "Renamed to {0}", "desktop.sessions.renamedNativeError": " (catalog updated; native: {0})"
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
      renameSession,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const session = await screen.findByRole("button", { name: /Fix renderer/ });
    notificationMocks.notifyDesktop.mockClear();
    fireEvent.contextMenu(session);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Auto rename" }));
    await waitFor(() => expect(renameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1", title: "Auto renamed session · app" }));
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenCalledWith({
      text: 'Renamed to Auto renamed session · app (catalog updated; native: native boom)',
      kind: "error"
    }));
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
      nativeRenamed: false
    }));
    const renameSession = vi.fn(async () => ({
      session: { provider: "codex", id: "session-1", title: "Auto renamed session · app", projectPath: "/work/app", updatedAt: 1 },
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
      renameSession,
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
      await waitFor(() => expect(autoRenameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1", persist: false }));
      await waitFor(() => expect(renameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1", title: "Auto renamed session · app" }));
      expect(notificationMocks.notifyDesktop).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("appends the project name when the session is not assigned to a folder", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const autoRenameSession = vi.fn(async () => ({
      title: "Auto renamed session",
      previousTitle: "Fix renderer",
      session: { provider: "codex", id: "session-1", title: "Auto renamed session", projectPath: "/work/app", projectId: "project-1", updatedAt: 1 },
      nativeRenamed: false
    }));
    const renameSession = vi.fn(async () => ({
      session: { provider: "codex", id: "session-1", title: "Auto renamed session · app", projectPath: "/work/app", projectId: "project-1", updatedAt: 1 },
      nativeRenamed: true,
      nativeError: null
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        ...FOLDER_DRAG_TEST_MESSAGES,
        "desktop.workbench.autoRename": "Auto rename",
        "desktop.workbench.autoRenaming": "Auto renaming…",
        "desktop.sessions.renamed": "Renamed to {0}"
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
        { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", projectId: "project-1", updatedAt: 1 }
      ],
      listProjects: async () => [{ projectId: "project-1", portableKey: "/work/app", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/app", pathMissing: false, sessionCount: 1 }],
      listWorkbenchSessionFolders: async () => ({
        folders: [
          { folderId: "campaign", projectId: "project-1", parentId: null, name: "Campaign", createdAtMs: 1, updatedAtMs: 1 }
        ],
        assignments: []
      }),
      autoRenameSession,
      renameSession,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    const session = await screen.findByRole("button", { name: /Fix renderer/ });
    fireEvent.contextMenu(session);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Auto rename" }));
    await waitFor(() => expect(autoRenameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1", persist: false }));
    await waitFor(() => expect(renameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1", title: "Auto renamed session · app" }));
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
      nativeRenamed: false
    }));
    const renameSession = vi.fn(async () => ({
      session: { provider: "codex", id: "session-1", title: "Auto renamed session · app", projectPath: "/work/app", updatedAt: 1 },
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
      renameSession,
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

  it("focuses the agent-session composer after spawn instead of xterm (box-primary)", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
    const workbenchListDirectory = vi.fn(async () => ({
      entries: [
        { name: "src", path: "/work/app/src", isDirectory: true },
        { name: "README.md", path: "/work/app/README.md", isDirectory: false }
      ]
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { ...ARROW_TEST_MESSAGES,
        "desktop.workbench.terminalComposerPlaceholder": "Type a command for the agent…",
        "desktop.workbench.terminalComposerHint": "Click to type a command.",
        "desktop.workbench.terminalComposerSend": "Send to terminal",
        "desktop.workbench.terminalComposerSuggestions": "Command suggestions",
        "desktop.workbench.terminalComposerDirectorySuggestions": "Directory suggestions",
        "desktop.workbench.terminalComposerDirectoryLoading": "Loading directories…",
        "desktop.workbench.terminalComposerDropHint": "Drop to insert path",
        "desktop.workbench.terminalComposerHintLine": "Enter pastes",
        "desktop.workbench.terminalComposerMove": "Move input box",
        "desktop.workbench.terminalComposerTips": "Sent messages",
        "desktop.workbench.closeTerminal": "Close terminal"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listProjects: async () => [{
        projectId: "project-1",
        portableKey: "/work/app",
        alias: "",
        hidden: false,
        pinned: false,
        lastSeenAtMs: 1,
        updatedAtMs: 1,
        localPath: "/work/app",
        pathMissing: false,
        sessionCount: 1
      }],
      querySessionsPage: async () => ({
        sessions: [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
        total: 1
      }),
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn,
      terminalDestroy: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true }),
      terminalInput: vi.fn(async () => ({ ok: true })),
      workbenchListDirectory
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(document.activeElement?.classList.contains("wb-terminal-composer-input")).toBe(true);
    });
    const composerInput = document.querySelector<HTMLTextAreaElement>(".workbench-layout .wb-terminal-composer-input");
    if (!composerInput) throw new Error("Session pane composer input not mounted");
    expect(document.querySelector(".wb-terminal-pane-split .wb-terminal-composer-stack")).toBeTruthy();
    expect(document.querySelector(".wb-terminal-pane .wb-terminal-composer")).toBeNull();
    expect(document.querySelector(".wb-transcript-compose .wb-terminal-composer")).toBeNull();
    expect(xtermMocks.instances[0].focusCalls).toBe(0);

    fireEvent.change(composerInput!, { target: { value: "please inspect #s" } });
    const listbox = await screen.findByRole("listbox", { name: "Directory suggestions" });
    expect(workbenchListDirectory).toHaveBeenCalledWith({ rootPath: "/work/app", dirPath: "/work/app" });
    expect(await within(listbox).findByText("#src")).toBeTruthy();
    fireEvent.keyDown(composerInput!, { key: "Tab" });
    expect(composerInput.value).toBe("please inspect #src");
  });

  it("offers no task repositories in the composer # menu", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
    const workbenchListDirectory = vi.fn(async () => ({ entries: [] }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { ...ARROW_TEST_MESSAGES,
        "desktop.workbench.terminalComposerPlaceholder": "Type a command for the agent…",
        "desktop.workbench.terminalComposerHint": "Click to type a command.",
        "desktop.workbench.terminalComposerSend": "Send to terminal",
        "desktop.workbench.terminalComposerSuggestions": "Command suggestions",
        "desktop.workbench.terminalComposerDirectorySuggestions": "Directory suggestions",
        "desktop.workbench.terminalComposerProjectSuggestions": "Project paths",
        "desktop.workbench.terminalComposerProjectNoMatch": "No matching projects",
        "desktop.workbench.terminalComposerDirectoryLoading": "Loading directories…",
        "desktop.workbench.terminalComposerDropHint": "Drop to insert path",
        "desktop.workbench.terminalComposerHintLine": "Enter pastes",
        "desktop.workbench.sessionTarget": "New sessions start in: {0}",
        "desktop.workbench.taskSessions": "{0} sessions"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listProjects: async () => [
        { projectId: "project-app", portableKey: "/work/app", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/app", pathMissing: false, sessionCount: 0 },
        { projectId: "project-api", portableKey: "/work/api", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/api", pathMissing: false, sessionCount: 0 }
      ],
      notesListTasks: async () => [
        { noteId: "wi-multi", title: "Multi", gtdStatus: "next", work: { sessions: ["codex:session-1"], projects: ["/work/app", "/work/api"], primaryProject: "/work/app" } }
      ],
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      querySessionsPage: async () => ({
        sessions: [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
        total: 1
      }),
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn,
      terminalDestroy: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true }),
      workbenchListDirectory
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app", { noteId: "wi-multi", projects: ["/work/app", "/work/api"] });
    await waitFor(() => expect(document.querySelector(".wb-detail-project-path")?.textContent).toBe("/work/app"));

    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    const composerInput = document.querySelector<HTMLTextAreaElement>(".workbench-layout .wb-terminal-composer-input");
    if (!composerInput) throw new Error("composer input missing");
    fireEvent.focus(composerInput);
    fireEvent.change(composerInput, { target: { value: "#" } });

    // The task's repositories are not offered as `#` targets: a session works
    // in a real repository, and `#` stays its directory listing.
    expect(screen.queryByRole("listbox", { name: "Project paths" })).toBeNull();
    await waitFor(() => expect(workbenchListDirectory).toHaveBeenCalledWith({ rootPath: "/work/app", dirPath: "/work/app" }));
  });

  it("shell terminals render no composer (session-gated)", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { ...ARROW_TEST_MESSAGES } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      homePath: async () => "/home/test",
      createScratchDir: async () => "/scratch/work",
      terminalSpawn: async () => ({ id: 1 }),
      terminalDestroy: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true }),
      terminalInput: vi.fn(async () => ({ ok: true }))
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    expect(document.querySelector(".wb-terminal-composer")).toBeNull();
    expect(document.querySelector<HTMLElement>(".wb-terminal-host")?.classList.contains("is-session")).toBe(false);
  });

  it("shows the floating project cd switcher on a shell terminal in a multi-repo task", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const ensureWorkspace = vi.fn(async () => ({ dir: WORKSPACE_CWD }));
    const terminalInput = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { ...ARROW_TEST_MESSAGES,
        "desktop.workbench.sessionTarget": "New sessions start in: {0}",
        "desktop.workbench.terminalSwitchProject": "Switch project",
        "desktop.workbench.terminalCdProject": "cd to {0}",
        "desktop.workbench.terminalCdActionTitle": "Run cd to {0} in terminal"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [],
      notesEnsureTaskWorkspace: ensureWorkspace,
      homePath: async () => "/home/test",
      createScratchDir: async () => "/scratch/work",
      terminalSpawn: async () => ({ id: 1 }),
      terminalDestroy: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true }),
      terminalInput
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app", { noteId: "wi-multi", projects: ["/work/app", "/work/api"] });

    // New terminal with no explicit target: a multi-repo task starts it in the
    // primary repository, from where the cd switcher reaches every other one.
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    await waitFor(() => expect(ensureWorkspace).not.toHaveBeenCalled());

    const switcher = document.querySelector(".wb-terminal-project-switcher");
    expect(switcher).not.toBeNull();
    // One chip per referenced repository — there is no workspace to return to.
    expect(screen.getByRole("button", { name: "cd to app" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "cd to api" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Shared workspace/ })).toBeNull();
    expect(terminalInput).not.toHaveBeenCalled();
  });

  it("cds a multi-repo task terminal to a project when its chip is clicked", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalInput = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { ...ARROW_TEST_MESSAGES,
        "desktop.workbench.sessionTarget": "New sessions start in: {0}",
        "desktop.workbench.terminalSwitchProject": "Switch project",
        "desktop.workbench.terminalCdProject": "cd to {0}",
        "desktop.workbench.terminalCdActionTitle": "Run cd to {0} in terminal"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [],
      notesEnsureTaskWorkspace: async () => ({ dir: WORKSPACE_CWD }),
      homePath: async () => "/home/test",
      createScratchDir: async () => "/scratch/work",
      terminalSpawn: async () => ({ id: 1 }),
      terminalDestroy: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true }),
      terminalInput
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app", { noteId: "wi-multi", projects: ["/work/app", "/work/api"] });
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    await waitFor(() => expect(document.querySelector(".wb-terminal-project-switcher")).not.toBeNull());

    // The chip writes a quoted `cd` + Enter to the PTY: the shell lands in the
    // repository without the user typing a path. The pane stays put — the
    // switcher is shell navigation, not a panel selection change.
    fireEvent.click(screen.getByRole("button", { name: "cd to api" }));
    await waitFor(() => expect(terminalInput).toHaveBeenCalledWith({ id: 1, data: "cd '/work/api'\r" }));

    // The switcher itself never vanished: the pane kept its task scope.
    expect(document.querySelector(".wb-terminal-project-switcher")).not.toBeNull();
  });

  it("does not render the project cd switcher on an agent session, even in the shared workspace", async () => {
    localStorage.setItem("wb-session-view-mode", "terminal");
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { ...ARROW_TEST_MESSAGES,
        "desktop.workbench.sessionTarget": "New sessions start in: {0}",
        "desktop.workbench.terminalSwitchProject": "Switch project"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Shared agent", projectPath: WORKSPACE_CWD, updatedAt: 1 }],
      notesListTasks: async () => [
        { noteId: "wi-multi", title: "Multi", gtdStatus: "next", work: { sessions: ["codex:session-1"], projects: ["/work/app", "/work/api"], primaryProject: "/work/app" } }
      ],
      notesEnsureTaskWorkspace: async () => ({ dir: WORKSPACE_CWD }),
      notesTaskWorkspace: async () => ({ dir: WORKSPACE_CWD, exists: true }),
      querySessionsPage: async () => ({
        sessions: [{ provider: "codex", id: "session-1", title: "Shared agent", projectPath: WORKSPACE_CWD, updatedAt: 1 }],
        total: 1
      }),
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: WORKSPACE_CWD }),
      terminalSpawn,
      terminalDestroy: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app", { noteId: "wi-multi", projects: ["/work/app", "/work/api"], sessions: ["codex:session-1"] });

    fireEvent.click(await screen.findByRole("button", { name: /Shared agent/ }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));

    // Sessions (whether split or full terminal) never show the shell cd switcher.
    expect(document.querySelector(".wb-terminal-project-switcher")).toBeNull();
  });

  it("pastes composer text into the TUI without submitting and logs a user send", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
    const terminalInput = vi.fn(async () => ({ ok: true }));
    const workbenchComposerSendAppend = vi.fn(async (args: { text: string }) => ({
      id: "send-1",
      createdAtMs: 1,
      paneKey: "terminal:1",
      projectPath: "/work/app",
      sessionKey: "codex:session-1",
      provider: "codex",
      agentSessionId: "session-1",
      text: args.text
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { ...ARROW_TEST_MESSAGES } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listProjects: async () => [{
        projectId: "project-1",
        portableKey: "/work/app",
        alias: "",
        hidden: false,
        pinned: false,
        lastSeenAtMs: 1,
        updatedAtMs: 1,
        localPath: "/work/app",
        pathMissing: false,
        sessionCount: 1
      }],
      querySessionsPage: async () => ({
        sessions: [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
        total: 1
      }),
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn,
      terminalDestroy: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true }),
      terminalInput,
      workbenchComposerSendAppend,
      workbenchComposerSendList: async () => []
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    const composerInput = document.querySelector<HTMLTextAreaElement>(".workbench-layout .wb-terminal-composer-input");
    if (!composerInput) throw new Error("composer input missing");
    fireEvent.change(composerInput, { target: { value: "inspect src" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to terminal" }));
    await waitFor(() => expect(terminalInput).toHaveBeenCalledWith({ id: 1, data: "inspect src\r" }));
    expect(composerInput.value).toBe("");
    expect(workbenchComposerSendAppend).toHaveBeenCalledWith(expect.objectContaining({ text: "inspect src", projectPath: "/work/app" }));
    await waitFor(() => expect(xtermMocks.instances[0].focusCalls).toBeGreaterThan(0));
  });

  it("submits composer text with a carriage return when the terminal console is collapsed", async () => {
    localStorage.setItem("wb-session-view-mode", "hybrid");
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
    const terminalInput = vi.fn(async () => ({ ok: true }));
    const workbenchComposerSendAppend = vi.fn(async (args: { text: string }) => ({
      id: "send-1",
      createdAtMs: 1,
      paneKey: "terminal:1",
      projectPath: "/work/app",
      sessionKey: "codex:session-1",
      provider: "codex",
      agentSessionId: "session-1",
      text: args.text
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { ...ARROW_TEST_MESSAGES } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listProjects: async () => [{
        projectId: "project-1",
        portableKey: "/work/app",
        alias: "",
        hidden: false,
        pinned: false,
        lastSeenAtMs: 1,
        updatedAtMs: 1,
        localPath: "/work/app",
        pathMissing: false,
        sessionCount: 1
      }],
      querySessionsPage: async () => ({
        sessions: [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
        total: 1
      }),
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn,
      terminalDestroy: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true }),
      terminalInput,
      workbenchComposerSendAppend,
      workbenchComposerSendList: async () => []
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    const composerInput = document.querySelector<HTMLTextAreaElement>(".workbench-layout .wb-terminal-composer-input");
    if (!composerInput) throw new Error("composer input missing");
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    await waitFor(() => expect(document.querySelector(".wb-session-split-tui.is-collapsed")).toBeTruthy());
    const focusBeforeSend = xtermMocks.instances[0]?.focusCalls ?? 0;
    fireEvent.change(composerInput, { target: { value: "inspect src" } });
    fireEvent.keyDown(composerInput, { key: "Enter" });
    await waitFor(() => expect(terminalInput).toHaveBeenCalledWith({ id: 1, data: "inspect src\r" }));
    expect(composerInput.value).toBe("");
    expect(workbenchComposerSendAppend).toHaveBeenCalledWith(expect.objectContaining({ text: "inspect src", projectPath: "/work/app" }));
    expect(document.querySelector(".wb-session-split-tui.is-collapsed")).toBeTruthy();
    expect(xtermMocks.instances[0]?.focusCalls ?? 0).toBe(focusBeforeSend);
  });

  it("runs a TUI slash command with a carriage return and skips composer send logging", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
    const terminalInput = vi.fn(async () => ({ ok: true }));
    const workbenchComposerSendAppend = vi.fn(async (args: { text: string }) => ({
      id: "send-1",
      createdAtMs: 1,
      paneKey: "terminal:1",
      projectPath: "/work/app",
      sessionKey: "codex:session-1",
      provider: "codex",
      agentSessionId: "session-1",
      text: args.text
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { ...ARROW_TEST_MESSAGES } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listProjects: async () => [{
        projectId: "project-1",
        portableKey: "/work/app",
        alias: "",
        hidden: false,
        pinned: false,
        lastSeenAtMs: 1,
        updatedAtMs: 1,
        localPath: "/work/app",
        pathMissing: false,
        sessionCount: 1
      }],
      querySessionsPage: async () => ({
        sessions: [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
        total: 1
      }),
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn,
      terminalDestroy: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true }),
      terminalInput,
      workbenchComposerSendAppend,
      workbenchComposerSendList: async () => []
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    const composerInput = document.querySelector<HTMLTextAreaElement>(".workbench-layout .wb-terminal-composer-input");
    if (!composerInput) throw new Error("composer input missing");
    fireEvent.focus(composerInput);
    fireEvent.change(composerInput, { target: { value: "/cle" } });
    const listbox = await screen.findByRole("listbox", { name: "Slash commands" });
    expect(within(listbox).getByText("/clear")).toBeTruthy();
    fireEvent.keyDown(composerInput, { key: "Tab" });
    await waitFor(() => expect(terminalInput).toHaveBeenCalledWith({ id: 1, data: "/clear\r" }));
    expect(workbenchComposerSendAppend).not.toHaveBeenCalled();
    expect(composerInput.value).toBe("");
    await waitFor(() => expect(xtermMocks.instances[0].focusCalls).toBeGreaterThan(0));
  });

  it("leaves native TUI slash input on xterm instead of hijacking it into the composer", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
    const terminalInput = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { ...ARROW_TEST_MESSAGES } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listProjects: async () => [{
        projectId: "project-1",
        portableKey: "/work/app",
        alias: "",
        hidden: false,
        pinned: false,
        lastSeenAtMs: 1,
        updatedAtMs: 1,
        localPath: "/work/app",
        pathMissing: false,
        sessionCount: 1
      }],
      querySessionsPage: async () => ({
        sessions: [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
        total: 1
      }),
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn,
      terminalDestroy: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true }),
      terminalInput,
      workbenchComposerSendList: async () => []
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    expect(xtermMocks.instances[0].customKeyEventHandler).toBeNull();
    const composerInput = document.querySelector<HTMLTextAreaElement>(".workbench-layout .wb-terminal-composer-input");
    if (!composerInput) throw new Error("composer input missing");
    expect(composerInput.value).toBe("");
    expect(terminalInput).not.toHaveBeenCalled();
  });

  it("shows TUI slash commands on a new session before the catalog binds", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { ...ARROW_TEST_MESSAGES } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listProjects: async () => [{
        projectId: "project-1",
        portableKey: "/work/app",
        alias: "",
        hidden: false,
        pinned: false,
        lastSeenAtMs: 1,
        updatedAtMs: 1,
        localPath: "/work/app",
        pathMissing: false,
        sessionCount: 1
      }],
      querySessionsPage: async () => ({
        sessions: [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
        total: 1
      }),
      workbenchNewSession: async () => ({ mode: "xterm", command: "codex", cwd: "/work/app" }),
      terminalSpawn,
      terminalDestroy: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true }),
      terminalInput: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    const composerInput = document.querySelector<HTMLTextAreaElement>(".workbench-layout .wb-terminal-composer-input");
    if (!composerInput) throw new Error("composer input missing");
    fireEvent.focus(composerInput);
    fireEvent.change(composerInput, { target: { value: "/" } });
    const listbox = await screen.findByRole("listbox", { name: "Slash commands" });
    expect(within(listbox).getByText("/clear")).toBeTruthy();
    expect(within(listbox).getByText("/compact")).toBeTruthy();
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
      nativeRenamed: false
    }));
    const renameSession = vi.fn(async () => ({
      session: { provider: "codex", id: "session-1", title: "Auto renamed session · app", projectPath: "/work/app", updatedAt: 1 },
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
      renameSession,
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
      await waitFor(() => expect(autoRenameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1", persist: false }));
      await waitFor(() => expect(renameSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1", title: "Auto renamed session · app" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the session search always visible and filters the list", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.workbench.allSessions": "All sessions"
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

    const searchInput = screen.getByRole("searchbox", { name: "desktop.workbench.searchSessions" }) as HTMLInputElement;
    expect(searchInput.value).toBe("");
    fireEvent.change(searchInput, { target: { value: "zzz" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Fix renderer/ })).toBeNull());
    fireEvent.change(searchInput, { target: { value: "Fix" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /Fix renderer/ })).toBeTruthy());
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
      terminalAttach: async ({ id }: { id: number }) => ({ ok: true, replay: `replay-${id}` }),
      terminalDetach: async () => ({ ok: true }),
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
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(2));

    fireEvent.click(document.querySelector<HTMLButtonElement>(".wb-terminal-tab-label")!);
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(3));
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "notes" })));
    expect(terminalDestroy).not.toHaveBeenCalled();

    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/docs");
    await activateTaskDirectory("/work/app");
    expect(terminalSpawn).toHaveBeenCalledTimes(2);
    expect(terminalDestroy).not.toHaveBeenCalled();
    expect(document.querySelector(".wb-terminal-tab-close")).toBeTruthy();
  });

  it("detaches xterm when leaving a project and reattaches without spawning", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn(async () => ({ id: 11 }));
    const terminalAttach = vi.fn(async () => ({ ok: true, replay: "hidden-output" }));
    const terminalDetach = vi.fn(async () => ({ ok: true }));
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
        { provider: "codex", id: "session-3", title: "Write docs", projectPath: "/work/docs", updatedAt: 3 }
      ],
      workbenchOpenSession: async ({ id }: { id: string }) => ({ mode: "xterm", command: `codex resume ${id}`, cwd: id === "session-3" ? "/work/docs" : "/work/app" }),
      terminalSpawn,
      terminalAttach,
      terminalDetach,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy,
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));

    await activateTaskDirectory("/work/docs");
    await waitFor(() => expect(terminalDetach).toHaveBeenCalledWith({ id: 11 }));
    expect(terminalDestroy).not.toHaveBeenCalled();
    expect(xtermMocks.instances).toHaveLength(1);

    await activateTaskDirectory("/work/app");
    await waitFor(() => expect(terminalAttach).toHaveBeenCalledWith({ id: 11 }));
    expect(terminalSpawn).toHaveBeenCalledTimes(1);
    expect(terminalDestroy).not.toHaveBeenCalled();
    expect(xtermMocks.instances).toHaveLength(2);
  });

  it("keeps a task's session terminal alive while another task is open", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchesByTask: Record<string, {
      workbenchId: string;
      taskNoteId: string;
      name: string;
      projectPath: string | null;
      position: number;
      layoutJson: string | null;
      createdAtMs: number;
      updatedAtMs: number;
    }[]> = {
      "task-a": [{ workbenchId: "wb-a", taskNoteId: "task-a", name: "", projectPath: "/work/app", position: 0, layoutJson: null, createdAtMs: 1, updatedAtMs: 1 }],
      "task-b": [{ workbenchId: "wb-b", taskNoteId: "task-b", name: "", projectPath: "/work/docs", position: 0, layoutJson: null, createdAtMs: 1, updatedAtMs: 1 }]
    };
    const terminalSpawn = vi.fn(async () => ({ id: 31 }));
    const terminalAttach = vi.fn(async () => ({ ok: true, replay: "task-switch-replay" }));
    const terminalDetach = vi.fn(async () => ({ ok: true }));
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
      ensureTaskWorkbench: async () => ({}),
      listTaskWorkbenches: async ({ taskNoteId }: { taskNoteId: string }) => workbenchesByTask[taskNoteId] ?? [],
      listSessions: async () => [
        { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 },
        { provider: "codex", id: "session-3", title: "Write docs", projectPath: "/work/docs", updatedAt: 3 }
      ],
      workbenchOpenSession: async ({ id }: { id: string }) => ({ mode: "xterm", command: `codex resume ${id}`, cwd: id === "session-3" ? "/work/docs" : "/work/app" }),
      terminalSpawn,
      terminalAttach,
      terminalDetach,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy,
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app", { noteId: "task-a" });
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));

    await activateTaskDirectory("/work/docs", { noteId: "task-b" });
    await waitFor(() => expect(terminalDetach).toHaveBeenCalledWith({ id: 31 }));
    expect(terminalDestroy).not.toHaveBeenCalled();

    await activateTaskDirectory("/work/app", { noteId: "task-a" });
    await waitFor(() => expect(terminalAttach).toHaveBeenCalledWith({ id: 31 }));
    expect(terminalSpawn).toHaveBeenCalledTimes(1);
    expect(terminalDestroy).not.toHaveBeenCalled();
    expect(document.querySelector(".wb-terminal-tab-close")).toBeTruthy();
  });

  it("destroys the PTY only when the terminal tab is closed", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn(async () => ({ id: 21 }));
    const terminalDetach = vi.fn(async () => ({ ok: true }));
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
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      querySessionsPage: querySessionsPageFromList(async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }]),
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn,
      terminalAttach: async () => ({ ok: true, replay: "" }),
      terminalDetach,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy,
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector(".wb-terminal-host")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
    await waitFor(() => expect(terminalDestroy).toHaveBeenCalledWith({ id: 21 }));
  });

  it("docks the session transcript beside the live TUI without destroying the terminal", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn(async () => ({ id: 1 }));
    const terminalDestroy = vi.fn(async () => ({ ok: true }));
    const previewSession = vi.fn(async () => ({
      session: { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 },
      preview: {
        title: "Fix renderer",
        messages: [
          { role: "user", text: "Add a transcript pane" },
          { role: "assistant", text: "Keep the TUI visible." }
        ]
      }
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.loadingPreview": "Loading preview…", "desktop.sessions.noMessages": "No messages", "desktop.sessions.truncated": "(truncated)", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.sidePanelTranscript": "Transcript", "desktop.workbench.transcriptOutline": "Turns", "desktop.workbench.transcriptSearchPlaceholder": "Search this conversation", "desktop.workbench.transcriptNeedSession": "Open a session", "desktop.workbench.transcriptNoMatches": "No matching turns", "desktop.workbench.transcriptRoleUser": "User", "desktop.workbench.transcriptRoleAssistant": "Assistant", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.resizeSidePanel": "Resize side panel"
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
      previewSession,
      terminalSpawn,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy,
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    expect(screen.queryByRole("button", { name: "Transcript" })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(terminalSpawn).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: /Add a transcript pane/ })).toBeTruthy();
    expect(document.querySelector(".wb-transcript-body")?.textContent).toContain("Keep the TUI visible.");
    expect(document.querySelector(".wb-git-pane-head")).toBeNull();
    expect(previewSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1" });
    expect(document.querySelector(".wb-terminal-host")).not.toBeNull();
    expect(document.querySelector(".wb-terminal-pane-split .wb-terminal-composer-stack")).toBeTruthy();
    expect(document.querySelector(".wb-terminal-pane .wb-terminal-composer")).toBeNull();
    expect(document.querySelector(".wb-transcript-compose .wb-terminal-composer")).toBeNull();
    expect(document.querySelector(".wb-session-split-transcript")).not.toBeNull();
    expect(document.querySelector(".sheet")).toBeNull();
    expect(terminalDestroy).not.toHaveBeenCalled();
    expect(xtermMocks.instances).toHaveLength(1);
  });

  it("keeps transcript markdown untouched while the user types and scrolls in the TUI", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalInput = vi.fn(async () => ({ ok: true }));
    const setWorkbenchActiveSessions = vi.fn();
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.loadingPreview": "Loading preview…", "desktop.sessions.noMessages": "No messages", "desktop.sessions.truncated": "(truncated)", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.sidePanelTranscript": "Transcript", "desktop.workbench.transcriptOutline": "Turns", "desktop.workbench.transcriptSearchPlaceholder": "Search this conversation", "desktop.workbench.transcriptNeedSession": "Open a session", "desktop.workbench.transcriptNoMatches": "No matching turns", "desktop.workbench.transcriptRoleUser": "User", "desktop.workbench.transcriptRoleAssistant": "Assistant", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.resizeSidePanel": "Resize side panel"
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
      previewSession: async () => ({
        session: { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 },
        preview: {
          title: "Fix renderer",
          messages: [
            { role: "user", text: "Add a transcript pane" },
            { role: "assistant", text: "Keep the TUI visible." }
          ]
        }
      }),
      terminalSpawn: async () => ({ id: 1 }),
      terminalInput,
      setWorkbenchActiveSessions,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(document.querySelector(".wb-session-split-transcript")).not.toBeNull());
    await screen.findByRole("button", { name: /Add a transcript pane/ });

    const markdown = document.querySelector(".wb-transcript-md") as HTMLElement;
    const paragraph = markdown.querySelector("p");
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    // Attributes are excluded on purpose: the streaming caret is a container
    // class, while any child/character mutation means the markdown re-rendered.
    observer.observe(markdown, { childList: true, subtree: true, characterData: true });

    const composer = document.querySelector(".wb-terminal-composer-input") as HTMLTextAreaElement | null;
    expect(composer).not.toBeNull();
    for (let index = 0; index < 6; index += 1) {
      await act(async () => { fireEvent.change(composer as HTMLTextAreaElement, { target: { value: `typing ${index}` } }); });
    }
    // Typing straight into the live TUI: the same path the real terminal uses
    // (PTY input plus the session activity signal).
    for (let index = 0; index < 6; index += 1) {
      await act(async () => { xtermMocks.instances[0]?.emitData(`x${index}`); });
    }
    expect(terminalInput).toHaveBeenCalled();

    // Typing straight into the live TUI also feeds the session status store;
    // the transcript markdown above stayed untouched through all of it.
    // (A status flip that lands on the pane is covered by the pane test.)
    const dotPayloads = setWorkbenchActiveSessions.mock.calls.map((call) => call[0] as Array<{ status?: string }>);
    expect(dotPayloads.length).toBeGreaterThan(0);
    expect(dotPayloads.every((payload) => payload.every((dot) => Boolean(dot.status)))).toBe(true);

    const terminalHost = document.querySelector(".wb-terminal-host") as HTMLElement;
    for (let index = 0; index < 6; index += 1) {
      await act(async () => {
        terminalHost.dispatchEvent(new WheelEvent("wheel", { deltaY: index % 2 === 0 ? -40 : 40, bubbles: true }));
      });
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
    observer.disconnect();

    expect(mutations).toEqual([]);
    expect(document.querySelector(".wb-transcript-md")).toBe(markdown);
    expect(document.querySelector(".wb-transcript-md p")).toBe(paragraph);
  });

  it("hides session scrollbars from launch and shows only the TUI waterdrop in the alternate buffer", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let terminalDataHandler: ((payload: { id: number; data: string }) => void) | null = null;
    const terminalInput = vi.fn(async () => ({ ok: true }));
    const terminalResize = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.terminalScrollTop": "Scroll to terminal top", "desktop.workbench.terminalScrollBottom": "Scroll to terminal bottom", "desktop.workbench.terminalTuiScrollControl": "TUI scroll control"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: (callback: (payload: { id: number; data: string }) => void) => {
        terminalDataHandler = callback;
        return () => { terminalDataHandler = null; };
      },
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }),
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize,
      terminalInput
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    const terminal = xtermMocks.instances[0];
    await waitFor(() => expect(terminalResize).toHaveBeenCalled());

    const terminalHost = document.querySelector<HTMLElement>(".wb-terminal-host")!;
    expect(terminalHost.classList.contains("is-session")).toBe(true);
    expect(terminalHost.classList.contains("is-tui-mode")).toBe(true);
    expect(screen.queryByRole("slider")).toBeNull();
    const startupWaterdrop = screen.getByRole("button", { name: "TUI scroll control" });
    expect(startupWaterdrop.classList.contains("is-unavailable")).toBe(false);
    expect(screen.getByRole("button", { name: "Scroll to terminal top" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scroll to terminal bottom" })).toBeTruthy();

    act(() => terminal.setBuffer("normal", 5, 10));
    expect(screen.queryByRole("slider")).toBeNull();
    const normalBufferWaterdrop = screen.getByRole("button", { name: "TUI scroll control" });
    expect(normalBufferWaterdrop.classList.contains("is-unavailable")).toBe(false);
    expect(terminalHost.classList.contains("is-tui-mode")).toBe(true);

    act(() => terminal.setBuffer("alternate", 0, 0));
    expect(terminalHost.classList.contains("is-tui-mode")).toBe(true);
    expect(screen.queryByRole("slider")).toBeNull();
    const waterdrop = screen.getByRole("button", { name: "TUI scroll control" });
    expect(waterdrop.classList.contains("is-unavailable")).toBe(false);
    expect(waterdrop.getAttribute("aria-disabled")).toBe("false");

    act(() => terminalDataHandler?.({ id: 1, data: "\x1b[?1002h\x1b[?1006h" }));
    terminalInput.mockClear();
    expect(waterdrop.classList.contains("is-unavailable")).toBe(false);
    expect(waterdrop.getAttribute("aria-disabled")).toBe("false");
    fireEvent.keyDown(waterdrop, { key: "ArrowUp" });
    expect(terminal.wheelDeltas).toEqual([-1]);
    fireEvent.keyDown(waterdrop, { key: "PageDown" });
    expect(terminal.wheelDeltas).toEqual([-1, ...Array(8).fill(1)]);
    fireEvent.click(screen.getByRole("button", { name: "Scroll to terminal top" }));
    expect(terminal.wheelDeltas.slice(-400)).toEqual(Array(400).fill(-1));
    fireEvent.click(screen.getByRole("button", { name: "Scroll to terminal bottom" }));
    expect(terminal.wheelDeltas.slice(-400)).toEqual(Array(400).fill(1));
    fireEvent.keyDown(waterdrop, { key: "Home" });
    expect(terminal.wheelDeltas.slice(-400)).toEqual(Array(400).fill(-1));
    fireEvent.keyDown(waterdrop, { key: "End" });
    expect(terminal.wheelDeltas.slice(-400)).toEqual(Array(400).fill(1));

    act(() => terminalDataHandler?.({ id: 1, data: "\x1b[?1002l" }));
    expect(waterdrop.classList.contains("is-unavailable")).toBe(false);
    fireEvent.keyDown(waterdrop, { key: "ArrowDown" });
    expect(terminal.wheelDeltas.at(-1)).toBe(1);
  });

  it("does not re-anchor when the user scrolled up to read history", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let terminalDataHandler: ((payload: { id: number; data: string }) => void) | null = null;
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.terminalScrollTop": "Scroll to terminal top", "desktop.workbench.terminalScrollBottom": "Scroll to terminal bottom", "desktop.workbench.terminalTuiScrollControl": "TUI scroll control"
      } }),
      onLocaleChanged: () => () => undefined, onWorkbenchCmdT: () => () => undefined, onWorkbenchCmdW: () => () => undefined,
      onTerminalData: (callback: (payload: { id: number; data: string }) => void) => { terminalDataHandler = callback; return () => { terminalDataHandler = null; }; },
      onTerminalExit: () => () => undefined, onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}), getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }), terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }), terminalDestroy: async () => ({ ok: true }), terminalResize: async () => ({ ok: true }), terminalInput: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    const terminal = xtermMocks.instances[0];

    // User scrolled up: viewport sits above baseY; a wheel then marks the
    // follow state as off so the redraw must not yank them back down.
    terminal.setBuffer("normal", 5, 10);
    fireEvent.wheel(document.querySelector<HTMLElement>(".wb-terminal-host")!, { deltaY: -100 });

    act(() => terminalDataHandler?.({
      id: 1,
      data: "\x1b[?2026h\x1b[2J\x1b[H redraw \x1b[?2026l"
    }));
    expect(terminal.scrollBottomCalls).toBe(0);
  });

  it("ignores non-redraw writes and alternate buffers for the follow anchor", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let terminalDataHandler: ((payload: { id: number; data: string }) => void) | null = null;
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.terminalScrollTop": "Scroll to terminal top", "desktop.workbench.terminalScrollBottom": "Scroll to terminal bottom", "desktop.workbench.terminalTuiScrollControl": "TUI scroll control"
      } }),
      onLocaleChanged: () => () => undefined, onWorkbenchCmdT: () => () => undefined, onWorkbenchCmdW: () => () => undefined,
      onTerminalData: (callback: (payload: { id: number; data: string }) => void) => { terminalDataHandler = callback; return () => { terminalDataHandler = null; }; },
      onTerminalExit: () => () => undefined, onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}), getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }), terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }), terminalDestroy: async () => ({ ok: true }), terminalResize: async () => ({ ok: true }), terminalInput: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    const terminal = xtermMocks.instances[0];

    // A shell-style `clear` (2J outside a synchronized block) must not trigger
    // the TUI re-anchor; a plain append at the bottom must not either.
    terminal.setBuffer("normal", 20, 20);
    act(() => terminalDataHandler?.({ id: 1, data: "\x1b[2J\x1b[H" }));
    act(() => terminalDataHandler?.({ id: 1, data: "appended line" }));
    expect(terminal.scrollBottomCalls).toBe(0);

    // Alternate-buffer TUIs are skipped entirely (they own their viewport).
    terminal.setBuffer("alternate", 0, 0);
    act(() => terminalDataHandler?.({ id: 1, data: "\x1b[?2026h\x1b[2J\x1b[H redraw \x1b[?2026l" }));
    expect(terminal.scrollBottomCalls).toBe(0);
  });

  it("continuously scrolls a mouse-tracking TUI by waterdrop pull direction and strength", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let terminalDataHandler: ((payload: { id: number; data: string }) => void) | null = null;
    const terminalInput = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.terminalScrollTop": "Scroll to terminal top", "desktop.workbench.terminalScrollBottom": "Scroll to terminal bottom", "desktop.workbench.terminalTuiScrollControl": "TUI scroll control"
      } }),
      onLocaleChanged: () => () => undefined, onWorkbenchCmdT: () => () => undefined, onWorkbenchCmdW: () => () => undefined,
      onTerminalData: (callback: (payload: { id: number; data: string }) => void) => { terminalDataHandler = callback; return () => { terminalDataHandler = null; }; },
      onTerminalExit: () => () => undefined, onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}), getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchOpenSession: async () => ({ mode: "xterm", command: "codex resume session-1", cwd: "/work/app" }), terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }), terminalDestroy: async () => ({ ok: true }), terminalResize: async () => ({ ok: true }), terminalInput
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    act(() => {
      xtermMocks.instances[0].setBuffer("alternate", 0, 0);
      terminalDataHandler?.({ id: 1, data: "\x1b[?1002h" });
    });
    const waterdrop = screen.getByRole("button", { name: "TUI scroll control" });
    terminalInput.mockClear();
    vi.useFakeTimers();

    fireEvent(waterdrop, new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }));
    fireEvent(waterdrop, new MouseEvent("pointermove", { bubbles: true, clientY: 95 }));
    expect(xtermMocks.instances[0].wheelDeltas).toEqual([]);
    expect(waterdrop.classList.contains("is-idle")).toBe(true);

    fireEvent(waterdrop, new MouseEvent("pointermove", { bubbles: true, clientY: 70 }));
    expect(waterdrop.classList.contains("is-up")).toBe(true);
    expect(xtermMocks.instances[0].wheelDeltas).toEqual(Array(4).fill(-1));
    fireEvent(waterdrop, new MouseEvent("pointermove", { bubbles: true, clientY: 10 }));
    act(() => vi.advanceTimersByTime(80));
    expect(xtermMocks.instances[0].wheelDeltas.slice(-14)).toEqual(Array(14).fill(-1));

    fireEvent(waterdrop, new MouseEvent("pointerup", { bubbles: true, clientY: 10 }));
    expect(waterdrop.classList.contains("is-idle")).toBe(true);
    const wheelsAfterRelease = xtermMocks.instances[0].wheelDeltas.length;
    act(() => vi.advanceTimersByTime(240));
    expect(xtermMocks.instances[0].wheelDeltas).toHaveLength(wheelsAfterRelease);

    fireEvent(waterdrop, new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }));
    fireEvent(waterdrop, new MouseEvent("pointermove", { bubbles: true, clientY: 150 }));
    expect(waterdrop.classList.contains("is-down")).toBe(true);
    expect(xtermMocks.instances[0].wheelDeltas.slice(-7)).toEqual(Array(7).fill(1));
    act(() => window.dispatchEvent(new Event("blur")));
    expect(waterdrop.classList.contains("is-idle")).toBe(true);
    const wheelsAfterBlur = xtermMocks.instances[0].wheelDeltas.length;
    act(() => vi.advanceTimersByTime(160));
    expect(xtermMocks.instances[0].wheelDeltas).toHaveLength(wheelsAfterBlur);
    vi.useRealTimers();
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

  it("keeps the TUI transcript tail anchored when the composer resizes the terminal", async () => {
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

    // Anchored TUI over scrollback: the 10-row transcript tail (buffer rows
    // 46..55) sits on the bottom screen row of the 24-row screen, so 14 blank
    // rows below baseY pull the viewport up to row 32. Rows above carry the
    // session history (content > one screen).
    const lines = Array.from({ length: 88 }, (_, index) => (index < 46 ? `history-${index}` : ""));
    for (let i = 46; i < 56; i += 1) lines[i] = `content-${i}`;
    act(() => {
      terminal.setBuffer("normal", 32, 46);
      terminal.buffer.active.lines = lines;
    });
    expect(terminal.buffer.active.viewportY).toBe(32);
    expect(terminal.scrollBottomCalls).toBe(0);

    // Composer grows: the host loses 6 rows. The transcript tail must stay on
    // the bottom screen row instead of slipping below the viewport, which left
    // stale scrollback on screen and cut off the TUI's bottom rows.
    xtermMocks.fitDimensions = { cols: 80, rows: 18 };
    act(() => xtermMocks.resizeObservers.forEach((notify) => notify()));
    await waitFor(() => expect(terminalResize).toHaveBeenCalledWith({ id: 1, cols: 80, rows: 18 }));
    expect(terminal.buffer.active.viewportY).toBe(38);

    // Shrinking the composer again restores the original anchor.
    xtermMocks.fitDimensions = { cols: 80, rows: 24 };
    act(() => xtermMocks.resizeObservers.forEach((notify) => notify()));
    await waitFor(() => expect(terminalResize).toHaveBeenCalledWith({ id: 1, cols: 80, rows: 24 }));
    expect(terminal.buffer.active.viewportY).toBe(32);
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
    await activateTaskDirectory("/work/docs");
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task-clear"));
    });
    fireEvent.click(sessionButton());

    expect(workbenchOpenSession).toHaveBeenCalledTimes(1);
    expect(terminalSpawn).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".wb-terminal-tab-label")?.textContent).toBe("Fix renderer");
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

  it("marks open workbench sessions with an activity dot until the terminal closes", async () => {
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
    fireEvent.click(await screen.findByRole("button", { name: /Recently updated/ }));
    await screen.findByRole("button", { name: "Close terminal" });
    await waitFor(() => expect(document.querySelector(".wb-list-item.has-wb-activity .wb-session-activity-dot")).not.toBeNull());
    expect(screen.getByRole("button", { name: /Older session/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
    await waitFor(() => expect(document.querySelector(".wb-list-item .wb-session-activity-dot")).toBeNull());
    expect(screen.getByRole("button", { name: /Recently updated/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Older session/ })).toBeTruthy();
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
      terminalAttach: async () => ({ ok: true, replay: "" }),
      terminalDetach: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy,
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await screen.findByRole("button", { name: "Close terminal" });
    await waitFor(() => expect(xtermMocks.instances.length).toBeGreaterThan(0));
    expect(setWorkbenchActive).toHaveBeenCalledWith(true);
    act(() => onWorkbenchCmdW?.());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Close terminal" })).toBeNull());
    await waitFor(() => expect(terminalDestroy).toHaveBeenCalledWith({ id: 1 }));
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

  it("highlights the matching session row when its terminal tab is activated (reverse binding)", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let spawnSeq = 0;
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal", "desktop.workbench.terminalTabs": "Terminal tabs"
      } }),
      onLocaleChanged: () => () => undefined,
      setWorkbenchActive: () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex", id: "session-a", title: "Session A", projectPath: "/work/app", updatedAt: 3 },
        { provider: "codex", id: "session-b", title: "Session B", projectPath: "/work/app", updatedAt: 2 }
      ],
      workbenchOpenSession: async ({ id }: { id: string }) => ({ mode: "xterm", command: `codex resume ${id}`, cwd: "/work/app" }),
      terminalSpawn: async () => ({ id: ++spawnSeq }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    const listItem = (title: string) => [...document.querySelectorAll<HTMLButtonElement>(".wb-list-item")]
      .find((item) => item.textContent?.includes(title));
    const tabByLabel = (title: string) => [...document.querySelectorAll(".wb-terminal-tab")].find((tab) =>
      tab.querySelector(".wb-terminal-tab-label")?.textContent === title
    );

    // Opening a session from the list activates its tab and highlights its row.
    fireEvent.click(await screen.findByRole("button", { name: /Session A/ }));
    await waitFor(() => expect(tabByLabel("Session A")?.classList.contains("active")).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: /Session B/ }));
    await waitFor(() => expect(tabByLabel("Session B")?.classList.contains("active")).toBe(true));
    expect(listItem("Session B")?.classList.contains("active")).toBe(true);
    expect(listItem("Session A")?.classList.contains("active")).toBe(false);

    // Reverse: activating Session A's tab must highlight its row.
    fireEvent.click(tabByLabel("Session A")!.querySelector("button.wb-terminal-tab-label")!);
    await waitFor(() => expect(listItem("Session A")?.classList.contains("active")).toBe(true));
    expect(listItem("Session B")?.classList.contains("active")).toBe(false);

    // A non-session pane (shell terminal) clears the session highlight.
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-terminal.active")?.textContent).toContain("Terminal 1"));
    await waitFor(() => expect(document.querySelector(".wb-list-item.active")).toBeNull());
  });

  it("highlights the matching chat row when an ACP tab is activated", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let spawnSeq = 0;
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.loading": "Loading…", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.acpEmptyTitle": "ACP chat", "desktop.workbench.acpEmptyHint": "Send a message", "desktop.workbench.acpInputPlaceholder": "Message", "desktop.workbench.acpConnecting": "Connecting…", "desktop.workbench.acpReady": "Ready", "desktop.workbench.acpError": "Error", "desktop.workbench.acpProvider.claude": "Claude Code"
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
      listSessions: async () => [
        { provider: "chat", id: "record-1", title: "ACP task", projectPath: "/work/app", acpProvider: "claude", updatedAt: 3 },
        { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 2 }
      ],
      notesList: async () => [],
      workbenchOpenSession: async ({ id }: { id: string }) => ({ mode: "xterm", command: `codex resume ${id}`, cwd: "/work/app" }),
      terminalSpawn: async () => ({ id: ++spawnSeq }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalGitStatus: async () => ({ isRepo: false, root: null, staged: [], unstaged: [], nestedRepos: [], tracking: [] }),
      terminalGitFetch: async () => ({ ok: true }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    const listItem = (title: string) => [...document.querySelectorAll<HTMLButtonElement>(".wb-list-item")]
      .find((item) => item.textContent?.includes(title));

    fireEvent.click(await screen.findByRole("button", { name: /ACP task/ }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-acp.active")).toBeTruthy());
    expect(listItem("ACP task")?.classList.contains("active")).toBe(true);

    // Activate a CLI session tab, then switch back to the ACP tab: the row must follow.
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-acp.active")).toBeFalsy());
    fireEvent.click(document.querySelector<HTMLButtonElement>(".wb-terminal-tab.is-acp .wb-terminal-tab-label")!);
    await waitFor(() => expect(listItem("ACP task")?.classList.contains("active")).toBe(true));
    expect(listItem("Fix renderer")?.classList.contains("active")).toBe(false);
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
    await activateTaskDirectory("/work/app");
    const newSessionButton = screen.getByRole("button", { name: /New session/i }) as HTMLButtonElement;
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
    // Counts ride inside the group capsules; an empty group has no number to show.
    expect(document.querySelector('[data-pane-group="terminal"] .wb-pane-tab-group-count')?.textContent).toBe("1");
    expect(document.querySelector('[data-pane-group="session"] .wb-pane-tab-group-count')).toBeNull();

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
    expect(document.querySelector('[data-pane-group="session"] .wb-pane-tab-group-count')?.textContent).toBe("1");
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
        "desktop.settings.defaultAgent": "Default agent", "desktop.settings.newSessionGroupCli": "CLI (terminal)", "desktop.settings.newSessionGroupAcp": "ACP (visual chat)", "desktop.settings.newSessionTarget.cli_codex": "Codex", "desktop.settings.newSessionTarget.cli_claude": "Claude", "desktop.settings.newSessionTarget.cli_grok": "Grok", "desktop.settings.newSessionTarget.cli_agy": "Antigravity", "desktop.settings.newSessionTarget.cli_opencode": "OpenCode", "desktop.settings.newSessionTarget.cli_pi": "Pi", "desktop.settings.newSessionTarget.cli_cursor": "Cursor CLI", "desktop.settings.newSessionTarget.cli_prime": "Prime Agent", "desktop.settings.newSessionTarget.cli_omp": "OMP", "desktop.settings.newSessionTarget.acp_claude": "ACP · Claude Code", "desktop.settings.newSessionTarget.acp_codex": "ACP · Codex", "desktop.settings.newSessionTarget.acp_grok": "ACP · Grok Build", "desktop.settings.newSessionTarget.acp_opencode": "ACP · OpenCode", "desktop.settings.newSessionTarget.acp_pi": "ACP · Pi", "desktop.settings.newSessionTarget.acp_prime": "ACP · Prime Agent", "desktop.settings.newSessionTarget.acp_omp": "ACP · OMP"
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
      contextMenuShow,
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
    await activateTaskDirectory("/work/app");
    const newSessionButton = screen.getByRole("button", { name: /New session/i });

    chooseContextMenuItem("Claude");
    fireEvent.click(newSessionButton);
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith({
      cwd: "/work/app",
      provider: "claude",
      executionMode: "standard",
      taskNoteId: "wi-test"
    }));
    // The picker is a native NSMenu now: assert the grouped items the renderer sends.
    const items = contextMenuShow.mock.calls.at(-1)![0].items;
    expect(items.find((item) => item.label === "CLI (terminal)")).toBeTruthy();
    expect(items.find((item) => item.label === "ACP (visual chat)")).toBeTruthy();

    chooseContextMenuItem("ACP · Codex");
    fireEvent.click(newSessionButton);
    await waitFor(() => expect(acpCreateSession).toHaveBeenCalledWith({ projectPath: "/work/app", provider: "codex" }));

    chooseContextMenuItem("ACP · Prime Agent");
    fireEvent.click(newSessionButton);
    await waitFor(() => expect(acpCreateSession).toHaveBeenCalledWith({ projectPath: "/work/app", provider: "prime" }));
  });

  it("lists only the CLI/ACP targets when there is no default agent", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchNewSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/c" }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.terminalTabs": "Terminal tabs",
        "desktop.settings.defaultAgent": "Default agent", "desktop.settings.newSessionGroupCli": "CLI (terminal)", "desktop.settings.newSessionGroupAcp": "ACP (visual chat)", "desktop.settings.newSessionTarget.cli_codex": "Codex", "desktop.settings.newSessionTarget.cli_claude": "Claude", "desktop.settings.newSessionTarget.cli_grok": "Grok", "desktop.settings.newSessionTarget.cli_agy": "Antigravity", "desktop.settings.newSessionTarget.cli_opencode": "OpenCode", "desktop.settings.newSessionTarget.cli_pi": "Pi", "desktop.settings.newSessionTarget.cli_cursor": "Cursor CLI", "desktop.settings.newSessionTarget.cli_prime": "Prime Agent", "desktop.settings.newSessionTarget.cli_omp": "OMP", "desktop.settings.newSessionTarget.acp_claude": "ACP · Claude Code", "desktop.settings.newSessionTarget.acp_codex": "ACP · Codex", "desktop.settings.newSessionTarget.acp_grok": "ACP · Grok Build", "desktop.settings.newSessionTarget.acp_opencode": "ACP · OpenCode", "desktop.settings.newSessionTarget.acp_pi": "ACP · Pi", "desktop.settings.newSessionTarget.acp_prime": "ACP · Prime Agent", "desktop.settings.newSessionTarget.acp_omp": "ACP · OMP",
        "desktop.settings.composerMentionsWorkspace": "Workspace", "desktop.settings.composerMentionsCurrentProject": "Current project"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: {
        defaultNewSessionProvider: "codex",
        defaultNewSessionTarget: ""
      } }),
      contextMenuShow,
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchNewSession,
      onAcpStream: () => () => undefined,
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    chooseContextMenuItem("Claude");
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith({
      cwd: "/work/app",
      provider: "claude",
      executionMode: "standard",
      taskNoteId: "wi-test"
    }));
    // No default agent  CLI/ACP only; the workspace mention step is gone.
    const items = contextMenuShow.mock.calls.at(-1)![0].items;
    expect(items.find((item) => item.label === "anfeng")).toBeUndefined();
    expect(items.find((item) => item.label === "CLI (terminal)")).toBeTruthy();
  });

  it("launches default agent immediately when target is set", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchNewSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/app" }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.terminalTabs": "Terminal tabs",
        "desktop.settings.defaultAgent": "Default agent", "desktop.settings.newSessionGroupCli": "CLI (terminal)", "desktop.settings.newSessionGroupAcp": "ACP (visual chat)", "desktop.settings.newSessionTarget.cli_codex": "Codex", "desktop.settings.newSessionTarget.cli_claude": "Claude"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: {
        defaultNewSessionProvider: "codex",
        defaultNewSessionTarget: "cli:codex"
      } }),
      contextMenuShow,
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchNewSession,
      onAcpStream: () => () => undefined,
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith({
      cwd: "/work/app",
      provider: "codex",
      executionMode: "standard",
      taskNoteId: "wi-test"
    }));
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
    await activateTaskDirectory("/work/app");
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector(".wb-terminal-loading")).toBeNull());
    expect(screen.getByRole("button", { name: /New session/i }).hasAttribute("disabled")).toBe(false);
  });

  it("notifies the user and opens session when YOLO mode is unsupported for provider", async () => {
    notificationMocks.notifyDesktop.mockClear();
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchNewSession = vi.fn(async () => ({
      mode: "xterm",
      command: "pi",
      cwd: "/work/app",
      unsupportedYolo: true,
      warning: "YOLO mode is not supported for provider: pi. Starting in standard mode."
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.newSession": "New session", "desktop.workbench.newSessionTitle": "New session · {0}", "desktop.workbench.yoloNotSupported": "YOLO mode is not supported for provider: {0}. Starting in standard mode."
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "pi", newSessionYolo: true } }),
      listSessions: async () => [{ provider: "pi" as const, id: "session-1", title: "Pi session", projectPath: "/work/app", projectId: "project-1", updatedAt: 1 }],
      querySessionsPage: querySessionsPageFromList(async () => [
        { provider: "pi" as const, id: "session-1", title: "Pi session", projectPath: "/work/app", projectId: "project-1", updatedAt: 1 }
      ]),
      listProjects: async () => [{ projectId: "project-1", portableKey: "/work/app", alias: "", hidden: false, pinned: false, lastSeenAtMs: 1, updatedAtMs: 1, localPath: "/work/app", pathMissing: false, sessionCount: 1 }],
      workbenchNewSession,
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalled());
    await waitFor(() => expect(notificationMocks.notifyDesktop).toHaveBeenCalledWith({
      text: "YOLO mode is not supported for provider: pi. Starting in standard mode.",
      kind: "info"
    }));
    expect((document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement).disabled).toBe(false);
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
    await activateTaskDirectory("/work/app");
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);

    const pending = await waitFor(() => {
      const row = [...document.querySelectorAll<HTMLButtonElement>(".wb-list-item")]
        .find((item) => item.textContent?.includes("New session app"));
      if (!row) throw new Error("pending session row not rendered");
      return row;
    });
    expect(pending.hasAttribute("draggable")).toBe(false);
    expect([...document.querySelectorAll<HTMLButtonElement>(".wb-list-item")]
      .find((item) => item.textContent?.includes("Existing session"))?.hasAttribute("draggable")).toBe(true);
    expect(document.querySelectorAll(".wb-session-activity-dot")).toHaveLength(1);
    // A brand-new session opens in the fullscreen terminal: nothing to observe yet.
    expect(document.querySelector(".wb-terminal-fullscreen-bar")).not.toBeNull();
    expect(document.querySelector(".wb-session-split-transcript")).toBeNull();
    fireEvent.click(pending);
    expect(workbenchOpenSession).not.toHaveBeenCalled();

    catalogSessions = [
      ...catalogSessions,
      { provider: "codex", id: "new-id", title: "Catalog session", projectPath: "/work/app", updatedAt: Date.now() }
    ];
    await act(async () => onSessionsSynced?.({ syncedAt: Date.now() }));

    await waitFor(() => expect([...document.querySelectorAll<HTMLButtonElement>(".wb-list-item")]
      .some((item) => item.textContent?.includes("Catalog session"))).toBe(true));
    // The bound terminal was the active pane, so the highlight moves onto the row.
    await waitFor(() => expect([...document.querySelectorAll<HTMLButtonElement>(".wb-list-item")]
      .find((item) => item.textContent?.includes("Catalog session"))?.classList.contains("active")).toBe(true));
    await waitFor(() => expect([...document.querySelectorAll(".wb-list-item")].some((item) => item.textContent?.includes("New session app"))).toBe(false));
    expect(document.querySelectorAll(".wb-session-activity-dot")).toHaveLength(1);
  });

  it("shows clean pending hint in new session, triggers sync on submit, then binds session when catalog syncs", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let onSessionsSynced: ((result: { syncedAt: number }) => void) | undefined;
    let catalogSessions = [{ provider: "pi", id: "existing", title: "Existing", projectPath: "/work/app", updatedAt: 1 }];
    const syncSessions = vi.fn(async () => ({ sessionCount: 1, syncedAt: Date.now(), warnings: [] }));
    const terminalInput = vi.fn(async () => ({ ok: true }));
    const previewSession = vi.fn(async ({ id }: { id: string }) => ({
      session: { provider: "pi", id, title: "Bound Pi Session", projectPath: "/work/app", updatedAt: Date.now() },
      preview: {
        title: "Bound Pi Session",
        messages: [
          { role: "user", text: "Hello Pi" },
          { role: "assistant", text: "Hello from Grok!" }
        ]
      }
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.newSessionTitle": "New session {0}", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.terminalConsole": "Terminal", "desktop.workbench.terminalComposerPlaceholder": "Prompt", "desktop.workbench.transcriptWorking": "Thinking...", "desktop.workbench.sidePanelTranscript": "Transcript", "desktop.workbench.transcriptNewSessionHint": "New session ready"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onSessionsSynced: (callback: (result: { syncedAt: number }) => void) => { onSessionsSynced = callback; return () => undefined; },
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "pi" } }),
      listSessions: async () => catalogSessions,
      querySessionsPage: async () => ({ sessions: catalogSessions, total: catalogSessions.length }),
      workbenchNewSession: async () => ({ mode: "xterm", command: "pi", cwd: "/work/app" }),
      syncSessions,
      previewSession,
      terminalSpawn: async () => ({ id: 1 }),
      terminalInput,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);

    const pending = await waitFor(() => {
      const row = [...document.querySelectorAll<HTMLButtonElement>(".wb-list-item")]
        .find((item) => item.textContent?.includes("New session app"));
      if (!row) throw new Error("pending session row not rendered");
      return row;
    });
    fireEvent.click(pending);
    // The new session starts fullscreen; the split is one toggle away.
    fireEvent.click(document.querySelector(".wb-terminal-mode-toggle-btn") as HTMLButtonElement);
    await waitFor(() => expect(document.querySelector(".wb-session-split-transcript")).not.toBeNull());
    expect(await screen.findByText("New session ready")).toBeTruthy();

    // Enter a prompt into the bottom composer and send it to terminal
    const composer = await screen.findByPlaceholderText("Prompt");
    fireEvent.change(composer, { target: { value: "Hello Pi" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    // Terminal receives input and sync is triggered
    expect(terminalInput).toHaveBeenCalled();

    // Now disk flushes and sync detects the session
    catalogSessions = [
      ...catalogSessions,
      { provider: "pi", id: "pi-session-1", title: "Bound Pi Session", projectPath: "/work/app", updatedAt: Date.now() }
    ];
    await act(async () => onSessionsSynced?.({ syncedAt: Date.now() }));

    // Session is bound, real markdown preview loads with authentic turns
    await waitFor(() => expect(previewSession).toHaveBeenCalledWith(expect.objectContaining({ id: "pi-session-1" })));
    await waitFor(() => expect(document.querySelector(".wb-transcript-body")?.textContent).toContain("Hello from Grok!"));
  });

  it("opens a new session in the fullscreen terminal even when the split view was last used", async () => {
    localStorage.setItem("wb-session-view-mode", "hybrid");
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.newSessionTitle": "New session {0}"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "codex" as const, id: "existing", title: "Existing session", projectPath: "/work/app", updatedAt: 1 }],
      workbenchNewSession: async () => ({ mode: "xterm", command: "codex", cwd: "/work/app" }),
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);

    await waitFor(() => {
      expect(document.querySelector(".wb-terminal-fullscreen-bar")).not.toBeNull();
    });
    expect(document.querySelector(".wb-session-split-transcript")).toBeNull();
    expect(localStorage.getItem("wb-session-view-mode")).toBe("terminal");
  });

  function gitRepositorySelectionStatus(unstaged: Array<{
    path: string;
    repoPath: string;
    repoRoot: string;
    status: string;
    staged: boolean;
    unstaged: boolean;
  }>) {
    return {
      isRepo: true,
      root: null,
      staged: [],
      unstaged,
      nestedRepos: [
        { root: "/work/monorepo/packages/app", displayPath: "packages/app" },
        { root: "/work/monorepo/packages/core", displayPath: "packages/core" }
      ],
      tracking: [
        { repoRoot: "/work/monorepo/packages/app", branch: "main", upstream: "origin/main", ahead: 0, behind: 0 },
        { repoRoot: "/work/monorepo/packages/core", branch: "dev", upstream: "origin/dev", ahead: 0, behind: 0 }
      ]
    };
  }

  async function renderGitRepositorySelector(getStatus: () => Promise<unknown>, contextMenuShow: ReturnType<typeof vi.fn> = vi.fn(async () => null)): Promise<HTMLButtonElement> {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects",
        "desktop.notes.projectFilter": "Project filter",
        "desktop.common.search": "Search",
        "desktop.common.all": "All",
        "desktop.common.active": "Active",
        "desktop.common.pinned": "Pinned",
        "desktop.common.close": "Close",
        "desktop.common.cancel": "Cancel",
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
        "desktop.workbench.gitCommit": "Commit",
        "desktop.workbench.gitCommitAndPush": "Commit & Push",
        "desktop.workbench.gitCommitDialogTitle": "Commit changes",
        "desktop.workbench.resizeCommitInput": "Resize commit input",
        "desktop.workbench.gitCommitAutoGenerate": "Auto generate",
        "desktop.workbench.gitLog": "Git log",
        "desktop.workbench.gitSync": "Sync",
        "desktop.workbench.gitRepoSelect": "Git repository",
        "desktop.workbench.switchBranch": "Switch branch",
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
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/monorepo", updatedAt: 1 }],
      terminalGitStatus: async () => getStatus(),
      terminalGitFetch: async () => ({ ok: true }),
      contextMenuShow
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/monorepo");
    fireEvent.click(screen.getAllByRole("button", { name: /^Git/ })[0]!);
    return screen.findByRole("button", { name: /^Git repository:/ }) as Promise<HTMLButtonElement>;
  }

  it("shows GTD status, filters the GTD view, and updates it from the session menu", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const setSessionGtdStatus = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.rename": "Rename", "desktop.workbench.sidebarView": "Workbench sidebar view", "desktop.workbench.projectsView": "Project view", "desktop.workbench.gtdView": "GTD view", "desktop.workbench.filterGtdSessions": "Filter GTD sessions", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.openInChatGpt": "Open in ChatGPT", "desktop.workbench.preview": "Preview", "desktop.workbench.mountNote": "Mount note", "desktop.workbench.removeFromPanel": "Remove", "desktop.workbench.setGtdStatus": "Set GTD status", "desktop.workbench.clearGtdStatus": "Clear GTD status", "desktop.workbench.gtdStatusSaveFailed": "Save failed: {0}", "desktop.workbench.gtdStatusLabel": "GTD status: {0}", "desktop.workbench.gtdCompleted": "Completed", "desktop.workbench.gtdStatus.inbox": "To do", "desktop.workbench.gtdStatus.next": "In progress", "desktop.workbench.gtdStatus.waiting": "Waiting", "desktop.workbench.gtdStatus.done": "Done"
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
    expect(nextSession.querySelector(".wb-gtd-status-badge")?.textContent).toBe("In progress");

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
  });

  it("updates note GTD from the note context menu", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let noteStatus: GtdStatus | undefined = "next";
    const notesSetGtdStatus = vi.fn(async ({ status }: { noteId: string; status: GtdStatus | null }) => {
      noteStatus = status ?? undefined;
      return { noteId: "note-1" };
    });
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.noteTab": "Note", "desktop.workbench.sessionTab": "Sessions",
        "desktop.workbench.noteFilter": "Filter notes", "desktop.workbench.noNotes": "No notes",
        "desktop.workbench.newNote": "New note", "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.setGtdStatus": "Set GTD status", "desktop.workbench.clearGtdStatus": "Clear GTD status",
        "desktop.workbench.gtdStatusLabel": "GTD status: {0}", "desktop.workbench.gtdStatusSaveFailed": "Save failed: {0}",
        "desktop.workbench.gtdStatus.inbox": "To do", "desktop.workbench.gtdStatus.next": "In progress",
        "desktop.workbench.gtdStatus.waiting": "Waiting", "desktop.workbench.gtdStatus.done": "Done",
        "desktop.gtd.unmarked": "Unmarked", "desktop.gtd.unmarkedHint": "No GTD status set"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      listProjects: async () => [],
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesList: async () => [{
        noteId: "note-1", scope: "library", filename: "design-doc.md", relDir: "library",
        relMdPath: "notes/library/design-doc.md", title: "Design doc", createdAtMs: 1, updatedAtMs: 1, gtdStatus: noteStatus
      }],
      notesSetGtdStatus,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("tab", { name: "Note" }));

    const row = await screen.findByRole("button", { name: "Design doc" });
    expect(row.querySelector(".wb-gtd-status-badge")?.textContent).toBe("In progress");

    fireEvent.contextMenu(row);
    // The note menu no longer offers an "open note" item; clicking the row opens it.
    expect(screen.queryByRole("menuitem", { name: "Open note" })).toBeNull();
    const waitingTag = await screen.findByRole("menuitemradio", { name: "Waiting" });
    expect(waitingTag.classList.contains("wb-gtd-context-tag")).toBe(true);
    fireEvent.click(waitingTag);
    await waitFor(() => expect(notesSetGtdStatus).toHaveBeenCalledWith({ noteId: "note-1", status: "waiting" }));
    await waitFor(() => expect(
      screen.getByRole("button", { name: "Design doc" }).querySelector(".wb-gtd-status-badge")?.textContent
    ).toBe("Waiting"));
  });

  const searchI18nMessages: Record<string, string> = {
    "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.findCount": "{0} / {1}", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelSearch": "Search", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.sidePanelNoRoot": "Select a project", "desktop.workbench.searchPlaceholder": "Search in project", "desktop.workbench.searchOptions": "Search options", "desktop.workbench.searchMatchCase": "Match Case", "desktop.workbench.searchWholeWord": "Match Whole Word", "desktop.workbench.searchUseRegex": "Use Regular Expression", "desktop.workbench.searchHint": "Type to search", "desktop.workbench.searchSearching": "Searching…", "desktop.workbench.searchNoResults": "No results", "desktop.workbench.searchResultSummary": "{0} results in {1} files", "desktop.workbench.searchTruncated": "results limited", "desktop.workbench.searchFailed": "Search failed: {0}", "desktop.workbench.explorerGitFileHistory": "View Git File History", "desktop.workbench.findInFolder": "Find in Folder", "desktop.workbench.searchToggleDetails": "Toggle search details", "desktop.workbench.searchToggleReplace": "Toggle replace", "desktop.workbench.searchReplacePlaceholder": "Replace", "desktop.workbench.searchReplaceAll": "Replace All", "desktop.workbench.searchReplaceInFile": "Replace all in file", "desktop.workbench.searchReplaceMatch": "Replace occurrence", "desktop.workbench.searchReplaceLimited": "Results were limited", "desktop.workbench.searchReplaceDone": "Replaced {0} occurrence(s) in {1} file(s)", "desktop.workbench.searchReplaceSkipped": "{0} skipped (unsaved changes)", "desktop.workbench.searchReplaceBlockedDirty": "Target files have unsaved changes", "desktop.workbench.searchReplaceFailed": "Replace failed: {0}", "desktop.workbench.searchFilesToInclude": "files to include", "desktop.workbench.searchFilesToIncludePlaceholder": "e.g. **/*.{ts,tsx}, src/**", "desktop.workbench.searchFilesToExclude": "files to exclude", "desktop.workbench.searchFilesToExcludePlaceholder": "e.g. **/*.test.ts", "desktop.workbench.quickAccessProjectPlaceholder": "Search projects by name or path", "desktop.workbench.quickAccessSelectProject": "Select project", "desktop.workbench.quickAccessNoProjects": "No matching projects", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.fileSaved": "Saved", "desktop.workbench.fileModified": "Modified", "desktop.workbench.fileSaving": "Saving…", "desktop.common.save": "Save", "desktop.workbench.closeFile": "Close file"
  };

  function searchHarness(opts: {
    searchResult?: { matches: unknown[]; truncated: boolean; filesSearched: number; engine: string };
  }) {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchSearchText = vi.fn(async (args?: { filesToExclude?: string; filesToInclude?: string }) => opts.searchResult ?? {
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
    });
    const workbenchReplaceText = vi.fn(async () => ({
      replaced: [{ path: "src/main.ts", count: 1 }],
      skipped: [],
      totalReplaced: 1
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: searchI18nMessages }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [{ provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 1 }],
      workbenchSearchText,
      workbenchSearchTextCancel: async () => ({ ok: true }),
      workbenchReplaceText,
      contextMenuShow
    } as unknown as typeof window.agentResume;
    return { workbenchSearchText, workbenchReplaceText, host };
  }

  async function openSearchWithResults(host: HTMLElement): Promise<void> {
    // Reset persisted pane toggles so each test starts with details/replace closed.
    localStorage.setItem("wb-search-details-open", "false");
    localStorage.setItem("wb-search-replace-open", "false");
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    fireEvent.click(screen.getByRole("button", { name: "Search", pressed: false }));
    fireEvent.change(await screen.findByRole("searchbox", { name: "Search" }), { target: { value: "findme" } });
  }

  it("switches tasks from the command palette and closes Quick Access", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let openCommands: () => void = () => undefined;
    const taskWindowOpen = vi.fn(async () => ({ ok: true, created: true, limit: 8 }));
    const listTaskWorkbenches = vi.fn(async ({ taskNoteId }: { taskNoteId: string }) => [{
      workbenchId: `wb-${taskNoteId}`,
      taskNoteId,
      name: "",
      projectPath: null,
      position: 0,
      layoutJson: null,
      createdAtMs: 1,
      updatedAtMs: 1
    }]);
    const notesListTasks = vi.fn(async (options?: { includeArchived?: boolean }) => [
      {
        noteId: "task-1", title: "Ship palette", filename: "ship-palette.md", gtdStatus: "next", updatedAtMs: 2,
        work: { next: "Cut release", sessions: ["codex:session-1"], projects: ["/work/app"], primaryProject: "/work/app" }
      },
      { noteId: "task-2", title: "Fix board", filename: "fix-board.md", gtdStatus: "inbox", updatedAtMs: 1, work: { sessions: [] } },
      { noteId: "task-archived", title: "Old board", filename: "old-board.md", gtdStatus: "done", updatedAtMs: 0, archivedAtMs: 1, work: { sessions: [] } }
    ].filter((record) => options?.includeArchived !== false || record.archivedAtMs === undefined));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.quickAccessDialog": "Quick Access",
        "desktop.workbench.quickAccessFilePlaceholder": "Search files by path",
        "desktop.workbench.quickAccessCommandPlaceholder": "Type a command",
        "desktop.workbench.quickAccessNoFiles": "No files",
        "desktop.workbench.quickAccessNoCommands": "No commands",
        "desktop.workbench.quickAccessNoProject": "No folder",
        "desktop.workbench.quickAccessClose": "Close",
        "desktop.workbench.quickAccessCategoryTasks": "Tasks",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdShiftP: (callback: () => void) => { openCommands = callback; return () => undefined; },
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks,
      ensureTaskWorkbench: async () => ({ ok: true }),
      listTaskWorkbenches,
      taskWindowOpen
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await act(async () => openCommands());

    const input = await waitFor(() => document.querySelector(".quick-access-input") as HTMLInputElement);
    expect(await screen.findByRole("option", { name: /Ship palette/ })).toBeTruthy();
    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.getByText("Next: Cut release")).toBeTruthy();
    // Archived tasks are not palette targets.
    expect(notesListTasks).toHaveBeenCalledWith({ includeArchived: false });
    expect(screen.queryByRole("option", { name: /Old board/ })).toBeNull();

    fireEvent.change(input, { target: { value: ">board" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The window owns one workbench, so switching tasks opens the target's window.
    await waitFor(() => expect(taskWindowOpen).toHaveBeenCalledWith({
      noteId: "task-2",
      workbenchId: "wb-task-2",
      title: "Fix board"
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Quick Access" })).toBeNull());
  });

  it("shows the live status on a session tab", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.refresh": "Refresh", "desktop.common.loading": "Loading…", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.closeTerminal": "Close terminal"
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
      terminalResize: async () => ({ ok: true }),
      agentStatusGetSnapshot: async () => ({
        byPaneId: { "1": { paneId: 1, agent: "codex", state: "blocked", authority: "screen", source: "screen", updatedAt: 1 } },
        bySessionKey: {},
        seq: 1
      }),
      onAgentStatusChanged: () => () => undefined
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(await screen.findByRole("button", { name: /Fix renderer/ }));
    await waitFor(() => expect(document.querySelector(".wb-terminal-tab.is-session.active .session-dot.is-awaiting")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "desktop.common.collapse" }));
    await waitFor(() => expect(document.querySelector(".wb-session-split-tui-awaiting")).toBeTruthy());
  });

  it("opens a floating note from an active CLI session tab and creates the session note", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const notesList = vi.fn(async () => []);
    const notesCreate = vi.fn(async () => ({ noteId: "floating-note", filename: "floating.md" }));
    const notesWrite = vi.fn(async ({ noteId, content }: { noteId: string; content: string }) => ({ noteId, filename: "floating.md", updatedAtMs: 3, content }));
    const notesDelete = vi.fn(async () => ({ ok: true }));
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
      notesWrite,
      notesDelete
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

    fireEvent.click(screen.getByRole("button", { name: "Close floating note" }));
    await waitFor(() => expect(notesDelete).toHaveBeenCalledWith({ noteId: "floating-note" }));
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
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter", "desktop.common.search": "Search", "desktop.common.all": "All", "desktop.common.active": "Active", "desktop.common.pinned": "Pinned", "desktop.common.refresh": "Refresh", "desktop.common.rename": "Rename", "desktop.workbench.allSessions": "All sessions", "desktop.workbench.noSessionsInProject": "No sessions", "desktop.workbench.noProjects": "No projects", "desktop.workbench.sidePanelExplorer": "Explorer", "desktop.workbench.sidePanelGit": "Git", "desktop.workbench.newTerminal": "New terminal", "desktop.workbench.newSession": "New session", "desktop.workbench.selectSessionHint": "Select a session", "desktop.workbench.selectProjectHint": "Select a project", "desktop.workbench.externalTerminalHint": "Opened externally", "desktop.workbench.terminalLabel": "Terminal {0}", "desktop.workbench.openInChatGpt": "Open in ChatGPT", "desktop.workbench.preview": "Preview", "desktop.workbench.mountNote": "Mount note", "desktop.workbench.addFloatingNote": "Add floating note", "desktop.workbench.openFloatingNote": "Open floating note", "desktop.workbench.removeFromPanel": "Remove from panel", "desktop.workbench.setGtdStatus": "Set GTD status", "desktop.workbench.gtdStatus.inbox": "To do", "desktop.workbench.gtdStatus.next": "In progress", "desktop.workbench.gtdStatus.waiting": "Waiting", "desktop.workbench.gtdStatus.done": "Done", "desktop.workbench.floatingNote": "Floating note", "desktop.workbench.floatingNoteClose": "Close floating note", "desktop.workbench.floatingNoteEditor": "Floating note editor", "desktop.workbench.floatingNoteLoading": "Loading floating note…", "desktop.workbench.floatingNoteCreating": "Creating floating note…", "desktop.workbench.floatingNoteSaved": "Saved", "desktop.workbench.floatingNoteUnsaved": "Unsaved changes", "desktop.workbench.floatingNoteSaving": "Saving…", "desktop.workbench.floatingNoteLoadFailed": "Could not open floating note.", "desktop.workbench.floatingNoteLoadError": "Could not open floating note: {0}", "desktop.workbench.floatingNoteSaveFailed": "Save failed: {0}"
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

  /** True when real DOM focus is on an enabled composer textarea (box-primary). */
  const activeComposer = () => {
    const el = document.activeElement;
    return el instanceof HTMLTextAreaElement
      && el.classList.contains("wb-terminal-composer-input")
      && !el.disabled;
  };
  const waitForComposerFocus = async () => {
    await waitFor(() => expect(activeComposer()).toBe(true));
  };

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
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      previewSession: async () => ({ session: { provider: "codex", id: "session-c", title: "Session C", projectPath: "/work/app", updatedAt: 1 }, preview: { title: "Session C", messages: [] } }),
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
    await waitForComposerFocus();

    // Existing pane: a second resume re-focuses the already-open session's composer immediately.
    await act(async () => resume("session-c"));
    await waitForComposerFocus();
  });

  it("workbench-open-session focuses an open session terminal, else opens a fresh one", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let spawnSeq = 0;
    const spawnResolvers = new Map<string, (result: { id: number }) => void>();
    const terminalSpawn = vi.fn(({ command }: { command: string }) => new Promise<{ id: number }>((resolve) => {
      spawnResolvers.set(command, resolve);
    }));
    const workbenchOpenSession = vi.fn(async ({ id }: { id: string }) => ({
      mode: "xterm",
      command: `codex resume ${id}`,
      cwd: "/work/app"
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: ARROW_TEST_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      previewSession: async ({ id }: { id: string }) => ({ session: { provider: "codex", id, title: `Session ${id}`, projectPath: "/work/app", updatedAt: 1 }, preview: { title: `Session ${id}`, messages: [] } }),
      workbenchOpenSession,
      terminalSpawn,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalGitStatus: async () => ({ isRepo: false, root: null, staged: [], unstaged: [], nestedRepos: [], tracking: [] }),
      terminalGitFetch: async () => ({ ok: true }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    const open = (id: string) => window.dispatchEvent(new CustomEvent("agent-resume:workbench-open-session", {
      detail: { provider: "codex", id, title: `Session ${id}`, projectPath: "/work/app", updatedAt: 1 }
    }));

    // Not open yet: spawns exactly one fresh terminal.
    await act(async () => open("session-a"));
    await waitFor(() => expect(workbenchOpenSession).toHaveBeenCalledWith({ provider: "codex", id: "session-a" }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    await act(async () => spawnResolvers.get("codex resume session-a")!({ id: ++spawnSeq }));
    await waitForComposerFocus();

    // Already open: re-focuses the same pane without a second instance.
    await act(async () => open("session-a"));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    await waitForComposerFocus();
  });

  it("workbench-open-session opens an ACP chat pane, or focuses it when already open", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const acpSession = { provider: "chat", id: "record-1", title: "ACP task", projectPath: "/work/app", acpProvider: "claude", updatedAt: 1 };
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        ...ARROW_TEST_MESSAGES,
        "desktop.workbench.acpEmptyTitle": "ACP chat",
        "desktop.workbench.acpEmptyHint": "Send a message",
        "desktop.workbench.acpInputPlaceholder": "Message",
        "desktop.workbench.acpConnecting": "Connecting…",
        "desktop.workbench.acpReady": "Ready",
        "desktop.workbench.acpError": "Error",
        "desktop.workbench.acpProvider.claude": "Claude Code"
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
      listSessions: async () => [acpSession],
      notesList: async () => [],
      terminalGitStatus: async () => ({ isRepo: false, root: null, staged: [], unstaged: [], nestedRepos: [], tracking: [] }),
      terminalGitFetch: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    const open = () => window.dispatchEvent(new CustomEvent("agent-resume:workbench-open-session", { detail: acpSession }));

    // Not open yet: adds a single ACP chat pane.
    await act(async () => open());
    await waitFor(() => expect(document.querySelectorAll(".wb-terminal-tab.is-acp")).toHaveLength(1));
    expect(document.querySelector(".wb-terminal-tab.is-acp.active")).toBeTruthy();

    // Already open: re-focuses the same pane, still one ACP pane.
    await act(async () => open());
    await waitFor(() => expect(document.querySelectorAll(".wb-terminal-tab.is-acp")).toHaveLength(1));
    expect(document.querySelector(".wb-terminal-tab.is-acp.active")).toBeTruthy();
  });

  const SESSION_SELECT_MESSAGES: Record<string, string> = {
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
    "desktop.workbench.newTerminal": "New terminal",
    "desktop.workbench.newSession": "New session",
    "desktop.workbench.selectSessionHint": "Select a session",
    "desktop.workbench.selectProjectHint": "Select a project",
    "desktop.workbench.externalTerminalHint": "Opened externally",
    "desktop.workbench.terminalLabel": "Terminal {0}",
    "desktop.workbench.preview": "Preview",
    "desktop.workbench.mountNote": "Mount note",
    "desktop.workbench.removeFromPanel": "Remove from panel",
    "desktop.workbench.removeFromPanelCount": "Remove {0} from panel",
    "desktop.workbench.removeConfirm": "Remove {0} from panel?",
    "desktop.workbench.removeMultipleConfirm": "Remove {0} sessions from panel? Native agent storage is unchanged.",
    "desktop.workbench.selectedCount": "{0} selected",
    "desktop.workbench.setGtdStatus": "Set GTD status",
    "desktop.workbench.gtdStatus.inbox": "To do",
    "desktop.workbench.gtdStatus.next": "In progress",
    "desktop.workbench.gtdStatus.waiting": "Waiting",
    "desktop.workbench.gtdStatus.done": "Done"
  };

  function listItem(title: string): HTMLButtonElement {
    const row = [...document.querySelectorAll<HTMLButtonElement>(".wb-list-item")]
      .find((button) => button.textContent?.includes(title));
    if (!row) throw new Error(`session row missing: ${title}`);
    return row;
  }

  it("toggles catalog sessions with cmd-click without opening them", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchOpenSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/app", external: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: SESSION_SELECT_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 3 },
        { provider: "codex", id: "session-2", title: "Review tests", projectPath: "/work/app", updatedAt: 2 },
        { provider: "codex", id: "session-3", title: "Write docs", projectPath: "/work/app", updatedAt: 1 }
      ],
      workbenchOpenSession
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await waitFor(() => expect(listItem("Fix renderer")).toBeTruthy());
    fireEvent.click(listItem("Fix renderer"), { metaKey: true });
    fireEvent.click(listItem("Write docs"), { metaKey: true });
    expect(listItem("Fix renderer").classList.contains("is-selected")).toBe(true);
    expect(listItem("Write docs").classList.contains("is-selected")).toBe(true);
    expect(listItem("Review tests").classList.contains("is-selected")).toBe(false);
    expect(workbenchOpenSession).not.toHaveBeenCalled();
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("selects a contiguous catalog range with shift-click", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchOpenSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/app", external: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: SESSION_SELECT_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 3 },
        { provider: "codex", id: "session-2", title: "Review tests", projectPath: "/work/app", updatedAt: 2 },
        { provider: "codex", id: "session-3", title: "Write docs", projectPath: "/work/app", updatedAt: 1 }
      ],
      workbenchOpenSession
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await waitFor(() => expect(listItem("Fix renderer")).toBeTruthy());
    fireEvent.click(listItem("Fix renderer"), { metaKey: true });
    fireEvent.click(listItem("Write docs"), { shiftKey: true });
    expect(listItem("Fix renderer").classList.contains("is-selected")).toBe(true);
    expect(listItem("Review tests").classList.contains("is-selected")).toBe(true);
    expect(listItem("Write docs").classList.contains("is-selected")).toBe(true);
    expect(workbenchOpenSession).not.toHaveBeenCalled();
  });

  it("removes every selected session from the panel after one confirm", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let sessions = [
      { provider: "codex" as const, id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 3 },
      { provider: "codex" as const, id: "session-2", title: "Review tests", projectPath: "/work/app", updatedAt: 2 },
      { provider: "codex" as const, id: "session-3", title: "Write docs", projectPath: "/work/app", updatedAt: 1 }
    ];
    const hideSessions = vi.fn(async ({ sessions: targets }: { sessions: Array<{ id: string }> }) => {
      const ids = new Set(targets.map((item) => item.id));
      sessions = sessions.filter((item) => !ids.has(item.id));
      return { ok: true };
    });
    const hideSession = vi.fn(async () => ({ ok: true }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onMutated = vi.fn();
    window.addEventListener("agent-resume:sessions-mutated", onMutated);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: SESSION_SELECT_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => sessions,
      hideSessions,
      hideSession,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await waitFor(() => expect(listItem("Fix renderer")).toBeTruthy());
    fireEvent.click(listItem("Fix renderer"), { metaKey: true });
    fireEvent.click(listItem("Review tests"), { metaKey: true });
    fireEvent.contextMenu(listItem("Review tests"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove 2 from panel" }));
    await waitFor(() => expect(hideSessions).toHaveBeenCalledWith({
      sessions: [
        { provider: "codex", id: "session-1" },
        { provider: "codex", id: "session-2" }
      ]
    }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(hideSession).not.toHaveBeenCalled();
    await waitFor(() => expect(document.body.textContent).not.toContain("Fix renderer"));
    expect(document.body.textContent).not.toContain("Review tests");
    expect(document.body.textContent).toContain("Write docs");
    await waitFor(() => expect(onMutated).toHaveBeenCalled());
    window.removeEventListener("agent-resume:sessions-mutated", onMutated);
    confirm.mockRestore();
  });

  it("collapses a multi-selection when right-clicking an unselected row", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const hideSessions = vi.fn(async () => ({ ok: true }));
    const hideSession = vi.fn(async () => ({ ok: true }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: SESSION_SELECT_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 3 },
        { provider: "codex", id: "session-2", title: "Review tests", projectPath: "/work/app", updatedAt: 2 },
        { provider: "codex", id: "session-3", title: "Write docs", projectPath: "/work/app", updatedAt: 1 }
      ],
      hideSessions,
      hideSession,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await waitFor(() => expect(listItem("Fix renderer")).toBeTruthy());
    fireEvent.click(listItem("Fix renderer"), { metaKey: true });
    fireEvent.click(listItem("Review tests"), { metaKey: true });
    fireEvent.contextMenu(listItem("Write docs"));
    expect(listItem("Write docs").classList.contains("is-selected")).toBe(true);
    expect(listItem("Fix renderer").classList.contains("is-selected")).toBe(false);
    expect(listItem("Review tests").classList.contains("is-selected")).toBe(false);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove from panel" }));
    await waitFor(() => expect(hideSession).toHaveBeenCalledWith({ provider: "codex", id: "session-3" }));
    expect(hideSessions).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("does not hide sessions when the batch confirm is cancelled", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const hideSessions = vi.fn(async () => ({ ok: true }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: SESSION_SELECT_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 3 },
        { provider: "codex", id: "session-2", title: "Review tests", projectPath: "/work/app", updatedAt: 2 }
      ],
      hideSessions,
      workbenchOpenSession: async () => ({ mode: "external-system", cwd: "/work/app", external: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await waitFor(() => expect(listItem("Fix renderer")).toBeTruthy());
    fireEvent.click(listItem("Fix renderer"), { metaKey: true });
    fireEvent.click(listItem("Review tests"), { metaKey: true });
    fireEvent.contextMenu(listItem("Fix renderer"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove 2 from panel" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(hideSessions).not.toHaveBeenCalled();
    expect(listItem("Fix renderer").classList.contains("is-selected")).toBe(true);
    confirm.mockRestore();
  });

  it("does not add a pending session to a catalog multi-selection", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchOpenSession = vi.fn();
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        ...SESSION_SELECT_MESSAGES,
        "desktop.workbench.newSessionTitle": "New session {0}",
        "desktop.workbench.closeTerminal": "Close terminal",
        "desktop.workbench.terminalTabs": "Terminal tabs"
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
        { provider: "codex", id: "existing", title: "Existing session", projectPath: "/work/app", updatedAt: 1 }
      ],
      workbenchNewSession: async () => ({ mode: "xterm", command: "codex", cwd: "/work/app" }),
      workbenchOpenSession,
      terminalSpawn: async () => ({ id: 1 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    fireEvent.click(document.querySelector(".wb-pane-tab-group-label") as HTMLButtonElement);
    const pending = await waitFor(() => listItem("New session app"));
    fireEvent.click(listItem("Existing session"), { metaKey: true });
    fireEvent.click(pending, { metaKey: true });
    expect(listItem("Existing session").classList.contains("is-selected")).toBe(true);
    expect(pending.classList.contains("is-selected")).toBe(false);
    expect(workbenchOpenSession).not.toHaveBeenCalled();
  });

  it("collapses a multi-selection to one session on a plain click", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchOpenSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/app", external: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: SESSION_SELECT_MESSAGES }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [
        { provider: "codex", id: "session-1", title: "Fix renderer", projectPath: "/work/app", updatedAt: 3 },
        { provider: "codex", id: "session-2", title: "Review tests", projectPath: "/work/app", updatedAt: 2 }
      ],
      workbenchOpenSession
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await waitFor(() => expect(listItem("Fix renderer")).toBeTruthy());
    fireEvent.click(listItem("Fix renderer"), { metaKey: true });
    fireEvent.click(listItem("Review tests"), { metaKey: true });
    fireEvent.click(listItem("Fix renderer"));
    await waitFor(() => expect(workbenchOpenSession).toHaveBeenCalledWith({ provider: "codex", id: "session-1" }));
    expect(listItem("Fix renderer").classList.contains("is-selected")).toBe(true);
    expect(listItem("Review tests").classList.contains("is-selected")).toBe(false);
  });

  it("sends selected note text to a new CLI session and an open pane", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbenchNewSession = vi.fn(async () => ({ mode: "xterm", command: "pi", cwd: "/work/app" }));
    const acpCreateSession = vi.fn(async ({ projectPath, provider }: { projectPath: string; provider: string }) => ({
      id: "acp-new",
      title: "ACP session",
      projectPath,
      provider,
      createdAt: 1,
      updatedAt: 1,
      messageCount: 0
    }));
    const terminalInput = vi.fn(async () => ({ ok: true }));
    const setWorkbenchActiveSessions = vi.fn();
    let sendSelection: ((payload: { kind: string; text: string; target?: string; paneKey?: string; projectPath?: string }) => void) | undefined;
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        ...ARROW_TEST_MESSAGES,
        "desktop.workbench.newSessionTitle": "New session {0}",
        "desktop.notes.sendSelectionMissingSession": "That session is no longer open.",
        "desktop.settings.newSessionTarget.cli_pi": "Pi"
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
      acpCreateSession,
      onAcpStream: () => () => undefined,
      acpConnect: async () => ({ record: { id: "acp-new", title: "ACP session", projectPath: "/work/app", provider: "pi", createdAt: 1, updatedAt: 1, messageCount: 0 }, init: {} }),
      acpDisconnect: async () => ({ ok: true }),
      setWorkbenchActiveSessions,
      getWorkbenchActiveSessions: async () => [],
      onWorkbenchSendSelection: (callback: typeof sendSelection) => {
        sendSelection = callback;
        return () => undefined;
      },
      terminalSpawn: async () => ({ id: 21 }),
      terminalInput,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await activateTaskDirectory("/work/app");
    await waitFor(() => expect(sendSelection).toBeTypeOf("function"));
    await waitFor(() => expect(setWorkbenchActiveSessions).toHaveBeenCalled());

    await act(async () => sendSelection?.({
      kind: "new-agent",
      text: "review this",
      target: "cli:pi",
      projectPath: "/work/app"
    }));
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith({
      cwd: "/work/app",
      provider: "pi",
      executionMode: "standard",
      taskNoteId: "wi-test"
    }));
    await waitFor(() => expect(document.querySelectorAll('[data-pane-group="session"] .wb-terminal-tab')).toHaveLength(1));
    const paneKey = setWorkbenchActiveSessions.mock.calls.at(-1)?.[0]?.[0]?.paneKey as string;
    expect(paneKey).toBeTruthy();

    await act(async () => sendSelection?.({
      kind: "existing-session",
      text: "follow up",
      paneKey
    }));
    await waitFor(() => expect(terminalInput).toHaveBeenCalledWith({ id: 21, data: "follow up\r" }));
  });

  it("organizes the Workbench by tasks", async () => {
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.sidebarView": "Workbench sidebar view",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.resourceView": "Repository",
        "desktop.workbench.projectsView": "Projects",
        "desktop.workbench.gtdView": "GTD",
        "desktop.workbench.filterTasks": "Filter tasks",
        "desktop.workbench.noTasks": "No tasks yet",
        "desktop.workbench.gtdStatus.next": "In progress",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.addProject": "Add project",
        "desktop.workbench.addProjectTitle": "Select project folder"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      listProjects: async () => [{
        projectId: "proj-a", portableKey: "/work/app", alias: "App", hidden: false, pinned: false,
        lastSeenAtMs: null, updatedAtMs: 0, localPath: "/work/app", pathMissing: false, sessionCount: 5
      }],
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      addProject: vi.fn(async () => ({ ok: true as const, project: {
        projectId: "proj-a", portableKey: "/work/app", alias: "App", hidden: false, pinned: false,
        lastSeenAtMs: null, updatedAtMs: 0, localPath: "/work/app", pathMissing: false, sessionCount: 5
      } })),
      notesAddTaskProject: vi.fn(async () => ({ ok: true })),
      notesListTasks: async () => [{
        noteId: "wi-1", scope: "project", projectPath: "/work/app",
        filename: "realtime-status.md", relDir: "projects/app", relMdPath: "notes/projects/app/realtime-status.md",
        title: "Realtime status", createdAtMs: 1, updatedAtMs: 1, gtdStatus: "next",
        work: { next: "Wire the rollup", decision: "Show connecting state?", sessions: ["codex:s1"] }
      }],
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    // The board opens a task's shared workspace (the in-panel list is gone).
    expect(document.querySelector(".wb-task")).toBeNull();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-1",
        title: "Realtime status",
        status: "next",
        next: "Wire the rollup",
        decision: "Show connecting state?",
        sessions: ["codex:s1"]
      } }));
    });
    await waitFor(() => expect(document.querySelector(".wb-task")).not.toBeNull());
    expect(screen.getAllByText("Realtime status").length).toBeGreaterThanOrEqual(1);
    // A project-less task must not inherit a stale project as its cwd, and
    // the follow-up workbench reload must not auto-pick one either.
    expect(document.querySelector(".wb-task-add-project")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" }));
    });
    await waitFor(() => expect(document.querySelector(".wb-detail-project-label-text")).not.toBeNull());
    const label = document.querySelector(".wb-detail-project-label-text")?.textContent ?? "";
    expect(label).not.toBe("App");
    expect(label).not.toContain("/work/app");

    // Finder is the entry point to attach a local directory to a project-less task.
    const addProject = document.querySelector(".wb-task-add-project") as HTMLButtonElement;
    fireEvent.click(addProject);
    await waitFor(() => expect(window.agentResume.addProject).toHaveBeenCalledWith({ title: "Select project folder" }));
    await waitFor(() => expect(window.agentResume.notesAddTaskProject).toHaveBeenCalledWith({
      noteId: "wi-1",
      projectPath: "/work/app"
    }));
    expect(screen.getByText(/Wire the rollup/)).toBeTruthy();
    expect(screen.getByText(/Show connecting state\?/)).toBeTruthy();
    expect(screen.getByText("1 sessions")).toBeTruthy();

    // The board can clear the scope, then re-open the same task.
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task-clear"));
    });
    await waitFor(() => expect(document.querySelector(".wb-task")).toBeNull());
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-1",
        title: "Realtime status",
        status: "next",
        next: "Wire the rollup",
        decision: "Show connecting state?",
        sessions: ["codex:s1"]
      } }));
    });
    await waitFor(() => expect(document.querySelector(".wb-task")).not.toBeNull());
  });

  it("shows a task's sessions across projects", async () => {
    const querySessionsPage = vi.fn(async () => ({ sessions: [
      { provider: "codex", id: "s1", title: "Frontend fix", projectPath: "/work/app", updatedAt: 2 },
      { provider: "claude", id: "s2", title: "Backend fix", projectPath: "/work/api", updatedAt: 1 }
    ], total: 2 }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.sidebarView": "Workbench sidebar view",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.resourceView": "Repository",
        "desktop.workbench.projectsView": "Projects",
        "desktop.workbench.gtdView": "GTD",
        "desktop.workbench.filterTasks": "Filter tasks",
        "desktop.workbench.noTasks": "No tasks yet",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      querySessionsPage,
      notesListTasks: async () => [{
        noteId: "wi-1", title: "Cross-repo feature", gtdStatus: "next",
        work: { sessions: ["codex:s1", "claude:s2"], projects: ["/work/app", "/work/api"], primaryProject: "/work/app" }
      }],
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    localStorage.setItem("workbench-sidebar-view-v2", "workitems");
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-1", title: "Cross-repo feature", status: "next",
        sessions: ["codex:s1", "claude:s2"], projects: ["/work/app", "/work/api"], primaryProject: "/work/app"
      } }));
    });

    expect(await screen.findByText("Frontend fix")).toBeTruthy();
    expect(screen.getByText("Backend fix")).toBeTruthy();
    expect(querySessionsPage).toHaveBeenCalledWith(expect.objectContaining({
      keys: [{ provider: "codex", id: "s1" }, { provider: "claude", id: "s2" }]
    }));
  });

  it("filters sessions by Task/All", async () => {
    const allSessions = [
      { provider: "codex", id: "s1", title: "Task session", projectPath: "/work/app", updatedAt: 2 },
      { provider: "claude", id: "s2", title: "Other session", projectPath: "/work/api", updatedAt: 1 }
    ];
    const querySessionsPage = vi.fn(async (args?: { keys?: Array<{ provider: string; id: string }> }) => {
      if (args?.keys?.length) {
        const sessions = allSessions.filter((s) => args.keys!.some((k) => k.provider === s.provider && k.id === s.id));
        return { sessions, total: sessions.length };
      }
      return { sessions: allSessions, total: allSessions.length };
    });
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.filterTask": "Task",
        "desktop.workbench.filterAll": "All",
        "desktop.workbench.sessionFilter": "Filter sessions"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      querySessionsPage,
      notesListTasks: async () => [{
        noteId: "wi-1", title: "Cross-repo feature", gtdStatus: "next",
        work: { sessions: ["codex:s1"], projects: ["/work/app"], primaryProject: "/work/app" }
      }],
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-1", title: "Cross-repo feature", status: "next",
        sessions: ["codex:s1"], projects: ["/work/app"], primaryProject: "/work/app"
      } }));
    });

    // Task filter (default): only the task's session.
    expect(await screen.findByText("Task session")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Other session")).toBeNull());

    // All: every session.
    const filterTabs = document.querySelectorAll<HTMLButtonElement>(".wb-note-list-toolbar .wb-note-filter .wb-left-tab");
    fireEvent.click(filterTabs[1]);
    await waitFor(() => expect(screen.getByText("Other session")).toBeTruthy());
    // The "all" list tags each session with its owning task.
    expect([...document.querySelectorAll(".wb-list .wb-task-badge")].map((badge) => badge.textContent)).toEqual(["Cross-repo feature"]);
  });

  it("drops a removed session from the task session list", async () => {
    let allSessions = [
      { provider: "codex" as const, id: "s1", title: "Task session", projectPath: "/work/app", updatedAt: 2 },
      { provider: "claude" as const, id: "s2", title: "Other session", projectPath: "/work/api", updatedAt: 1 }
    ];
    const querySessionsPage = vi.fn(async (args?: { keys?: Array<{ provider: string; id: string }> }) => {
      if (args?.keys?.length) {
        const sessions = allSessions.filter((s) => args.keys!.some((k) => k.provider === s.provider && k.id === s.id));
        return { sessions, total: sessions.length };
      }
      return { sessions: allSessions, total: allSessions.length };
    });
    const hideSession = vi.fn(async ({ provider, id }: { provider: string; id: string }) => {
      allSessions = allSessions.filter((s) => !(s.provider === provider && s.id === id));
      return { ok: true };
    });
    const hideSessions = vi.fn(async ({ sessions: targets }: { sessions: Array<{ provider: string; id: string }> }) => {
      const keys = new Set(targets.map((target) => `${target.provider}:${target.id}`));
      allSessions = allSessions.filter((s) => !keys.has(`${s.provider}:${s.id}`));
      return { ok: true };
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.filterTask": "Task",
        "desktop.workbench.filterAll": "All",
        "desktop.workbench.sessionFilter": "Filter sessions",
        "desktop.workbench.removeFromPanel": "Remove from panel",
        "desktop.workbench.removeConfirm": "Remove \"{0}\" from panel?",
        "desktop.workbench.removeMultipleConfirm": "Remove {0} sessions?",
        "desktop.workbench.ownedByTask": "Task: {0}"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      querySessionsPage,
      hideSession,
      hideSessions,
      notesListTasks: async () => [{
        noteId: "wi-1", title: "Cross-repo feature", gtdStatus: "next",
        work: { sessions: ["codex:s1"], projects: ["/work/app"], primaryProject: "/work/app" }
      }],
      notesListLinks: async () => [],
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-1", title: "Cross-repo feature", status: "next",
        sessions: ["codex:s1"], projects: ["/work/app"], primaryProject: "/work/app"
      } }));
    });

    const row = await screen.findByRole("button", { name: /Task session/ });
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove from panel" }));
    await waitFor(() => expect(hideSession).toHaveBeenCalledWith({ provider: "codex", id: "s1" }));
    // The hidden session must leave the task-scoped list immediately.
    await waitFor(() => expect(screen.queryByText("Task session")).toBeNull());
    confirm.mockRestore();
  });

  it("shows no sessions for a task that has none instead of falling back to all", async () => {
    const allSessions = [
      { provider: "codex", id: "s1", title: "Task session", projectPath: "/work/app", updatedAt: 2 },
      { provider: "claude", id: "s2", title: "Other session", projectPath: "/work/api", updatedAt: 1 }
    ];
    const querySessionsPage = vi.fn(async (args?: { keys?: Array<{ provider: string; id: string }> }) => {
      if (args?.keys?.length) {
        const sessions = allSessions.filter((s) => args.keys!.some((k) => k.provider === s.provider && k.id === s.id));
        return { sessions, total: sessions.length };
      }
      return { sessions: allSessions, total: allSessions.length };
    });
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.filterTask": "Task",
        "desktop.workbench.filterAll": "All",
        "desktop.workbench.sessionFilter": "Filter sessions"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      querySessionsPage,
      notesListTasks: async () => [{
        noteId: "wi-empty", title: "Fresh task", gtdStatus: "next",
        work: { sessions: [], projects: ["/work/app"], primaryProject: "/work/app" }
      }],
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-empty", title: "Fresh task", status: "next",
        sessions: [], projects: ["/work/app"], primaryProject: "/work/app"
      } }));
    });

    // Task filter (default): a session-less task shows nothing, not every session.
    await waitFor(() => expect(querySessionsPage).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Task session")).toBeNull());
    expect(screen.queryByText("Other session")).toBeNull();

    // All: every session is available again.
    const filterTabs = document.querySelectorAll<HTMLButtonElement>(".wb-note-list-toolbar .wb-note-filter .wb-left-tab");
    fireEvent.click(filterTabs[1]);
    await waitFor(() => expect(screen.getByText("Task session")).toBeTruthy());
    expect(screen.getByText("Other session")).toBeTruthy();
  });

  it("defaults new sessions to the primary repository when a task spans several projects", async () => {
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.sidebarView": "Workbench sidebar view",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.resourceView": "Repository",
        "desktop.workbench.projectsView": "Projects",
        "desktop.workbench.gtdView": "GTD",
        "desktop.workbench.filterTasks": "Filter tasks",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.sessionTarget": "New sessions start in: {0}",
        "desktop.workbench.removeProject": "Remove from this task",
        "desktop.workbench.removeProjectConfirm": "Remove {0}?"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [
        { noteId: "wi-multi", title: "Multi", gtdStatus: "next", work: { sessions: [], projects: ["/work/app", "/work/api"], primaryProject: "/work/app" } },
        { noteId: "wi-single", title: "Single", gtdStatus: "next", work: { sessions: [], projects: ["/work/app"], primaryProject: "/work/app" } }
      ],
      notesRemoveTaskProject: vi.fn(async () => ({ ok: true })),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    localStorage.setItem("workbench-sidebar-view-v2", "workitems");
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    // Several repositories → the primary one carries the task's cwd.
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-multi", title: "Multi", status: "next", sessions: [], projects: ["/work/app", "/work/api"], primaryProject: "/work/app"
      } }));
    });
    await waitFor(() => expect(document.querySelector(".wb-detail-project-path")?.textContent).toBe("/work/app"));

    // A referenced project can be removed from the task.
    const confirmStub = vi.spyOn(window, "confirm").mockReturnValue(true);
    const apiChip = [...document.querySelectorAll(".wb-task-project")]
      .find((node) => node.textContent?.includes("api")) as HTMLElement;
    fireEvent.click(within(apiChip).getByRole("button", { name: "Remove from this task" }));
    await waitFor(() => expect(window.agentResume.notesRemoveTaskProject).toHaveBeenCalledWith({
      noteId: "wi-multi",
      projectPath: "/work/api"
    }));
    confirmStub.mockRestore();

    // Exactly one repository → unambiguous cwd.
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-single", title: "Single", status: "next", sessions: [], projects: ["/work/app"], primaryProject: "/work/app"
      } }));
    });
    await waitFor(() => expect(document.querySelector(".wb-detail-project-path")?.textContent).toBe("/work/app"));
  });

  it("releases the session-target override when the focused chip is clicked again", async () => {
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.removeProject": "Remove from this task",
        "desktop.workbench.addProject": "Add project"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [
        { noteId: "wi-multi", title: "Multi", gtdStatus: "next", work: { sessions: [], projects: ["/work/app", "/work/api"], primaryProject: "/work/app" } }
      ],
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-multi", title: "Multi", status: "next", sessions: [], projects: ["/work/app", "/work/api"], primaryProject: "/work/app"
      } }));
    });
    const chip = (name: string) => [...document.querySelectorAll(".wb-task-project")]
      .find((node) => node.textContent?.includes(name)) as HTMLElement;

    // A multi-repo task starts with no focused chip: the primary repository carries the cwd.
    await waitFor(() => expect(chip("app")).toBeTruthy());
    expect(document.querySelector(".wb-task-project.is-active")).toBeNull();

    // Focusing a chip pins the next session there…
    fireEvent.click(chip("app").querySelector(".wb-task-project-chip") as HTMLElement);
    expect(chip("app").classList.contains("is-active")).toBe(true);

    // …and clicking it again releases the override back to the automatic rule.
    fireEvent.click(chip("app").querySelector(".wb-task-project-chip") as HTMLElement);
    expect(document.querySelector(".wb-task-project.is-active")).toBeNull();
  });

  it("links an ACP session started inside a task to that task", async () => {
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.sidebarView": "Workbench sidebar view",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.resourceView": "Repository",
        "desktop.workbench.projectsView": "Projects",
        "desktop.workbench.gtdView": "GTD",
        "desktop.workbench.filterTasks": "Filter tasks",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.sessionTarget": "New sessions start in: {0}",
        "desktop.workbench.newSession": "New session"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionTarget: "acp:codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [
        { noteId: "wi-multi", title: "Multi", gtdStatus: "next", work: { sessions: [], projects: ["/work/app", "/work/api"], primaryProject: "/work/app" } }
      ],
      acpCreateSession: async ({ projectPath, provider }: { projectPath: string; provider: string }) => ({
        id: "acp-1", title: "ACP session", projectPath, provider, createdAt: 1, updatedAt: 1, messageCount: 0
      }),
      onAcpStream: () => () => undefined,
      acpConnect: async () => ({ record: { id: "acp-1", title: "ACP session", projectPath: "/work/app", provider: "codex", createdAt: 1, updatedAt: 1, messageCount: 0 }, init: {} }),
      acpDisconnect: async () => ({ ok: true }),
      homePath: async () => "/home/test",
      notesLinkSessionToTask: vi.fn(async () => ({ noteId: "wi-multi" })),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    localStorage.setItem("workbench-sidebar-view-v2", "workitems");
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    // Several repositories → an ACP session starts in the primary repository.
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-multi", title: "Multi", status: "next", sessions: [], projects: ["/work/app", "/work/api"], primaryProject: "/work/app"
      } }));
    });
    await waitFor(() => expect(document.querySelector(".wb-detail-project-path")?.textContent).toBe("/work/app"));

    fireEvent.click(screen.getByRole("button", { name: /New session/i }));
    await waitFor(() => expect(window.agentResume.notesLinkSessionToTask).toHaveBeenCalledWith({
      noteId: "wi-multi",
      sessionKey: "chat:acp-1",
      projectPath: "/work/app"
    }));
  });

  it("passes taskNoteId to workbenchNewSession when launching a CLI session inside a task", async () => {
    const workbenchNewSession = vi.fn(async () => ({ mode: "external-system", cwd: "/work/app" }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.sidebarView": "Workbench sidebar view",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.resourceView": "Repository",
        "desktop.workbench.projectsView": "Projects",
        "desktop.workbench.gtdView": "GTD",
        "desktop.workbench.filterTasks": "Filter tasks",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.sessionTarget": "New sessions start in: {0}",
        "desktop.workbench.newSession": "New session"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionTarget: "cli:codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [
        { noteId: "wi-single", title: "Single", gtdStatus: "next", work: { sessions: [], projects: ["/work/app"], primaryProject: "/work/app" } }
      ],
      workbenchNewSession,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    // Single repository → CLI session stays in /work/app but passes taskNoteId.
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-single", title: "Single", status: "next", sessions: [], projects: ["/work/app"], primaryProject: "/work/app"
      } }));
    });
    await waitFor(() => expect(document.querySelector(".wb-detail-project-path")?.textContent).toBe("/work/app"));

    fireEvent.click(screen.getByRole("button", { name: /New session/i }));
    await waitFor(() => expect(workbenchNewSession).toHaveBeenCalledWith({
      cwd: "/work/app",
      provider: "codex",
      executionMode: "standard",
      taskNoteId: "wi-single"
    }));
  });

  it("deletes a session-less task from its context menu, with no workspace item", async () => {
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.sidebarView": "Workbench sidebar view",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.filterTasks": "Filter tasks",
        "desktop.workbench.newTask": "New task",
        "desktop.workbench.noTasks": "No tasks yet",
        "desktop.workbench.sessionFilter": "Status",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.deleteTask": "Delete task",
        "desktop.workbench.deleteTaskConfirm": "Delete {0}?",
        "desktop.notes.projectLabel": "Project"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [
        { noteId: "wi-multi", title: "Multi", gtdStatus: "next", work: { sessions: [], projects: ["/work/app", "/work/api"], primaryProject: "/work/app" } }
      ],
      notesDelete: vi.fn(async () => ({ ok: true })),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-multi", title: "Multi", status: "next", sessions: [],
        projects: ["/work/app", "/work/api"], primaryProject: "/work/app"
      } }));
    });
    await waitFor(() => expect(document.querySelector(".wb-task")).not.toBeNull());
    const confirmStub = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.contextMenu(document.querySelector(".wb-task") as HTMLElement);
    // There is no workspace folder to open anymore — a session-less task offers
    // only its deletion.
    expect(screen.queryByRole("menuitem", { name: "Open workspace folder" })).toBeNull();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete task" }));
    await waitFor(() => expect(window.agentResume.notesDelete).toHaveBeenCalledWith({ noteId: "wi-multi" }));
    confirmStub.mockRestore();
  });

  it("names the task and points at the primary repository, opening it in Zed by default", async () => {
    const workbenchOpenInApp = vi.fn(async () => ({ ok: true }));
    const workbenchRevealPath = vi.fn(async () => ({ ok: true }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.openDirectoryIn.zed": "Open in Zed",
        "desktop.workbench.openDirectoryIn.vscode": "Open in VS Code",
        "desktop.workbench.openDirectoryIn.finder": "Reveal in Finder",
        "desktop.workbench.openDirectoryWith": "Open with…"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [
        { noteId: "wi-multi", title: "Multi repo work", gtdStatus: "next", work: { sessions: [], projects: ["/work/app", "/work/api"], primaryProject: "/work/app" } }
      ],
      workbenchRevealPath,
      workbenchOpenInApp,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-multi", title: "Multi repo work", status: "next", sessions: [],
        projects: ["/work/app", "/work/api"], primaryProject: "/work/app"
      } }));
    });

    // Several projects, none activated → the primary repository is the directory.
    await waitFor(() => expect(document.querySelector(".wb-detail-project-label-text")?.textContent).toBe("Multi repo work"));
    await waitFor(() => expect(document.querySelector(".wb-detail-project-path")?.textContent).toBe("/work/app"));
    const reveal = document.querySelector(".wb-detail-project-reveal") as HTMLButtonElement;
    expect(reveal).not.toBeNull();
    fireEvent.click(reveal);
    // The header's default target is the editor, not the Finder.
    await waitFor(() =>
      expect(workbenchOpenInApp).toHaveBeenCalledWith({ rootPath: "/work/app", targetPath: "/work/app", app: "zed" })
    );
  });

  it("shows persistent waiting tooltip for closed sessions and avoids double signal when open", async () => {
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.sidebarView": "Workbench sidebar view",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.resourceView": "Repository",
        "desktop.workbench.projectsView": "Projects",
        "desktop.workbench.gtdView": "GTD",
        "desktop.workbench.filterTasks": "Filter tasks",
        "desktop.workbench.noTasks": "No tasks yet",
        "desktop.workbench.lastExitWaiting": "This session was waiting on you when the app last closed"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listProjects: async () => [{ id: "p1", path: "/work/app", sessionCount: 2, hidden: false }],
      listSessions: async () => [
        { provider: "codex", id: "s-waiting", title: "Waiting session", projectPath: "/work/app", updatedAt: 100, lastExitWaiting: true },
        { provider: "codex", id: "s-normal", title: "Normal session", projectPath: "/work/app", updatedAt: 90 }
      ],
      agentStatusGetSnapshot: async () => ({ byPaneId: {}, bySessionKey: {}, seq: 1 }),
      onAgentStatusChanged: () => () => undefined,
      workbenchOpenSession: async () => ({
        cwd: "/work/app",
        command: "pi",
        projectPath: "/work/app"
      }),
      terminalSpawn: async () => ({ id: 2 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    localStorage.setItem("workbench-sidebar-view-v2", "resource");
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    // When closed, Waiting session shows lastExitWaiting in tooltip; normal session does not.
    const waitingTitle = await screen.findByText("Waiting session", { selector: ".wb-list-item-title" });
    const waitingButton = waitingTitle.closest("button") as HTMLButtonElement;
    expect(waitingButton.title).toBe("This session was waiting on you when the app last closed");

    const normalTitle = await screen.findByText("Normal session", { selector: ".wb-list-item-title" });
    const normalButton = normalTitle.closest("button") as HTMLButtonElement;
    expect(normalButton.title).toBeFalsy();

    // When opened in a live pane, live dot takes over and persistent marker is suppressed (no dual signal).
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-open-session", {
        detail: { provider: "codex", id: "s-waiting", projectPath: "/work/app" }
      }));
    });

    await waitFor(() => {
      const currentWaitingButton = document.querySelectorAll<HTMLButtonElement>(".wb-list-item")[0];
      expect(currentWaitingButton.title).not.toContain("This session was waiting on you when the app last closed");
    });
  });

  it("lists a task's notes and opens one in the right pane", async () => {
    const notesRead = vi.fn(async ({ noteId }: { noteId: string }) => ({
      record: {
        noteId, scope: "project", projectPath: "/work/app", filename: "realtime-status.md",
        relDir: "", relMdPath: "realtime-status.md", title: "Realtime status",
        createdAtMs: 1, updatedAtMs: 1, work: { sessions: [] }
      },
      content: "# Realtime status"
    }));
    const notesList = vi.fn(async () => [
      { noteId: "wi-1", scope: "project", projectPath: "/work/app", filename: "realtime-status.md", relDir: "", relMdPath: "realtime-status.md", title: "Realtime status", createdAtMs: 1, updatedAtMs: 10, work: { sessions: [] } },
      { noteId: "loose-1", scope: "library", filename: "scratch.md", relDir: "", relMdPath: "scratch.md", title: "Scratch pad", createdAtMs: 1, updatedAtMs: 5 }
    ]);
    const notesResolveLinkRoot = vi.fn(async ({ noteId }: { noteId: string }) => ({ rootNoteId: noteId }));
    const notesGetSubtree = vi.fn(async ({ rootNoteId }: { rootNoteId: string }) => ({
      rootNoteId,
      root: { noteId: rootNoteId, title: "Realtime status", filename: "realtime-status.md", children: [] },
      nodesById: { [rootNoteId]: { noteId: rootNoteId, title: "Realtime status", filename: "realtime-status.md", children: [] } },
      edges: []
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.noteFilter": "Filter notes",
        "desktop.workbench.noteFilterTask": "Task",
        "desktop.workbench.noteFilterAll": "All",
        "desktop.workbench.noteTab": "Note",
        "desktop.workbench.sessionTab": "Sessions",
        "desktop.workbench.newNote": "New note",
        "desktop.workbench.noNotes": "No notes",
        "desktop.notes.editorPlaceholder": "Edit Markdown…"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      listProjects: async () => [],
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesRead, notesList, notesResolveLinkRoot, notesGetSubtree,
      notesListLinks: async () => [],
      notesListTasks: async () => [{
        noteId: "wi-1", scope: "project", projectPath: "/work/app",
        filename: "realtime-status.md", relDir: "projects/app", relMdPath: "notes/projects/app/realtime-status.md",
        title: "Realtime status", createdAtMs: 1, updatedAtMs: 1, gtdStatus: "next",
        work: { next: "Wire the rollup", sessions: [] }
      }],
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-1", title: "Realtime status", status: "next", sessions: []
      } }));
    });

    // Entering a task lands on the Sessions tab (its session list).
    await waitFor(() => expect(document.querySelectorAll(".wb-left-tab")[0]?.classList.contains("active")).toBe(true));

    // "Open note" directly opens the task's note in the detail pane.
    fireEvent.click(await screen.findByRole("button", { name: "Open note" }));
    await waitFor(() => expect(document.querySelector(".wb-note-pane")).not.toBeNull());
    expect(notesRead).toHaveBeenCalledWith({ noteId: "wi-1" });
    expect(screen.getByPlaceholderText("Edit Markdown…")).toBeTruthy();

    // Switching to the Notes tab shows the task's note tree.
    fireEvent.click(document.querySelectorAll(".wb-left-tab")[1]);
    expect(document.querySelectorAll(".wb-left-tab")[1]?.classList.contains("active")).toBe(true);

    // Task filter: only the task's note tree is listed.
    const row = await screen.findByRole("button", { name: "Realtime status" });
    expect(screen.queryByRole("button", { name: "Scratch pad" })).toBeNull();

    // "All" reveals non-task notes.
    const filterTabs = document.querySelectorAll<HTMLButtonElement>(".wb-note-filter .wb-left-tab");
    fireEvent.click(filterTabs[1]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Scratch pad" })).toBeTruthy());
    // "All" tags the task's own notes with the owning task, and leaves loose notes untagged.
    expect([...document.querySelectorAll(".wb-note-list .wb-task-badge")].map((badge) => badge.textContent)).toEqual(["Realtime status"]);

    // Re-entering the task resets the left panel to the Sessions tab.
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-1", title: "Realtime status", status: "next", sessions: []
      } }));
    });
    await waitFor(() => expect(document.querySelectorAll(".wb-left-tab")[0]?.classList.contains("active")).toBe(true));
  });

;

;

  it("honors a deep-linked workbench over the stored one", async () => {
    const wb = (overrides: Record<string, unknown>) => ({
      taskNoteId: "wi-dl", layoutJson: null, projectPath: "/work/api", createdAtMs: 1, updatedAtMs: 1, ...overrides
    });
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.filterTasks": "Filter tasks",
        "desktop.workbench.noTasks": "No tasks yet",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      listProjects: async () => [],
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [{
        noteId: "wi-dl", scope: "project", projectPath: "/work/api",
        filename: "dl.md", relDir: "", relMdPath: "dl.md", title: "Deep link",
        createdAtMs: 1, updatedAtMs: 1, gtdStatus: "next",
        work: { sessions: [], projects: ["/work/api"], primaryProject: "/work/api" }
      }],
      listTaskWorkbenches: async () => [
        wb({ workbenchId: "wb-a", name: "Alpha", position: 0 }),
        wb({ workbenchId: "wb-b", name: "Beta", position: 1 })
      ],
      ensureTaskWorkbench: async () => wb({ workbenchId: "wb-a", name: "Alpha", position: 0 }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    // Stored preference says Alpha; the deep-link asks for Beta.
    localStorage.setItem("workbench-active-v1:wi-dl", "wb-a");
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-dl", title: "Deep link", status: "next", sessions: [],
        projects: ["/work/api"], primaryProject: "/work/api", workbenchId: "wb-b"
      } }));
    });

    // The deep-linked workbench wins over the stored preference, and the choice
    // is what gets written back.
    await waitFor(() => expect(localStorage.getItem("workbench-active-v1:wi-dl")).toBe("wb-b"));
    localStorage.removeItem("workbench-active-v1:wi-dl");
  });

  it("restores a workbench's persisted note panes when it becomes active", async () => {
    const notesRead = vi.fn(async ({ noteId }: { noteId: string }) => ({
      record: {
        noteId, scope: "project", projectPath: "/work/app", filename: `${noteId}.md`,
        relDir: "", relMdPath: `${noteId}.md`, title: `Note ${noteId}`,
        createdAtMs: 1, updatedAtMs: 1, work: { sessions: [] }
      },
      content: "# restored"
    }));
    const layoutJson = JSON.stringify({ openNoteIds: ["n-one", "n-two"] });
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.common.close": "Close", "desktop.common.loading": "Loading…",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.filterTasks": "Filter tasks",
        "desktop.workbench.noTasks": "No tasks yet",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.notes.allNotes": "All notes",
        "desktop.notes.editorPlaceholder": "Edit Markdown…"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      listProjects: async () => [],
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesRead,
      notesListTasks: async () => [{
        noteId: "wi-lay", scope: "project", projectPath: "/work/app",
        filename: "lay.md", relDir: "", relMdPath: "lay.md", title: "Layout task",
        createdAtMs: 1, updatedAtMs: 1, gtdStatus: "next",
        work: { sessions: [], projects: ["/work/app"], primaryProject: "/work/app" }
      }],
      listTaskWorkbenches: async () => [{
        workbenchId: "wb-lay", taskNoteId: "wi-lay", name: "Layout", projectPath: "/work/app",
        position: 0, layoutJson, createdAtMs: 1, updatedAtMs: 1
      }],
      ensureTaskWorkbench: async () => ({
        workbenchId: "wb-lay", taskNoteId: "wi-lay", name: "Layout", projectPath: "/work/app",
        position: 0, layoutJson, createdAtMs: 1, updatedAtMs: 1
      }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    localStorage.setItem("workbench-active-v1:wi-lay", "wb-lay");
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-lay", title: "Layout task", status: "next", sessions: [],
        projects: ["/work/app"], primaryProject: "/work/app"
      } }));
    });

    const noteTabs = () => [...document.querySelectorAll<HTMLElement>(".wb-terminal-tab.is-note")];
    await waitFor(() => expect(noteTabs().length).toBe(2));
    expect(notesRead).toHaveBeenCalledWith({ noteId: "n-one" });
    expect(notesRead).toHaveBeenCalledWith({ noteId: "n-two" });
    expect(document.querySelector(".wb-note-pane")).not.toBeNull();
    // The inactive restored tab shows its own resolved title, not a placeholder.
    await waitFor(() => expect(noteTabs().map((tab) => tab.textContent).join("\n")).toContain("Note n-two"));

    // Closing the active tab removes it: the pane must stay closed, not come
    // back deactivated from the persisted layout.
    fireEvent.click(noteTabs()[0]!.querySelector(".wb-terminal-tab-close") as HTMLElement);
    await waitFor(() => expect(noteTabs().length).toBe(1));
    expect(noteTabs()[0]!.textContent).toContain("Note n-two");
    // Switching the active pane must not resurrect the closed tab either.
    fireEvent.click(noteTabs()[0]!.querySelector(".wb-terminal-tab-label") as HTMLElement);
    await waitFor(() => expect(noteTabs()[0]!.className).toContain("active"));
    expect(noteTabs().length).toBe(1);
    localStorage.removeItem("workbench-active-v1:wi-lay");
  });

  it("deletes a session-less task from the task context menu", async () => {
    const notesDelete = vi.fn(async () => ({ ok: true, deletedNoteIds: ["wi-del"] }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.filterTasks": "Filter tasks",
        "desktop.workbench.noTasks": "No tasks yet",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.deleteTask": "Delete task",
        "desktop.workbench.deleteTaskConfirm": "Delete task \"{0}\"?"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      listProjects: async () => [],
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesDelete,
      notesListTasks: async () => [{
        noteId: "wi-del", scope: "library", filename: "del.md", relDir: "", relMdPath: "del.md",
        title: "Disposable task", createdAtMs: 1, updatedAtMs: 1, gtdStatus: "inbox",
        work: { sessions: [] }
      }],
      notesTaskWorkspace: async () => ({ dir: "/tmp/ws", exists: false }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-del", title: "Disposable task", status: "inbox", sessions: []
      } }));
    });
    await waitFor(() => expect(document.querySelector(".wb-task")).not.toBeNull());

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.contextMenu(document.querySelector(".wb-task") as HTMLElement);
    const del = await screen.findByRole("menuitem", { name: "Delete task" });
    fireEvent.click(del);
    await waitFor(() => expect(notesDelete).toHaveBeenCalledWith({ noteId: "wi-del" }));
    confirmSpy.mockRestore();
  });

  it("opens the task's note pane when the board requests it", async () => {
    const wb = { workbenchId: "wb-open", taskNoteId: "wi-open", name: "WB", projectPath: "/work/app", position: 0, layoutJson: null, createdAtMs: 1, updatedAtMs: 1 };
    const notesRead = vi.fn(async ({ noteId }: { noteId: string }) => ({
      record: {
        noteId, scope: "project", projectPath: "/work/app", filename: `${noteId}.md`,
        relDir: "", relMdPath: `${noteId}.md`, title: `Note ${noteId}`,
        createdAtMs: 1, updatedAtMs: 1, work: { sessions: [] }
      },
      content: "# note"
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.workbench.leftPaneTabs": "Task panels",
        "desktop.workbench.noteTab": "Note",
        "desktop.workbench.sessionTab": "Sessions",
        "desktop.notes.allNotes": "All notes",
        "desktop.notes.editorPlaceholder": "Edit Markdown…"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      listProjects: async () => [],
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesRead,
      notesListTasks: async () => [{
        noteId: "wi-open", scope: "project", projectPath: "/work/app",
        filename: "open.md", relDir: "", relMdPath: "open.md", title: "Open me",
        createdAtMs: 1, updatedAtMs: 1, gtdStatus: "next",
        work: { sessions: [], projects: ["/work/app"], primaryProject: "/work/app" }
      }],
      listTaskWorkbenches: async () => [wb],
      ensureTaskWorkbench: async () => wb,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-open", title: "Open me", status: "next", sessions: [],
        projects: ["/work/app"], primaryProject: "/work/app", openNote: true
      } }));
    });

    await waitFor(() => expect(document.querySelector(".wb-note-pane")).not.toBeNull());
    expect(notesRead).toHaveBeenCalledWith({ noteId: "wi-open" });
    // The board's “open note” switches the left panel to its Note tab.
    expect(document.querySelector(".wb-left-tab.active")?.textContent).toBe("Note");
  });

  it("adds an extra note (linked child) from the note tab group", async () => {
    const wb = { workbenchId: "wb-child", taskNoteId: "wi-child", name: "WB", projectPath: "/work/app", position: 0, layoutJson: null, createdAtMs: 1, updatedAtMs: 1 };
    const notesCreateLinkedChild = vi.fn(async () => ({ noteId: "child-1", filename: "child.md" }));
    const notesRead = vi.fn(async ({ noteId }: { noteId: string }) => ({
      record: {
        noteId, scope: "project", projectPath: "/work/app", filename: `${noteId}.md`,
        relDir: "", relMdPath: `${noteId}.md`, title: `Note ${noteId}`,
        createdAtMs: 1, updatedAtMs: 1, work: { sessions: [] }
      },
      content: ""
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.taskNext": "Next:",
        "desktop.workbench.taskSessions": "{0} sessions",
        "desktop.notes.allNotes": "All notes",
        "desktop.notes.newLinkedChild": "New linked child note",
        "desktop.notes.editorPlaceholder": "Edit Markdown…"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      listProjects: async () => [],
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesRead,
      notesCreateLinkedChild,
      notesListTasks: async () => [{
        noteId: "wi-child", scope: "project", projectPath: "/work/app",
        filename: "child-task.md", relDir: "", relMdPath: "child-task.md", title: "Child task",
        createdAtMs: 1, updatedAtMs: 1, gtdStatus: "next",
        work: { sessions: [], projects: ["/work/app"], primaryProject: "/work/app" }
      }],
      listTaskWorkbenches: async () => [wb],
      ensureTaskWorkbench: async () => wb,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-child", title: "Child task", status: "next", sessions: [],
        projects: ["/work/app"], primaryProject: "/work/app"
      } }));
    });

    fireEvent.click(await screen.findByRole("button", { name: "New linked child note" }));
    await waitFor(() => expect(notesCreateLinkedChild).toHaveBeenCalledWith({ parentNoteId: "wi-child" }));
    await waitFor(() => expect(notesRead).toHaveBeenCalledWith({ noteId: "child-1" }));
  });
  it("adopts the workbench's running ptys instead of spawning new agents", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const terminalSpawn = vi.fn(async () => ({ id: 999 }));
    const terminalAttach = vi.fn(async ({ id }: { id: number }) => ({ ok: true, replay: `replay-${id}` }));
    const terminalListForWorkbench = vi.fn(async () => [{ id: 77, cwd: "/work/app", cols: 80, rows: 24 }]);
    const layoutJson = JSON.stringify({
      openNoteIds: [],
      activePaneKey: "terminal:kept",
      terminals: [
        {
          key: "terminal:kept",
          ptyId: 77,
          title: "Fix renderer",
          group: "session",
          cwd: "/work/app",
          projectPath: "/work/app",
          sessionKey: "codex:session-1",
          command: "codex resume session-1"
        },
        // Not running any more: the pane must not come back.
        { key: "terminal:dead", ptyId: 78, title: "Gone", group: "terminal", cwd: "/work/app", projectPath: "/work/app" }
      ]
    });

    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.newSession": "New session",
        "desktop.workbench.selectSessionHint": "Select a session"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [],
      ensureTaskWorkbench: async () => ({ workbenchId: "wb-keep" }),
      listTaskWorkbenches: async () => [{
        workbenchId: "wb-keep",
        taskNoteId: "wi-keep",
        name: "",
        projectPath: "/work/app",
        position: 0,
        layoutJson,
        createdAtMs: 1,
        updatedAtMs: 2
      }],
      listTaskWorkbenchSessionLinks: async () => [],
      setTaskWorkbenchLayout: async () => ({ ok: true }),
      terminalListForWorkbench,
      terminalSpawn,
      terminalAttach,
      terminalDetach: async () => ({ ok: true }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      workbenchSetFileWatch: async () => ({ rootPaths: [] })
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", { detail: {
        noteId: "wi-keep", title: "Kept", status: "next", sessions: [],
        projects: ["/work/app"], primaryProject: "/work/app", workbenchId: "wb-keep"
      } }));
    });

    await waitFor(() => expect(terminalListForWorkbench).toHaveBeenCalledWith({ workbenchId: "wb-keep" }));
    await waitFor(() => expect(terminalAttach).toHaveBeenCalledWith({ id: 77 }));
    expect(terminalSpawn).not.toHaveBeenCalled();
    // The dead pane stays dead: only the running pty comes back.
    expect(terminalAttach).not.toHaveBeenCalledWith({ id: 78 });
    await waitFor(() => expect(document.querySelectorAll(".wb-terminal-tab").length).toBe(1));
  });
  it("renders the detail header inside a workbench window", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.workbench.allSessions": "All sessions",
        "desktop.workbench.sidePanelExplorer": "Explorer",
        "desktop.workbench.sidePanelGit": "Git",
        "desktop.workbench.newSession": "New session"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [],
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] })
    } as unknown as typeof window.agentResume;

    document.documentElement.dataset.windowMode = "task";
    try {
      render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));

      // The window has no app header, so the workbench carries its own chrome.
      const strip = await waitFor(() => {
        const found = document.querySelector<HTMLElement>(".wb-window-header");
        expect(found).toBeTruthy();
        return found as HTMLElement;
      });
      expect(strip.querySelector(".wb-detail-tools")).toBeTruthy();
      // And it is not also portaled into an app header slot.
      expect(document.querySelector(".mac-top .wb-detail-head")).toBeNull();
    } finally {
      document.documentElement.dataset.windowMode = "main";
    }
  });

  it("runs a requested template script in a new terminal pane once the workbench is active", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbench = {
      workbenchId: "wb-run", taskNoteId: "wi-run", name: "Run", projectPath: "/work/app",
      position: 0, layoutJson: null, createdAtMs: 1, updatedAtMs: 1
    };
    let runScriptListener: ((payload: { name: string; command: string; cwd: string }) => void) | undefined;
    const terminalSpawn = vi.fn(async () => ({ id: 77 }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.common.close": "Close",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.workbenchTabs": "Workbenches",
        "desktop.workbench.newWorkbench": "New workbench",
        "desktop.workbench.deleteWorkbench": "Delete workbench",
        "desktop.workbench.deleteWorkbenchConfirm": "Delete workbench \"{0}\"?",
        "desktop.workbench.newTerminal": "New terminal",
        "desktop.workbench.closeTerminal": "Close terminal",
        "desktop.workbench.terminalTabs": "Terminal tabs"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      onTaskWindowRunScript: (callback: (payload: { name: string; command: string; cwd: string }) => void) => {
        runScriptListener = callback;
        return () => undefined;
      },
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [],
      ensureTaskWorkbench: async () => workbench,
      listTaskWorkbenches: async () => [workbench],
      setTaskWorkbenchLayout: async () => ({ ok: true }),
      terminalSpawn,
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] })
    } as unknown as typeof window.agentResume;

    try {
      render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
      await act(async () => {
        window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", {
          detail: { noteId: "wi-run", title: "Deploy", status: "inbox", sessions: [], projects: ["/work/app"], primaryProject: "/work/app" }
        }));
      });
  
      // The already-open window path: main sends the run request as IPC.
      await act(async () => {
        runScriptListener?.({ name: "dev", command: "pnpm dev", cwd: "/work/app" });
      });
      await waitFor(() => expect(terminalSpawn).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/work/app", command: "pnpm dev", workbenchId: "wb-run" })
      ));

      // The fresh-window path: the task event is followed by the queued run.
      terminalSpawn.mockClear();
      await act(async () => {
        window.dispatchEvent(new CustomEvent("agent-resume:workbench-run-script", {
          detail: { name: "build", command: "pnpm build", cwd: "/work/app" }
        }));
      });
      await waitFor(() => expect(terminalSpawn).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/work/app", command: "pnpm build", workbenchId: "wb-run" })
      ));
    } finally {
      host.remove();
    }
  });

  it("sends a right-clicked script to the task's own template", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbench = {
      workbenchId: "wb-tpl", taskNoteId: "wi-tpl", name: "Deploy", projectPath: "/work/app",
      position: 0, layoutJson: null, createdAtMs: 1, updatedAtMs: 1
    };
    const contextMenuShow = vi.fn(async () => "send");
    const taskTemplatesAddScript = vi.fn(async () => ({
      template: { templateId: "tpl-1", title: "Deploy", projectPaths: [], scripts: [], createdAtMs: 1, updatedAtMs: 1 },
      added: true
    }));
    const taskTemplatesLinkTask = vi.fn(async () => ({ ok: true as const }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.notes.filterProjects": "Filter projects", "desktop.notes.projectFilter": "Project filter",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.workbenchTabs": "Workbenches",
        "desktop.workbench.newWorkbench": "New workbench",
        "desktop.workbench.deleteWorkbench": "Delete workbench",
        "desktop.workbench.deleteWorkbenchConfirm": "Delete workbench \"{0}\"?",
        "desktop.workbench.sidePanelExplorer": "Explorer",
        "desktop.workbench.sidePanelScripts": "Scripts",
        "desktop.workbench.sidePanelGit": "Git",
        "desktop.workbench.sidePanelSearch": "Search panel",
        "desktop.workbench.scriptsEmpty": "No scripts",
        "desktop.workbench.scriptsRefresh": "Refresh scripts",
        "desktop.workbench.scriptSendToTemplate": "Send to Template",
        "desktop.workbench.scriptSentToTemplate": "Sent to the task's template",
        "desktop.workbench.scriptAlreadyOnTemplate": "This script is already on the template"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [],
      ensureTaskWorkbench: async () => workbench,
      listTaskWorkbenches: async () => [workbench],
      setTaskWorkbenchLayout: async () => ({ ok: true }),
      workbenchListScripts: async () => ({
        truncated: false,
        packages: [{
          id: "pkg-1", kind: "npm", packageRoot: "/work/app", relativeRoot: "",
          label: "app", manifestPath: "/work/app/package.json",
          scripts: [{ id: "s-dev", name: "dev", run: { cwd: "/work/app", command: "pnpm dev" } }]
        }]
      }),
      contextMenuShow,
      taskTemplatesAddScript,
      taskTemplatesLinkTask,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    document.documentElement.dataset.windowMode = "task";
    try {
      render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
      await act(async () => {
        window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", {
          detail: {
            noteId: "wi-tpl", title: "Deploy task", status: "inbox", sessions: [],
            projects: ["/work/app"], primaryProject: "/work/app", templateId: "tpl-1"
          }
        }));
      });

      fireEvent.click(await screen.findByRole("button", { name: "Scripts" }));
      const scriptRow = await screen.findByRole("button", { name: "dev" });
      fireEvent.contextMenu(scriptRow);

      await waitFor(() => expect(taskTemplatesAddScript).toHaveBeenCalledWith({
        templateId: "tpl-1",
        script: { name: "dev", command: "pnpm dev", cwd: "/work/app" }
      }));
      const items = (contextMenuShow.mock.calls[0] as unknown as [{ items: Array<{ label?: string }> }] | undefined)?.[0]?.items ?? [];
      expect(items.map((item) => item.label)).toContain("Send to Template");
      // An already-linked task must not be re-linked.
      expect(taskTemplatesLinkTask).not.toHaveBeenCalled();
    } finally {
      document.documentElement.dataset.windowMode = "main";
      host.remove();
    }
  });

  it("offers a template submenu for a script when the task is not linked to one", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    const workbench = {
      workbenchId: "wb-pick", taskNoteId: "wi-pick", name: "Pick", projectPath: "/work/app",
      position: 0, layoutJson: null, createdAtMs: 1, updatedAtMs: 1
    };
    const contextMenuShow = vi.fn(async () => "tpl:tpl-2");
    const taskTemplatesList = vi.fn(async () => [
      { templateId: "tpl-2", title: "Release", projectPaths: [], scripts: [], createdAtMs: 1, updatedAtMs: 1 },
      { templateId: "tpl-3", title: "Ops", projectPaths: [], scripts: [], createdAtMs: 1, updatedAtMs: 1 }
    ]);
    const taskTemplatesAddScript = vi.fn(async () => ({
      template: { templateId: "tpl-2", title: "Release", projectPaths: [], scripts: [], createdAtMs: 1, updatedAtMs: 1 },
      added: true
    }));
    const taskTemplatesLinkTask = vi.fn(async () => ({ ok: true as const }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: {
        "desktop.common.search": "Search", "desktop.common.refresh": "Refresh", "desktop.common.all": "All",
        "desktop.workbench.tasksView": "Tasks",
        "desktop.workbench.taskView": "Task",
        "desktop.workbench.taskOpenNote": "Open note",
        "desktop.workbench.taskClear": "Exit task",
        "desktop.workbench.workbenchTabs": "Workbenches",
        "desktop.workbench.newWorkbench": "New workbench",
        "desktop.workbench.deleteWorkbench": "Delete workbench",
        "desktop.workbench.deleteWorkbenchConfirm": "Delete workbench \"{0}\"?",
        "desktop.workbench.sidePanelScripts": "Scripts",
        "desktop.workbench.scriptsEmpty": "No scripts",
        "desktop.workbench.scriptsRefresh": "Refresh scripts",
        "desktop.workbench.scriptSendToTemplate": "Send to Template",
        "desktop.workbench.scriptNoTemplate": "No template yet",
        "desktop.workbench.scriptSendToTemplateNamed": "Send to template \"{0}\"",
        "desktop.workbench.scriptSendToOtherTemplate": "Send to another template…",
        "desktop.workbench.scriptTemplateCreated": "Created template \"{0}\"",
        "desktop.gtd.createTemplate": "Create template"
      } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      notesListTasks: async () => [],
      ensureTaskWorkbench: async () => workbench,
      listTaskWorkbenches: async () => [workbench],
      setTaskWorkbenchLayout: async () => ({ ok: true }),
      workbenchListScripts: async () => ({
        truncated: false,
        packages: [{
          id: "pkg-1", kind: "npm", packageRoot: "/work/app", relativeRoot: "",
          label: "app", manifestPath: "/work/app/package.json",
          scripts: [
            { id: "s-dev", name: "dev", run: { cwd: "/work/app", command: "pnpm dev" } },
            { id: "s-build", name: "build", run: { cwd: "/work/app", command: "pnpm build" } }
          ]
        }]
      }),
      contextMenuShow,
      taskTemplatesList,
      taskTemplatesAddScript,
      taskTemplatesLinkTask,
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalDestroy: async () => ({ ok: true }),
      terminalResize: async () => ({ ok: true })
    } as unknown as typeof window.agentResume;

    document.documentElement.dataset.windowMode = "task";
    try {
      render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
      await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
      await act(async () => {
        window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", {
          detail: {
            noteId: "wi-pick", title: "Release-1012", status: "inbox", sessions: [],
            projects: ["/work/app"], primaryProject: "/work/app" // no templateId
          }
        }));
      });

      fireEvent.click(await screen.findByRole("button", { name: "Scripts" }));
      fireEvent.contextMenu(await screen.findByRole("button", { name: "dev" }));

      await waitFor(() => expect(taskTemplatesList).toHaveBeenCalled());
      const items = (contextMenuShow.mock.calls[0] as unknown as [
        { items: Array<{ id?: string; label?: string; submenu?: Array<{ id?: string; label?: string }> }> }
      ] | undefined)?.[0]?.items ?? [];
      // The task title prefixes the template name, so one click targets "Release".
      expect(items[0]?.id).toBe("tpl:tpl-2");
      expect(items[0]?.label).toBe('Send to template "Release"');
      const send = items.find((item) => item.id === "send");
      expect(send?.label).toBe("Send to another template…");
      expect(send?.submenu?.map((item) => item.label).filter(Boolean)).toEqual(["Release", "Ops", "Create template"]);
      // The single script row sends that one script after the template pick.
      await waitFor(() => expect(taskTemplatesAddScript).toHaveBeenCalledWith({
        templateId: "tpl-2",
        script: { name: "dev", command: "pnpm dev", cwd: "/work/app" }
      }));

      // Right-clicking the package row offers every script in it, then the
      // template picker resolves on the follow-up menu.
      taskTemplatesAddScript.mockClear();
      contextMenuShow.mockReset();
      contextMenuShow.mockResolvedValueOnce("pick:s-build").mockResolvedValueOnce("tpl:tpl-2");
      fireEvent.contextMenu(document.querySelector(".wb-scripts-group-row")!);
      await waitFor(() => expect(contextMenuShow).toHaveBeenCalled());
      const groupItems = (contextMenuShow.mock.calls[0] as unknown as [
        { items: Array<{ label?: string; submenu?: Array<{ id?: string; label?: string }> }> }
      ] | undefined)?.[0]?.items ?? [];
      expect(groupItems[0]?.submenu?.map((item) => item.label)).toEqual(["dev", "build"]);
      await waitFor(() => expect(taskTemplatesAddScript).toHaveBeenCalledWith({
        templateId: "tpl-2",
        script: { name: "build", command: "pnpm build", cwd: "/work/app" }
      }));
      // The task had no template, so the send links it — its own card then shows the command.
      await waitFor(() => expect(taskTemplatesLinkTask).toHaveBeenCalledWith({
        noteId: "wi-pick",
        templateId: "tpl-2"
      }));
    } finally {
      document.documentElement.dataset.windowMode = "main";
      host.remove();
    }
  });

  it("previews an inactive terminal tab from its headless screen", async () => {
    const host = document.createElement("div");
    host.id = "react-workbench";
    document.body.append(host);
    let nextPtyId = 0;
    const agentStatusScreen = vi.fn(async ({ paneId }: { paneId: number }) => ({
      paneId,
      agent: "shell",
      state: "idle",
      source: "hook",
      authority: "hook",
      screenText: `$ screen ${paneId}\nready\n`,
      oscTitle: "",
      oscProgress: "",
      cursorHidden: false,
      toolRunning: false,
      at: 1
    }));
    window.agentResume = {
      getI18nBundle: async () => ({ locale: "en", messages: { ...ARROW_TEST_MESSAGES } }),
      onLocaleChanged: () => () => undefined,
      onWorkbenchCmdT: () => () => undefined,
      onWorkbenchCmdW: () => () => undefined,
      onTerminalData: () => () => undefined,
      onTerminalExit: () => () => undefined,
      onTerminalRespawned: () => () => undefined,
      listProjectAliases: async () => ({}),
      getSettings: async () => ({ workbench: { defaultNewSessionProvider: "codex" } }),
      listSessions: async () => [],
      homePath: async () => "/home/test",
      createScratchDir: async () => "/scratch/work",
      terminalSpawn: async () => ({ id: ++nextPtyId }),
      terminalDestroy: async () => ({ ok: true }),
      terminalGitInfo: async () => ({ mode: "none", isRepo: false, branch: null, repoRoot: null, nestedRepos: [] }),
      terminalResize: async () => ({ ok: true }),
      terminalInput: vi.fn(async () => ({ ok: true })),
      agentStatusScreen
    } as unknown as typeof window.agentResume;

    render(<I18nProvider><WorkbenchPanel /></I18nProvider>);
    await act(async () => window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" })));
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await waitFor(() => expect(xtermMocks.instances).toHaveLength(2));

    const tabs = Array.from(document.querySelectorAll<HTMLElement>(".is-terminal-group .wb-terminal-tab"));
    expect(tabs).toHaveLength(2);
    expect(tabs[1].classList.contains("active")).toBe(true);

    // The active tab has nothing to preview; the inactive one opens after the
    // intent delay and reads the pane mirror for its own PTY.
    fireEvent.pointerOver(tabs[1]);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
    expect(document.querySelector(".wb-tab-preview")).toBeNull();

    fireEvent.pointerOver(tabs[0]);
    await waitFor(() => {
      expect(document.querySelector(".wb-tab-preview")?.textContent).toContain("$ screen 1");
    }, { timeout: 1_500 });
    expect(agentStatusScreen).toHaveBeenCalledWith({ paneId: 1 });
  });
});
