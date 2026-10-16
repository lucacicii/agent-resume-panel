import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DesktopAppearanceState } from "../../../themes";
import { createTerminalAdapter, XtermTerminalAdapter } from "./index";

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  }
});

describe("Terminal Adapters", () => {
  const defaultAppearance: DesktopAppearanceState = {
    requestedAppearance: "dark",
    appearance: "dark"
  };

  const defaultOptions = {
    themeId: "default-dark" as const,
    appearance: defaultAppearance,
    rendererMode: "canvas" as const,
    fontSize: 13
  };

  describe("XtermTerminalAdapter", () => {
    it("initializes xterm adapter with default values and implements ITerminalAdapter", async () => {
      const adapter = createTerminalAdapter("xterm", defaultOptions);
      expect(adapter.engineType).toBe("xterm");
      expect(adapter instanceof XtermTerminalAdapter).toBe(true);

      const container = document.createElement("div");
      adapter.open(container);

      expect(typeof adapter.cols).toBe("number");
      expect(typeof adapter.rows).toBe("number");

      const bufferInfo = adapter.getBufferInfo();
      expect(bufferInfo.type).toBe("normal");
      expect(bufferInfo.baseY).toBe(0);

      await new Promise<void>((resolve) => adapter.write("Hello world\r\n", resolve));
      adapter.focus();
      adapter.blur();
      adapter.scrollToBottom();
      adapter.scrollLines(1);

      adapter.dispose();
    });

    it("supports search lifecycle", async () => {
      const adapter = new XtermTerminalAdapter(defaultOptions);
      const container = document.createElement("div");
      adapter.open(container);

      await new Promise<void>((resolve) => adapter.write("foo bar baz\r\n", resolve));
      expect(adapter.findNext("bar")).toBe(true);
      expect(adapter.findPrevious("bar")).toBe(true);
      adapter.clearSearchDecorations();

      adapter.dispose();
    });

    it("fit preserves bottom scroll position when at bottom", async () => {
      const adapter = new XtermTerminalAdapter(defaultOptions);
      const container = document.createElement("div");
      adapter.open(container);

      const lines = Array.from({ length: 50 }, (_, i) => `line ${i}\r\n`).join("");
      await new Promise<void>((resolve) => adapter.write(lines, resolve));
      adapter.scrollToBottom();

      const before = adapter.getBufferInfo();
      expect(before.viewportY).toBe(before.baseY);

      adapter.fit();
      const after = adapter.getBufferInfo();
      expect(after.viewportY).toBe(after.baseY);

      adapter.dispose();
    });
  });

});
