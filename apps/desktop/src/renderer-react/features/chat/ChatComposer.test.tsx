import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ChatComposer, compileChatPrompt } from "./ChatComposer";
import type { SkillDescriptor, AgentToolDescriptor } from "@agent-resume/core";

describe("compileChatPrompt", () => {
  beforeEach(() => {
    (window as any).agentResume = {
      readSkill: vi.fn().mockResolvedValue("Instructions for browser-use skill"),
      notesRead: vi.fn().mockImplementation(async ({ noteId }: { noteId: string }) => {
        if (noteId === "note-1") {
          return {
            record: { noteId: "note-1", title: "Architecture Doc" },
            content: "Architecture details: microservices and event buses."
          };
        }
        if (noteId === "task-1") {
          return {
            record: { noteId: "task-1", title: "Migrate database" },
            content: "Step 1: create migration scripts\nStep 2: apply in staging"
          };
        }
        return null;
      }),
      thunderChatGetConversation: vi.fn().mockResolvedValue({
        id: "sess-1",
        title: "Previous Discussion",
        messages: [
          { role: "user", content: "How does caching work?" },
          { role: "assistant", content: "It uses Redis TTLs." }
        ]
      }),
      workbenchReadFileText: vi.fn().mockImplementation(async ({ filePath }: { filePath: string }) => {
        if (filePath === "src/index.ts") {
          return {
            content: "export const app = 'test';",
            truncated: false,
            byteLength: 28
          };
        }
        return null;
      })
    };
  });

  it("resolves skill slash command and injects skill instructions", async () => {
    const skills: SkillDescriptor[] = [
      {
        name: "browser-use",
        description: "Direct browser control via CDP",
        location: "/path/to/SKILL.md",
        directory: "/path/to",
        scope: "user"
      }
    ];

    const result = await compileChatPrompt("/browser-use search github for agent-resume", {
      workspaceDir: "/work/repo",
      skills
    });

    expect((window as any).agentResume.readSkill).toHaveBeenCalledWith({ location: "/path/to/SKILL.md" });
    expect(result).toContain("[Active Skill Instructions: browser-use]");
    expect(result).toContain("Instructions for browser-use skill");
    expect(result).toContain("search github for agent-resume");
  });

  it("resolves MCP tool slash command and injects tool block", async () => {
    const tools: AgentToolDescriptor[] = [
      {
        name: "bash",
        description: "Execute bash commands in working directory",
        category: "workbench",
        kind: "core_mcp"
      }
    ];

    const result = await compileChatPrompt("/bash ls -la", {
      workspaceDir: "/work/repo",
      tools
    });

    expect(result).toContain("[Requested MCP Tool: bash]");
    expect(result).toContain("Execute bash commands in working directory");
    expect(result).toContain("ls -la");
  });

  it("resolves referenced note, task, and session mentions (@)", async () => {
    const result = await compileChatPrompt("Please review these resources", {
      workspaceDir: "/work/repo",
      referencedMentions: [
        { kind: "note", id: "note-1", title: "Architecture Doc", badge: "笔记" },
        { kind: "task", id: "task-1", title: "Migrate database", badge: "任务", gtdStatus: "next" },
        { kind: "session", id: "sess-1", title: "Previous Discussion", badge: "会话" }
      ]
    });

    expect(result).toContain("[Referenced Note: Architecture Doc]");
    expect(result).toContain("Architecture details: microservices and event buses.");

    expect(result).toContain("[Referenced GTD Task: Migrate database (Status: 进行中)]");
    expect(result).toContain("Step 1: create migration scripts");

    expect(result).toContain("[Referenced Conversation: Previous Discussion]");
    expect(result).toContain("user: How does caching work?");
    expect(result).toContain("assistant: It uses Redis TTLs.");
    expect(result).toContain("Please review these resources");
  });

  it("resolves referenced file (#) and reads its text content", async () => {
    const result = await compileChatPrompt("Check this file #src/index.ts", {
      workspaceDir: "/work/repo",
      referencedFiles: ["src/index.ts"]
    });

    expect((window as any).agentResume.workbenchReadFileText).toHaveBeenCalledWith({
      rootPath: "/work/repo",
      filePath: "src/index.ts",
      maxBytes: 64 * 1024
    });
    expect(result).toContain("[Referenced File: src/index.ts]");
    expect(result).toContain("export const app = 'test';");
    expect(result).toContain("Check this file #src/index.ts");
  });
});

describe("ChatComposer UI popovers and keyboard interactions", () => {
  const defaultProps = {
    onSend: vi.fn(),
    onCancel: vi.fn(),
    isStreaming: false,
    models: [{ id: "mock-1", name: "Mock Model", selection_id: "mock-1", provider: "mock", available: true }],
    selectedModel: "mock-1",
    onSelectModel: vi.fn(),
    thinkingLevel: "off",
    onSelectThinkingLevel: vi.fn(),
    workspaceDir: "/test/workspace",
    onSelectWorkspaceDir: vi.fn(),
    useMock: false,
    onToggleMock: vi.fn()
  };

  beforeEach(() => {
    (window as any).agentResume = {
      listSkills: vi.fn().mockResolvedValue([
        {
          name: "dividend-cows",
          description: "High dividend stock screener",
          location: "/skills/dividend-cows/SKILL.md",
          directory: "/skills/dividend-cows",
          scope: "user"
        }
      ]),
      listAgentTools: vi.fn().mockResolvedValue([
        {
          name: "bash",
          description: "Execute shell command",
          category: "workbench",
          kind: "core_mcp"
        }
      ]),
      notesList: vi.fn().mockResolvedValue([
        { noteId: "note-abc", title: "Project Plan", relDir: "docs" }
      ]),
      notesListTasks: vi.fn().mockResolvedValue([
        { noteId: "task-xyz", title: "Refactor router", gtdStatus: "next", updatedAtMs: Date.now() }
      ]),
      thunderChatListConversations: vi.fn().mockResolvedValue([
        { id: "conv-123", title: "Design Review", message_count: 5 }
      ]),
      workbenchListDirectory: vi.fn().mockResolvedValue({
        entries: [
          { name: "src", isDirectory: true },
          { name: "package.json", isDirectory: false }
        ]
      }),
      readSkill: vi.fn().mockResolvedValue("Skill content"),
      notesRead: vi.fn().mockResolvedValue({
        record: { noteId: "note-abc", title: "Project Plan" },
        content: "Detailed project plan contents."
      }),
      workbenchReadFileText: vi.fn().mockResolvedValue({
        content: "{\n  \"name\": \"app\"\n}",
        truncated: false,
        byteLength: 20
      })
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("displays slash suggestions when typing / and accepts selection with Tab", async () => {
    render(<ChatComposer {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Ask Thunder agent anything/i);

    // Type "/" to open slash popover
    fireEvent.change(textarea, { target: { value: "/", selectionStart: 1 } });

    await waitFor(() => {
      expect(screen.getByRole("listbox", { name: /slash commands/i })).toBeTruthy();
      expect(screen.getByText("/dividend-cows")).toBeTruthy();
    });

    // Press Tab to accept the first slash command
    fireEvent.keyDown(textarea, { key: "Tab" });

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe("/dividend-cows ");
    });
  });

  it("displays mention suggestions when typing @ and accepts selection with Enter", async () => {
    render(<ChatComposer {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Ask Thunder agent anything/i);

    // Type "@" to open mention popover
    fireEvent.change(textarea, { target: { value: "@", selectionStart: 1 } });

    await waitFor(() => {
      expect(screen.getByRole("listbox", { name: /mention context/i })).toBeTruthy();
      expect(screen.getByText("@Refactor router")).toBeTruthy();
      expect(screen.getByText("@Project Plan")).toBeTruthy();
    });

    // Press Enter to accept first mention
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe("@Refactor router ");
    });
  });

  it("displays file/directory suggestions when typing # and navigates with ArrowRight", async () => {
    render(<ChatComposer {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Ask Thunder agent anything/i);

    // Type "#" to open file/directory popover
    fireEvent.change(textarea, { target: { value: "#", selectionStart: 1 } });

    await waitFor(() => {
      expect(screen.getByRole("listbox", { name: /files and directories/i })).toBeTruthy();
      expect(screen.getByText("#src/")).toBeTruthy();
      expect(screen.getByText("#package.json")).toBeTruthy();
    });

    // Press ArrowRight on "src" directory to enter directory drilldown
    fireEvent.keyDown(textarea, { key: "ArrowRight" });

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe("#src/");
    });
  });

  it("compiles prompt and calls onSend with context when Enter is pressed", async () => {
    const onSend = vi.fn();
    render(<ChatComposer {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Ask Thunder agent anything/i);

    // Type mention "@Project Plan"
    fireEvent.change(textarea, { target: { value: "@", selectionStart: 1 } });

    await waitFor(() => {
      expect(screen.getByText("@Project Plan")).toBeTruthy();
    });

    // Click on "@Project Plan"
    fireEvent.click(screen.getByText("@Project Plan"));

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe("@Project Plan ");
    });

    // Add prompt text and submit
    fireEvent.change(textarea, {
      target: { value: "@Project Plan please review this plan", selectionStart: 38 }
    });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        expect.stringContaining("[Referenced Note: Project Plan]"),
        expect.anything()
      );
      expect(onSend).toHaveBeenCalledWith(
        expect.stringContaining("Detailed project plan contents."),
        expect.anything()
      );
    });
  });
  it("offers roles in the slash palette ahead of skills and tools", async () => {
    const roles = [
      {
        id: "plan",
        name: "Plan",
        aliases: ["p"],
        description: "Plan before acting",
        permission: "read"
      }
    ];
    render(<ChatComposer {...defaultProps} roles={roles} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "/", selectionStart: 1 } });

    const list = await screen.findByRole("listbox", { name: /slash commands/i });
    const options = list.querySelectorAll('[role="option"]');
    expect(options[0]?.textContent).toContain("/plan");
    expect(options[0]?.textContent).toContain("read-only");
  });

  it("passes the selected role id when sending a leading slash command", async () => {
    const onSend = vi.fn();
    const roles = [
      { id: "plan", name: "Plan", aliases: [], description: "Plan only", permission: "read" }
    ];
    render(<ChatComposer {...defaultProps} onSend={onSend} roles={roles} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "/plan refactor auth" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][1]).toMatchObject({ role: "plan" });
  });

  it("omits the role when the prompt has no leading slash command", async () => {
    const onSend = vi.fn();
    const roles = [
      { id: "plan", name: "Plan", aliases: [], description: "Plan only", permission: "read" }
    ];
    render(<ChatComposer {...defaultProps} onSend={onSend} roles={roles} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "just a normal question" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][1]?.role).toBeUndefined();
  });

  it("resolves a role alias to its canonical id", async () => {
    const onSend = vi.fn();
    const roles = [
      { id: "plan", name: "Plan", aliases: ["p"], description: "Plan only", permission: "read" }
    ];
    render(<ChatComposer {...defaultProps} onSend={onSend} roles={roles} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "/p refactor auth" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][1]).toMatchObject({ role: "plan" });
  });

  it("keeps the Cache badge always visible during streaming and renders reasoning tokens", () => {
    const { container, rerender } = render(
      <ChatComposer
        {...defaultProps}
        isStreaming={true}
        streamingMetrics={{ tokensCount: 150, tps: 25.5, reasoningCount: 90 }}
        lastRunMetrics={{
          promptTokens: 1000,
          completionTokens: 200,
          cachedTokens: 800,
          reasoningTokens: 120,
          totalTokens: 1200,
          tps: 30
        }}
      />
    );

    // During streaming: tok/s, token count, and reasoning breakdown are displayed
    expect(container.textContent).toContain("25.5 tok/s");
    expect(container.textContent).toContain("150 tokens");
    expect(container.textContent).toContain("(含思考 90)");

    // Cache badge is ALWAYS visible during streaming and retains previous-turn cache info
    const cacheBadge = container.querySelector(".tb-metrics-cache-badge");
    expect(cacheBadge).not.toBeNull();
    expect(cacheBadge?.textContent).toContain("Cache 800");
    expect(cacheBadge?.textContent).toContain("80.00%");

    // Now switch to completed (non-streaming) turn
    rerender(
      <ChatComposer
        {...defaultProps}
        isStreaming={false}
        lastRunMetrics={{
          promptTokens: 1000,
          completionTokens: 350,
          cachedTokens: 800,
          reasoningTokens: 200,
          totalTokens: 1350,
          tps: 28.4
        }}
      />
    );

    // Completed turn: speed, turn tokens, breakdown with reasoning tokens, and persistent Cache badge
    expect(container.textContent).toContain("28.4 tok/s");
    expect(container.textContent).toContain("Turn: 1,350");
    expect(container.textContent).toContain("In 1,000 · Out 350 (含思考 200)");
    const finishedCacheBadge = container.querySelector(".tb-metrics-cache-badge");
    expect(finishedCacheBadge).not.toBeNull();
    expect(finishedCacheBadge?.textContent).toContain("Cache 800");
  });

  it("renders Cache 0 in initial state without crashing or disappearing", () => {
    const { container } = render(
      <ChatComposer
        {...defaultProps}
        isStreaming={false}
        lastRunMetrics={null}
      />
    );

    expect(container.textContent).toContain("Ready");
    const cacheBadge = container.querySelector(".tb-metrics-cache-badge");
    expect(cacheBadge).not.toBeNull();
    expect(cacheBadge?.textContent).toContain("Cache 0");
    expect(cacheBadge?.className).toContain("is-zero");
  });

  it("renders Cache hit ratio with two decimal places", () => {
    const { container } = render(
      <ChatComposer
        {...defaultProps}
        isStreaming={false}
        lastRunMetrics={{
          promptTokens: 1234,
          completionTokens: 200,
          cachedTokens: 800,
          totalTokens: 1434
        }}
      />
    );

    const cacheBadge = container.querySelector(".tb-metrics-cache-badge");
    expect(cacheBadge).not.toBeNull();
    expect(cacheBadge?.textContent).toContain("Cache 800");
    expect(cacheBadge?.textContent).toContain("64.83%");
  });
});
