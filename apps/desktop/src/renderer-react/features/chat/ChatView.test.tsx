import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ChatView } from "./ChatView";
import { sortGtdTasks } from "./ChatComposer";
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
      contextMenuShow: vi.fn().mockResolvedValue(null),
      notesListTasks: vi.fn().mockResolvedValue([
        { noteId: "task-done", title: "Completed Task", gtdStatus: "done", updatedAtMs: 1000 },
        { noteId: "task-todo-1", title: "First Todo Task", gtdStatus: "inbox", updatedAtMs: 5000 },
        { noteId: "task-next", title: "In Progress Task", gtdStatus: "next", updatedAtMs: 4000 },
        { noteId: "task-waiting", title: "Waiting Task", gtdStatus: "waiting", updatedAtMs: 3000 },
        { noteId: "task-todo-2", title: "Second Todo Task", gtdStatus: "inbox", updatedAtMs: 6000 }
      ]),
      notesEnsureTaskWorkspace: vi.fn().mockResolvedValue({ dir: "/work/gtd/task-todo-2" }),
      notesTaskNoteIdForSession: vi.fn().mockResolvedValue(null),
      notesRead: vi.fn().mockResolvedValue({
        record: { title: "Second Todo Task", gtdStatus: "inbox" },
        content: "# Second Todo Task\n\nTask background knowledge"
      })
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

  it("sorts GTD tasks in TODO -> DONE default order", () => {
    const rawTasks = [
      { noteId: "done-1", title: "Finished", gtdStatus: "done", updatedAtMs: 100 },
      { noteId: "next-1", title: "In Progress", gtdStatus: "next", updatedAtMs: 200 },
      { noteId: "todo-old", title: "Older Todo", gtdStatus: "inbox", updatedAtMs: 300 },
      { noteId: "waiting-1", title: "Blocked", gtdStatus: "waiting", updatedAtMs: 400 },
      { noteId: "todo-new", title: "Newer Todo", gtdStatus: "inbox", updatedAtMs: 500 }
    ];

    const sorted = sortGtdTasks(rawTasks);
    expect(sorted.map((t) => t.noteId)).toEqual([
      "todo-new",
      "todo-old",
      "next-1",
      "waiting-1",
      "done-1"
    ]);
  });

  it("selects workspace from Finder and updates workspace label", async () => {
    window.agentResume.contextMenuShow = vi.fn().mockResolvedValue("finder:choose");
    window.agentResume.pickDirectory = vi.fn().mockResolvedValue({
      ok: true,
      path: "/Users/lucas/workspace/my-project"
    });

    render(
      <I18nProvider>
        <ChatView active={true} />
      </I18nProvider>
    );

    const wsBtn = screen.getByLabelText("选择工作区");
    fireEvent.click(wsBtn);

    await waitFor(() => {
      expect(window.agentResume.pickDirectory).toHaveBeenCalled();
      expect(wsBtn.textContent).toContain("my-project");
    });
  });

  it("selects a GTD task and passes taskNoteId when sending prompt", async () => {
    let capturedMenuItems: any[] = [];
    window.agentResume.contextMenuShow = vi.fn().mockImplementation(async ({ items }) => {
      capturedMenuItems = items;
      return "gtd:task-todo-2";
    });

    render(
      <I18nProvider>
        <ChatView active={true} />
      </I18nProvider>
    );

    const wsBtn = screen.getByLabelText("选择工作区");
    fireEvent.click(wsBtn);

    await waitFor(() => {
      expect(window.agentResume.notesEnsureTaskWorkspace).toHaveBeenCalledWith({
        noteId: "task-todo-2"
      });
      // Should show [待办] Second Todo Task
      expect(wsBtn.textContent).toContain("Second Todo Task");
      expect(wsBtn.textContent).toContain("[待办]");
    });

    // Menu should contain Finder option and GTD tasks ordered TODO -> DONE
    expect(capturedMenuItems.some((i) => i.id === "finder:choose")).toBe(true);
    const gtdItems = capturedMenuItems.filter((i) => i.id && i.id.startsWith("gtd:"));
    expect(gtdItems.map((i) => i.id)).toEqual([
      "gtd:task-todo-2",
      "gtd:task-todo-1",
      "gtd:task-next",
      "gtd:task-waiting",
      "gtd:task-done"
    ]);

    // Send a message and verify taskNoteId is passed along with workspaceDir
    const textarea = screen.getByPlaceholderText(/Ask Thunder agent anything/i);
    fireEvent.change(textarea, { target: { value: "Review task requirements" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(window.agentResume.thunderChatRunTask).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Review task requirements",
          taskNoteId: "task-todo-2",
          workspaceDir: "/work/gtd/task-todo-2"
        })
      );
    });
  });

  it("restores GTD task workspace binding when selecting linked session", async () => {
    window.agentResume.notesTaskNoteIdForSession = vi.fn().mockResolvedValue("task-next");

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

    const wsBtn = screen.getByLabelText("选择工作区");
    await waitFor(() => {
      expect(wsBtn.textContent).toContain("In Progress Task");
      expect(wsBtn.textContent).toContain("[进行中]");
    });
  });
});
