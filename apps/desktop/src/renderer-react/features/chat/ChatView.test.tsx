import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ChatView } from "./ChatView";
import type { ThunderConversationSummary } from "@agent-resume/core";

const mockConversations: ThunderConversationSummary[] = [
  {
    id: "sess_1",
    title: "Inspect Git Status & Changes",
    status: "active",
    message_count: 2,
    turn_count: 1,
    total_tokens: 350,
    created_at_ms: Date.now() - 1000,
    updated_at_ms: Date.now() - 500
  },
  {
    id: "sess_2",
    title: "Draft Unit Tests",
    status: "active",
    message_count: 4,
    turn_count: 2,
    total_tokens: 820,
    created_at_ms: Date.now() - 86400000,
    updated_at_ms: Date.now() - 86000000
  }
];

describe("ChatView", () => {
  beforeEach(() => {
    const host = document.createElement("div");
    host.id = "react-chat";
    document.body.appendChild(host);

    window.agentResume = {
      getI18nBundle: vi.fn().mockResolvedValue({ locale: "en", messages: {} }),
      onI18nBundleChanged: vi.fn().mockReturnValue(() => undefined),
      onLocaleChanged: vi.fn().mockReturnValue(() => undefined),
      thunderGetStatus: vi.fn().mockResolvedValue({
        available: true,
        repoPath: "/path/to/thunder",
        daemonPath: "/path/to/thunder/daemon.sh",
        models: [
          { id: "gpt-4o", provider: "openai", name: "GPT-4o", selection_id: "openai/gpt-4o", available: true }
        ]
      }),
      thunderListModels: vi.fn().mockResolvedValue([
        { id: "gpt-4o", provider: "openai", name: "GPT-4o", selection_id: "openai/gpt-4o", available: true }
      ]),
      thunderChatListConversations: vi.fn().mockResolvedValue(mockConversations),
      thunderChatGetConversation: vi.fn().mockResolvedValue({
        id: "sess_1",
        title: "Inspect Git Status & Changes",
        status: "active",
        messages: [
          { role: "user", content: "Check git status" },
          { role: "assistant", content: "Working tree is clean." }
        ],
        created_at_ms: Date.now() - 1000,
        updated_at_ms: Date.now() - 500
      }),
      thunderChatDeleteConversation: vi.fn().mockResolvedValue(true),
      thunderChatRunTask: vi.fn().mockResolvedValue({
        finalContent: "Thunder task finished.",
        finishReason: "Done"
      }),
      thunderChatCancelTask: vi.fn().mockResolvedValue(true),
      onThunderChatEvent: vi.fn().mockReturnValue(() => undefined),
      pickDirectory: vi.fn().mockResolvedValue({ ok: true, path: "/work/repo" })
    } as any;
  });

  afterEach(() => {
    cleanup();
    document.getElementById("react-chat")?.remove();
  });

  it("renders conversation history and empty state or starters", async () => {
    render(
      <I18nProvider>
        <ChatView active={true} />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Inspect Git Status & Changes").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Draft Unit Tests")).toBeTruthy();
    });

    expect(screen.getByText("New Chat")).toBeTruthy();
    expect(screen.getByText("Thunder Daemon")).toBeTruthy();
  });

  it("loads conversation messages when a session is selected", async () => {
    render(
      <I18nProvider>
        <ChatView active={true} />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Inspect Git Status & Changes").length).toBeGreaterThanOrEqual(1);
    });

    const items = screen.getAllByText("Inspect Git Status & Changes");
    fireEvent.click(items[0]);

    await waitFor(() => {
      expect(screen.getByText("Check git status")).toBeTruthy();
      expect(screen.getByText("Working tree is clean.")).toBeTruthy();
    });
  });

  it("submits a new message through the composer", async () => {
    render(
      <I18nProvider>
        <ChatView active={true} />
      </I18nProvider>
    );

    const textarea = screen.getByPlaceholderText(/Ask Thunder agent anything/i);
    fireEvent.change(textarea, { target: { value: "Hello Thunder Agent" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(window.agentResume.thunderChatRunTask).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Hello Thunder Agent"
        })
      );
    });
  });
});
