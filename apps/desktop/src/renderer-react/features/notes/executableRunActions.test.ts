import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildStepPrompt,
  probeExecutableNote,
  resumeNoteSession,
  snapshotFromParsed
} from "./executableRunActions";

const apiMock = vi.hoisted(() => ({ probe: vi.fn(), resume: vi.fn() }));

vi.mock("../../bridge", () => ({
  desktopApi: () => ({
    notesExecutableProbe: apiMock.probe,
    notesResumeSession: apiMock.resume
  } as unknown as ReturnType<typeof import("../../bridge").desktopApi>)
}));

beforeEach(() => {
  apiMock.probe.mockReset();
  apiMock.resume.mockReset();
});

describe("executableRunActions", () => {
  it("detects approvable run and current child", () => {
    const snap = snapshotFromParsed({
      runs: [{ status: "awaiting_approval", text: "" }],
      noteChildren: [
        { index: 0, noteId: "a", status: "idle", text: "A" },
        { index: 1, noteId: "b", status: "idle", text: "B" }
      ]
    });
    expect(snap.canApprove).toBe(true);
    expect(snap.canStartStep).toBe(false);
    expect(snap.currentChildNoteId).toBe("a");
  });

  it("allows start step when executing without native session", () => {
    const snap = snapshotFromParsed({
      runs: [{ status: "executing", text: "" }],
      noteChildren: [{ index: 0, noteId: "a", status: "running", text: "A" }],
      currentSession: { provider: "codex", status: "planned", text: "" }
    });
    expect(snap.canStartStep).toBe(true);
    expect(snap.canSettle).toBe(true);
  });

  it("hides start step once native session is bound", () => {
    const snap = snapshotFromParsed({
      runs: [{ status: "executing", text: "" }],
      noteChildren: [{ index: 0, noteId: "a", status: "running", text: "A" }],
      currentSession: {
        provider: "codex",
        status: "running",
        native: "chat/xyz",
        text: ""
      }
    });
    expect(snap.canStartStep).toBe(false);
    expect(snap.canSettle).toBe(true);
  });

  it("builds step prompt from session text or child body", () => {
    expect(
      buildStepPrompt({
        parentTitle: "Parent",
        childTitle: "Child",
        childBody: "# Child\n\nbody",
        sessionText: "Do the thing"
      })
    ).toBe("Do the thing");

    const fallback = buildStepPrompt({
      parentTitle: "Parent",
      childTitle: "Child",
      childBody: "# Child\n\nImplement API\n\n:::session codex idle\n:::\n"
    });
    expect(fallback).toContain("Implement API");
    expect(fallback).toContain('note "Parent"');
    expect(fallback).not.toContain(":::session");
  });

  it("probeExecutableNote forwards the noteId and returns the probe result", async () => {
    apiMock.probe.mockResolvedValue({ hasRun: true, runStatus: "awaiting_approval", runCount: 1, hasSession: false, asStep: undefined });
    const result = await probeExecutableNote("note-9");
    expect(apiMock.probe).toHaveBeenCalledWith({ noteId: "note-9" });
    expect(result?.hasRun).toBe(true);
  });

  it("resumeNoteSession forwards the provider/sessionId to the main process", async () => {
    apiMock.resume.mockResolvedValue({ ok: true, mode: "xterm", command: "codex resume --cd /x sess-1", cwd: "/x" });
    const result = await resumeNoteSession({ provider: "codex", sessionId: "sess-1" });
    expect(apiMock.resume).toHaveBeenCalledWith({ provider: "codex", sessionId: "sess-1" });
    expect(result.ok).toBe(true);
  });

  it("resumeNoteSession throws when the main process fails", async () => {
    apiMock.resume.mockResolvedValue({ ok: false, error: "Session not found" });
    await expect(resumeNoteSession({ provider: "codex", sessionId: "missing" })).rejects.toThrow(/Session not found/);
  });
});
