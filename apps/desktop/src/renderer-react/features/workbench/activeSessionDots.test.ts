import { describe, expect, it } from "vitest";
import { collectActiveSessionDots } from "./activeSessionDots";

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
      { paneKey: "terminal:1", projectPath: "/p", title: "pending title", sessionKey: "" },
      { paneKey: "terminal:2", projectPath: "/p", title: "fallback", sessionKey: "cli:missing" },
      { paneKey: "terminal:3", projectPath: "/q", title: "Bound Title", sessionKey: "cli:abc" },
      { paneKey: "acp:rec1", projectPath: "/s", title: "acp fallback", sessionKey: "chat:rec1" }
    ]);
  });

  it("resolves acp titles from sessionTitles when bound", () => {
    const acpChats = [{ key: "acp:rec2", recordId: "rec2", title: "stale", projectPath: "/t" }];
    const titles = new Map<string, string>([["chat:rec2", "Bound Acp Title"]]);
    expect(collectActiveSessionDots([], acpChats, titles)).toEqual([
      { paneKey: "acp:rec2", projectPath: "/t", title: "Bound Acp Title", sessionKey: "chat:rec2" }
    ]);
  });

  it("returns an empty array when nothing is open", () => {
    expect(collectActiveSessionDots([], [], new Map())).toEqual([]);
  });
});
