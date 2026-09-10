import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStatusStore, type StatusScreenReader } from "./store";

/** Minimal xterm stand-in: rows of plain text, alternate buffer flag. */
function makeReader(lines: string[], rows = 40): StatusScreenReader {
  return {
    rows,
    buffer: {
      active: {
        type: "normal",
        baseY: 0,
        getLine: (index: number) => {
          const text = lines[index];
          return text === undefined ? undefined : { translateToString: () => text };
        }
      }
    }
  };
}

const PLAN_MENU = [
  "Plan mode — what next?",
  "",
  " → Execute the plan",
  "   Stay in plan mode",
  "   Refine the plan",
  "",
  " ↑↓ navigate  enter select  escape/ctrl+c cancel"
];

describe("SessionStatusStore", () => {
  let store: SessionStatusStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    store = new SessionStatusStore();
  });

  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
  });

  it("ignores shell panes and reports session panes as idle", () => {
    let emissions = 0;
    store.subscribe(() => { emissions += 1; });

    store.setPanes([
      { key: "terminal:shell", group: "terminal", ptyId: 1 },
      { key: "terminal:session", group: "session", ptyId: 2 }
    ]);

    const snapshot = store.getSnapshot();
    expect(Object.keys(snapshot.runtimeByPaneKey)).toEqual(["terminal:session"]);
    expect(snapshot.runtimeByPaneKey["terminal:session"]).toEqual({ status: "running", awaitingConfidence: undefined });
    expect(emissions).toBeGreaterThan(0);
  });

  it("reports running while output flows and idle once it stops", () => {
    store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
    store.start();

    store.ingestTerminalData(1, "compiling...\n");
    expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("running");
    expect(store.getSnapshot().sourceByPaneKey.p1).toBe("activity");

    vi.advanceTimersByTime(8_000);
    expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("open");
    expect(store.getSnapshot().sourceByPaneKey.p1).toBe("idle");
  });

  it("honours an explicit status sequence above screen heuristics", () => {
    store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
    store.ingestTerminalData(1, "\x1b]633;AR;awaiting;select\x07");

    const snapshot = store.getSnapshot();
    expect(snapshot.runtimeByPaneKey.p1).toEqual({
      status: "awaiting_user",
      awaitingConfidence: "confirmed"
    });
    expect(snapshot.sourceByPaneKey.p1).toBe("native");
  });

  it("detects a plan menu on the full screen, not just the bottom rows", () => {
    store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
    // 40-row terminal with the menu painted at the very top.
    store.attachTerminal(1, makeReader(PLAN_MENU, 40));
    store.ingestTerminalData(1, "starting");
    vi.advanceTimersByTime(1_000);

    const snapshot = store.getSnapshot();
    expect(snapshot.runtimeByPaneKey.p1.status).toBe("awaiting_user");
    expect(snapshot.sourceByPaneKey.p1).toBe("fingerprint");
  });

  it("uses the retained tail when the terminal is unmounted (background pane)", () => {
    store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
    store.ingestTerminalData(1, `${PLAN_MENU.join("\r\n")}\r\n`);
    store.detachTerminal(1);
    vi.advanceTimersByTime(1_000);

    expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("awaiting_user");
  });

  it("keeps a background pane alive from throttled activity heartbeats", () => {
    store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
    store.detachTerminal(1);

    vi.advanceTimersByTime(9_000);
    expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("open");

    store.ingestTerminalActivity(1, { tail: "still working", timestamp: Date.now() });
    expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("running");
  });

  it("treats user input as immediate activity", () => {
    store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
    vi.advanceTimersByTime(9_000);
    expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("open");

    store.markUserInput("p1");
    expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("running");
    expect(store.getSnapshot().sourceByPaneKey.p1).toBe("activity");
  });

  it("drives ACP panes from pending requests", () => {
    store.setPanes([{ key: "acp:r1", group: "session", acpRecordId: "r1" }]);

    store.ingestAcpEvent({ type: "status", chatId: "r1", status: "running", isRunning: true });
    expect(store.getSnapshot().runtimeByPaneKey["acp:r1"].status).toBe("running");
    expect(store.getSnapshot().sourceByPaneKey["acp:r1"]).toBe("native");

    store.ingestAcpEvent({ type: "permissionRequest", chatId: "r1", requestId: "req-1" });
    expect(store.getSnapshot().runtimeByPaneKey["acp:r1"].status).toBe("awaiting_user");

    store.ingestAcpEvent({ type: "permissionResolved", chatId: "r1", requestId: "req-1" });
    expect(store.getSnapshot().runtimeByPaneKey["acp:r1"].status).toBe("running");
  });

  it("ignores ACP events that cannot change status", () => {
    store.setPanes([{ key: "acp:r1", group: "session", acpRecordId: "r1" }]);
    let emissions = 0;
    store.subscribe(() => { emissions += 1; });

    store.ingestAcpEvent({ type: "agentMessageChunk", chatId: "r1" });
    store.ingestAcpEvent({ type: "toolCall", chatId: "r1" });
    expect(emissions).toBe(0);
  });

  it("drops state for panes that closed", () => {
    store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
    store.ingestTerminalData(1, "work");
    expect(store.getSnapshot().runtimeByPaneKey.p1).toBeDefined();

    store.setPanes([]);
    expect(store.getSnapshot().runtimeByPaneKey.p1).toBeUndefined();
  });

  it("stops emitting after dispose", () => {
    store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
    let emissions = 0;
    store.subscribe(() => { emissions += 1; });
    store.dispose();

    store.ingestTerminalData(1, "after dispose");
    vi.advanceTimersByTime(10_000);
    expect(emissions).toBe(0);
  });

  it("keeps the snapshot reference stable when nothing changed", () => {
    store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
    const first = store.getSnapshot();
    store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
    expect(store.getSnapshot()).toBe(first);
  });

  describe("Tier 1 process probe", () => {
    it("reports running while a tool process runs beneath the agent", async () => {
      const calls: number[][] = [];
      store.setProcessProbe(async (ptyIds) => {
        calls.push([...ptyIds]);
        return Object.fromEntries(ptyIds.map((id) => [id, { active: true, processes: ["/bin/bash"] }]));
      });
      store.setPanes([{ key: "p1", group: "session", ptyId: 7 }]);

      await vi.waitFor(() => {
        expect(store.getSnapshot().sourceByPaneKey.p1).toBe("process");
      });
      expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("running");
      // A pane that is quiet but executing must never fall back to idle.
      expect(calls[0]).toEqual([7]);
    });

    it("batches every pane into a single probe call", async () => {
      const calls: number[][] = [];
      store.setProcessProbe(async (ptyIds) => {
        calls.push([...ptyIds]);
        return Object.fromEntries(ptyIds.map((id) => [id, { active: false, processes: [] }]));
      });
      store.setPanes([
        { key: "p1", group: "session", ptyId: 1 },
        { key: "p2", group: "session", ptyId: 2 },
        { key: "p3", group: "session", ptyId: 3 }
      ]);

      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
      expect(calls[0]).toEqual([1, 2, 3]);
    });

    it("does not clear a settled status when the probe fails", async () => {
      store.setProcessProbe(async () => {
        throw new Error("ps unavailable");
      });
      store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
      store.ingestTerminalData(1, "working");
      expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("running");

      await vi.waitFor(() => expect(store.getSnapshot()).toBeDefined());
      // Silence still decays normally; the failure only means "no Tier 1 signal".
      vi.advanceTimersByTime(9_000);
      expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("open");
    });

    it("behaves exactly as before when no probe is installed", () => {
      store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
      store.ingestTerminalData(1, "working");
      expect(store.getSnapshot().sourceByPaneKey.p1).toBe("activity");
      vi.advanceTimersByTime(9_000);
      expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("open");
    });
  });

  describe("Tier 1.5 judge", () => {
    const AMBIGUOUS_SCREEN = [
      "Which approach should I take?",
      "  Option A: refactor now",
      "  Option B: defer to next release"
    ].join("\n");

    /**
     * Quiet long enough to leave the running window and carry no tool, no
     * status sequence and no fingerprint match — the only judged case.
     */
    function makeAmbiguous() {
      store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
      store.attachTerminal(1, makeReader(AMBIGUOUS_SCREEN.split("\n"), 40));
      store.ingestTerminalData(1, "prompt printed");
      // Beyond RUNNING_WINDOW_MS so the probe reaches its idle branch.
      vi.advanceTimersByTime(6_000);
    }

    it("raises awaiting when the model says the screen blocks on the user", async () => {
      const judge = vi.fn(async (requests: readonly { paneKey: string }[]) =>
        requests.map((request) => ({ paneKey: request.paneKey, awaiting: true, reason: "menu" })));
      store.setStatusJudge(judge);
      makeAmbiguous();

      await vi.waitFor(() => expect(store.getSnapshot().sourceByPaneKey.p1).toBe("judge"));
      expect(store.getSnapshot().runtimeByPaneKey.p1).toEqual({
        status: "awaiting_user",
        awaitingConfidence: "confirmed"
      });
    });

    it("leaves a not-waiting verdict as plain idle", async () => {
      store.setStatusJudge(async (requests) =>
        requests.map((request) => ({ paneKey: request.paneKey, awaiting: false })));
      makeAmbiguous();

      await vi.waitFor(() => expect(store.getSnapshot().sourceByPaneKey.p1).toBe("idle"));
      expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("open");
    });

    it("does not ask while output is still flowing", async () => {
      const judge = vi.fn(async () => []);
      store.setStatusJudge(judge);
      store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
      store.ingestTerminalData(1, "streaming");
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      expect(judge).not.toHaveBeenCalled();
    });

    it("does not ask while a tool command is running", async () => {
      const judge = vi.fn(async () => []);
      store.setStatusJudge(judge);
      store.setProcessProbe(async (ptyIds) =>
        Object.fromEntries(ptyIds.map((id) => [id, { active: true, processes: ["/bin/bash"] }])));
      store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
      await vi.waitFor(() => expect(store.getSnapshot().sourceByPaneKey.p1).toBe("process"));
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
      expect(judge).not.toHaveBeenCalled();
    });

    it("does not re-ask for an unchanged screen", async () => {
      const judge = vi.fn(async (requests: readonly { paneKey: string }[]) =>
        requests.map((request) => ({ paneKey: request.paneKey, awaiting: true })));
      store.setStatusJudge(judge);
      makeAmbiguous();
      await vi.waitFor(() => expect(judge).toHaveBeenCalledTimes(1));

      // Same screen, more time: the cached verdict stands, no second call.
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
      expect(judge).toHaveBeenCalledTimes(1);
    });

    it("discards a verdict whose screen changed while the model was thinking", async () => {
      let release = () => {};
      const judge = vi.fn(async (requests: readonly { paneKey: string }[]) => {
        await new Promise<void>((resolve) => { release = resolve; });
        return requests.map((request) => ({ paneKey: request.paneKey, awaiting: true }));
      });
      store.setStatusJudge(judge);
      makeAmbiguous();
      await vi.waitFor(() => expect(judge).toHaveBeenCalledTimes(1));

      // The screen moves on before the verdict lands.
      store.attachTerminal(1, makeReader(["done, nothing to choose"], 40));
      release();
      await Promise.resolve();

      await vi.waitFor(() => expect(store.getSnapshot().sourceByPaneKey.p1).not.toBe("judge"));
      expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("open");
    });

    it("never lets the judge suppress a confident fingerprint match", async () => {
      const judge = vi.fn(async (requests: readonly { paneKey: string }[]) =>
        requests.map((request) => ({ paneKey: request.paneKey, awaiting: false })));
      store.setStatusJudge(judge);
      store.setPanes([{ key: "p1", group: "session", ptyId: 1 }]);
      store.attachTerminal(1, makeReader(PLAN_MENU, 40));
      store.ingestTerminalData(1, "starting");
      vi.advanceTimersByTime(1_000);

      expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("awaiting_user");
      expect(store.getSnapshot().sourceByPaneKey.p1).toBe("fingerprint");
    });

    it("survives a judge failure without disturbing status", async () => {
      store.setStatusJudge(async () => {
        throw new Error("llm down");
      });
      makeAmbiguous();
      await vi.waitFor(() => expect(store.getSnapshot()).toBeDefined());
      expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("open");
    });

    it("does nothing when no judge is installed", async () => {
      makeAmbiguous();
      await Promise.resolve();
      expect(store.getSnapshot().runtimeByPaneKey.p1.status).toBe("open");
    });
  });
});
