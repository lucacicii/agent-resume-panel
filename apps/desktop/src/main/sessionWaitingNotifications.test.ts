import { describe, expect, it } from "vitest";
import { collectNewConfirmedWaitingSessions } from "./sessionWaitingNotifications";

const waiting = {
  paneKey: "pane:1",
  projectPath: "/tmp/project",
  title: "Needs input",
  sessionKey: "codex:session-1",
  status: "awaiting_user" as const
};

describe("collectNewConfirmedWaitingSessions", () => {
  it("notifies once while a session stays confirmed waiting", () => {
    const notified = new Set<string>();
    expect(collectNewConfirmedWaitingSessions([waiting], notified)).toEqual([waiting]);
    expect(collectNewConfirmedWaitingSessions([waiting], notified)).toEqual([]);
  });

  it("clears the episode once the session stops waiting", () => {
    const notified = new Set<string>();
    expect(collectNewConfirmedWaitingSessions([waiting], notified)).toEqual([waiting]);

    const idle = { ...waiting, status: "open" as const };
    expect(collectNewConfirmedWaitingSessions([idle], notified)).toEqual([]);
    expect(collectNewConfirmedWaitingSessions([waiting], notified)).toEqual([waiting]);
  });

  it("starts a new episode after running", () => {
    const notified = new Set<string>();
    expect(collectNewConfirmedWaitingSessions([waiting], notified)).toEqual([waiting]);

    const running = { ...waiting, status: "running" as const };
    expect(collectNewConfirmedWaitingSessions([running], notified)).toEqual([]);
    expect(collectNewConfirmedWaitingSessions([waiting], notified)).toEqual([waiting]);
  });

  it("removes keys for closed sessions", () => {
    const notified = new Set<string>();
    collectNewConfirmedWaitingSessions([waiting], notified);
    expect(collectNewConfirmedWaitingSessions([], notified)).toEqual([]);
    expect(notified.size).toBe(0);
  });
});
