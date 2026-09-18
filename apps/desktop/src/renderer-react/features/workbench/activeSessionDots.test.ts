import { describe, expect, it } from "vitest";
import { collectActiveSessionDots } from "./activeSessionDots";

describe("collectActiveSessionDots", () => {
  it("collects session-group terminals + acp chats, skips shell terminals", () => {
    const terminals = [
      { key: "terminal:1", title: "pending title", group: "session", projectPath: "/p", workbenchId: "wb-1" },
      { key: "terminal:2", title: "fallback", group: "session", sessionKey: "cli:missing", projectPath: "/p", workbenchId: "wb-1" },
      { key: "terminal:3", title: "stale", group: "session", sessionKey: "cli:abc", projectPath: "/q", workbenchId: "wb-2" },
      { key: "terminal:4", title: "shell", group: "terminal", sessionKey: "cli:zzz", projectPath: "/r", workbenchId: "wb-1" }
    ];
    const acpChats = [{ key: "acp:rec1", recordId: "rec1", title: "acp fallback", projectPath: "/s", workbenchId: "wb-1" }];
    const titles = new Map<string, string>([["cli:abc", "  Bound Title  "]]);

    expect(collectActiveSessionDots(terminals, acpChats, titles)).toEqual([
      { paneKey: "terminal:1", projectPath: "/p", title: "pending title", sessionKey: "", status: "open", workbenchId: "wb-1" },
      { paneKey: "terminal:2", projectPath: "/p", title: "fallback", sessionKey: "cli:missing", status: "open", workbenchId: "wb-1" },
      { paneKey: "terminal:3", projectPath: "/q", title: "Bound Title", sessionKey: "cli:abc", status: "open", workbenchId: "wb-2" },
      { paneKey: "acp:rec1", projectPath: "/s", title: "acp fallback", sessionKey: "chat:rec1", status: "open", workbenchId: "wb-1" }
    ]);
  });

  it("leaves workbenchId empty when the pane has no workbench binding yet", () => {
    const terminals = [
      { key: "terminal:1", title: "unbound", group: "session", projectPath: "/p" }
    ];
    expect(collectActiveSessionDots(terminals, [], new Map())).toEqual([
      { paneKey: "terminal:1", projectPath: "/p", title: "unbound", sessionKey: "", status: "open", workbenchId: "" }
    ]);
  });

  it("merges runtime status for terminal and acp panes", () => {
    const terminals = [
      { key: "terminal:1", title: "tui", group: "session", sessionKey: "cli:a", projectPath: "/p", workbenchId: "wb-1" }
    ];
    const acpChats = [{ key: "acp:rec1", recordId: "rec1", title: "chat", projectPath: "/s", workbenchId: "wb-1" }];
    const runtime = new Map([
      ["terminal:1", { status: "awaiting_user" as const }],
      ["acp:rec1", { status: "running" as const }]
    ]);
    expect(collectActiveSessionDots(terminals, acpChats, new Map(), runtime)).toEqual([
      {
        paneKey: "terminal:1",
        projectPath: "/p",
        title: "tui",
        sessionKey: "cli:a",
        status: "awaiting_user",
        workbenchId: "wb-1"
      },
      {
        paneKey: "acp:rec1",
        projectPath: "/s",
        title: "chat",
        sessionKey: "chat:rec1",
        status: "running",
        workbenchId: "wb-1"
      }
    ]);
  });

  it("resolves acp titles from sessionTitles when bound", () => {
    const acpChats = [{ key: "acp:rec2", recordId: "rec2", title: "stale", projectPath: "/t", workbenchId: "wb-3" }];
    const titles = new Map<string, string>([["chat:rec2", "Bound Acp Title"]]);
    expect(collectActiveSessionDots([], acpChats, titles)).toEqual([
      {
        paneKey: "acp:rec2",
        projectPath: "/t",
        title: "Bound Acp Title",
        sessionKey: "chat:rec2",
        status: "open",
        workbenchId: "wb-3"
      }
    ]);
  });

  it("returns an empty array when nothing is open", () => {
    expect(collectActiveSessionDots([], [], new Map())).toEqual([]);
  });
});
