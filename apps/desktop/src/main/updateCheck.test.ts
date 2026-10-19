import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getVersion: () => "0.2.36", getAppPath: () => "/nonexistent" }
}));

import { pickDownloadUrl } from "./updateCheck";

const asset = (name: string) => ({ name, browser_download_url: `https://example.test/${name}` });

describe("pickDownloadUrl", () => {
  it("prefers the DMG on macOS", () => {
    const assets = [asset("Agent Resume-0.3.0-arm64.dmg"), asset("Agent Resume-0.3.0-win32-x64.zip")];
    expect(pickDownloadUrl(assets, "darwin", "arm64")).toBe("https://example.test/Agent Resume-0.3.0-arm64.dmg");
  });

  it("prefers the installer, then the arch zip, on Windows", () => {
    const assets = [
      asset("Agent Resume-0.3.0-win32-arm64.zip"),
      asset("Agent Resume-0.3.0-win32-x64-setup.exe"),
      asset("Agent Resume-0.3.0-win32-x64.zip"),
      asset("Agent Resume-0.3.0-arm64.dmg")
    ];
    expect(pickDownloadUrl(assets, "win32", "x64")).toBe(
      "https://example.test/Agent Resume-0.3.0-win32-x64-setup.exe"
    );
    expect(pickDownloadUrl(assets, "win32", "arm64")).toBe(
      "https://example.test/Agent Resume-0.3.0-win32-arm64.zip"
    );
  });

  it("falls back to any Windows asset when the exact arch is missing", () => {
    const assets = [asset("Agent Resume-0.3.0-win32-x64.zip")];
    expect(pickDownloadUrl(assets, "win32", "arm64")).toBe(
      "https://example.test/Agent Resume-0.3.0-win32-x64.zip"
    );
  });

  it("returns null when the platform has no asset", () => {
    expect(pickDownloadUrl([asset("Agent Resume-0.3.0.dmg")], "win32", "x64")).toBeNull();
    expect(pickDownloadUrl(undefined, "win32", "x64")).toBeNull();
  });
});
