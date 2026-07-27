import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { AcpChatView } from "./AcpChatView";

const streamListeners = new Set<(event: Record<string, unknown>) => void>();

function emit(event: Record<string, unknown>): void {
  for (const listener of streamListeners) listener(event);
}

async function renderChat(initExtra: Record<string, unknown> = {}): Promise<void> {
  window.agentResume = {
    getI18nBundle: vi.fn(async () => ({
      locale: "en",
      messages: {
        "desktop.workbench.acpSlashCommands": "Agent commands",
        "desktop.workbench.acpModeSwitched": "Mode: {0}",
        "desktop.workbench.acpPlanTitle": "Plan",
        "desktop.workbench.acpPlanPreview": "Preview",
        "desktop.workbench.acpPlanPreviewTitle": "Plan preview",
        "desktop.workbench.acpPlanOpen": "Open file",
        "desktop.workbench.acpPlanFromSession": "From session update"
      }
    })),
    onLocaleChanged: vi.fn(() => () => undefined),
    onAcpStream: (listener: (event: Record<string, unknown>) => void) => {
      streamListeners.add(listener);
      return () => streamListeners.delete(listener);
    },
    acpConnect: vi.fn(async () => ({ ok: true, record: { id: "chat-1", title: "Chat", provider: "codex" } })),
    acpDisconnect: vi.fn(async () => ({ ok: true })),
    acpPrompt: vi.fn(async () => ({ ok: true })),
    acpSetMode: vi.fn(async () => ({ ok: true })),
    acpOpenPath: vi.fn(async () => ({ ok: true }))
  } as unknown as typeof window.agentResume;
  render(<I18nProvider><AcpChatView recordId="chat-1" provider="codex" projectPath="/work/app" title="Chat" active /></I18nProvider>);
  await waitFor(() => expect(streamListeners.size).toBe(1));
  emit({
    type: "init",
    chatId: "chat-1",
    init: {
      title: "Chat",
      availableCommands: [
        { name: "review", description: "Review the current changes" },
        { name: "plan", description: "Create a plan", inputHint: "topic" }
      ],
      modes: [
        { id: "build", name: "Build" },
        { id: "plan", name: "Plan" },
        { id: "ask", name: "Ask" }
      ],
      modeId: "build",
      isRunning: false,
      isConnecting: false,
      status: "ready",
      fileUpload: true,
      ...initExtra
    }
  });
}

afterEach(() => {
  cleanup();
  streamListeners.clear();
});

describe("AcpChatView slash commands", () => {
  it("filters dynamic agent commands and inserts a tag on Enter (send on second Enter)", async () => {
    const user = userEvent.setup();
    await renderChat();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(input, "/re");
    expect(await screen.findByRole("option", { name: /\/review/i })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /\/plan/i })).toBeNull();
    await user.keyboard("{Enter}");
    // Tag chip is inserted; prompt not sent yet.
    expect(window.agentResume.acpPrompt).not.toHaveBeenCalled();
    expect(screen.getByText("/review")).toBeTruthy();
    expect(input.value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.keyboard("{Enter}");
    expect(window.agentResume.acpPrompt).toHaveBeenCalledWith({
      chatId: "chat-1",
      text: "/review",
      images: [],
      files: []
    });
  });

  it("supports Tab selection into a tag, then free-text args before send", async () => {
    const user = userEvent.setup();
    await renderChat();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(input, "/");
    await screen.findAllByRole("option");
    await user.keyboard("{ArrowDown}{Tab}");
    expect(screen.getByText("/plan")).toBeTruthy();
    await waitFor(() => expect(input.value).toBe(""));
    expect(window.agentResume.acpPrompt).not.toHaveBeenCalled();
    // Set suffix via change to avoid cursor races after Tab clears the field.
    fireEvent.change(input, { target: { value: "auth flow" } });
    input.focus();
    await user.keyboard("{Enter}");
    expect(window.agentResume.acpPrompt).toHaveBeenCalledWith({
      chatId: "chat-1",
      text: "/plan auth flow",
      images: [],
      files: []
    });
  });

  it("keeps the keyboard-active command visible in the menu", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });
    try {
      const user = userEvent.setup();
      await renderChat();
      await user.type(screen.getByRole("textbox"), "/");
      await screen.findAllByRole("option");
      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("option", { name: /\/plan/i }).getAttribute("aria-selected")).toBe("true");
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
      else delete (HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView;
    }
  });

  it("closes the menu with Escape and sends the retained plain input with Enter", async () => {
    const user = userEvent.setup();
    await renderChat();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(input, "/review");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}{Enter}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(window.agentResume.acpPrompt).toHaveBeenCalledWith({ chatId: "chat-1", text: "/review", images: [], files: [] });
  });

  it("inserts a command tag with the pointer; Enter sends it", async () => {
    const user = userEvent.setup();
    await renderChat();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/re" } });
    fireEvent.click(screen.getByRole("option", { name: /\/review/i }));
    expect(window.agentResume.acpPrompt).not.toHaveBeenCalled();
    expect(screen.getByText("/review")).toBeTruthy();
    input.focus();
    await user.keyboard("{Enter}");
    expect(window.agentResume.acpPrompt).toHaveBeenCalledWith({
      chatId: "chat-1",
      text: "/review",
      images: [],
      files: []
    });
  });

  it("removes the slash tag with Backspace when the free-text field is empty", async () => {
    const user = userEvent.setup();
    await renderChat();
    await user.type(screen.getByRole("textbox"), "/re");
    await user.keyboard("{Enter}");
    expect(screen.getByText("/review")).toBeTruthy();
    await user.keyboard("{Backspace}");
    expect(screen.queryByText("/review")).toBeNull();
    expect(window.agentResume.acpPrompt).not.toHaveBeenCalled();
  });
});

describe("AcpChatView modes and plan preview", () => {
  it("cycles session modes with Shift+Tab", async () => {
    await renderChat();
    await waitFor(() => expect(screen.getByRole("combobox", { name: /mode/i })).toBeTruthy());
    const shiftTab = () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          code: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    };
    shiftTab();
    await waitFor(() =>
      expect(window.agentResume.acpSetMode).toHaveBeenCalledWith({ chatId: "chat-1", modeId: "plan" })
    );
    shiftTab();
    await waitFor(() =>
      expect(window.agentResume.acpSetMode).toHaveBeenCalledWith({ chatId: "chat-1", modeId: "ask" })
    );
  });

  it("opens a markdown plan preview from planFile stream events in the message list", async () => {
    await renderChat();
    emit({
      type: "planFile",
      chatId: "chat-1",
      path: "/Users/me/.grok/sessions/s1/plan.md",
      content: "# Goal\n\nShip plan preview",
      updatedAt: Date.now()
    });
    // Plan appears as an in-log card, not a sticky bar above the composer.
    expect(document.querySelector(".wb-acp-plan-bar")).toBeNull();
    expect(await screen.findByText("# Goal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));
    expect(await screen.findByRole("dialog", { name: /plan preview/i })).toBeTruthy();
    expect(screen.getByText("Ship plan preview")).toBeTruthy();
  });
});

describe("AcpChatView message layout", () => {
  it("renders user and assistant rows with Telegram-style bubble classes", async () => {
    await renderChat();
    emit({
      type: "history",
      chatId: "chat-1",
      messages: [
        { id: "u1", role: "user", text: "Hello agent", timestamp: Date.UTC(2026, 0, 1, 12, 0, 0) },
        { id: "a1", role: "assistant", text: "Hi there", timestamp: Date.UTC(2026, 0, 1, 12, 1, 0) },
        { id: "a2", role: "assistant", text: "Second line", timestamp: Date.UTC(2026, 0, 1, 12, 2, 0) }
      ]
    });

    await waitFor(() => {
      expect(screen.getByText("Hello agent")).toBeTruthy();
      expect(screen.getByText("Hi there")).toBeTruthy();
    });

    const userBubble = screen.getByText("Hello agent").closest(".chat-bubble");
    const assistantBubble = screen.getByText("Hi there").closest(".chat-bubble");
    const secondAssistant = screen.getByText("Second line").closest(".chat-bubble");
    expect(userBubble?.className).toContain("user");
    expect(assistantBubble?.className).toContain("assistant");
    expect(userBubble?.closest(".chat-message")?.className).toContain("chat-message-out");
    expect(assistantBubble?.closest(".chat-message")?.className).toContain("chat-message-in");
    expect(assistantBubble?.querySelector(".chat-sender")).toBeTruthy();
    // Consecutive inbound messages only show sender on the first of the cluster.
    expect(secondAssistant?.querySelector(".chat-sender")).toBeNull();
    expect(assistantBubble?.querySelector(".chat-footer-meta")).toBeTruthy();
    expect(document.querySelector(".wb-acp-day-separator")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /copy/i }).length).toBeGreaterThan(0);
  });

  it("clamps long tool labels and expands on click", async () => {
    const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("wb-acp-tool-label") ? 48 : (scrollHeight?.get?.call(this) ?? 0);
      }
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("wb-acp-tool-label") ? 20 : (clientHeight?.get?.call(this) ?? 0);
      }
    });

    try {
      await renderChat();
      const longTitle =
        "Run a very long shell command that definitely wraps past two lines of tool chip text when the bubble is constrained";
      emit({
        type: "history",
        chatId: "chat-1",
        messages: [
          {
            id: "a1",
            role: "assistant",
            text: "Working",
            timestamp: Date.now(),
            toolCalls: [{ toolCallId: "t1", title: longTitle, kind: "execute", status: "completed" }]
          }
        ]
      });

      const chip = await screen.findByRole("button", { name: new RegExp(longTitle.slice(0, 20)) });
      expect(chip.querySelector(".wb-acp-tool-label")).toBeTruthy();
      await waitFor(() => expect(chip.className).toContain("is-expandable"));
      fireEvent.click(chip);
      expect(chip.className).toContain("is-expanded");
      expect(chip.getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(chip);
      expect(chip.className).not.toContain("is-expanded");
    } finally {
      if (scrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeight);
      else delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
      if (clientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
      else delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
    }
  });
});
