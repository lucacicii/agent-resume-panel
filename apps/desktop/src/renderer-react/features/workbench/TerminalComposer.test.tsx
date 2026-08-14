import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { WB_PATH_DND_MIME } from "./workbenchDnd";
import {
  computeSuggestions,
  TERMINAL_COMPOSER_STATIC_COMMANDS,
  TerminalComposer
} from "./TerminalComposer";

const COMPOSER_MESSAGES: Record<string, string> = {
  "desktop.workbench.terminalComposerPlaceholder": "Type a command for the agent…",
  "desktop.workbench.terminalComposerHint": "Click to type a command. Enter sends, Shift+Enter adds a new line.",
  "desktop.workbench.terminalComposerSend": "Send command",
  "desktop.workbench.terminalComposerSuggestions": "Command suggestions",
  "desktop.workbench.terminalComposerDropHint": "Drop to insert path",
  "desktop.workbench.terminalComposerHintLine": "Enter sends · Shift+Enter newline",
  "desktop.workbench.terminalComposerMove": "Move input box"
};

const terminalInputMock = vi.fn(async () => ({ ok: true }));

type RegisterMap = Map<string, () => void>;

async function renderComposer(options: {
  ptyId?: number | null;
  active?: boolean;
  group?: "session" | "terminal";
  cwd?: string;
} = {}): Promise<{ map: RegisterMap; container: HTMLElement; registerSpy: ReturnType<typeof vi.fn> }> {
  const map: RegisterMap = new Map();
  const registerSpy = vi.fn((key: string, fn: () => void) => {
    map.set(key, fn);
    return () => map.delete(key);
  });
  window.agentResume = {
    getI18nBundle: vi.fn(async () => ({ locale: "en", messages: COMPOSER_MESSAGES })),
    onLocaleChanged: vi.fn(() => () => undefined),
    terminalInput: terminalInputMock
  } as unknown as typeof window.agentResume;
  const { container } = render(
    <I18nProvider>
      <TerminalComposer
        pane={{ key: "terminal:1", cwd: options.cwd ?? "/work/app", group: options.group ?? "session" }}
        ptyId={options.ptyId !== undefined ? options.ptyId : 7}
        active={options.active !== undefined ? options.active : true}
        registerFocus={registerSpy}
      />
    </I18nProvider>
  );
  await waitFor(() => {
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).placeholder).toBe(
      COMPOSER_MESSAGES["desktop.workbench.terminalComposerPlaceholder"]
    );
  });
  return { map, container, registerSpy };
}

function composerEl(container: HTMLElement): HTMLElement {
  return container.querySelector(".wb-terminal-composer") as HTMLElement;
}

function textbox(): HTMLTextAreaElement {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

/**
 * Move focus so both the DOM activeElement AND React's onFocus fire. jsdom's
 * native .focus() sets activeElement but does not dispatch the focusin event
 * React listens to, so fireEvent.focus is needed to flip the focused state.
 */
function focusInput(): void {
  act(() => {
    fireEvent.focus(textbox());
    textbox().focus();
  });
}

beforeEach(() => {
  terminalInputMock.mockClear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("computeSuggestions", () => {
  it("matches history prefix before the static list", () => {
    const result = computeSuggestions("git", ["git push", "npm test"]);
    expect(result[0]).toBe("git push");
    expect(result).toContain("git status");
    expect(result).not.toContain("npm test");
  });

  it("returns an empty list for an empty query", () => {
    expect(computeSuggestions("", ["git status"])).toEqual([]);
    expect(computeSuggestions("   ", ["git status"])).toEqual([]);
  });

  it("caps at six results and includes static commands", () => {
    const result = computeSuggestions("git", []);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(6);
    for (const item of result) expect(item.startsWith("git")).toBe(true);
    expect(TERMINAL_COMPOSER_STATIC_COMMANDS).toContain("git status");
  });
});

describe("TerminalComposer", () => {
  it("renders collapsed when not active and registers its focus handle", async () => {
    const { map, container, registerSpy } = await renderComposer({ active: false });
    expect(composerEl(container).classList.contains("is-collapsed")).toBe(true);
    expect(registerSpy).toHaveBeenCalledWith("terminal:1", expect.any(Function));
    expect(map.has("terminal:1")).toBe(true);
  });

  it("auto-focuses when active (box-primary), then collapses on blur", async () => {
    const { container } = await renderComposer();
    // Takes focus on mount when the pane is active + PTY ready.
    expect(composerEl(container).classList.contains("is-expanded")).toBe(true);
    expect(document.activeElement).toBe(textbox());
    fireEvent.blur(textbox());
    expect(composerEl(container).classList.contains("is-collapsed")).toBe(true);
    focusInput();
    expect(composerEl(container).classList.contains("is-expanded")).toBe(true);
  });

  it("sends the full line on Enter and keeps focus", async () => {
    const { container } = await renderComposer();
    focusInput();
    fireEvent.change(textbox(), { target: { value: "git status" } });
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(terminalInputMock).toHaveBeenCalledWith({ id: 7, data: "git status\r" });
    expect(textbox().value).toBe("");
    expect(composerEl(container).classList.contains("is-expanded")).toBe(true);
    expect(document.activeElement).toBe(textbox());
  });

  it("does not send on Shift+Enter and keeps the draft", async () => {
    await renderComposer();
    focusInput();
    fireEvent.change(textbox(), { target: { value: "git commit -m \"wip\"" } });
    fireEvent.keyDown(textbox(), { key: "Enter", shiftKey: true });
    expect(terminalInputMock).not.toHaveBeenCalled();
    expect(textbox().value).toBe("git commit -m \"wip\"");
  });

  it("auto-grows rows with no upper cap", async () => {
    await renderComposer();
    fireEvent.change(textbox(), { target: { value: "a\nb\nc" } });
    expect(textbox().rows).toBe(3);
    fireEvent.change(textbox(), { target: { value: Array(10).fill("line").join("\n") } });
    expect(textbox().rows).toBe(10);
  });

  it("disables input while the PTY is unavailable or the pane is inactive", async () => {
    const noPty = await renderComposer({ ptyId: null });
    expect(textbox().disabled).toBe(true);
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(terminalInputMock).not.toHaveBeenCalled();
    cleanup();

    const inactive = await renderComposer({ active: false });
    expect(textbox().disabled).toBe(true);
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(terminalInputMock).not.toHaveBeenCalled();
    expect(composerEl(inactive.container).classList.contains("is-collapsed")).toBe(true);
  });

  it("navigates command history and persists it per working directory", async () => {
    await renderComposer();
    focusInput();
    for (const command of ["cmd1", "cmd2"]) {
      fireEvent.change(textbox(), { target: { value: command } });
      fireEvent.keyDown(textbox(), { key: "Enter" });
    }
    expect(terminalInputMock).toHaveBeenNthCalledWith(1, { id: 7, data: "cmd1\r" });
    expect(terminalInputMock).toHaveBeenNthCalledWith(2, { id: 7, data: "cmd2\r" });

    const stored = JSON.parse(localStorage.getItem("wb-terminal-composer-history") || "{}") as Record<string, string[]>;
    expect(stored["/work/app"]).toEqual(["cmd2", "cmd1"]);

    fireEvent.keyDown(textbox(), { key: "ArrowUp" });
    expect(textbox().value).toBe("cmd2");
    fireEvent.keyDown(textbox(), { key: "ArrowUp" });
    expect(textbox().value).toBe("cmd1");
    fireEvent.keyDown(textbox(), { key: "ArrowDown" });
    expect(textbox().value).toBe("cmd2");
    fireEvent.keyDown(textbox(), { key: "ArrowDown" });
    expect(textbox().value).toBe("");
  });

  it("keeps mid-text ArrowUp/ArrowDown for cursor movement (history only at the edge)", async () => {
    await renderComposer();
    fireEvent.change(textbox(), { target: { value: "line1\nline2" } });
    textbox().setSelectionRange(4, 4);
    fireEvent.keyDown(textbox(), { key: "ArrowUp" });
    expect(textbox().value).toBe("line1\nline2");
    fireEvent.keyDown(textbox(), { key: "ArrowDown" });
    expect(textbox().value).toBe("line1\nline2");
  });

  it("accepts a suggestion from the dropdown and only then sends on Enter", async () => {
    await renderComposer();
    focusInput();
    fireEvent.change(textbox(), { target: { value: "git s" } });
    const listbox = await screen.findByRole("listbox", { name: "Command suggestions" });
    const option = listbox.querySelector('[role="option"]')!;
    expect(option.textContent).toContain("git status");
    expect(option.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(textbox().value).toBe("git status");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(terminalInputMock).not.toHaveBeenCalled();

    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(terminalInputMock).toHaveBeenCalledWith({ id: 7, data: "git status\r" });
  });

  it("sends immediately when the value already matches the suggestion", async () => {
    await renderComposer();
    focusInput();
    fireEvent.change(textbox(), { target: { value: "git status" } });
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(terminalInputMock).toHaveBeenCalledWith({ id: 7, data: "git status\r" });
  });

  it("Escape closes suggestions first, then blurs and collapses", async () => {
    const { container } = await renderComposer();
    focusInput();
    fireEvent.change(textbox(), { target: { value: "git s" } });
    await screen.findByRole("listbox");

    fireEvent.keyDown(textbox(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(textbox());
    expect(textbox().value).toBe("git s");

    fireEvent.keyDown(textbox(), { key: "Escape" });
    expect(document.activeElement).not.toBe(textbox());
    expect(composerEl(container).classList.contains("is-collapsed")).toBe(true);
  });

  it("inserts a shell-quoted dropped path at the cursor", async () => {
    const { container } = await renderComposer();
    focusInput();
    fireEvent.change(textbox(), { target: { value: "abc" } });
    textbox().setSelectionRange(1, 1);
    fireEvent.drop(composerEl(container), {
      dataTransfer: {
        types: [WB_PATH_DND_MIME],
        getData: (mime: string) => (mime === WB_PATH_DND_MIME ? "/work/app/src/main.ts" : "")
      }
    });
    expect(textbox().value).toBe("a'/work/app/src/main.ts'bc");
    await waitFor(() => expect(textbox().selectionStart).toBe(1 + "'/work/app/src/main.ts'".length));
    expect(composerEl(container).classList.contains("is-drag-over")).toBe(false);
  });

  it("unregisters its focus handle on unmount", async () => {
    const { map } = await renderComposer();
    const focus = map.get("terminal:1")!;
    focus();
    expect(document.activeElement).toBe(textbox());
    cleanup();
    expect(map.has("terminal:1")).toBe(false);
  });

  it("send button is disabled while empty and sends on click without blurring", async () => {
    await renderComposer();
    const send = screen.getByRole("button", { name: "Send command" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    focusInput();
    fireEvent.change(textbox(), { target: { value: "ls" } });
    expect(send.disabled).toBe(false);
    fireEvent.mouseDown(send);
    expect(document.activeElement).toBe(textbox());
    fireEvent.click(send);
    expect(terminalInputMock).toHaveBeenCalledWith({ id: 7, data: "ls\r" });
  });

  it("drag-moves the composer, clamps it, and persists the position", async () => {
    const { container } = await renderComposer();
    const grip = screen.getByRole("button", { name: "Move input box" });
    // jsdom has no PointerEvent — dispatch MouseEvents typed as pointer events
    // (same pattern as the workbench resizer tests), wrapped in act to flush.
    const pointer = (type: "pointerdown" | "pointermove" | "pointerup", clientX: number, clientY: number) =>
      act(() => {
        grip.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }));
      });
    pointer("pointerdown", 100, 200);
    pointer("pointermove", 160, 170);
    pointer("pointerup", 160, 170);
    const el = composerEl(container);
    expect(el.style.left).toBe("70px");
    expect(el.style.bottom).toBe("38px");

    // Clamp to the pane's right edge (room reserved for the expanded width).
    pointer("pointerdown", 0, 0);
    pointer("pointermove", 5000, 0);
    pointer("pointerup", 5000, 0);
    expect(el.style.left).toBe("460px");
    expect(el.style.bottom).toBe("38px");

    const stored = JSON.parse(localStorage.getItem("wb-terminal-composer-position") || "{}");
    expect(stored["/work/app"]).toEqual({ x: 460, y: 38 });
  });

  it("restores a persisted composer position on mount", async () => {
    localStorage.setItem("wb-terminal-composer-position", JSON.stringify({ "/work/app": { x: 120, y: 60 } }));
    const { container } = await renderComposer();
    expect(composerEl(container).style.left).toBe("120px");
    expect(composerEl(container).style.bottom).toBe("60px");
  });
});
