import { describe, expect, it } from "vitest";
import { activationTarget } from "./activationTarget";

function window(destroyed = false): { isDestroyed(): boolean; name: string } {
  return { name: destroyed ? "destroyed" : "alive", isDestroyed: () => destroyed };
}

describe("macOS reopen target", () => {
  it("returns the window the user left in front", () => {
    const board = window();
    const workbench = window();
    expect(activationTarget(workbench, board, true)).toBe(workbench);
  });

  it("falls back to the board when nothing is remembered", () => {
    const board = window();
    expect(activationTarget(null, board, true)).toBe(board);
  });

  it("falls back to the board when the remembered window is gone", () => {
    const board = window();
    expect(activationTarget(window(true), board, true)).toBe(board);
  });

  it("asks for the board when the system is waiting for a window", () => {
    const board = window();
    const workbench = window();
    expect(activationTarget(workbench, board, false)).toBe(board);
  });

  it("returns null when there is no board either", () => {
    expect(activationTarget(null, null, true)).toBeNull();
    expect(activationTarget(null, null, false)).toBeNull();
  });
});
