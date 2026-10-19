import { describe, expect, it } from "vitest";
import { lastActiveWindowStatePath, readStoredActiveWindow } from "./lastActiveWindowStore";

describe("last active window state", () => {
  it("keeps the board and complete workbench entries", () => {
    expect(readStoredActiveWindow({ kind: "board" })).toEqual({ kind: "board" });
    expect(readStoredActiveWindow({ kind: "task", workbenchId: "wb-1" }))
      .toEqual({ kind: "task", workbenchId: "wb-1" });
    expect(readStoredActiveWindow({ kind: "task", workbenchId: "  wb-2  " }))
      .toEqual({ kind: "task", workbenchId: "wb-2" });
  });

  it("drops entries it cannot resolve to a window", () => {
    expect(readStoredActiveWindow({ kind: "task" })).toBeNull();
    expect(readStoredActiveWindow({ kind: "task", workbenchId: "" })).toBeNull();
    expect(readStoredActiveWindow({ kind: "task", workbenchId: 42 })).toBeNull();
    expect(readStoredActiveWindow({ kind: "note", noteId: "n-1" })).toBeNull();
    expect(readStoredActiveWindow({ workbenchId: "wb-1" })).toBeNull();
    expect(readStoredActiveWindow(null)).toBeNull();
    expect(readStoredActiveWindow("board")).toBeNull();
    expect(readStoredActiveWindow([{ kind: "board" }])).toBeNull();
  });

  it("lives beside the desktop database", () => {
    expect(lastActiveWindowStatePath("/home/u/.agent-resume-panel/.desktop/desktop.db"))
      .toBe("/home/u/.agent-resume-panel/.desktop/last-active-window.json");
  });
});
