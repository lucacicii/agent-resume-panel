import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const nativeTheme = { shouldUseDarkColors: false, themeSource: "system" as string };
  return {
    nativeTheme,
    systemPreferences: {
      getAccentColor: vi.fn((): unknown => "0a84ffff"),
      subscribeNotification: vi.fn((..._args: unknown[]) => 7),
      unsubscribeNotification: vi.fn((..._args: unknown[]) => undefined)
    }
  };
});

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: fake.nativeTheme,
  systemPreferences: fake.systemPreferences
}));

import { accentColorFromSystem, currentAccentColor, subscribeAccentColorChange } from "./systemAccent";
import { applyNativeThemeSource, windowBackgroundColor } from "./windowAppearance";

describe("accentColorFromSystem", () => {
  it("strips the alpha channel macOS appends", () => {
    expect(accentColorFromSystem("0a84ffff")).toBe("#0a84ff");
    expect(accentColorFromSystem("#0a84ff")).toBe("#0a84ff");
  });

  it("rejects malformed and non-string values", () => {
    expect(accentColorFromSystem("blue")).toBeNull();
    expect(accentColorFromSystem("0a84")).toBeNull();
    expect(accentColorFromSystem(true)).toBeNull();
    expect(accentColorFromSystem(null)).toBeNull();
  });
});

describe("currentAccentColor", () => {
  beforeEach(() => {
    fake.systemPreferences.getAccentColor.mockReturnValue("ff0000ff");
  });

  it.skipIf(process.platform !== "darwin")("reads the system accent on darwin", () => {
    expect(currentAccentColor()).toBe("#ff0000");
  });

  it.skipIf(process.platform !== "darwin")("falls back to null when the platform reports a boolean", () => {
    fake.systemPreferences.getAccentColor.mockReturnValue(true);
    expect(currentAccentColor()).toBeNull();
  });

  it.skipIf(process.platform === "darwin")("stays null off darwin", () => {
    expect(currentAccentColor()).toBeNull();
  });
});

describe("subscribeAccentColorChange", () => {
  it.skipIf(process.platform !== "darwin")("forwards the new accent and unsubscribes", () => {
    const listener = vi.fn();
    const stop = subscribeAccentColorChange(listener);
    const calls = fake.systemPreferences.subscribeNotification.mock.calls;
    const callback = calls[calls.length - 1]?.[1] as () => void;
    fake.systemPreferences.getAccentColor.mockReturnValue("af52deff");
    callback();
    expect(listener).toHaveBeenCalledWith("#af52de");
    stop();
    expect(fake.systemPreferences.unsubscribeNotification).toHaveBeenCalledWith(7);
  });
});

describe("applyNativeThemeSource", () => {
  beforeEach(() => {
    fake.nativeTheme.themeSource = "system";
    fake.nativeTheme.shouldUseDarkColors = false;
  });

  it("follows the in-app appearance setting", () => {
    applyNativeThemeSource("dark");
    expect(fake.nativeTheme.themeSource).toBe("dark");
    applyNativeThemeSource("light");
    expect(fake.nativeTheme.themeSource).toBe("light");
  });

  it("treats an unset or unknown value as system", () => {
    fake.nativeTheme.themeSource = "dark";
    applyNativeThemeSource(undefined);
    expect(fake.nativeTheme.themeSource).toBe("system");
  });

  it("does not clobber an unchanged value", () => {
    fake.nativeTheme.themeSource = "system";
    applyNativeThemeSource("system");
    expect(fake.nativeTheme.themeSource).toBe("system");
  });
});

describe("windowBackgroundColor", () => {
  it("follows the effective appearance", () => {
    fake.nativeTheme.shouldUseDarkColors = false;
    expect(windowBackgroundColor()).toBe("#f5f5f7");
    fake.nativeTheme.shouldUseDarkColors = true;
    expect(windowBackgroundColor()).toBe("#1e1e1e");
  });
});
