import { describe, expect, it } from "vitest";
import { confirmDialogOptions } from "./confirmDialog";

const labels = { confirm: "Continue", cancel: "Cancel" };

describe("confirmDialogOptions", () => {
  it("puts Cancel first and the verb button last", () => {
    const options = confirmDialogOptions(
      { message: "Delete \"demo\"?", confirmLabel: "Delete", destructive: true },
      labels
    );
    expect(options.buttons).toEqual(["Cancel", "Delete"]);
  });

  it("keeps Return on Cancel for a destructive alert", () => {
    const options = confirmDialogOptions({ message: "Delete it?", destructive: true }, labels);
    expect(options.defaultId).toBe(0);
    expect(options.cancelId).toBe(0);
    expect(options.type).toBe("warning");
  });

  it("defaults to the confirm button for a non-destructive question", () => {
    const options = confirmDialogOptions({ message: "Continue?" }, labels);
    expect(options.defaultId).toBe(1);
    expect(options.cancelId).toBe(0);
    expect(options.type).toBe("question");
    expect(options.buttons).toEqual(["Cancel", "Continue"]);
  });

  it("passes a detail line only when there is one", () => {
    expect(confirmDialogOptions({ message: "a", detail: "  " }, labels).detail).toBeUndefined();
    expect(confirmDialogOptions({ message: "a", detail: "Cannot be undone." }, labels).detail).toBe("Cannot be undone.");
  });

  it("normalizes access keys so a & in a label is not swallowed", () => {
    expect(confirmDialogOptions({ message: "a" }, labels).normalizeAccessKeys).toBe(true);
  });
});
