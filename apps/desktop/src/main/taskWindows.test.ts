import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeListener = (...args: unknown[]) => void;

import { WINDOW_BACKGROUND_DARK, WINDOW_BACKGROUND_LIGHT, WINDOW_BACKGROUND_TRANSPARENT } from "./windowAppearance";

const fake = vi.hoisted(() => {
  const windows: Array<Record<string, unknown>> = [];
  const nativeTheme = { shouldUseDarkColors: false };
  let nextId = 1;

  class FakeBrowserWindow {
    static getAllWindows = () => windows.filter((win) => !(win as { destroyed: boolean }).destroyed);
    static nextId = () => nextId++;

    options: Record<string, unknown>;
    webContents: { id: number; once: (event: string, listener: FakeListener) => void; emit: (event: string) => void };
    destroyed = false;
    title: string;
    shown = 0;
    focused = 0;
    loadQuery: Record<string, string> | null = null;
    private listeners = new Map<string, FakeListener[]>();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.title = String(options.title ?? "");
      this.webContents = {
        id: nextId++,
        once: (event: string, listener: FakeListener) => {
          if (event === "did-finish-load") this.loadedListeners.push(listener);
        },
        emit: (event: string) => {
          if (event === "did-finish-load") for (const listener of this.loadedListeners.splice(0)) listener();
        }
      };
      windows.push(this as unknown as Record<string, unknown>);
    }

    private loadedListeners: FakeListener[] = [];

    isDestroyed(): boolean {
      return this.destroyed;
    }

    on(event: string, listener: FakeListener): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    }

    once(event: string, listener: FakeListener): void {
      this.on(event, listener);
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }

    close(): void {
      this.destroyed = true;
      this.emit("closed");
    }

    show(): void {
      this.shown += 1;
    }

    focus(): void {
      this.focused += 1;
    }

    isMinimized(): boolean {
      return false;
    }

    restore(): void {
      /* no-op */
    }

    getBounds(): Electron.Rectangle {
      return { x: 0, y: 0, width: 1180, height: 820 };
    }

    setPosition(): void {
      /* no-op */
    }

    setTitle(title: string): void {
      this.title = title;
    }

    setMenuBarVisibility(): void {
      /* no-op */
    }

    loadFile(_file: string, opts?: { query?: Record<string, string> }): Promise<void> {
      this.loadQuery = opts?.query ?? null;
      return Promise.resolve();
    }
  }

  return {
    windows,
    FakeBrowserWindow,
    nativeTheme,
    reset: () => {
      windows.length = 0;
      nextId = 1;
      nativeTheme.shouldUseDarkColors = false;
    }
  };
});

vi.mock("electron", () => ({
  BrowserWindow: fake.FakeBrowserWindow,
  nativeTheme: fake.nativeTheme,
  screen: {
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })
  }
}));

import {
  MAX_TASK_WINDOWS,
  closeAllTaskWindows,
  closeTaskWindow,
  listTaskWindows,
  openTaskWindow,
  setTaskWindowTitle,
  summarizeTaskWindows,
  taskWindowOpenTimings,
  taskWindowStateForSender
} from "./taskWindows";

function deps(): {
  preloadPath: string;
  rendererIndex: string;
  onCreated: ReturnType<typeof vi.fn>;
  onChange: ReturnType<typeof vi.fn>;
} {
  return {
    preloadPath: "/tmp/preload.js",
    rendererIndex: "/tmp/renderer/index.html",
    onCreated: vi.fn(),
    onChange: vi.fn()
  };
}

type FakeWindow = { loadQuery: Record<string, string> | null; title: string; shown: number; focused: number };

function windowAt(index: number): FakeWindow {
  return listTaskWindows()[index]!.window as unknown as FakeWindow;
}

describe("task workbench windows", () => {
  beforeEach(() => {
    // The registry lives in the module under test; close its windows first so
    // each case starts from an empty set.
    closeAllTaskWindows();
    fake.reset();
  });

  it("loads the renderer in task mode for the requested workbench", () => {
    const depsMock = deps();
    const result = openTaskWindow(depsMock, { noteId: "note-1", workbenchId: "wb-1" });

    expect(result).toEqual({ ok: true, created: true });
    expect(windowAt(0).loadQuery).toEqual({ mode: "task", noteId: "note-1", workbenchId: "wb-1" });
    expect(depsMock.onCreated).toHaveBeenCalledTimes(1);
    expect(depsMock.onChange).toHaveBeenCalledWith([
      { workbenchId: "wb-1", noteId: "note-1", title: "Workbench" }
    ]);
  });

  it("focuses the open window instead of mounting a second copy", () => {
    openTaskWindow(deps(), { noteId: "note-1", workbenchId: "wb-1" });
    const again = deps();
    const result = openTaskWindow(again, { noteId: "note-1", workbenchId: "wb-1" });

    expect(result).toEqual({ ok: true, created: false });
    expect(listTaskWindows()).toHaveLength(1);
    expect(windowAt(0).focused).toBe(1);
    expect(again.onChange).not.toHaveBeenCalled();
  });

  it("makes a workbench window translucent on macOS and themed elsewhere", () => {
    openTaskWindow(deps(), { noteId: "note-1", workbenchId: "wb-light" });
    fake.nativeTheme.shouldUseDarkColors = true;
    openTaskWindow(deps(), { noteId: "note-2", workbenchId: "wb-dark" });

    const [light, dark] = fake.windows as Array<{ options: Record<string, unknown> }>;
    if (process.platform === "darwin") {
      // The window header and the task list show the desktop through, so the
      // window must not paint a colour of its own.
      expect(light!.options.backgroundColor).toBe(WINDOW_BACKGROUND_TRANSPARENT);
      expect(light!.options.vibrancy).toBe("sidebar");
      expect(light!.options.transparent).toBe(true);
      return;
    }
    // Elsewhere the themed background is what keeps the close from flashing white.
    expect(light!.options.backgroundColor).toBe(WINDOW_BACKGROUND_LIGHT);
    expect(dark!.options.backgroundColor).toBe(WINDOW_BACKGROUND_DARK);
  });

  it("caps how many workbench windows can be open at once", () => {
    for (let index = 0; index < MAX_TASK_WINDOWS; index += 1) {
      expect(openTaskWindow(deps(), { noteId: `note-${index}`, workbenchId: `wb-${index}` }).ok).toBe(true);
    }
    expect(openTaskWindow(deps(), { noteId: "note-x", workbenchId: "wb-x" })).toEqual({
      ok: false,
      reason: "limit",
      limit: MAX_TASK_WINDOWS
    });
    expect(listTaskWindows()).toHaveLength(MAX_TASK_WINDOWS);
  });

  it("names the window from the task title", () => {
    openTaskWindow(deps(), { noteId: "note-1", workbenchId: "wb-1", title: "Realtime status" });
    expect(summarizeTaskWindows()).toEqual([
      { workbenchId: "wb-1", noteId: "note-1", title: "Realtime status" }
    ]);

    setTaskWindowTitle("wb-1", "Renamed task");
    expect(windowAt(0).title).toBe("Renamed task");
    expect(summarizeTaskWindows()[0]!.title).toBe("Renamed task");
  });

  it("resolves the window that sent an ipc message", () => {
    openTaskWindow(deps(), { noteId: "note-1", workbenchId: "wb-1" });
    const opened = listTaskWindows()[0]!;

    expect(taskWindowStateForSender(opened.window.webContents)?.workbenchId).toBe("wb-1");
    expect(taskWindowStateForSender({ id: 999 } as unknown as Electron.WebContents)).toBeUndefined();
  });

  it("drops the window from the registry when it closes", () => {
    const onChange = deps();
    openTaskWindow(onChange, { noteId: "note-1", workbenchId: "wb-1" });
    onChange.onChange.mockClear();

    expect(closeTaskWindow("wb-1")).toBe(true);
    expect(listTaskWindows()).toHaveLength(0);
    expect(onChange.onChange).toHaveBeenCalledWith([]);
    expect(closeTaskWindow("wb-1")).toBe(false);
  });

  it("reports how long a window took to load and show", () => {
    openTaskWindow(deps(), { noteId: "note-1", workbenchId: "wb-1" });
    const win = listTaskWindows()[0]!.window as unknown as { webContents: { emit: (event: string) => void }; emit: (event: string) => void };

    win.webContents.emit("did-finish-load");
    win.emit("ready-to-show");

    const timings = taskWindowOpenTimings();
    expect(timings).toHaveLength(1);
    expect(timings[0]!.workbenchId).toBe("wb-1");
    expect(timings[0]!.loadMs).toBeGreaterThanOrEqual(0);
    expect(timings[0]!.showMs).toBeGreaterThanOrEqual(0);
  });
});
