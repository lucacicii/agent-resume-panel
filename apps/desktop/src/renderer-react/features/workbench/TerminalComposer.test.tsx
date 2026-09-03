import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
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
  "desktop.workbench.terminalComposerHint": "Click to type. Enter pastes into the terminal without sending. Shift+Enter adds a new line.",
  "desktop.workbench.terminalComposerSend": "Send to terminal",
  "desktop.workbench.terminalComposerSuggestions": "Command suggestions",
  "desktop.workbench.terminalComposerDirectorySuggestions": "Directory suggestions",
  "desktop.workbench.terminalComposerDirectoryLoading": "Loading directories…",
  "desktop.workbench.terminalComposerDirectoryEmpty": "No folders in this project",
  "desktop.workbench.terminalComposerDirectoryNoMatch": "No matching folders",
  "desktop.workbench.terminalComposerDirectoryError": "Could not load folders: {0}",
  "desktop.workbench.terminalComposerDropHint": "Drop to insert path",
  "desktop.workbench.terminalComposerHintLine": "Enter pastes · Shift+Enter newline",
  "desktop.workbench.terminalComposerMove": "Move input box",
  "desktop.workbench.terminalComposerTips": "Sent messages",
  "desktop.workbench.terminalComposerClose": "Close session",
  "desktop.workbench.sessionDots": "Active sessions",
  "desktop.workbench.sessionDot.awaiting": "Waiting for you",
  "desktop.workbench.sessionDot.running": "Running",
  "desktop.workbench.sessionDot.connecting": "Connecting",
  "desktop.workbench.sessionDot.error": "Error"
};

const workbenchListDirectoryMock = vi.fn(async () => ({
  entries: [
    { name: "src", path: "/work/app/src", isDirectory: true },
    { name: ".git", path: "/work/app/.git", isDirectory: true },
    { name: "README.md", path: "/work/app/README.md", isDirectory: false }
  ]
}));

type RegisterMap = Map<string, () => void>;

async function renderComposer(options: {
  ptyId?: number | null;
  activePane?: boolean;
  cwd?: string;
  projectPath?: string;
  projectName?: string;
  sessionTitle?: string;
  value?: string;
  tips?: Array<{ id: string; text: string; createdAtMs: number }>;
  onChange?: (value: string) => void;
  onSendToTerminal?: () => void;
  onActivate?: () => void;
  onOpenTip?: (tip: { id: string; text: string; createdAtMs: number }) => void;
  onClose?: () => void;
} = {}): Promise<{
  map: RegisterMap;
  container: HTMLElement;
  registerSpy: ReturnType<typeof vi.fn>;
  onChange: ReturnType<typeof vi.fn>;
  onSendToTerminal: ReturnType<typeof vi.fn>;
  onActivate: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}> {
  const map: RegisterMap = new Map();
  const registerSpy = vi.fn((key: string, fn: () => void) => {
    map.set(key, fn);
    return () => map.delete(key);
  });
  const onChange = options.onChange ? vi.fn(options.onChange) : vi.fn();
  const onSendToTerminal = options.onSendToTerminal ? vi.fn(options.onSendToTerminal) : vi.fn();
  const onActivate = options.onActivate ? vi.fn(options.onActivate) : vi.fn();
  const onClose = options.onClose ? vi.fn(options.onClose) : vi.fn();
  window.agentResume = {
    getI18nBundle: vi.fn(async () => ({ locale: "en", messages: COMPOSER_MESSAGES })),
    onLocaleChanged: vi.fn(() => () => undefined),
    workbenchListDirectory: workbenchListDirectoryMock
  } as unknown as typeof window.agentResume;
  function Harness(): React.JSX.Element {
    const [value, setValue] = useState(options.value ?? "");
    return (
      <TerminalComposer
        pane={{
          key: "terminal:1",
          cwd: options.cwd ?? "/work/app",
          group: "session",
          projectPath: options.projectPath
        }}
        ptyId={options.ptyId !== undefined ? options.ptyId : 7}
        activePane={options.activePane !== undefined ? options.activePane : true}
        projectName={options.projectName ?? "app"}
        sessionTitle={options.sessionTitle ?? "Fix renderer"}
        value={value}
        tips={options.tips}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        onSendToTerminal={onSendToTerminal}
        onActivate={onActivate}
        onOpenTip={options.onOpenTip}
        onClose={onClose}
        registerFocus={registerSpy}
      />
    );
  }
  const { container } = render(
    <I18nProvider>
      <Harness />
    </I18nProvider>
  );
  await waitFor(() => {
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).placeholder).toBe(
      COMPOSER_MESSAGES["desktop.workbench.terminalComposerPlaceholder"]
    );
  });
  return { map, container, registerSpy, onChange, onSendToTerminal, onActivate, onClose };
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
  workbenchListDirectoryMock.mockClear();
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
  it("loads project folders when # is typed and inserts the selected folder", async () => {
    const { onChange } = await renderComposer({ cwd: "/other", projectPath: "/work/app" });
    focusInput();
    fireEvent.change(textbox(), { target: { value: "please inspect #s" } });
    const listbox = await screen.findByRole("listbox", { name: "Directory suggestions" });
    expect(workbenchListDirectoryMock).toHaveBeenCalledWith({ rootPath: "/work/app", dirPath: "/work/app" });
    expect(await within(listbox).findByText("#src")).toBeTruthy();
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("please inspect #src");
  });

  it("includes hidden first-level directories for a bare # query", async () => {
    await renderComposer({ projectPath: "/work/app" });
    focusInput();
    fireEvent.change(textbox(), { target: { value: "#" } });
    const listbox = await screen.findByRole("listbox", { name: "Directory suggestions" });
    expect(await within(listbox).findByText("#.git")).toBeTruthy();
  });

  it("sends to the terminal without a carriage return when no directory matches", async () => {
    const { onSendToTerminal } = await renderComposer({ projectPath: "/work/app" });
    focusInput();
    fireEvent.change(textbox(), { target: { value: "#missing" } });
    const listbox = await screen.findByRole("listbox", { name: "Directory suggestions" });
    expect(await within(listbox).findByText("No matching folders")).toBeTruthy();
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(onSendToTerminal).toHaveBeenCalledTimes(1);
    expect(textbox().value).toBe("");
  });

  it("shows project name, status dot, and close control", async () => {
    const { container, onClose } = await renderComposer({ projectName: "agent-resume", sessionTitle: "Fix renderer" });
    expect(container.querySelector(".wb-terminal-composer-session-title")?.textContent).toBe("Fix renderer");
    expect(container.querySelector(".wb-terminal-composer-project-name")?.textContent).toBe("agent-resume");
    expect(container.querySelector(".rail-session-dot")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close session" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders collapsed when not the active pane and registers its focus handle", async () => {
    const { map, container, registerSpy } = await renderComposer({ activePane: false });
    expect(composerEl(container).classList.contains("is-collapsed")).toBe(true);
    expect(composerEl(container).classList.contains("is-inactive-pane")).toBe(true);
    expect(registerSpy).toHaveBeenCalledWith("terminal:1", expect.any(Function));
    expect(map.has("terminal:1")).toBe(true);
  });

  it("auto-focuses when active, then collapses on blur", async () => {
    const { container } = await renderComposer();
    expect(composerEl(container).classList.contains("is-expanded")).toBe(true);
    expect(document.activeElement).toBe(textbox());
    fireEvent.blur(textbox());
    expect(composerEl(container).classList.contains("is-collapsed")).toBe(true);
    focusInput();
    expect(composerEl(container).classList.contains("is-expanded")).toBe(true);
  });

  it("keeps the full draft value visible when collapsed", async () => {
    const longDraft = "git commit -m \"a very long message that would overflow the slim collapsed strip\" --no-verify";
    const { container } = await renderComposer({ value: longDraft });
    focusInput();
    fireEvent.blur(textbox());
    expect(composerEl(container).classList.contains("is-collapsed")).toBe(true);
    expect(textbox().value).toBe(longDraft);
  });

  it("pastes on Enter and clears the draft", async () => {
    const { container, onSendToTerminal } = await renderComposer({ value: "git status" });
    focusInput();
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(onSendToTerminal).toHaveBeenCalledTimes(1);
    expect(textbox().value).toBe("");
    expect(composerEl(container).classList.contains("is-expanded")).toBe(true);
  });

  it("does not send on Shift+Enter", async () => {
    const { onSendToTerminal } = await renderComposer({ value: "git commit -m \"wip\"" });
    focusInput();
    fireEvent.keyDown(textbox(), { key: "Enter", shiftKey: true });
    expect(onSendToTerminal).not.toHaveBeenCalled();
    expect(textbox().value).toBe("git commit -m \"wip\"");
  });

  it("auto-grows rows with no upper cap", async () => {
    const { onChange } = await renderComposer({ value: "a\nb\nc" });
    expect(textbox().rows).toBe(3);
    fireEvent.change(textbox(), { target: { value: Array(10).fill("line").join("\n") } });
    expect(onChange).toHaveBeenCalled();
  });

  it("disables send while the PTY is unavailable or the draft is empty", async () => {
    await renderComposer({ ptyId: null, value: "ls" });
    expect((screen.getByRole("button", { name: "Send to terminal" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    await renderComposer({ value: "" });
    expect((screen.getByRole("button", { name: "Send to terminal" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets inactive panes keep editing the draft", async () => {
    const { onChange } = await renderComposer({ activePane: false, value: "draft" });
    expect(textbox().disabled).toBe(false);
    fireEvent.change(textbox(), { target: { value: "draft two" } });
    expect(onChange).toHaveBeenCalledWith("draft two");
  });

  it("accepts a suggestion from the dropdown and only then pastes on Enter", async () => {
    const onChange = vi.fn();
    const { onSendToTerminal } = await renderComposer({ value: "git s", onChange });
    focusInput();
    fireEvent.change(textbox(), { target: { value: "git s" } });
    const listbox = await screen.findByRole("listbox", { name: "Command suggestions" });
    const option = listbox.querySelector('[role="option"]')!;
    expect(option.textContent).toContain("git status");
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("git status");
    expect(onSendToTerminal).not.toHaveBeenCalled();
  });

  it("pastes immediately when the value already matches the suggestion", async () => {
    const { onSendToTerminal } = await renderComposer({ value: "git status" });
    focusInput();
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(onSendToTerminal).toHaveBeenCalledTimes(1);
  });

  it("Escape closes suggestions first, then blurs and collapses", async () => {
    const { container } = await renderComposer({ value: "git s" });
    focusInput();
    fireEvent.change(textbox(), { target: { value: "git s" } });
    await screen.findByRole("listbox");

    fireEvent.keyDown(textbox(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(textbox());

    fireEvent.keyDown(textbox(), { key: "Escape" });
    expect(document.activeElement).not.toBe(textbox());
    expect(composerEl(container).classList.contains("is-collapsed")).toBe(true);
  });

  it("inserts a shell-quoted dropped path at the cursor", async () => {
    const onChange = vi.fn();
    const { container } = await renderComposer({ value: "abc", onChange });
    focusInput();
    textbox().setSelectionRange(1, 1);
    fireEvent.drop(composerEl(container), {
      dataTransfer: {
        types: [WB_PATH_DND_MIME],
        getData: (mime: string) => (mime === WB_PATH_DND_MIME ? "/work/app/src/main.ts" : "")
      }
    });
    expect(onChange).toHaveBeenCalledWith("a'/work/app/src/main.ts'bc");
  });

  it("unregisters its focus handle on unmount", async () => {
    const { map } = await renderComposer();
    const focus = map.get("terminal:1")!;
    focus();
    expect(document.activeElement).toBe(textbox());
    cleanup();
    expect(map.has("terminal:1")).toBe(false);
  });

  it("send button is disabled while empty and pastes on click without blurring", async () => {
    const { onSendToTerminal } = await renderComposer({ value: "ls" });
    const send = screen.getByRole("button", { name: "Send to terminal" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    focusInput();
    fireEvent.mouseDown(send);
    expect(document.activeElement).toBe(textbox());
    fireEvent.click(send);
    expect(onSendToTerminal).toHaveBeenCalledTimes(1);
    expect(textbox().value).toBe("");
  });

  it("activates its session when the input is focused", async () => {
    const { onActivate } = await renderComposer({ activePane: false });
    fireEvent.pointerDown(textbox());
    focusInput();
    expect(onActivate).toHaveBeenCalled();
  });

  it("renders user-message tips above the input", async () => {
    const onOpenTip = vi.fn();
    await renderComposer({
      tips: [
        { id: "1", text: "inspect src", createdAtMs: 1 },
        { id: "2", text: "run tests", createdAtMs: 2 }
      ],
      onOpenTip
    });
    const list = screen.getByRole("list", { name: "Sent messages" });
    expect(within(list).getByText("inspect src")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: "run tests" }));
    expect(onOpenTip).toHaveBeenCalledWith({ id: "2", text: "run tests", createdAtMs: 2 });
  });
});
