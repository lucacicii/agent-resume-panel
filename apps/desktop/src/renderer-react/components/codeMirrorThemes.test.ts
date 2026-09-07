import { afterEach, describe, expect, it } from "vitest";
import { resolveCodeMirrorThemeId } from "./codeMirrorThemes";

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe("CodeMirror appearance resolution", () => {
  it("keeps an explicit Workbench light or dark preference independent from the app appearance", () => {
    document.documentElement.dataset.theme = "dark";
    expect(resolveCodeMirrorThemeId("light", document.documentElement, true)).toBe("classic-light");
    expect(resolveCodeMirrorThemeId("dark", document.documentElement, false)).toBe("classic-dark");
  });

  it("uses the app appearance, then the system appearance as fallback", () => {
    document.documentElement.dataset.theme = "dark";
    expect(resolveCodeMirrorThemeId("follow-app", document.documentElement, false)).toBe("classic-dark");

    delete document.documentElement.dataset.theme;
    expect(resolveCodeMirrorThemeId("follow-app", document.documentElement, false)).toBe("classic-light");
    expect(resolveCodeMirrorThemeId("follow-app", document.documentElement, true)).toBe("classic-dark");
  });
});
