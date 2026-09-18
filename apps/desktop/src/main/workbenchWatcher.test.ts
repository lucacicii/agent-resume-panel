import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ipcMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}));
const fsMocks = vi.hoisted(() => ({ watch: vi.fn() }));

vi.mock("electron", () => ({ BrowserWindow: class {} }));
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  watch: fsMocks.watch
}));
vi.mock("./ipcUtils", () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => ipcMocks.handlers.set(channel, handler)
}));

import {
  disposeWorkbenchWatchers,
  getWorkbenchWatcherRuntimeMetrics,
  registerWorkbenchWatcherIpc,
  setWorkbenchWatcherActive,
  WORKBENCH_POLL_INTERVALS_MS
} from "./workbenchWatcher";

type WatchCallback = (eventType: string, filename: string | Buffer | null) => void;
type FakeWatcher = {
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emitError: (error: Error) => void;
};

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-resume-workbench-watcher-"));
  roots.push(root);
  return root;
}

function createSender(id = 1) {
  return {
    id,
    isDestroyed: () => false,
    once: vi.fn(),
    send: vi.fn()
  };
}

function installWatchMock(implementation: (callback: WatchCallback) => FakeWatcher): typeof fsMocks.watch {
  fsMocks.watch.mockImplementation((_filename: fs.PathLike, options: fs.WatchOptions | string, listener?: WatchCallback) => {
    const callback = typeof options === "function" ? options as WatchCallback : listener;
    if (!callback) throw new Error("Expected a watcher callback");
    return implementation(callback) as unknown as fs.FSWatcher;
  });
  return fsMocks.watch;
}

function getSetFileWatchHandler(): (event: { sender: ReturnType<typeof createSender> }, args: { rootPaths: string[] | null }) => Promise<{ rootPaths: string[] }> {
  const handler = ipcMocks.handlers.get("workbench:setFileWatch");
  if (!handler) throw new Error("Missing workbench:setFileWatch handler");
  return handler as (event: { sender: ReturnType<typeof createSender> }, args: { rootPaths: string[] | null }) => Promise<{ rootPaths: string[] }> ;
}

describe("workbench watcher fallback", () => {
  afterEach(async () => {
    disposeWorkbenchWatchers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    fsMocks.watch.mockReset();
    ipcMocks.handlers.clear();
    await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
  });

  it("keeps native recursive events batched without starting polling", async () => {
    vi.useFakeTimers();
    const root = await makeRoot();
    let callback: WatchCallback | undefined;
    const watcher: FakeWatcher = {
      close: vi.fn(),
      on: vi.fn(() => watcher),
      emitError: () => undefined
    };
    const watchSpy = installWatchMock((listener) => { callback = listener; return watcher; });
    const sender = createSender();
    registerWorkbenchWatcherIpc(() => ({ webContents: sender } as never));

    await getSetFileWatchHandler()({ sender }, { rootPaths: [root] });
    callback?.("change", "src/index.ts");
    await vi.advanceTimersByTimeAsync(120);

    expect(sender.send).toHaveBeenCalledWith("workbench:fileSystemChanged", expect.objectContaining({
      type: "change",
      fullRescan: false,
      paths: [path.join(root, "src/index.ts")]
    }));
    sender.send.mockClear();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sender.send).not.toHaveBeenCalled();
    expect(watchSpy).toHaveBeenCalledTimes(1);
  });

  it("watches several roots for one sender and reports each in turn", async () => {
    vi.useFakeTimers();
    const first = await makeRoot();
    const second = await makeRoot();
    const callbacks = new Map<string, WatchCallback>();
    const watchers: FakeWatcher[] = [];
    fsMocks.watch.mockImplementation((filename: fs.PathLike, options: fs.WatchOptions | string, listener?: WatchCallback) => {
      const callback = typeof options === "function" ? options as WatchCallback : listener;
      if (!callback) throw new Error("Expected a watcher callback");
      callbacks.set(String(filename), callback);
      const watcher: FakeWatcher = { close: vi.fn(), on: vi.fn(() => watcher), emitError: () => undefined };
      watchers.push(watcher);
      return watcher as unknown as fs.FSWatcher;
    });
    const sender = createSender();
    registerWorkbenchWatcherIpc(() => ({ webContents: sender } as never));

    await getSetFileWatchHandler()({ sender }, { rootPaths: [first, second] });
    expect(getWorkbenchWatcherRuntimeMetrics()).toEqual({ watcherCount: 2, pollingCount: 0, activeCount: 2 });

    callbacks.get(first)?.("change", "src/a.ts");
    await vi.advanceTimersByTimeAsync(120);
    expect(sender.send).toHaveBeenCalledWith("workbench:fileSystemChanged", expect.objectContaining({
      type: "change", rootPath: first, paths: [path.join(first, "src/a.ts")]
    }));

    sender.send.mockClear();
    callbacks.get(second)?.("change", "src/b.ts");
    await vi.advanceTimersByTimeAsync(120);
    expect(sender.send).toHaveBeenCalledWith("workbench:fileSystemChanged", expect.objectContaining({
      type: "change", rootPath: second, paths: [path.join(second, "src/b.ts")]
    }));

    // Replacing the watch set closes the previous watchers.
    const third = await makeRoot();
    await getSetFileWatchHandler()({ sender }, { rootPaths: [third] });
    expect(watchers[0]?.close).toHaveBeenCalledTimes(1);
    expect(watchers[1]?.close).toHaveBeenCalledTimes(1);
    expect(watchers[2]?.close).not.toHaveBeenCalled();
    expect(getWorkbenchWatcherRuntimeMetrics()).toEqual({ watcherCount: 1, pollingCount: 0, activeCount: 1 });
  });

  it("uses one polling timer after recursive watch creation fails without emitting EMFILE", async () => {
    vi.useFakeTimers();
    const root = await makeRoot();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const watchSpy = fsMocks.watch.mockImplementation(() => { throw Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" }); });
    const sender = createSender();
    registerWorkbenchWatcherIpc(() => ({ webContents: sender } as never));

    await getSetFileWatchHandler()({ sender }, { rootPaths: [root] });
    expect(watchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120);
    expect(sender.send).toHaveBeenCalledWith("workbench:fileSystemChanged", expect.objectContaining({
      type: "change", fullRescan: true, rootPath: root
    }));
    expect(sender.send).not.toHaveBeenCalledWith("workbench:fileSystemChanged", expect.objectContaining({ type: "error" }));

    sender.send.mockClear();
    await vi.advanceTimersByTimeAsync(2_000 + 120);
    expect(watchSpy).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith("workbench:fileSystemChanged", expect.objectContaining({
      type: "change", fullRescan: true, rootPath: root
    }));
  });

  it("switches from a failed recursive watcher to one polling timer and closes it on stop", async () => {
    vi.useFakeTimers();
    const root = await makeRoot();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let callback: WatchCallback | undefined;
    let errorListener: ((error: Error) => void) | undefined;
    const watcher: FakeWatcher = {
      close: vi.fn(),
      on: vi.fn((event: string, listener: (error: Error) => void) => {
        if (event === "error") errorListener = listener;
        return watcher;
      }),
      emitError: (error) => errorListener?.(error)
    };
    const watchSpy = installWatchMock((listener) => { callback = listener; return watcher; });
    const sender = createSender();
    registerWorkbenchWatcherIpc(() => ({ webContents: sender } as never));

    await getSetFileWatchHandler()({ sender }, { rootPaths: [root] });
    expect(watchSpy).toHaveBeenCalledWith(root, expect.objectContaining({ recursive: true, persistent: false }), expect.any(Function));
    expect(callback).toBeDefined();

    watcher.emitError(new Error("EMFILE: too many open files"));
    expect(watcher.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120);
    expect(sender.send).toHaveBeenCalledWith("workbench:fileSystemChanged", expect.objectContaining({ type: "change", fullRescan: true }));

    watcher.emitError(new Error("EMFILE: too many open files"));
    await vi.advanceTimersByTimeAsync(2_000 + 120);
    expect(watchSpy).toHaveBeenCalledTimes(1);

    await getSetFileWatchHandler()({ sender }, { rootPaths: null });
    sender.send.mockClear();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("pauses fallback polling while Workbench is inactive and resumes from the fast interval", async () => {
    vi.useFakeTimers();
    const root = await makeRoot();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fsMocks.watch.mockImplementation(() => { throw new Error("recursive watch unavailable"); });
    const sender = createSender();
    registerWorkbenchWatcherIpc(() => ({ webContents: sender } as never));

    await getSetFileWatchHandler()({ sender }, { rootPaths: [root] });
    await vi.advanceTimersByTimeAsync(120);
    sender.send.mockClear();
    expect(getWorkbenchWatcherRuntimeMetrics()).toEqual({ watcherCount: 1, pollingCount: 1, activeCount: 1 });

    setWorkbenchWatcherActive(sender.id, false);
    expect(getWorkbenchWatcherRuntimeMetrics()).toEqual({ watcherCount: 1, pollingCount: 0, activeCount: 0 });
    await vi.advanceTimersByTimeAsync(WORKBENCH_POLL_INTERVALS_MS[0] + 120);
    expect(sender.send).not.toHaveBeenCalled();

    setWorkbenchWatcherActive(sender.id, true);
    expect(getWorkbenchWatcherRuntimeMetrics()).toEqual({ watcherCount: 1, pollingCount: 1, activeCount: 1 });
    await vi.advanceTimersByTimeAsync(WORKBENCH_POLL_INTERVALS_MS[0] + 120);
    expect(sender.send).toHaveBeenCalledWith("workbench:fileSystemChanged", expect.objectContaining({
      type: "change",
      fullRescan: true,
      rootPath: root
    }));
  });

  it("shares one watch per project root across windows", async () => {
    vi.useFakeTimers();
    const root = await makeRoot();
    let callback: WatchCallback | undefined;
    const watcher: FakeWatcher = { close: vi.fn(), on: vi.fn(() => watcher), emitError: () => undefined };
    const watchSpy = installWatchMock((listener) => { callback = listener; return watcher; });
    const main = createSender(1);
    const taskWindow = createSender(2);
    registerWorkbenchWatcherIpc(
      () => ({ webContents: main } as never),
      (sender) => sender === (taskWindow as unknown as typeof sender)
    );

    await getSetFileWatchHandler()({ sender: main }, { rootPaths: [root] });
    await getSetFileWatchHandler()({ sender: taskWindow }, { rootPaths: [root] });

    // One recursive watcher for both windows, both of which get the event.
    expect(watchSpy).toHaveBeenCalledTimes(1);
    callback?.("change", "src/index.ts");
    await vi.advanceTimersByTimeAsync(120);
    expect(main.send).toHaveBeenCalledWith("workbench:fileSystemChanged", expect.objectContaining({
      paths: [path.join(root, "src/index.ts")]
    }));
    expect(taskWindow.send).toHaveBeenCalledWith("workbench:fileSystemChanged", expect.objectContaining({
      paths: [path.join(root, "src/index.ts")]
    }));

    // Hiding one window stops delivering to it without touching the watch.
    setWorkbenchWatcherActive(taskWindow.id, false);
    main.send.mockClear();
    taskWindow.send.mockClear();
    callback?.("change", "src/other.ts");
    await vi.advanceTimersByTimeAsync(120);
    expect(main.send).toHaveBeenCalledTimes(1);
    expect(taskWindow.send).not.toHaveBeenCalled();

    // When the last subscriber leaves, the watch goes with it.
    await getSetFileWatchHandler()({ sender: taskWindow }, { rootPaths: null });
    expect(watcher.close).not.toHaveBeenCalled();
    await getSetFileWatchHandler()({ sender: main }, { rootPaths: null });
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(getWorkbenchWatcherRuntimeMetrics()).toEqual({ watcherCount: 0, pollingCount: 0, activeCount: 0 });
  });

  it("accepts an authorized workbench window and rejects a foreign sender", async () => {
    const root = await makeRoot();
    installWatchMock(() => ({ close: vi.fn(), on: vi.fn(), emitError: () => undefined } as unknown as FakeWatcher));
    const main = createSender();
    const taskWindow = createSender();
    const foreign = createSender();
    registerWorkbenchWatcherIpc(
      () => ({ webContents: main } as never),
      (sender) => sender === (taskWindow as unknown as typeof sender)
    );

    await expect(getSetFileWatchHandler()({ sender: foreign }, { rootPaths: [root] }))
      .rejects.toThrow("无效的窗口来源");

    const watched = await getSetFileWatchHandler()({ sender: taskWindow }, { rootPaths: [root] });
    expect(watched.rootPaths).toEqual([root]);
    expect(getWorkbenchWatcherRuntimeMetrics()).toEqual({ watcherCount: 1, pollingCount: 0, activeCount: 1 });
  });
});
