import { describe, expect, it } from "vitest";
import {
  parseWorkbenchActiveSessionDots,
  parseWorkbenchFocusSessionRequest,
  parseWorkbenchSendSelectionRequest,
  rollupSessionDotStatus
} from "./workbenchSelection";

describe("parseWorkbenchSendSelectionRequest", () => {
  it("accepts a new-agent request with a known target", () => {
    expect(parseWorkbenchSendSelectionRequest({
      kind: "new-agent",
      text: "  review this  ",
      target: "cli:pi",
      projectPath: "/work/app"
    })).toEqual({
      kind: "new-agent",
      text: "review this",
      target: "cli:pi",
      projectPath: "/work/app"
    });
  });

  it("accepts an existing-session request", () => {
    expect(parseWorkbenchSendSelectionRequest({
      kind: "existing-session",
      text: "fix this",
      paneKey: "terminal:1"
    })).toEqual({
      kind: "existing-session",
      text: "fix this",
      paneKey: "terminal:1"
    });
  });

  it("rejects empty text", () => {
    expect(() => parseWorkbenchSendSelectionRequest({
      kind: "new-agent",
      text: "   ",
      target: "cli:pi"
    })).toThrow(/required/i);
  });

  it("rejects an unknown agent target", () => {
    expect(() => parseWorkbenchSendSelectionRequest({
      kind: "new-agent",
      text: "hello",
      target: "cli:chat"
    })).toThrow(/unsupported agent target/i);
  });

  it("rejects a missing pane key", () => {
    expect(() => parseWorkbenchSendSelectionRequest({
      kind: "existing-session",
      text: "hello",
      paneKey: " "
    })).toThrow(/pane/i);
  });
});

describe("parseWorkbenchFocusSessionRequest", () => {
  it("accepts a pane key and optional project path", () => {
    expect(parseWorkbenchFocusSessionRequest({
      paneKey: "  terminal:9  ",
      projectPath: " /work/app "
    })).toEqual({
      paneKey: "terminal:9",
      projectPath: "/work/app"
    });
  });

  it("omits a missing project path", () => {
    expect(parseWorkbenchFocusSessionRequest({
      paneKey: "acp:1"
    })).toEqual({ paneKey: "acp:1" });
  });

  it("rejects a missing pane key", () => {
    expect(() => parseWorkbenchFocusSessionRequest({ paneKey: " " })).toThrow(/pane/i);
  });
});

describe("parseWorkbenchActiveSessionDots", () => {
  it("keeps known fields and drops invalid rows", () => {
    expect(parseWorkbenchActiveSessionDots([
      {
        paneKey: "terminal:1",
        projectPath: "/work/app",
        title: "Pi",
        sessionKey: "pi:abc",
        status: "running",
        workbenchId: "  wb-1  ",
        extra: true
      },
      { title: "missing pane" },
      null
    ])).toEqual([
      {
        paneKey: "terminal:1",
        projectPath: "/work/app",
        title: "Pi",
        sessionKey: "pi:abc",
        status: "running",
        workbenchId: "wb-1"
      }
    ]);
  });

  it("falls back to open when status is unknown", () => {
    expect(parseWorkbenchActiveSessionDots([
      { paneKey: "acp:1", status: "thinking" }
    ])).toEqual([
      {
        paneKey: "acp:1",
        projectPath: "",
        title: "",
        sessionKey: "",
        status: "open",
        workbenchId: ""
      }
    ]);
  });
});

describe("rollupSessionDotStatus", () => {
  it("returns the most urgent status", () => {
    expect(rollupSessionDotStatus(["open", "running", "error", "connecting"])).toBe("error");
    expect(rollupSessionDotStatus(["open", "running", "awaiting_user"])).toBe("awaiting_user");
    expect(rollupSessionDotStatus(["open", "open"])).toBe("open");
  });

  it("defaults to open for no panes", () => {
    expect(rollupSessionDotStatus([])).toBe("open");
  });
});
