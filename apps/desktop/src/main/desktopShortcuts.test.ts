import { describe, expect, it } from "vitest";
import {
  DEFAULT_STANDALONE_NOTE_SHORTCUT,
  isQuickAccessShortcut,
  isValidGlobalShortcut,
  normalizeGlobalShortcut,
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
    expect(isValidGlobalShortcut("CommandOrControl+Shift+F12")).toBe(true);
    expect(isValidGlobalShortcut("D")).toBe(false);
    expect(isValidGlobalShortcut("CommandOrControl")).toBe(false);
  });

  it("allows an explicit empty value to disable the shortcut", () => {
    expect(normalizeGlobalShortcut("")).toBe("");
    expect(normalizeGlobalShortcut(undefined)).toBe("");
    expect(normalizeGlobalShortcut("not-an-accelerator")).toBe(DEFAULT_STANDALONE_NOTE_SHORTCUT);
  });
});
