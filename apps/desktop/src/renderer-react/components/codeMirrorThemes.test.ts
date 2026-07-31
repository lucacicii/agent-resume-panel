import { afterEach, describe, expect, it } from "vitest";
import { resolveCodeMirrorThemeId } from "./codeMirrorThemes";

afterEach(() => {
  delete document.documentElement.dataset.visualTheme;
  delete document.documentElement.dataset.theme;
});

describe("CodeMirror visual theme resolution", () => {
  it("maps follow-app to the Cyberpunk and DOS editor themes", () => {
    document.documentElement.dataset.visualTheme = "cyberpunk";
    document.documentElement.dataset.theme = "dark";
    expect(resolveCodeMirrorThemeId("follow-app", document.documentElement, false)).toBe("cyberpunk");

    document.documentElement.dataset.visualTheme = "dos";
    expect(resolveCodeMirrorThemeId("follow-app", document.documentElement, false)).toBe("dos");
  });

  it("keeps an explicit Workbench light or dark preference independent from the visual theme", () => {
    document.documentElement.dataset.visualTheme = "cyberpunk";
    expect(resolveCodeMirrorThemeId("light", document.documentElement, true)).toBe("classic-light");

    document.documentElement.dataset.visualTheme = "dos";
    expect(resolveCodeMirrorThemeId("dark", document.documentElement, false)).toBe("classic-dark");
  });

  it("uses the app appearance for Classic and the system appearance as its fallback", () => {
    document.documentElement.dataset.visualTheme = "classic";
    document.documentElement.dataset.theme = "dark";
    expect(resolveCodeMirrorThemeId("follow-app", document.documentElement, false)).toBe("classic-dark");

    delete document.documentElement.dataset.theme;
    expect(resolveCodeMirrorThemeId("follow-app", document.documentElement, false)).toBe("classic-light");
    expect(resolveCodeMirrorThemeId("follow-app", document.documentElement, true)).toBe("classic-dark");
  });
});
