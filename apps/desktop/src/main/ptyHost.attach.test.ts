import { afterEach, describe, expect, it, vi } from "vitest";

const ipcMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}));

type DataHandler = (data: string) => void;

const ptyMocks = vi.hoisted(() => {
  const instances: Array<{
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    onData: (listener: DataHandler) => void;
    emit: (data: string) => void;
  }> = [];
  return {
    instances,
    spawn: vi.fn(() => {
      const listeners: DataHandler[] = [];
      const instance = {
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: (listener: DataHandler) => { listeners.push(listener); },
        onExit: vi.fn(),
        emit: (data: string) => listeners.forEach((listener) => listener(data))
      };
      instances.push(instance);
      return instance;
    })
  };
});

vi.mock("electron", () => ({ BrowserWindow: class {} }));
vi.mock("node-pty", () => ({ spawn: ptyMocks.spawn }));
vi.mock("./ipcUtils", () => ({
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown) => ipcMocks.handlers.set(channel, handler)
}));
vi.mock("./gitNestedScan", () => ({
  checkoutGitBranch: vi.fn(),
  listGitBranchesWithNested: vi.fn(),
  queryGitInfoWithNested: vi.fn()
}));
vi.mock("./terminalEnv", () => ({
  ensureUtf8TerminalEnv: (env: Record<string, string | undefined>) => env
}));

import { destroyPtyOnQuit, PTY_REPLAY_LIMIT, registerPtyIpc } from "./ptyHost";

function handler<T>(channel: string): (...args: unknown[]) => Promise<T> {
  const found = ipcMocks.handlers.get(channel);
  if (!found) throw new Error(`Missing ${channel}`);
  return found as (...args: unknown[]) => Promise<T>;
}

describe("pty attach / detach replay", () => {
  afterEach(() => {
    destroyPtyOnQuit();
    ipcMocks.handlers.clear();
    ptyMocks.instances.length = 0;
    ptyMocks.spawn.mockClear();
  });

  it("keeps draining detached output and replays it on attach", async () => {
    const send = vi.fn();
    registerPtyIpc(() => ({ isDestroyed: () => false, webContents: { send } }) as never);
    const spawned = await handler<{ id: number }>("terminal:spawn")({}, { cwd: process.cwd(), cols: 80, rows: 24 });
    expect(spawned.id).toBeGreaterThan(0);
    const instance = ptyMocks.instances[0];
    expect(instance).toBeTruthy();

    instance.emit("boot-");
    expect(send).not.toHaveBeenCalled();

    const firstAttach = await handler<{ ok: boolean; replay: string }>("terminal:attach")({}, { id: spawned.id });
    expect(firstAttach.replay).toContain("boot-");
    send.mockClear();
    instance.emit("vis");
    instance.emit("ible-");
    expect(send).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("terminal:data", { id: spawned.id, data: "visible-" });

    await handler("terminal:detach")({}, { id: spawned.id });
    send.mockClear();
    instance.emit("hidden-output");
    expect(send).not.toHaveBeenCalled();

    const attached = await handler<{ ok: boolean; replay: string }>("terminal:attach")({}, { id: spawned.id });
    expect(attached.ok).toBe(true);
    expect(attached.replay).toContain("visible-");
    expect(attached.replay).toContain("hidden-output");

    send.mockClear();
    instance.emit("after-attach");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(send).toHaveBeenCalledWith("terminal:data", { id: spawned.id, data: "after-attach" });
  });

  it("caps the replay buffer instead of growing without bound", async () => {
    registerPtyIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as never);
    const spawned = await handler<{ id: number }>("terminal:spawn")({}, { cwd: process.cwd() });
    await handler("terminal:detach")({}, { id: spawned.id });
    const instance = ptyMocks.instances[0];
    instance.emit("a".repeat(PTY_REPLAY_LIMIT + 2048));
    const attached = await handler<{ ok: boolean; replay: string }>("terminal:attach")({}, { id: spawned.id });
    expect(attached.replay.length).toBeLessThanOrEqual(PTY_REPLAY_LIMIT);
    expect(attached.replay.endsWith("a".repeat(64))).toBe(true);
  });
});
