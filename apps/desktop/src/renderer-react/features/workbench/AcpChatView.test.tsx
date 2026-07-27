import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { AcpChatView } from "./AcpChatView";

const streamListeners = new Set<(event: Record<string, unknown>) => void>();

function emit(event: Record<string, unknown>): void {
  for (const listener of streamListeners) listener(event);
}

async function renderChat(): Promise<void> {
  window.agentResume = {
    getI18nBundle: vi.fn(async () => ({
      locale: "en",
      messages: { "desktop.workbench.acpSlashCommands": "Agent commands" }
    })),
    onLocaleChanged: vi.fn(() => () => undefined),
    onAcpStream: (listener: (event: Record<string, unknown>) => void) => {
      streamListeners.add(listener);
      return () => streamListeners.delete(listener);
    },
    acpConnect: vi.fn(async () => ({ ok: true, record: { id: "chat-1", title: "Chat", provider: "codex" } })),
    acpDisconnect: vi.fn(async () => ({ ok: true })),
    acpPrompt: vi.fn(async () => ({ ok: true }))
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
      isRunning: false,
      isConnecting: false,
      status: "ready",
      fileUpload: true
    }
  });
}

afterEach(() => {
  cleanup();
  streamListeners.clear();
});

describe("AcpChatView slash commands", () => {
  it("filters dynamic agent commands and inserts a selected command", async () => {
    const user = userEvent.setup();
    await renderChat();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(input, "/re");
    expect(await screen.findByRole("option", { name: /\/review/i })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /\/plan/i })).toBeNull();
    await user.keyboard("{Enter}");
    expect(input.value).toBe("/review");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("supports keyboard selection and retains a space for command input", async () => {
    const user = userEvent.setup();
    await renderChat();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(input, "/");
    await screen.findAllByRole("option");
    await user.keyboard("{ArrowDown}{Tab}");
    expect(input.value).toBe("/plan ");
  });

  it("closes the menu with Escape and sends the retained input with Enter", async () => {
    const user = userEvent.setup();
    await renderChat();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(input, "/review");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}{Enter}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(window.agentResume.acpPrompt).toHaveBeenCalledWith({ chatId: "chat-1", text: "/review", images: [], files: [] });
  });

  it("selects a command with the pointer", async () => {
    await renderChat();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/pl" } });
    fireEvent.click(screen.getByRole("option", { name: /\/plan/i }));
    expect(input.value).toBe("/plan ");
  });
});
