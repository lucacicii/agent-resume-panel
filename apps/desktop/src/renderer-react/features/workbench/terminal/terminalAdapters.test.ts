import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DesktopAppearanceState } from "../../../themes";
import { createTerminalAdapter, XtermTerminalAdapter, GhosttyWebTerminalAdapter } from "./index";

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
    visualTheme: "classic",
    requestedAppearance: "dark",
    appearance: "dark",
    effects: "full",
    density: "comfortable"
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
  });

  describe("GhosttyWebTerminalAdapter", () => {
    it("initializes ghostty-web adapter and manages event handlers", async () => {
      const onData = vi.fn();
      const onResize = vi.fn();
      const onWriteParsed = vi.fn();
      const onBufferChange = vi.fn();

      const adapter = createTerminalAdapter("ghostty-web", defaultOptions);
      expect(adapter.engineType).toBe("ghostty-web");
      expect(adapter instanceof GhosttyWebTerminalAdapter).toBe(true);

      adapter.onData(onData);
      adapter.onResize(onResize);
      adapter.onWriteParsed(onWriteParsed);
      adapter.onBufferChange(onBufferChange);

      const container = document.createElement("div");
      adapter.open(container);

      await new Promise<void>((resolve) => adapter.write("hello from ghostty\r\n", resolve));
      expect(onWriteParsed).toHaveBeenCalled();

      // Test Alternate buffer detection
      adapter.write("\x1b[?1049h");
      expect(adapter.getBufferInfo().type).toBe("alternate");
      expect(onBufferChange).toHaveBeenCalled();

      adapter.write("\x1b[?1049l");
      expect(adapter.getBufferInfo().type).toBe("normal");

      adapter.resize(100, 30);
      expect(adapter.cols).toBe(100);
      expect(adapter.rows).toBe(30);
      expect(onResize).toHaveBeenCalledWith({ cols: 100, rows: 30 });

      adapter.dispose();
    });
  });
});
