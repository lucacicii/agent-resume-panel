import { describe, expect, it } from "vitest";
import {
  WORKBENCH_TERMINAL_THEME_IDS,
  resolveTerminalTheme,
  resolveTerminalThemeId
} from "./terminalThemes";

describe("terminalThemes", () => {
  it("resolves every built-in id to a full theme with background and foreground", () => {
    for (const id of WORKBENCH_TERMINAL_THEME_IDS) {
      const theme = resolveTerminalTheme(id);
      expect(theme.background).toMatch(/^#|rgba/);
      expect(theme.foreground).toMatch(/^#/);
      expect(theme.red).toBeTruthy();
      expect(theme.brightWhite).toBeTruthy();
    }
  });

  it("falls back to follow-app for unknown ids", () => {
    expect(resolveTerminalThemeId(undefined)).toBe("follow-app");
    expect(resolveTerminalThemeId("nope")).toBe("follow-app");
    expect(resolveTerminalTheme("nope").background).toBe(
      resolveTerminalTheme("default-dark").background
    );
  });

  it("returns a shallow copy so callers can replace options.theme safely", () => {
    const a = resolveTerminalTheme("one-dark");
    const b = resolveTerminalTheme("one-dark");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
