import { beforeAll, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { isTerminalAtBottom } from "./WorkbenchPanel";

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

describe("Terminal Scroll & Bottom Detection", () => {
  it("returns true when normal buffer viewport is at baseY", async () => {
    const terminal = new Terminal({ rows: 24, cols: 80 });
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}\r\n`).join("");
    await new Promise<void>((resolve) => terminal.write(lines, resolve));
    terminal.scrollToBottom();
    expect(isTerminalAtBottom(terminal)).toBe(true);
    terminal.dispose();
  });

  it("returns false when user scrolls up into history", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const terminal = new Terminal({ rows: 24, cols: 80 });
    terminal.open(container);
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}\r\n`).join("");
    await new Promise<void>((resolve) => terminal.write(lines, resolve));
    terminal.scrollToBottom();
    terminal.scrollLines(-15);
    expect(isTerminalAtBottom(terminal)).toBe(false);
    terminal.dispose();
    container.remove();
  });

  it("returns true when viewport is anchored to short TUI content with trailing gap", async () => {
    const terminal = new Terminal({ rows: 24, cols: 80 });
    const lines = Array.from({ length: 10 }, (_, i) => `tui line ${i}\r\n`).join("");
    await new Promise<void>((resolve) => terminal.write(lines, resolve));
    terminal.scrollToBottom();
    // At bottom of short output, isTerminalAtBottom is true
    expect(isTerminalAtBottom(terminal)).toBe(true);
    terminal.dispose();
  });

  it("handles mock terminal buffer structures safely", () => {
    const mockTerminal = {
      rows: 24,
      cols: 80,
      buffer: {
        active: {
          type: "normal" as const,
          viewportY: 35,
          baseY: 50,
          getLine: (y: number) => {
            // Lines 50..58 have content (9 lines), lines 59..73 are blank
            // gap = 24 - 1 - 8 = 15; targetY = 50 - 15 = 35.
            const offset = y - 50;
            if (offset >= 0 && offset <= 8) {
              return { translateToString: () => `tui-line-${offset}` };
            }
            return { translateToString: () => "   " };
          }
        }
      }
    } as unknown as Terminal;

    // viewportY is 35, which matches targetY (50 - 15 = 35) -> should be true
    expect(isTerminalAtBottom(mockTerminal)).toBe(true);

    // If viewportY is 30 (< 35), user scrolled up -> should be false
    (mockTerminal.buffer.active as { viewportY: number }).viewportY = 30;
    expect(isTerminalAtBottom(mockTerminal)).toBe(false);

    // If viewportY is 40 (>= 35), user is within the bottom TUI view -> should be true
    (mockTerminal.buffer.active as { viewportY: number }).viewportY = 40;
    expect(isTerminalAtBottom(mockTerminal)).toBe(true);
  });

  it("returns true for alternate screen buffer", () => {
    const mockTerminal = {
      rows: 24,
      cols: 80,
      buffer: {
        active: {
          type: "alternate" as const,
          viewportY: 0,
          baseY: 0,
          getLine: () => undefined
        }
      }
    } as unknown as Terminal;

    expect(isTerminalAtBottom(mockTerminal)).toBe(true);
  });
});
