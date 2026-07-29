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

import { disposeWorkbenchWatchers, registerWorkbenchWatcherIpc } from "./workbenchWatcher";

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

function createSender() {
  return {
    id: 1,
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

function getSetFileWatchHandler(): (event: { sender: ReturnType<typeof createSender> }, args: { rootPath: string | null }) => Promise<{ rootPath: string | null }> {
  const handler = ipcMocks.handlers.get("workbench:setFileWatch");
  if (!handler) throw new Error("Missing workbench:setFileWatch handler");
  return handler as (event: { sender: ReturnType<typeof createSender> }, args: { rootPath: string | null }) => Promise<{ rootPath: string | null }> ;
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

    await getSetFileWatchHandler()({ sender }, { rootPath: root });
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

  it("uses one polling timer after recursive watch creation fails without emitting EMFILE", async () => {
    vi.useFakeTimers();
    const root = await makeRoot();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const watchSpy = fsMocks.watch.mockImplementation(() => { throw Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" }); });
    const sender = createSender();
    registerWorkbenchWatcherIpc(() => ({ webContents: sender } as never));

    await getSetFileWatchHandler()({ sender }, { rootPath: root });
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

    await getSetFileWatchHandler()({ sender }, { rootPath: root });
    expect(watchSpy).toHaveBeenCalledWith(root, expect.objectContaining({ recursive: true, persistent: false }), expect.any(Function));
    expect(callback).toBeDefined();

    watcher.emitError(new Error("EMFILE: too many open files"));
    expect(watcher.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120);
    expect(sender.send).toHaveBeenCalledWith("workbench:fileSystemChanged", expect.objectContaining({ type: "change", fullRescan: true }));

    watcher.emitError(new Error("EMFILE: too many open files"));
    await vi.advanceTimersByTimeAsync(2_000 + 120);
    expect(watchSpy).toHaveBeenCalledTimes(1);

    await getSetFileWatchHandler()({ sender }, { rootPath: null });
    sender.send.mockClear();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sender.send).not.toHaveBeenCalled();
  });
});
