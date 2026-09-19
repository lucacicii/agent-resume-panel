import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ dialogConfirm: vi.fn() }));
vi.mock("./bridge", () => ({ desktopApi: () => api }));

import { confirmAction, confirmDestructive } from "./confirmAction";

describe("confirmAction", () => {
  beforeEach(() => {
    api.dialogConfirm.mockReset();
    vi.spyOn(window, "confirm").mockReset();
  });

  it("asks the native dialog when the bridge is present", async () => {
    api.dialogConfirm.mockResolvedValue(true);
    expect(await confirmAction("Delete it?")).toBe(true);
    expect(api.dialogConfirm).toHaveBeenCalledWith({ message: "Delete it?" });
  });

  it("passes the destructive verb and detail through", async () => {
    api.dialogConfirm.mockResolvedValue(false);
    expect(await confirmDestructive("Delete \"x\"?", "Delete", "This cannot be undone.")).toBe(false);
    expect(api.dialogConfirm).toHaveBeenCalledWith({
      message: "Delete \"x\"?",
      confirmLabel: "Delete",
      detail: "This cannot be undone.",
      destructive: true
    });
  });

  it("falls back to window.confirm without a bridge", async () => {
    const fallback = vi.spyOn(window, "confirm").mockReturnValue(true);
    api.dialogConfirm.mockImplementation(() => {
      throw new Error("no bridge");
    });
    // A throwing bridge must not confirm anything by accident.
    await expect(confirmAction("Delete it?")).resolves.toBe(false);
    fallback.mockRestore();
  });

  it("reports false when the user cancels", async () => {
    api.dialogConfirm.mockResolvedValue(false);
    expect(await confirmAction("Delete it?")).toBe(false);
  });
});
