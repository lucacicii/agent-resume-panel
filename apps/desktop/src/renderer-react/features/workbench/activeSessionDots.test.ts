import { describe, expect, it } from "vitest";
import {
  acpRuntimeToStatus,
  collectActiveSessionDots,
  pickHigherStatus
} from "./activeSessionDots";

describe("collectActiveSessionDots", () => {
  it("collects session-group terminals + acp chats, skips shell terminals", () => {
    const terminals = [
      { key: "terminal:1", title: "pending title", group: "session", projectPath: "/p" },
      { key: "terminal:2", title: "fallback", group: "session", sessionKey: "cli:missing", projectPath: "/p" },
      { key: "terminal:3", title: "stale", group: "session", sessionKey: "cli:abc", projectPath: "/q" },
      { key: "terminal:4", title: "shell", group: "terminal", sessionKey: "cli:zzz", projectPath: "/r" }
    ];
    const acpChats = [{ key: "acp:rec1", recordId: "rec1", title: "acp fallback", projectPath: "/s" }];
    const titles = new Map<string, string>([["cli:abc", "  Bound Title  "]]);

    expect(collectActiveSessionDots(terminals, acpChats, titles)).toEqual([
      { paneKey: "terminal:1", projectPath: "/p", title: "pending title", sessionKey: "", status: "open" },
      { paneKey: "terminal:2", projectPath: "/p", title: "fallback", sessionKey: "cli:missing", status: "open" },
      { paneKey: "terminal:3", projectPath: "/q", title: "Bound Title", sessionKey: "cli:abc", status: "open" },
      { paneKey: "acp:rec1", projectPath: "/s", title: "acp fallback", sessionKey: "chat:rec1", status: "open" }
    ]);
  });

  it("merges runtime status for terminal and acp panes", () => {
    const terminals = [
      { key: "terminal:1", title: "tui", group: "session", sessionKey: "cli:a", projectPath: "/p" }
    ];
    const acpChats = [{ key: "acp:rec1", recordId: "rec1", title: "chat", projectPath: "/s" }];
    const runtime = new Map([
      ["terminal:1", { status: "awaiting_user" as const, awaitingConfidence: "possible" as const }],
      ["acp:rec1", { status: "running" as const }]
    ]);
    expect(collectActiveSessionDots(terminals, acpChats, new Map(), runtime)).toEqual([
      {
        paneKey: "terminal:1",
        projectPath: "/p",
        title: "tui",
        sessionKey: "cli:a",
        status: "awaiting_user",
        awaitingConfidence: "possible"
      },
      {
        paneKey: "acp:rec1",
        projectPath: "/s",
        title: "chat",
        sessionKey: "chat:rec1",
        status: "running",
        awaitingConfidence: undefined
      }
    ]);
  });

  it("resolves acp titles from sessionTitles when bound", () => {
    const acpChats = [{ key: "acp:rec2", recordId: "rec2", title: "stale", projectPath: "/t" }];
    const titles = new Map<string, string>([["chat:rec2", "Bound Acp Title"]]);
    expect(collectActiveSessionDots([], acpChats, titles)).toEqual([
      {
        paneKey: "acp:rec2",
        projectPath: "/t",
        title: "Bound Acp Title",
        sessionKey: "chat:rec2",
        status: "open"
      }
    ]);
  });

  it("returns an empty array when nothing is open", () => {
    expect(collectActiveSessionDots([], [], new Map())).toEqual([]);
  });
});

describe("acpRuntimeToStatus", () => {
  it("prioritizes pending requests over running", () => {
    expect(acpRuntimeToStatus({ isRunning: true, pendingRequestCount: 1 })).toBe("awaiting_user");
  });

  it("maps connecting / error / running / open", () => {
    expect(acpRuntimeToStatus({ isConnecting: true })).toBe("connecting");
    expect(acpRuntimeToStatus({ status: "error" })).toBe("error");
    expect(acpRuntimeToStatus({ isRunning: true })).toBe("running");
    expect(acpRuntimeToStatus({ status: "thinking", isRunning: true })).toBe("running");
    expect(acpRuntimeToStatus({})).toBe("open");
  });
});

describe("pickHigherStatus", () => {
  it("orders awaiting above running", () => {
    expect(pickHigherStatus("running", "awaiting_user")).toBe("awaiting_user");
    expect(pickHigherStatus("open", "error")).toBe("error");
  });
});
