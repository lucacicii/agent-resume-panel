import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECENT_STANDALONE_NOTE_SHORTCUT,
  DEFAULT_STANDALONE_NOTE_SHORTCUT,
  isQuickAccessShortcut,
  isValidGlobalShortcut,
  normalizeGlobalShortcut,
  workbenchArrowDirectionFromInput,
  type DesktopShortcutInput
} from "./desktopShortcuts";

function input(patch: Partial<DesktopShortcutInput>): DesktopShortcutInput {
  return { type: "keyDown", key: "p", code: "KeyP", control: false, meta: true, alt: false, shift: false, ...patch };
}

describe("desktop Quick Access shortcuts", () => {
  it("matches Cmd/Ctrl+P in file mode", () => {
    expect(isQuickAccessShortcut(input({}), false)).toBe(true);
    expect(isQuickAccessShortcut(input({ meta: false, control: true }), false)).toBe(true);
    expect(isQuickAccessShortcut(input({ shift: true }), false)).toBe(false);
  });

  it("matches Cmd/Ctrl+Shift+P in command mode", () => {
    expect(isQuickAccessShortcut(input({ shift: true }), true)).toBe(true);
    expect(isQuickAccessShortcut(input({ shift: false }), true)).toBe(false);
    expect(isQuickAccessShortcut(input({ shift: true, alt: true }), true)).toBe(false);
    expect(isQuickAccessShortcut(input({ type: "keyUp", shift: true }), true)).toBe(false);
  });
});

describe("global standalone note shortcut", () => {
  it("accepts modifier-plus-key Electron accelerators", () => {
    expect(isValidGlobalShortcut("CommandOrControl+D")).toBe(true);
    expect(isValidGlobalShortcut("CommandOrControl+Shift+D")).toBe(true);
    expect(isValidGlobalShortcut("CommandOrControl+Shift+F12")).toBe(true);
    expect(isValidGlobalShortcut("D")).toBe(false);
    expect(isValidGlobalShortcut("CommandOrControl")).toBe(false);
  });

  it("allows an explicit empty value to disable the shortcut", () => {
    expect(normalizeGlobalShortcut("")).toBe("");
    expect(normalizeGlobalShortcut(undefined)).toBe("");
    expect(normalizeGlobalShortcut("not-an-accelerator")).toBe(DEFAULT_STANDALONE_NOTE_SHORTCUT);
    expect(normalizeGlobalShortcut("not-an-accelerator", DEFAULT_RECENT_STANDALONE_NOTE_SHORTCUT)).toBe(
      DEFAULT_RECENT_STANDALONE_NOTE_SHORTCUT
    );
  });

  it("exports the recent standalone note default", () => {
    expect(DEFAULT_STANDALONE_NOTE_SHORTCUT).toBe("CommandOrControl+D");
    expect(DEFAULT_RECENT_STANDALONE_NOTE_SHORTCUT).toBe("CommandOrControl+Shift+D");
  });
});

describe("desktop Workbench arrow shortcuts", () => {
  it("matches Cmd/Ctrl+Arrow in each direction", () => {
    expect(workbenchArrowDirectionFromInput(input({ key: "ArrowLeft", code: "ArrowLeft" }))).toBe("left");
    expect(workbenchArrowDirectionFromInput(input({ key: "ArrowRight", code: "ArrowRight" }))).toBe("right");
    expect(workbenchArrowDirectionFromInput(input({ key: "ArrowUp", code: "ArrowUp" }))).toBe("up");
    expect(workbenchArrowDirectionFromInput(input({ key: "ArrowDown", code: "ArrowDown" }))).toBe("down");
    expect(workbenchArrowDirectionFromInput(input({ meta: false, control: true, key: "ArrowDown", code: "ArrowDown" }))).toBe("down");
  });

  it("rejects invalid arrow shortcut combinations", () => {
    expect(workbenchArrowDirectionFromInput(input({ shift: true, key: "ArrowLeft", code: "ArrowLeft" }))).toBeNull();
    expect(workbenchArrowDirectionFromInput(input({ alt: true, key: "ArrowLeft", code: "ArrowLeft" }))).toBeNull();
    expect(workbenchArrowDirectionFromInput(input({ type: "keyUp", key: "ArrowLeft", code: "ArrowLeft" }))).toBeNull();
    expect(workbenchArrowDirectionFromInput(input({ meta: false, control: false, key: "ArrowLeft", code: "ArrowLeft" }))).toBeNull();
    expect(workbenchArrowDirectionFromInput(input({ key: "Enter", code: "Enter" }))).toBeNull();
  });
});
