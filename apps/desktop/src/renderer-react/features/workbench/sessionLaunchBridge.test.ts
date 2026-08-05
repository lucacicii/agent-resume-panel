import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sessions: [] as Array<{ provider: string; id: string; title: string; projectPath: string; updatedAt: number }>
}));

vi.mock("../../bridge", () => ({
  desktopApi: () => ({ listSessions: async () => state.sessions })
}));

import { findRecentCatalogSession } from "./sessionLaunchBridge";

describe("findRecentCatalogSession", () => {
  it("recovers a session identified by the Flow note prompt even when it predates the waiter", async () => {
    state.sessions = [{
      provider: "codex",
      id: "existing-session",
      title: 'You are executing Flow node for Note ID "note-123".',
      projectPath: "/different/path",
      updatedAt: 1
    }];

    await expect(findRecentCatalogSession({
      cwd: "/project",
      provider: "codex",
      noteId: "note-123",
      knownKeys: new Set(["codex:existing-session"]),
      notBeforeMs: 100
    })).resolves.toEqual({ catalogProvider: "codex", sessionId: "existing-session" });
  });

  it("does not bind an unrelated old session", async () => {
    state.sessions = [{
      provider: "codex",
      id: "old-session",
      title: "Unrelated work",
      projectPath: "/different/path",
      updatedAt: 1
    }];

    await expect(findRecentCatalogSession({
      cwd: "/project",
      provider: "codex",
      noteId: "note-123",
      knownKeys: new Set(["codex:old-session"]),
      notBeforeMs: 100
    })).resolves.toBeNull();
  });
});
