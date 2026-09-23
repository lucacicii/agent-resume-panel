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
          {
            id: "gpt-4o",
            provider: "openai",
            name: "GPT-4o",
            selection_id: "openai/gpt-4o",
            available: true,
            reasoning: false,
            thinking_levels: ["off"],
            default_thinking_level: "off"
          },
          {
            id: "o3-mini",
            provider: "openai",
            name: "o3-mini",
            selection_id: "openai/o3-mini",
            available: true,
            reasoning: true,
            thinking_levels: ["off", "low", "medium", "high"],
            default_thinking_level: "medium"
          }
        ]
      }),
      thunderListModels: vi.fn().mockResolvedValue([
        {
          id: "gpt-4o",
          provider: "openai",
          name: "GPT-4o",
          selection_id: "openai/gpt-4o",
          available: true,
          reasoning: false,
          thinking_levels: ["off"],
          default_thinking_level: "off"
        },
        {
          id: "o3-mini",
          provider: "openai",
          name: "o3-mini",
          selection_id: "openai/o3-mini",
          available: true,
          reasoning: true,
          thinking_levels: ["off", "low", "medium", "high"],
          default_thinking_level: "medium"
        }
      ]),
      thunderChatListConversations: vi.fn().mockResolvedValue(mockConversations),
      thunderChatGetConversation: vi.fn().mockResolvedValue({
        id: "sess_1",
        title: "Inspect Git Status & Changes",
        model: "openai/gpt-4o",
        workspace: "/work/repo",
        thinking_level: "high",
        status: "active",
        messages: [
          { role: "user", content: "Check git status" },
          { role: "assistant", content: "Working tree is clean." }
        ],
        created_at_ms: Date.now() - 1000,
        updated_at_ms: Date.now() - 500
      }),
      thunderChatDeleteConversation: vi.fn().mockResolvedValue(true),
      thunderChatTruncateConversation: vi.fn().mockResolvedValue(true),
      thunderChatRunTask: vi.fn().mockResolvedValue({
        finalContent: "Thunder task finished.",
        finishReason: "Done"
      }),
      thunderChatCancelTask: vi.fn().mockResolvedValue(true),
      onThunderChatEvent: vi.fn().mockReturnValue(() => undefined),
      pickDirectory: vi.fn().mockResolvedValue({ ok: true, path: "/work/repo" }),
      contextMenuShow: vi.fn().mockResolvedValue(null)
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

  it("regenerates the assistant response when clicking Regenerate", async () => {
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
      expect(screen.getByText("Working tree is clean.")).toBeTruthy();
    });

    const regenBtn = screen.getByTitle("Regenerate answer");
    fireEvent.click(regenBtn);

    await waitFor(() => {
      expect(window.agentResume.thunderChatTruncateConversation).toHaveBeenCalled();
      expect(window.agentResume.thunderChatRunTask).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Check git status"
        })
      );
    });
  });

  it("resends user prompt when clicking Resend", async () => {
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
    });

    const resendBtn = screen.getByTitle("Resend this message");
    fireEvent.click(resendBtn);

    await waitFor(() => {
      expect(window.agentResume.thunderChatTruncateConversation).toHaveBeenCalled();
      expect(window.agentResume.thunderChatRunTask).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Check git status"
        })
      );
    });
  });

  it("restores bound model, workspace, and thinking level from conversation", async () => {
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
    });

    // Send a message and check that the bound model, workspace, and thinking_level are sent
    const textarea = screen.getByPlaceholderText(/Ask Thunder agent anything/i);
    fireEvent.change(textarea, { target: { value: "Follow up question" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(window.agentResume.thunderChatRunTask).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Follow up question",
          model: "openai/gpt-4o",
          workspaceDir: "/work/repo",
          thinking_level: "high"
        })
      );
    });
  });

  it("dynamically reads model thinking_levels and switches to model default_thinking_level", async () => {
    let capturedMenuItems: any[] = [];
    window.agentResume.contextMenuShow = vi.fn().mockImplementation(async ({ items }) => {
      capturedMenuItems = items;
      return "openai/o3-mini";
    });

    render(
      <I18nProvider>
        <ChatView active={true} />
      </I18nProvider>
    );

    // Initial model is gpt-4o, non-reasoning with levels ["off"]
    await waitFor(() => {
      const modelBtn = screen.getByLabelText(/Select Model: GPT-4o/i);
      expect(modelBtn).toBeTruthy();
    });

    const thinkingBtn = screen.getByLabelText(/Thinking Level/i) as HTMLButtonElement;
    expect(thinkingBtn.disabled).toBe(true);
    expect(thinkingBtn.textContent).toContain("Thinking: Off");

    // Click model select button to switch to o3-mini
    const modelBtn = screen.getByLabelText(/Select Model: GPT-4o/i);
    fireEvent.click(modelBtn);

    await waitFor(() => {
      expect(thinkingBtn.disabled).toBe(false);
      expect(thinkingBtn.textContent).toContain("Thinking: Medium");
    });

    // Click thinking level button to verify options passed to contextMenuShow
    window.agentResume.contextMenuShow = vi.fn().mockImplementation(async ({ items }) => {
      capturedMenuItems = items;
      return "high";
    });
    fireEvent.click(thinkingBtn);

    await waitFor(() => {
      expect(capturedMenuItems.map((i) => i.id)).toEqual(["off", "low", "medium", "high"]);
      expect(thinkingBtn.textContent).toContain("Thinking: High");
    });

    // Send a message and verify that the updated thinking_level "high" is submitted
    const textarea = screen.getByPlaceholderText(/Ask Thunder agent anything/i);
    fireEvent.change(textarea, { target: { value: "Perform reasoning calculation" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(window.agentResume.thunderChatRunTask).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Perform reasoning calculation",
          model: "openai/o3-mini",
          thinking_level: "high"
        })
      );
    });
  });
});
