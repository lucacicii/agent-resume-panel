import { describe, expect, it } from "vitest";
import { applyDesktopAppearance, appearanceStateFromSettings, appThemeTerminal } from "./index";

describe("desktop appearance", () => {
  it("follows an explicit light or dark preference", () => {
    expect(appearanceStateFromSettings({ desktop: { theme: "dark" } })).toEqual({
      requestedAppearance: "dark",
      appearance: "dark"
    });
    expect(appearanceStateFromSettings({ desktop: { theme: "light" } })).toEqual({
      requestedAppearance: "light",
      appearance: "light"
    });
  });

  it("defaults system appearance to the current color-scheme media query", () => {
    const state = appearanceStateFromSettings({ desktop: { theme: "system" } });
    expect(state.requestedAppearance).toBe("system");
    expect(["light", "dark"]).toContain(state.appearance);
  });

  it("applies light/dark to the document root without visual-theme packages", () => {
    applyDesktopAppearance({ requestedAppearance: "dark", appearance: "dark" });
    expect(document.documentElement.dataset).toMatchObject({ theme: "dark", appearance: "dark" });
    expect(document.documentElement.dataset.visualTheme).toBeUndefined();
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("keeps a single Classic terminal palette for follow-app terminals", () => {
    expect(appThemeTerminal({ requestedAppearance: "system", appearance: "light" })).toMatchObject({
      background: "#1e1e1e",
      foreground: "#f2f2f7",
      brightWhite: "#ffffff"
    });
  });
});
