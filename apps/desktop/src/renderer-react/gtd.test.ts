import { describe, expect, it } from "vitest";
import {
  DESKTOP_GTD_STATUSES,
  desktopGtdColumn,
  desktopGtdColumnFromRollup,
  desktopGtdLabelKey
} from "./gtd";

function counts(partial: Partial<Record<"inbox" | "next" | "waiting" | "someday" | "reference" | "done", number>>) {
  return {
    inbox: 0,
    next: 0,
    waiting: 0,
    someday: 0,
    reference: 0,
    done: 0,
    ...partial
  };
}

describe("desktop GTD presentation", () => {
  it("surfaces exactly the four desktop columns", () => {
    expect([...DESKTOP_GTD_STATUSES]).toEqual(["inbox", "next", "waiting", "done"]);
  });

  it("folds hidden states onto to-do", () => {
    expect(desktopGtdColumn("next")).toBe("next");
    expect(desktopGtdColumn("waiting")).toBe("waiting");
    expect(desktopGtdColumn("done")).toBe("done");
    expect(desktopGtdColumn("inbox")).toBe("inbox");
    expect(desktopGtdColumn("someday")).toBe("inbox");
    expect(desktopGtdColumn("reference")).toBe("inbox");
    expect(desktopGtdColumn(undefined)).toBe("inbox");
  });

  it("applies the waiting > in progress > to do > done priority", () => {
    expect(desktopGtdColumnFromRollup({ counts: counts({ waiting: 1, next: 1 }), total: 2 })).toBe("waiting");
    expect(desktopGtdColumnFromRollup({ counts: counts({ next: 1, inbox: 1 }), total: 2 })).toBe("next");
    expect(desktopGtdColumnFromRollup({ counts: counts({ inbox: 1, someday: 1 }), total: 2 })).toBe("inbox");
    expect(desktopGtdColumnFromRollup({ counts: counts({ done: 1 }), total: 1 })).toBe("done");
  });

  it("only reports done when every contributor is done", () => {
    expect(desktopGtdColumnFromRollup({ counts: counts({ done: 1, inbox: 1 }), total: 2 })).toBe("inbox");
    expect(desktopGtdColumnFromRollup({ counts: counts({ done: 2 }), total: 2 })).toBe("done");
  });

  it("lets an explicit task pin win over the rollup", () => {
    expect(
      desktopGtdColumnFromRollup({ counts: counts({ waiting: 1 }), total: 1, override: "next" })
    ).toBe("next");
    expect(
      desktopGtdColumnFromRollup({ counts: counts({}), total: 0, override: "reference" })
    ).toBe("inbox");
  });

  it("falls back to the task's own status when no rollup is available", () => {
    expect(desktopGtdColumnFromRollup(undefined, "waiting")).toBe("waiting");
    expect(desktopGtdColumnFromRollup(undefined, "reference")).toBe("inbox");
    expect(desktopGtdColumnFromRollup(undefined)).toBe("inbox");
  });

  it("folds label keys onto the desktop column", () => {
    expect(desktopGtdLabelKey("someday")).toBe("desktop.workbench.gtdStatus.inbox");
    expect(desktopGtdLabelKey("reference")).toBe("desktop.workbench.gtdStatus.inbox");
    expect(desktopGtdLabelKey("next")).toBe("desktop.workbench.gtdStatus.next");
  });
});
