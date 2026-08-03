import { describe, expect, it } from "vitest";
import {
  buildStepPrompt,
  snapshotFromParsed
} from "./executableRunActions";

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
});
