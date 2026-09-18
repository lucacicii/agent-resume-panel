import { afterEach, describe, expect, it, vi } from "vitest";

const ipcMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}));

type DataHandler = (data: string) => void;

type FakeSender = {
  id: number;
  send: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
};

const senders = vi.hoisted(() => {
  const byId = new Map<number, FakeSender>();
  return {
    byId,
    create(id: number): FakeSender {
      const sender: FakeSender = {
        id,
        send: vi.fn(),
        once: vi.fn(),
        isDestroyed: () => false
      };
      byId.set(id, sender);
      return sender;
    },
    reset(): void {
      byId.clear();
    }
  };
});

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

// WebContents ids are how panes find their window, so the mock registry is the
// only way a pty can reach a renderer.
vi.mock("electron", () => ({
  webContents: { fromId: (id: number) => senders.byId.get(id) ?? null }
}));
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

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

describe("pty attach / detach replay", () => {
  afterEach(() => {
    destroyPtyOnQuit();
    ipcMocks.handlers.clear();
    ptyMocks.instances.length = 0;
    ptyMocks.spawn.mockClear();
    senders.reset();
  });

  it("keeps draining detached output and replays it on attach", async () => {
    registerPtyIpc();
    const sender = senders.create(11);
    const spawned = await handler<{ id: number }>("terminal:spawn")(
      { sender },
      { cwd: process.cwd(), cols: 80, rows: 24 }
    );
    expect(spawned.id).toBeGreaterThan(0);
    const instance = ptyMocks.instances[0];
    expect(instance).toBeTruthy();

    instance.emit("boot-");
    expect(sender.send).not.toHaveBeenCalled();

    const firstAttach = await handler<{ ok: boolean; replay: string }>("terminal:attach")(
      { sender },
      { id: spawned.id }
    );
    expect(firstAttach.replay).toContain("boot-");
    sender.send.mockClear();
    instance.emit("vis");
    instance.emit("ible-");
    expect(sender.send).not.toHaveBeenCalled();
    await flush();
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith("terminal:data", { id: spawned.id, data: "visible-" });

    await handler("terminal:detach")({ sender }, { id: spawned.id });
    sender.send.mockClear();
    instance.emit("hidden-output");
    expect(sender.send).not.toHaveBeenCalled();

    const attached = await handler<{ ok: boolean; replay: string }>("terminal:attach")(
      { sender },
      { id: spawned.id }
    );
    expect(attached.ok).toBe(true);
    expect(attached.replay).toContain("visible-");
    expect(attached.replay).toContain("hidden-output");

    sender.send.mockClear();
    instance.emit("after-attach");
    await flush();
    expect(sender.send).toHaveBeenCalledWith("terminal:data", { id: spawned.id, data: "after-attach" });
  });

  it("hands a pane to the window that attaches last", async () => {
    registerPtyIpc();
    const board = senders.create(21);
    const taskWindow = senders.create(22);
    const spawned = await handler<{ id: number }>("terminal:spawn")(
      { sender: board },
      { cwd: process.cwd(), cols: 80, rows: 24 }
    );
    const instance = ptyMocks.instances[0];

    await handler("terminal:attach")({ sender: board }, { id: spawned.id });
    instance.emit("from-board");
    await flush();
    expect(board.send).toHaveBeenCalledWith("terminal:data", { id: spawned.id, data: "from-board" });

    board.send.mockClear();
    const handoff = await handler<{ ok: boolean; replay: string }>("terminal:attach")(
      { sender: taskWindow },
      { id: spawned.id }
    );
    // The new owner catches up from the replay the attach call returns.
    expect(handoff.replay).toContain("from-board");
    expect(taskWindow.send).not.toHaveBeenCalled();
    taskWindow.send.mockClear();

    instance.emit("after-handoff");
    await flush();
    expect(board.send).not.toHaveBeenCalled();
    expect(taskWindow.send).toHaveBeenCalledWith("terminal:data", { id: spawned.id, data: "after-handoff" });
  });

  it("ignores a resize from a window that does not render the pane", async () => {
    registerPtyIpc();
    const owner = senders.create(31);
    const other = senders.create(32);
    const spawned = await handler<{ id: number }>("terminal:spawn")(
      { sender: owner },
      { cwd: process.cwd(), cols: 80, rows: 24 }
    );
    const instance = ptyMocks.instances[0];
    await handler("terminal:attach")({ sender: owner }, { id: spawned.id });
    instance.resize.mockClear();

    await handler("terminal:resize")({ sender: other }, { id: spawned.id, cols: 120, rows: 40 });
    expect(instance.resize).not.toHaveBeenCalled();

    await handler("terminal:resize")({ sender: owner }, { id: spawned.id, cols: 100, rows: 30 });
    expect(instance.resize).toHaveBeenCalledWith(100, 30);
  });

  it("stops forwarding once the owning window is gone", async () => {
    registerPtyIpc();
    const owner = senders.create(41);
    const spawned = await handler<{ id: number }>("terminal:spawn")(
      { sender: owner },
      { cwd: process.cwd(), cols: 80, rows: 24 }
    );
    const instance = ptyMocks.instances[0];
    await handler("terminal:attach")({ sender: owner }, { id: spawned.id });

    // The window disappeared without detaching: the id no longer resolves.
    senders.byId.delete(41);
    owner.send.mockClear();
    instance.emit("orphan-output");
    await flush();
    expect(owner.send).not.toHaveBeenCalled();
  });

  it("lists the panes of a workbench so a reopened one can adopt them", async () => {
    registerPtyIpc();
    const sender = senders.create(61);
    const mine = await handler<{ id: number }>("terminal:spawn")(
      { sender },
      { cwd: process.cwd(), workbenchId: "wb-1" }
    );
    const other = await handler<{ id: number }>("terminal:spawn")(
      { sender },
      { cwd: process.cwd(), workbenchId: "wb-2" }
    );
    await handler("terminal:attach")({ sender }, { id: mine.id });

    const panes = await handler<Array<{ id: number; cwd: string }>>("terminal:listForWorkbench")(
      { sender },
      { workbenchId: "wb-1" }
    );
    expect(panes.map((pane) => pane.id)).toEqual([mine.id]);
    expect(panes[0]!.cwd).toBe(process.cwd());

    // A pane bound after it was spawned still joins its workbench.
    await handler("terminal:bindSession")({ sender }, { id: other.id, workbenchId: "wb-1" });
    const rejoined = await handler<Array<{ id: number }>>("terminal:listForWorkbench")(
      { sender },
      { workbenchId: "wb-1" }
    );
    expect(rejoined.map((pane) => pane.id).sort()).toEqual([mine.id, other.id].sort());
  });

  it("caps the replay buffer instead of growing without bound", async () => {
    registerPtyIpc();
    const sender = senders.create(51);
    const spawned = await handler<{ id: number }>("terminal:spawn")(
      { sender },
      { cwd: process.cwd() }
    );
    await handler("terminal:detach")({ sender }, { id: spawned.id });
    const instance = ptyMocks.instances[0];
    instance.emit("a".repeat(PTY_REPLAY_LIMIT + 2048));
    const attached = await handler<{ ok: boolean; replay: string }>("terminal:attach")(
      { sender },
      { id: spawned.id }
    );
    expect(attached.replay.length).toBeLessThanOrEqual(PTY_REPLAY_LIMIT);
    expect(attached.replay.endsWith("a".repeat(64))).toBe(true);
  });
});
