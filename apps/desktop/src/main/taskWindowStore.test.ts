import { describe, expect, it } from "vitest";
import { readStoredTaskWindows, taskWindowStatePath } from "./taskWindowStore";

describe("task window state", () => {
  it("keeps complete entries and drops malformed ones", () => {
    expect(readStoredTaskWindows([
      { workbenchId: "wb-1", noteId: "t-1", title: "Realtime status" },
      { workbenchId: "wb-2", noteId: "t-2" },
      { workbenchId: "", noteId: "t-3" },
      { noteId: "t-4" },
      null,
      "nope",
      { workbenchId: "wb-5", noteId: "" }
    ])).toEqual([
      { workbenchId: "wb-1", noteId: "t-1", title: "Realtime status" },
      { workbenchId: "wb-2", noteId: "t-2" }
    ]);
  });

  it("returns nothing for values that are not a list", () => {
    expect(readStoredTaskWindows(null)).toEqual([]);
    expect(readStoredTaskWindows({ workbenchId: "wb-1" })).toEqual([]);
    expect(readStoredTaskWindows("[]")).toEqual([]);
  });

  it("lives beside the desktop database", () => {
    expect(taskWindowStatePath("/home/u/.agent-resume-panel/.desktop/desktop.db"))
      .toBe("/home/u/.agent-resume-panel/.desktop/task-windows.json");
  });
});
