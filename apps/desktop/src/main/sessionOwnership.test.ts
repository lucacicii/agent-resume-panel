import { describe, expect, it } from "vitest";
import { findWorkbenchForSession, splitSessionKey } from "./sessionOwnership";

const workbench = (workbenchId: string, taskNoteId: string) => ({
  workbenchId,
  taskNoteId,
  name: "",
  projectPath: null,
  position: 0,
  layoutJson: null,
  createdAtMs: 1,
  updatedAtMs: 1
});

const link = (workbenchId: string, provider: string, agentSessionId: string) => ({
  workbenchId,
  provider,
  agentSessionId,
  updatedAtMs: 1
});

describe("session ownership", () => {
  it("splits provider and id from a session key", () => {
    expect(splitSessionKey("codex:abc-123")).toEqual({ provider: "codex", agentSessionId: "abc-123" });
    expect(splitSessionKey("codex:")).toBeNull();
    expect(splitSessionKey("nocolon")).toBeNull();
    expect(splitSessionKey("")).toBeNull();
  });

  it("finds the workbench whose links own the session", () => {
    const links = new Map([
      ["wb-1", [link("wb-1", "claude", "other")]],
      ["wb-2", [link("wb-2", "codex", "abc-123")]]
    ]);
    expect(findWorkbenchForSession([workbench("wb-1", "t-1"), workbench("wb-2", "t-2")], links, "codex:abc-123"))
      .toEqual({ workbenchId: "wb-2", noteId: "t-2" });
  });

  it("reports no owner for unlinked or malformed sessions", () => {
    const links = new Map([["wb-1", [link("wb-1", "codex", "abc-123")]]]);
    expect(findWorkbenchForSession([workbench("wb-1", "t-1")], links, "codex:nope")).toBeNull();
    expect(findWorkbenchForSession([workbench("wb-1", "t-1")], links, "broken")).toBeNull();
    expect(findWorkbenchForSession([], new Map(), "codex:abc-123")).toBeNull();
  });

  it("does not match a different provider with the same id", () => {
    const links = new Map([["wb-1", [link("wb-1", "codex", "abc-123")]]]);
    expect(findWorkbenchForSession([workbench("wb-1", "t-1")], links, "claude:abc-123")).toBeNull();
  });
});
